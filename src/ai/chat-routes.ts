/**
 * AI chat routes — multi-turn tool-use via Vercel AI SDK + DeepSpace proxy.
 *
 * Registers four endpoints on the passed-in Hono app:
 *   POST   /api/ai/chats       — find or create the caller's chat for a trip (members only)
 *   PATCH  /api/ai/chats/:id   — rename / patch a chat
 *   DELETE /api/ai/chats/:id   — delete chat + cascade messages
 *   POST   /api/ai/chat        — streamed assistant turn (the big one)
 *
 * Every turn is owner-billed with claude-haiku-5-5 chosen here (a client
 * modelId is ignored), and is reserved against the caller's daily chat cap and
 * the app-wide credit ceiling before the model runs.
 *
 * Lives in its own file so worker.ts can stay small and the streaming
 * handler's full context (compaction, tools, persistence, abort handling)
 * is co-located rather than scattered through the entry file.
 */

import type { Context, Hono } from 'hono'
import { createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, type ModelMessage } from 'ai'
import {
  AgentToolError,
  deepSpaceAgentErrorSummary,
  prepareMessagesWithCompaction,
  resolveDeepSpaceAgentModel,
  streamDeepSpaceAgent,
  turnsToCoreMessages,
  buildUiParts,
  makeDefaultSummarizer,
  createUserToolExecutor,
  DEFAULT_CONTEXT_CONFIG,
  getChat,
  updateChat,
  deleteChatCascade,
  loadMessages,
  appendMessage,
  loggableError,
} from 'deepspace/worker'
import type { ActionTools, AgentToolAccessResult, AgentToolRouteOptions, ChatTurn } from 'deepspace/worker'
import { createActionTools } from '../server/action-routes.js'
import { memberTrip } from '../server/board-services.js'
import { mocksExternalApis, reservePaidCall } from '../server/trip-services.js'
import { CHAT_MESSAGES, chatErrorText } from './errors.js'
import { buildTripPrompt } from './prompt.js'
import { createTestChatModel } from './test-model.js'
import { loadTripContext } from './tools.js'
// Type-only — TypeScript strips these at runtime, so no circular import
// with worker.ts (which imports `registerAiChatRoutes` from this file).
import type { Env, AppContext } from '../../worker.js'

type ResolveAccess = (req: Request, env: Env) => Promise<AgentToolAccessResult>
type AccessGrant = Extract<AgentToolAccessResult, { ok: true }>
/** `buildTools` from src/ai/tools.ts; it may ignore the context argument. */
type ToolFactory = AgentToolRouteOptions<Env>['buildTools']

function recordRoomStub(env: Env): DurableObjectStub {
  // Rooms are keyed by the immutable app id — the same `app:${DEEPSPACE_APP_ID}`
  // the client's RecordScope (SCOPE_ID) and worker.ts's own stubs use. Keying
  // by APP_NAME would read/write a room the browser never subscribes to.
  return env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
}

const CHAT_MODEL_ID = 'claude-haiku-5-5'
/** Bounds one turn's spend: tool steps, effort and reply length. */
const MAX_TOOL_CALLS = 8
const MAX_OUTPUT_TOKENS = 1024

/** The caller's chat row with its trip, or null when it is missing or someone else's. */
async function getTripChat(tools: ActionTools, chatId: string, userId: string): Promise<{ tripId: string } | null> {
  const res = await tools.get<Record<string, unknown>>('ai-chats', chatId)
  const data = res.success ? (res.data.record?.data as { userId?: string; tripId?: string } | undefined) : undefined
  return data?.userId === userId && typeof data.tripId === 'string' ? { tripId: data.tripId } : null
}

async function findTripChat(tools: ActionTools, userId: string, tripId: string): Promise<string | null> {
  const res = await tools.query('ai-chats', { where: { userId, tripId }, limit: 1 })
  return res.success ? (res.data.records[0]?.recordId ?? null) : null
}

// Cap on user-supplied content length. Far above any realistic message;
// blocks accidental DoS via megabyte payloads.
const MAX_USER_CONTENT_LENGTH = 100_000

// Derive a chat title from the first user message — first non-empty line,
// trimmed to ~50 chars with an ellipsis.
function deriveTitle(content: string): string {
  const first =
    content
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? 'Untitled'
  return first.length <= 50 ? first : first.slice(0, 47).trimEnd() + '…'
}

export function registerAiChatRoutes(
  app: Hono<AppContext>,
  resolveAccess: ResolveAccess,
  buildTools: ToolFactory,
): void {
  // One chokepoint for the access-decision → HTTP mapping on every chat route.
  const requireAccess = async (c: Context<AppContext>): Promise<AccessGrant | Response> => {
    const access = await resolveAccess(c.req.raw, c.env)
    if (access.ok) return access
    const error =
      access.status === 401
        ? 'Unauthorized'
        : access.status === 403
          ? 'Forbidden'
          : 'Temporarily unavailable'
    return c.json({ error }, access.status)
  }

  // One chat per user per trip: return the caller's existing chat or create it.
  app.post('/api/ai/chats', async (c) => {
    const access = await requireAccess(c)
    if (access instanceof Response) return access
    const { auth } = access

    const body = await c.req.json<{ tripId?: unknown }>().catch(() => ({}) as { tripId?: unknown })
    const tripId = typeof body.tripId === 'string' ? body.tripId.slice(0, 100) : ''
    const tools = createActionTools(c.env, auth.userId, '')
    const trip = await memberTrip(tools, tripId, auth.userId)
    if (!trip.success) return c.json({ error: CHAT_MESSAGES.notMember, code: trip.code }, 403)

    const existing = await findTripChat(tools, auth.userId, tripId)
    if (existing) return c.json({ chat: { recordId: existing } })
    const created = await tools.create('ai-chats', { userId: auth.userId, tripId, title: trip.data.data.name })
    if (created.success) return c.json({ chat: { recordId: created.data.recordId } })
    // A parallel first send won the unique (userId, tripId) row; use it.
    const raced = await findTripChat(tools, auth.userId, tripId)
    if (raced) return c.json({ chat: { recordId: raced } })
    return c.json({ error: 'Could not start the chat' }, 500)
  })

  // Rename / patch a chat. Ownership enforced via getChat.
  app.patch('/api/ai/chats/:id', async (c) => {
    const access = await requireAccess(c)
    if (access instanceof Response) return access
    const { auth } = access

    const id = c.req.param('id')
    const stub = recordRoomStub(c.env)
    const chat = await getChat(stub, id, auth.userId)
    if (!chat) return c.json({ error: 'Not found' }, 404)

    const body = await c.req.json<{ title?: string }>().catch(() => ({}) as { title?: string })
    const patch: { title?: string } = {}
    if (typeof body.title === 'string') patch.title = body.title
    // `updateChat` re-checks the chat; a delete racing this PATCH answers 404
    // instead of `ok: true` for a write that never landed.
    if (!(await updateChat(stub, id, auth.userId, patch)))
      return c.json({ error: 'Not found' }, 404)
    return c.json({ ok: true })
  })

  // Delete chat + cascade messages.
  app.delete('/api/ai/chats/:id', async (c) => {
    const access = await requireAccess(c)
    if (access instanceof Response) return access
    const { auth } = access

    const id = c.req.param('id')
    const stub = recordRoomStub(c.env)
    const chat = await getChat(stub, id, auth.userId)
    if (!chat) return c.json({ error: 'Not found' }, 404)

    await deleteChatCascade(stub, id, auth.userId)
    return c.json({ ok: true })
  })

  // Known limitation: two tabs sending to the same chatId concurrently can
  // interleave row writes (DO serializes individual writes but not the
  // per-request 3-write group). The next turn's history then mis-pairs
  // user/assistant rows. Closing this requires per-chatId locking in the DO;
  // out of scope for this PR. Realistic impact: rare (multi-tab same-chat
  // usage); recoverable by user (one tab works correctly going forward).
  app.post('/api/ai/chat', async (c) => {
    const access = await requireAccess(c)
    if (access instanceof Response) return access
    const { auth } = access

    const { chatId, userMessageId, content } = await c.req.json<{
      chatId?: string
      userMessageId?: string
      content?: string
    }>()
    if (typeof chatId !== 'string' || !chatId) return c.json({ error: 'chatId is required' }, 400)
    if (typeof userMessageId !== 'string' || !userMessageId)
      return c.json({ error: 'userMessageId is required' }, 400)
    if (typeof content !== 'string' || content.trim() === '')
      return c.json({ error: 'content is required' }, 400)
    if (content.length > MAX_USER_CONTENT_LENGTH) {
      return c.json({ error: `content exceeds ${MAX_USER_CONTENT_LENGTH} chars` }, 413)
    }
    // Owner-billed, so the server picks the model; a client modelId is ignored.
    const selectedModel = resolveDeepSpaceAgentModel(CHAT_MODEL_ID, 'application')
    if (!selectedModel) return c.json({ error: 'Chat model unavailable' }, 503)

    const stub = recordRoomStub(c.env)
    const actionTools = createActionTools(c.env, auth.userId, '')
    const chat = await getChat(stub, chatId, auth.userId)
    const tripChat = chat ? await getTripChat(actionTools, chatId, auth.userId) : null
    if (!chat || !tripChat) {
      console.warn('[ai-chat] REQUEST chat-not-found', { userId: auth.userId, chatId })
      return c.json({ error: 'Chat not found' }, 404)
    }

    let tripContext: Awaited<ReturnType<typeof loadTripContext>>
    try {
      tripContext = await loadTripContext(actionTools, auth.userId, tripChat.tripId)
    } catch (err) {
      if (err instanceof AgentToolError) return c.json({ error: CHAT_MESSAGES.notMember, code: err.code }, 403)
      throw err
    }

    // Reserved before any model call; a refused turn costs nothing and is not saved.
    const reservation = await reservePaidCall(c.env, actionTools, auth.userId, 'chat')
    if (!reservation.ok) {
      const error = reservation.reason === 'user_cap' ? CHAT_MESSAGES.userCap : CHAT_MESSAGES.appCap
      return c.json({ error, code: reservation.reason }, 429)
    }

    // Load history before writing this turn. `persistTurn` later writes user then
    // assistant as separate DO operations; the ordering is intentional, but
    // it is not atomic.
    const history = await loadMessages(stub, chatId, auth.userId)
    // Carry `parts` through so compaction can truncate stale tool results AND
    // turnsToCoreMessages can rebuild assistant tool-call/tool-result pairs.
    const rawTurns: ChatTurn[] = history.map((m) => ({
      id: m.recordId,
      role: m.role,
      content: m.content,
      parts: m.parts,
    }))

    // Append the in-flight user message in memory so the LLM sees it; its DO
    // write is the first persistence operation in `persistTurn`.
    // Then dedup consecutive user messages — defense-in-depth for legacy
    // chats with orphan user rows AND for the rare case where a prior turn's
    // user-write succeeded but the assistant-write failed both retries.
    // Crucial: dedup runs AFTER appending the in-flight; otherwise a trailing
    // orphan user from history would survive the loop (no following user in
    // raw history) and then sit next to the in-flight user, sending two
    // consecutive user messages to the LLM.
    const allTurns: ChatTurn[] = [...rawTurns, { id: userMessageId, role: 'user', content }]
    const turns: ChatTurn[] = []
    for (let i = 0; i < allTurns.length; i++) {
      if (allTurns[i].role === 'user' && allTurns[i + 1]?.role === 'user') continue
      turns.push(allTurns[i])
    }

    const cachedSummary =
      chat.compactedSummary && chat.compactedThroughId
        ? { text: chat.compactedSummary, throughId: chat.compactedThroughId }
        : undefined

    // Owner-billed like the chat turn itself, so users never pay.
    const summarizer = makeDefaultSummarizer(c.env)
    const { messages: prepared, newSummary } = await prepareMessagesWithCompaction(
      turns,
      DEFAULT_CONTEXT_CONFIG,
      { summarizer, cachedSummary },
    )
    if (newSummary) {
      await updateChat(stub, chatId, auth.userId, {
        compactedSummary: newSummary.text,
        compactedThroughId: newSummary.throughId,
      })
    }

    const usedModelId = selectedModel.modelId
    const diagnosticContext = {
      profile: 'application' as const,
      provider: selectedModel.provider,
      modelId: usedModelId,
    }
    const baseSystem = buildTripPrompt({ ...tripContext, userName: auth.claims.name || 'a traveler' })

    // Compaction inserts at most one summary system message at index 0; fold
    // it into the top-level `system` so we don't pass two system roles. Then
    // convert the remaining ChatTurns into AI SDK ModelMessages — splitting
    // assistant rows into the assistant + paired tool messages the SDK expects.
    const [first, ...rest] = prepared
    const summary = first?.role === 'system' ? first : null
    const systemText = summary ? `${baseSystem}\n\n${summary.content}` : baseSystem
    const messages = turnsToCoreMessages(summary ? rest : prepared)

    // The SDK executor runs each tool as the verified user, in the room the
    // access grant admitted them to, and forwards the route's abort signal, so
    // a tool fetch in flight is cancelled if the client navigates away
    // mid-stream. The local assistant routes use the same executor and
    // context, and streamDeepSpaceAgent caps each tool result for the model,
    // keeping both surfaces' tool behavior identical.
    const tools = buildTools(
      createUserToolExecutor(c.env, auth.userId, c.req.raw.signal, { room: access.room }),
      { env: c.env, userId: auth.userId, request: c.req.raw },
    )

    // Allocate the assistant row id BEFORE streaming starts so we can echo it
    // back via a response header. The client tags its in-flight overlay with
    // this id and dedups against the WebSocket-broadcast persisted row by id —
    // not by comparing `spawnTime` (client clock) to `createdAt` (server clock),
    // which broke for users whose clock was ahead of the server.
    const asstId = `asst-${Date.now()}-${crypto.randomUUID()}`

    // Save the finished turn: every step's messages (tool calls included), not
    // just the final step's. Called on normal completion and when the request
    // is aborted after at least one step completed.
    const persistTurn = async (text: string, responseMessages: ModelMessage[]): Promise<void> => {
      const parts = buildUiParts(responseMessages)
      if (text.trim() === '' && parts.length === 0) {
        console.warn('[ai-chat] FINISH empty turn, skipping persist')
        return
      }

      // Persist user → assistant → metadata as independent writes, not a
      // transaction. Order matters: user FIRST so chronological reads are
      // correct, then assistant. If user-write
      // exhausts retries we ABORT the assistant write — otherwise we'd persist
      // an assistant row with no preceding user row, breaking the invariant
      // relied on by the dedup + turnsToCoreMessages loop on the next turn.
      //
      // The helpers return `false` (no throw) when the chat no longer exists
      // — deleted mid-stream — and nothing was written; that is not retried,
      // and it stops the sequence the same way an exhausted retry does.
      const writeWithRetry = async (
        label: string,
        fn: () => Promise<boolean | void>,
      ): Promise<boolean> => {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            if ((await fn()) === false) {
              console.warn(`[ai-chat] ${label} skipped — chat ${chatId} no longer exists`)
              return false
            }
            return true
          } catch (err) {
            console.error(`[ai-chat] ${label} ${attempt === 1 ? 'failed, retrying once' : 'retry failed'}: ${loggableError(err)}`)
          }
        }
        return false
      }

      const userOk = await writeWithRetry('user message', () =>
        appendMessage(stub, {
          id: userMessageId,
          chatId,
          userId: auth.userId,
          role: 'user',
          content,
        }),
      )
      if (!userOk) {
        console.error(
          '[ai-chat] FINISH aborting — user write did not land; skipping assistant + metadata to avoid orphan rows',
        )
        return
      }
      const assistantOk = await writeWithRetry('assistant message', () =>
        appendMessage(stub, {
          id: asstId,
          chatId,
          userId: auth.userId,
          role: 'assistant',
          content: text,
          ...(parts.length > 0 ? { parts } : {}),
        }),
      )
      if (!assistantOk) return
      await writeWithRetry('chat metadata', async () => {
        // Re-fetch so a mid-stream rename by the user isn't clobbered by a
        // stale "auto-title" derived from the captured `chat` snapshot. A
        // chat deleted mid-stream reads back as null; `updateChat` refuses
        // that case on its own (an unguarded `records.update` would upsert
        // the row back into existence), so this only decides the title.
        const fresh = await getChat(stub, chatId, auth.userId)
        const patch: { title?: string; model?: string } = { model: usedModelId }
        if (fresh && (!fresh.title || fresh.title === 'New chat')) {
          patch.title = deriveTitle(content)
        }
        return updateChat(stub, chatId, auth.userId, patch)
      })
    }

    const streamOptions = {
      instructions: systemText,
      messages,
      tools,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // Cancel provider and tool work with the request. `onAbort` then saves
      // any completed steps; a zero-step abort saves nothing.
      abortSignal: c.req.raw.signal,
      onError: ({ error }: { error: unknown }) => {
        console.error(
          `[ai-chat] stream error: ${deepSpaceAgentErrorSummary(error, diagnosticContext)}`,
        )
      },
      onEnd: ({ text, responseMessages }: { text: string; responseMessages: unknown[] }) =>
        persistTurn(text, responseMessages as ModelMessage[]),
      // AI SDK skips `onEnd` on abort; keep the steps that did complete.
      onAbort: ({ steps }: { steps: readonly { text: string; response: { messages: unknown[] } }[] }) => {
        const last = steps.at(-1)
        if (!last) return
        return persistTurn(last.text, steps.flatMap((step) => step.response.messages) as ModelMessage[])
      },
    }
    // Playwright runs (MOCK_EXTERNAL_APIS) swap only the model for a scripted
    // one; route, tools, caps and persistence stay the real ones.
    const result = mocksExternalApis(c.env)
      ? streamText({ ...streamOptions, model: createTestChatModel(), stopWhen: isStepCount(MAX_TOOL_CALLS + 1) })
      : streamDeepSpaceAgent(c.env, {
          ...streamOptions,
          profile: 'application',
          modelId: usedModelId,
          maxToolCalls: MAX_TOOL_CALLS,
          effort: 'low',
        }).result

    return createUIMessageStreamResponse({
      headers: {
        // Lets the client tag its in-flight assistant overlay with the same id
        // the worker will use in `persistTurn`, so dedup against
        // the WebSocket-broadcast row is by id (clock-skew-proof).
        'X-Asst-Id': asstId,
      },
      stream: toUIMessageStream({
        stream: result.stream,
        // Reasoning models (o-series, Claude with extended thinking) emit
        // `reasoning-start`/`reasoning-delta`/`reasoning-end` chunks. We
        // don't render them today — pass them through and the user sees a
        // stuck spinner during long thinks. Opt out at the boundary until
        // the UI gains a "thinking" disclosure block.
        sendReasoning: false,
        onError: (error: unknown): string => {
          // The return value becomes the user-visible `errorText` for every
          // `tool-input-error` / `tool-output-error` chunk and stream-level
          // error. Surface the real message so RBAC denials and validation
          // failures are debuggable; log full detail server-side.
          console.error(`[ai-chat] response error: ${loggableError(error)}`)
          return chatErrorText(error)
        },
      }),
    })
  })
}

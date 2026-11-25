/**
 * Co-planner chat routes. Every turn is owner-billed on a model chosen here, reserved
 * against the caller's daily cap and the app-wide ceiling before the model runs, and
 * settled to its token cost after. Input is bounded, so one turn's cost is bounded too.
 */

import type { Context, Hono } from 'hono'
import { createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, type ModelMessage } from 'ai'
import {
  AgentToolError,
  deepSpaceAgentErrorSummary,
  resolveDeepSpaceAgentModel,
  streamDeepSpaceAgent,
  turnsToCoreMessages,
  buildUiParts,
  createUserToolExecutor,
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
import { chatTurnCredits, mocksExternalApis, reservePaidCall, settlePaidCall } from '../server/trip-services.js'
import { CHAT_MESSAGE_MAX_LENGTH, CHAT_MESSAGES, chatErrorText } from './errors.js'
import { buildTripPrompt } from './prompt.js'
import { createTestChatModel } from './test-model.js'
import { boundHistory, chatTools, MAX_OUTPUT_TOKENS, MAX_TOOL_CALLS } from './bounds.js'
import { loadTripContext } from './tools.js'
// Type-only, so there is no runtime import cycle with worker.ts.
import type { Env, AppContext } from '../../worker.js'

type TokenUsage = { inputTokens?: number; outputTokens?: number }
type ResolveAccess = (req: Request, env: Env) => Promise<AgentToolAccessResult>
type AccessGrant = Extract<AgentToolAccessResult, { ok: true }>
type ToolFactory = AgentToolRouteOptions<Env>['buildTools']

function recordRoomStub(env: Env): DurableObjectStub {
  // Keyed by the app id, like the client's scope; APP_NAME would address a room nobody subscribes to.
  return env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
}

const CHAT_MODEL_ID = 'claude-haiku-5-5'

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

  // One chat per user per trip.
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
    // updateChat re-checks, so a delete racing this PATCH answers 404.
    if (!(await updateChat(stub, id, auth.userId, patch)))
      return c.json({ error: 'Not found' }, 404)
    return c.json({ ok: true })
  })

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

  // Known limitation: two tabs sending to one chat at once can interleave the turn's writes.
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
    if (content.length > CHAT_MESSAGE_MAX_LENGTH) {
      return c.json({ error: `Keep messages under ${CHAT_MESSAGE_MAX_LENGTH} characters.`, code: 'too_long' }, 413)
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

    const history = await loadMessages(stub, chatId, auth.userId)
    // Keep `parts` so old tool results can be truncated and tool-call pairs rebuilt.
    const rawTurns: ChatTurn[] = history.map((m) => ({
      id: m.recordId,
      role: m.role,
      content: m.content,
      parts: m.parts,
    }))

    // Drop orphan user rows (a prior turn whose assistant write failed). This must run after
    // appending the new message, or a trailing orphan would sit next to it.
    const allTurns: ChatTurn[] = [...rawTurns, { id: userMessageId, role: 'user', content }]
    const turns: ChatTurn[] = []
    for (let i = 0; i < allTurns.length; i++) {
      if (allTurns[i].role === 'user' && allTurns[i + 1]?.role === 'user') continue
      turns.push(allTurns[i])
    }

    const usedModelId = selectedModel.modelId
    const diagnosticContext = {
      profile: 'application' as const,
      provider: selectedModel.provider,
      modelId: usedModelId,
    }
    const baseSystem = buildTripPrompt({ ...tripContext, userName: auth.claims.name || 'a traveler' })

    const messages = turnsToCoreMessages(boundHistory(turns))

    // Tools run as the verified user, with the same executor the local agent routes use.
    const tools = chatTools(
      buildTools(createUserToolExecutor(c.env, auth.userId, c.req.raw.signal, { room: access.room }), {
        env: c.env,
        userId: auth.userId,
        request: c.req.raw,
      }),
    )

    // Sent as X-Asst-Id so the client dedups its overlay against the saved row by id, not by clock.
    const asstId = `asst-${Date.now()}-${crypto.randomUUID()}`

    // Saves every step's messages (tool calls included), on completion or after a partial abort.
    const persistTurn = async (text: string, responseMessages: ModelMessage[]): Promise<void> => {
      const parts = buildUiParts(responseMessages)
      if (text.trim() === '' && parts.length === 0) {
        console.warn('[ai-chat] FINISH empty turn, skipping persist')
        return
      }

      // User, then assistant, then metadata, as separate writes. A failed user write stops the
      // rest, so there is never an assistant row without its user row. `false` means the chat
      // was deleted mid-stream.
      const writeWithRetry = async (
        label: string,
        fn: () => Promise<boolean | void>,
      ): Promise<boolean> => {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            if ((await fn()) === false) {
              console.warn(`[ai-chat] ${label} skipped: chat ${chatId} no longer exists`)
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
          '[ai-chat] FINISH aborting: user write did not land; skipping assistant + metadata to avoid orphan rows',
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
        // Re-read so a mid-stream rename is not overwritten by the auto-title.
        const fresh = await getChat(stub, chatId, auth.userId)
        const patch: { title?: string; model?: string } = { model: usedModelId }
        if (fresh && (!fresh.title || fresh.title === 'New chat')) {
          patch.title = deriveTitle(content)
        }
        return updateChat(stub, chatId, auth.userId, patch)
      })
    }

    const streamOptions = {
      instructions: baseSystem,
      messages,
      tools,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      abortSignal: c.req.raw.signal,
      onError: ({ error }: { error: unknown }) => {
        console.error(
          `[ai-chat] stream error: ${deepSpaceAgentErrorSummary(error, diagnosticContext)}`,
        )
      },
      onEnd: async ({ text, responseMessages, totalUsage }: { text: string; responseMessages: unknown[]; totalUsage: TokenUsage }) => {
        const credits = chatTurnCredits(totalUsage)
        console.info(`[ai-chat] turn settled: ${totalUsage.inputTokens ?? 0} in, ${totalUsage.outputTokens ?? 0} out, ${credits} credits`)
        await settlePaidCall(actionTools, reservation.usageId, credits)
        await persistTurn(text, responseMessages as ModelMessage[])
      },
      // onEnd is skipped on abort. A zero-step abort keeps the reserved estimate (the call may be billed).
      onAbort: async ({ steps }: { steps: readonly { text: string; usage: TokenUsage; response: { messages: unknown[] } }[] }) => {
        const last = steps.at(-1)
        if (!last) return
        const total = (key: keyof TokenUsage) => steps.reduce((sum, step) => sum + (step.usage[key] ?? 0), 0)
        await settlePaidCall(actionTools, reservation.usageId, chatTurnCredits({ inputTokens: total('inputTokens'), outputTokens: total('outputTokens') }))
        await persistTurn(last.text, steps.flatMap((step) => step.response.messages) as ModelMessage[])
      },
    }
    // Playwright runs swap only the model; route, tools, caps and persistence stay real.
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
        'X-Asst-Id': asstId,
      },
      stream: toUIMessageStream({
        stream: result.stream,
        // The UI does not render reasoning chunks.
        sendReasoning: false,
        onError: (error: unknown): string => {
          console.error(`[ai-chat] response error: ${loggableError(error)}`)
          return chatErrorText(error)
        },
      }),
    })
  })
}

/**
 * A scripted stand-in for the chat model, used only when MOCK_EXTERNAL_APIS
 * is "true" (Playwright runs). It reads the trip prompt from src/ai/prompt.ts
 * and turns plain commands into real tool calls, so tests exercise the same
 * route, tools, caps and persistence as production without spending credits.
 *
 *   add <title> on day <n>      -> add_stop
 *   move <title> to day <n>     -> move_stop
 *   remove <title>              -> remove_stop
 *   search <query>              -> search_places
 *   weather / forecast          -> get_forecast
 *   out of credits              -> a 402 from the "provider"
 */

import type { LanguageModel } from 'ai'

type Model = Extract<LanguageModel, { specificationVersion: 'v4' }>
type CallOptions = Parameters<Model['doStream']>[0]
type StreamPart = Awaited<ReturnType<Model['doStream']>>['stream'] extends ReadableStream<infer P> ? P : never

const USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
}

interface TripFacts {
  tripId: string
  days: string[]
  stops: { id: string; title: string }[]
}

export function readTripFacts(system: string): TripFacts {
  const tripId = /^Trip id: (\S+)/m.exec(system)?.[1] ?? ''
  const days = [...system.matchAll(/^- Day \d+: (\d{4}-\d{2}-\d{2})/gm)].map((m) => m[1])
  const stops = [...system.matchAll(/^- \[(\S+)\] Day \d+ \S+(?: \d\d:\d\d)?: (.+?)(?: \(added by AI\))?$/gm)].map((m) => ({
    id: m[1],
    title: m[2],
  }))
  return { tripId, days, stops }
}

type Plan = { tool: string; input: Record<string, unknown> } | { text: string } | { fail: 'credits' }

export function planReply(userText: string, facts: TripFacts): Plan {
  const text = userText.trim()
  const findStop = (title: string) => facts.stops.find((s) => s.title.toLowerCase() === title.trim().toLowerCase())
  let m: RegExpExecArray | null
  if (/out of credits/i.test(text)) return { fail: 'credits' }
  if ((m = /^add (.+) on day (\d+)$/i.exec(text))) {
    return { tool: 'add_stop', input: { tripId: facts.tripId, day: facts.days[Number(m[2]) - 1] ?? '1999-01-01', title: m[1] } }
  }
  if ((m = /^move (.+) to day (\d+)$/i.exec(text))) {
    return {
      tool: 'move_stop',
      input: { tripId: facts.tripId, stopId: findStop(m[1])?.id ?? 'missing', day: facts.days[Number(m[2]) - 1] ?? '1999-01-01' },
    }
  }
  if ((m = /^remove (.+)$/i.exec(text))) {
    return { tool: 'remove_stop', input: { tripId: facts.tripId, stopId: findStop(m[1])?.id ?? 'missing' } }
  }
  if ((m = /^search (.+)$/i.exec(text))) return { tool: 'search_places', input: { tripId: facts.tripId, query: m[1] } }
  if (/weather|forecast/i.test(text)) return { tool: 'get_forecast', input: { tripId: facts.tripId } }
  return { text: 'Test co-planner here. Try "add <title> on day 2".' }
}

function textParts(text: string): StreamPart[] {
  return [
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: text },
    { type: 'text-end', id: 't1' },
    { type: 'finish', usage: USAGE, finishReason: { unified: 'stop', raw: undefined } },
  ]
}

function afterTool(options: CallOptions): string {
  const last = options.prompt.at(-1)
  const result = last?.role === 'tool' ? last.content.find((part) => part.type === 'tool-result') : undefined
  if (!result || result.type !== 'tool-result') return 'Done.'
  const { output } = result
  if (output.type === 'error-text' || output.type === 'error-json') {
    return `That did not work: ${typeof output.value === 'string' ? output.value : JSON.stringify(output.value)}`
  }
  return `Done: ${result.toolName} finished.`
}

function stream(parts: StreamPart[]): ReadableStream<StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    },
  })
}

export function createTestChatModel(): Model {
  let calls = 0
  return {
    specificationVersion: 'v4',
    provider: 'tripboard-test',
    modelId: 'test-co-planner',
    supportedUrls: {},
    async doGenerate() {
      throw new Error('The test model only streams')
    },
    async doStream(options) {
      const first = options.prompt[0]
      const system = first?.role === 'system' ? first.content : ''
      const last = options.prompt.at(-1)
      if (last?.role === 'tool') return { stream: stream([{ type: 'stream-start', warnings: [] }, ...textParts(afterTool(options))]) }

      const userText =
        last?.role === 'user' ? last.content.map((part) => (part.type === 'text' ? part.text : '')).join(' ') : ''
      const plan = planReply(userText, readTripFacts(system))
      if ('fail' in plan) {
        throw Object.assign(new Error('Insufficient credits'), {
          statusCode: 402,
          responseBody: '{"error":{"code":"insufficient_credits"}}',
        })
      }
      if ('text' in plan) return { stream: stream([{ type: 'stream-start', warnings: [] }, ...textParts(plan.text)]) }
      calls++
      return {
        stream: stream([
          { type: 'stream-start', warnings: [] },
          { type: 'tool-call', toolCallId: `call_${calls}`, toolName: plan.tool, input: JSON.stringify(plan.input) },
          { type: 'finish', usage: USAGE, finishReason: { unified: 'tool-calls', raw: undefined } },
        ]),
      }
    },
  }
}

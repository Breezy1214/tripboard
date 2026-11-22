/**
 * Limits on what one co-planner chat turn sends to the model, so the cost of a
 * turn is bounded: tool steps, reply length per step, each tool result the
 * model reads, and the history resent with every step. With the message cap
 * (CHAT_MESSAGE_MAX_LENGTH) and the 40-stop prompt, a worst-case turn stays
 * near the 1.5 credits it reserves; the measured cost then replaces the estimate.
 */

import { applySlidingWindow, capToolResultSize, truncateOldToolResults } from 'deepspace/worker'
import type { ChatTurn } from 'deepspace/worker'
import type { ToolSet } from 'ai'
import { CUSTOM_TOOL_NAMES } from './tools.js'

export const MAX_TOOL_CALLS = 4
export const MAX_OUTPUT_TOKENS = 1024
export const TOOL_RESULT_CAP = 4_000
export const HISTORY_CHAR_BUDGET = 8_000

/**
 * Earlier turns the model sees: older tool results become short markers, then
 * the oldest messages drop until the history fits the budget. There is no
 * summarizer, so no second paid call and no stored summary to trust.
 */
export function boundHistory(turns: ChatTurn[]): ChatTurn[] {
  const kept = applySlidingWindow(
    truncateOldToolResults(
      turns.filter((t) => t.role !== 'system'),
      1,
    ),
    HISTORY_CHAR_BUDGET,
    1,
  )
  const firstUser = kept.findIndex((t) => t.role === 'user')
  return firstUser > 0 ? kept.slice(firstUser) : kept
}

/** The chat gets only the trip tools, each result capped for the model. Local agents keep the full set. */
export function chatTools(all: ToolSet): ToolSet {
  return Object.fromEntries(
    CUSTOM_TOOL_NAMES.filter((name) => all[name]).map((name) => {
      const definition = all[name]
      const execute = definition.execute
      if (!execute) return [name, definition]
      return [
        name,
        {
          ...definition,
          execute: async (...args: Parameters<typeof execute>) => capToolResultSize(await execute(...args), TOOL_RESULT_CAP),
        },
      ]
    }),
  )
}

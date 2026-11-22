/** Longest chat message the route accepts; the chat box enforces it too. Bounds one turn's input. */
export const CHAT_MESSAGE_MAX_LENGTH = 2000

/** Friendly text for the chat panel when the owner's free credits run out or a cap is reached. */
export const CHAT_MESSAGES = {
  outOfCredits:
    'The AI co-planner is out of credits for now. The board still works: add and edit stops by hand.',
  userCap: 'You have used your AI turns for today. They reset at midnight UTC. The board still works.',
  appCap: 'The AI co-planner hit its daily limit for everyone. Try again tomorrow. The board still works.',
  notMember: 'You are not a member of this trip, so the co-planner cannot help here.',
} as const

const OUT_OF_CREDITS = /insufficient[_ ]credits|out of credits|payment required/i

/** Walks an error (and its cause chain) for a 402 or an insufficient_credits code. */
export function isOutOfCredits(error: unknown): boolean {
  const seen = new Set<unknown>()
  const pending = [error]
  while (pending.length) {
    const current = pending.shift()
    if (current == null || seen.has(current)) continue
    seen.add(current)
    if (typeof current === 'string') {
      if (OUT_OF_CREDITS.test(current)) return true
      continue
    }
    if (typeof current !== 'object') continue
    const record = current as Record<string, unknown>
    if (record.statusCode === 402 || record.status === 402) return true
    for (const key of ['code', 'message', 'error', 'responseBody']) {
      const value = record[key]
      if (typeof value === 'string' && OUT_OF_CREDITS.test(value)) return true
    }
    pending.push(record.cause, record.lastError, ...(Array.isArray(record.errors) ? record.errors : []))
  }
  return false
}

/** What the user sees for a failed turn. Out-of-credits gets the friendly text; other errors keep their message. */
export function chatErrorText(error: unknown): string {
  if (isOutOfCredits(error)) return CHAT_MESSAGES.outOfCredits
  return error instanceof Error ? error.message : String(error)
}

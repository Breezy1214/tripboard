/**
 * Who pays for each integration. Per-user connected accounts (Google, Composio)
 * must be 'user': the platform resolves the account from the caller's JWT.
 */
export const integrations: Record<
  string,
  { billing: 'developer' | 'user'; anonymous?: boolean }
> = {
  google: { billing: 'user' },
  composio: { billing: 'user' },
  // Owner-billed, called only from server actions behind daily caps.
  openweathermap: { billing: 'developer' },
  serpapi: { billing: 'developer' },
}

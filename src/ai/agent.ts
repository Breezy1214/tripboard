/** One authorization policy for both the in-app co-planner and local agents (Claude Code, a shell). */

import type { Hono } from 'hono'
import { registerAgentToolRoutes, resolveAppMembership } from 'deepspace/worker'
import type { AgentToolAccessResult, AgentToolRouteOptions, JwtClaims } from 'deepspace/worker'
import { registerAiChatRoutes } from './chat-routes.js'
import { resolveAgentAuth, resolveAuth } from '../server/http-routes.js'
import type { AppContext, Env } from '../../worker.js'

type ToolFactory = AgentToolRouteOptions<Env>['buildTools']

export interface AgentAuthorizationContext {
  userId: string
  claims: JwtClaims
  request: Request
  env: Env
}

export interface RegisterAgentOptions {
  tools: ToolFactory
  inApp?: boolean
  local?: boolean
  /** Can only narrow access, after identity and app membership pass. */
  authorize?: (context: AgentAuthorizationContext) => boolean | Promise<boolean>
  /** Decide from the verified userId, never from input. Defaults to the app's room. */
  room?: (userId: string, env: Env) => string
}

function createAccessResolver(options: RegisterAgentOptions, resolveIdentity: typeof resolveAuth) {
  return async (request: Request, env: Env): Promise<AgentToolAccessResult> => {
    const auth = await resolveIdentity(request, env)
    if (!auth) return { ok: false, status: 401 }

    // A membership read that could not complete is 503 (retryable), never 403.
    const room = options.room?.(auth.userId, env)
    const membership = await resolveAppMembership(env, auth.userId, request.signal, { room })
    if (!membership) return { ok: false, status: 503 }
    if (!membership.member) return { ok: false, status: 403 }

    if (options.authorize) {
      try {
        if (
          !(await options.authorize({ userId: auth.userId, claims: auth.claims, request, env }))
        ) {
          return { ok: false, status: 403 }
        }
      } catch {
        // Failed rather than denied: fail closed but retryable.
        return { ok: false, status: 503 }
      }
    }

    return { ok: true, auth, room }
  }
}

export function registerAgent(app: Hono<AppContext>, options: RegisterAgentOptions): void {
  if (options.inApp !== false) {
    registerAiChatRoutes(app, createAccessResolver(options, resolveAuth), options.tools)
  }
  if (options.local !== false) {
    registerAgentToolRoutes(app, {
      buildTools: options.tools,
      resolveAccess: createAccessResolver(options, resolveAgentAuth),
      resolveBrowserAccess: createAccessResolver(options, resolveAuth),
    })
  }
}

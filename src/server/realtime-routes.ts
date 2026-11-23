/**
 * WebSocket routing for app-owned Durable Objects.
 *
 * Caller identity in query parameters and headers is never trusted. Routes
 * scrub it and forward verified JWT identity in internal-only headers.
 *
 * Only the rooms the app uses are reachable: the app's record room and
 * member-only trip presence rooms. Any other room id would create a fresh
 * Durable Object on demand, so it gets a 404.
 */

import type { Context, Hono } from 'hono'
import { authenticatedRoomRequest, verifyJwt } from 'deepspace/worker'
import type { JwtVerifierConfig, VerifyResult } from 'deepspace/worker'
import type { AppContext, Env } from '../../worker.js'
import { createActionTools } from './action-routes.js'
import { isTripMember } from './trip-services.js'

function jwtConfig(env: Env): JwtVerifierConfig {
  return { publicKey: env.AUTH_JWT_PUBLIC_KEY, issuer: env.AUTH_JWT_ISSUER }
}

function wsRoute(doNamespace: (env: Env) => DurableObjectNamespace) {
  return async (c: Context<AppContext>) => {
    const id = c.req.param('roomId') ?? c.req.param('scopeId')
    if (!id) return new Response('Not found', { status: 404 })
    const url = new URL(c.req.url)
    const token = url.searchParams.get('token')

    let auth: VerifyResult | null = null
    if (token) {
      auth = (await verifyJwt(jwtConfig(c.env), token)).result
      if (!auth) return new Response('Unauthorized', { status: 401 })
    }
    const roomRequest = authenticatedRoomRequest(c.req.raw, auth)

    const namespace = doNamespace(c.env)
    const stub = namespace.get(namespace.idFromName(id))
    return stub.fetch(roomRequest)
  }
}

export function registerRealtimeRoutes(app: Hono<AppContext>): void {
  const recordRoute = wsRoute((env) => env.RECORD_ROOMS)
  app.get('/ws/:roomId', (c) => {
    if (c.req.param('roomId') !== `app:${c.env.DEEPSPACE_APP_ID}`) return new Response('Not found', { status: 404 })
    return recordRoute(c)
  })

  // Trip presence carries names, so only trip members may join.
  const presenceRoute = wsRoute((env) => env.PRESENCE_ROOMS)
  app.get('/ws/presence/:scopeId', async (c) => {
    const scopeId = c.req.param('scopeId')
    if (!scopeId.startsWith('trip:')) return new Response('Not found', { status: 404 })
    const token = new URL(c.req.url).searchParams.get('token')
    const auth = token ? (await verifyJwt(jwtConfig(c.env), token)).result : null
    if (!auth) return new Response('Unauthorized', { status: 401 })
    const tools = createActionTools(c.env, auth.userId, '')
    if (!(await isTripMember(tools, scopeId.slice('trip:'.length), auth.userId))) {
      return new Response('Forbidden', { status: 403 })
    }
    return presenceRoute(c)
  })

  // The scaffold's Yjs, canvas, cron and job sockets are unused by Tripboard.
  app.all('/ws/*', () => new Response('Not found', { status: 404 }))
}

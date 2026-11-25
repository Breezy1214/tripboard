import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  armCronRoom,
  CanvasRoom,
  CronRoom,
  JobRoom,
  PresenceRoom,
  RecordRoom,
  resolveAppRole,
  workerErrorHandler,
  YjsRoom,
} from 'deepspace/worker'
import type { DOBindings, DOManifest, Job, JobContext } from 'deepspace/worker'
import { AI_CHATS_SCHEMA } from 'deepspace/schema'
import { registerAgent } from './src/ai/agent.js'
import { buildTools } from './src/ai/tools.js'
import { tasks as cronTasks, runTask as runCronTask } from './src/cron.js'
import { runJob } from './src/jobs.js'
import { schemas } from './src/schemas.js'
import { registerActionRoutes } from './src/server/action-routes.js'
import {
  registerAuthAndIntegrationRoutes,
  registerPlatformProxyRoutes,
  registerStaticRoutes,
  resolveAuth,
} from './src/server/http-routes.js'
import { registerRealtimeRoutes } from './src/server/realtime-routes.js'

// Dynamic deploy reads this manifest to create the app's DO bindings.
export const __DO_MANIFEST__ = [
  { binding: 'RECORD_ROOMS', className: 'AppRecordRoom', sqlite: true },
  { binding: 'YJS_ROOMS', className: 'AppYjsRoom', sqlite: true },
  { binding: 'CANVAS_ROOMS', className: 'AppCanvasRoom', sqlite: true },
  { binding: 'PRESENCE_ROOMS', className: 'AppPresenceRoom', sqlite: true },
  { binding: 'CRON_ROOMS', className: 'AppCronRoom', sqlite: true },
  { binding: 'JOB_ROOMS', className: 'AppJobRoom', sqlite: true },
] as const satisfies DOManifest

export class AppRecordRoom extends RecordRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, schemas, { ownerUserId: env.OWNER_USER_ID })
    // usage moved from one counter row per (userId, day, kind) to one row per call,
    // and the SDK adds uniqueOn indexes but never drops a removed one.
    this.sql.exec('DROP INDEX IF EXISTS "uniq_c_usage_userId_day_kind"')
  }
}

export class AppYjsRoom extends YjsRoom<Env> {}
export class AppCanvasRoom extends CanvasRoom<Env> {}
export class AppPresenceRoom extends PresenceRoom<Env> {}

export class AppCronRoom extends CronRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, { tasks: cronTasks })
  }

  protected async onTask(taskName: string): Promise<void> {
    await runCronTask(taskName, this.env)
  }
}

export class AppJobRoom extends JobRoom<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      authorizeWrite: async (user) => {
        if (user.userId.startsWith('anon-')) return false
        const role = await resolveAppRole(env, user.userId)
        return role === 'member' || role === 'admin'
      },
    })
  }

  protected async onJob(job: Job, context: JobContext): Promise<unknown> {
    return await runJob(job, context, this.env)
  }
}

export interface Env extends DOBindings<typeof __DO_MANIFEST__> {
  ASSETS: Fetcher
  PLATFORM_WORKER?: Fetcher
  PLATFORM_WORKER_URL?: string
  APP_IDENTITY_TOKEN?: string
  API_WORKER?: Fetcher
  API_WORKER_URL?: string
  AUTH_JWT_PUBLIC_KEY: string
  AUTH_JWT_ISSUER: string
  AUTH_WORKER_URL: string
  NATIVE_AUTH_REDIRECT_URIS?: string
  APP_NAME: string
  DEEPSPACE_APP_ID: string
  OWNER_USER_ID: string
  APP_OWNER_JWT: string
  ALLOW_DEBUG_ROUTES?: string
  /** "true" only in Playwright runs (set by vite.config.ts for `vite serve`): external calls return canned data. */
  MOCK_EXTERNAL_APIS?: string
  /** One id per Playwright run, so each run counts usage from zero. */
  MOCK_RUN_ID?: string
}

export type AppContext = { Bindings: Env }

const app = new Hono<AppContext>()
app.use('/api/*', cors())
// The CronRoom arms its alarm on first fetch, so wake it from the request path. No-op without tasks.
app.use('*', async (c, next) => {
  armCronRoom(c.executionCtx, c.env.CRON_ROOMS, `app:${c.env.DEEPSPACE_APP_ID}`, cronTasks)
  await next()
})

// Order matters: the wildcard auth route follows its special cases, AI precedes platform proxies, static is last.
registerAuthAndIntegrationRoutes(app)
registerRealtimeRoutes(app)
registerActionRoutes(app, resolveAuth)
registerAgent(app, {
  tools: buildTools,
  inApp: schemas.some((schema) => schema.name === AI_CHATS_SCHEMA.name),
})
registerPlatformProxyRoutes(app)
registerStaticRoutes(app)

// Hono's default onError logs only stack frames in Workers Logs; this keeps the message and returns a generic 500.
app.onError(workerErrorHandler('error'))

export default app

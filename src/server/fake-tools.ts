/**
 * In-memory ActionTools for unit tests: equality `where`, `orderBy`, `limit`,
 * get, create, update, remove, and a stubbed integration call. RBAC is off,
 * like the real action tools.
 */

import type { ActionTools } from 'deepspace/worker'

type Row = { recordId: string; createdBy: string; data: Record<string, unknown> }

export function fakeTools(userId = 'u1', integration?: (endpoint: string, body: unknown) => unknown) {
  const tables = new Map<string, Map<string, Row>>()
  const integrationCalls: { endpoint: string; body: unknown }[] = []
  let nextId = 0
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map())
    return tables.get(name)!
  }
  const ok = <T>(data: T) => ({ success: true as const, data })

  const toolsAs = (actor: string) => ({
    async create(collection: string, data: Record<string, unknown>, recordId?: string) {
      const id = recordId ?? `${collection}_${nextId++}`
      table(collection).set(id, { recordId: id, createdBy: actor, data: { ...data, ...(collection === 'stops' ? { addedBy: actor } : {}) } })
      return ok({ recordId: id })
    },
    async update(collection: string, recordId: string, data: Record<string, unknown>) {
      const row = table(collection).get(recordId)
      if (!row) return { success: false as const, error: 'Record not found' }
      row.data = { ...row.data, ...data }
      return ok({ recordId })
    },
    async remove(collection: string, recordId: string) {
      table(collection).delete(recordId)
      return ok({ recordId })
    },
    async get(collection: string, recordId: string) {
      const row = table(collection).get(recordId)
      return row ? ok({ record: row }) : { success: false as const, error: 'Record not found' }
    },
    async query(collection: string, options: { where?: Record<string, unknown>; orderBy?: string; orderDir?: string; limit?: number } = {}) {
      let rows = [...table(collection).values()].filter((r) =>
        Object.entries(options.where ?? {}).every(([k, v]) => r.data[k] === v),
      )
      if (options.orderBy) {
        const key = options.orderBy
        const dir = options.orderDir === 'desc' ? -1 : 1
        rows = rows.sort((a, b) => (Number(a.data[key] ?? 0) - Number(b.data[key] ?? 0)) * dir)
      }
      rows = rows.slice(0, options.limit ?? 100)
      return ok({ records: rows, count: rows.length })
    },
    async integration(endpoint: string, body: unknown) {
      integrationCalls.push({ endpoint, body })
      const result = integration?.(endpoint, body)
      return (result ?? { success: true, data: {} }) as never
    },
  })

  /** `asUser` shares the tables but acts as another user, like `createActionTools(env, userId)`. */
  const asUser = (actor: string) => toolsAs(actor) as unknown as ActionTools
  return { tools: asUser(userId), asUser, tables, table, integrationCalls }
}

export const APP_NAME = 'tripboard-app'

export const PRODUCT_NAME = 'Tripboard'

/** Injected by the build from wrangler.toml. Never a literal, or a staging build would read production's rooms. */
declare const __DEEPSPACE_APP_ID__: string
export const APP_ID: string = __DEEPSPACE_APP_ID__

export const SCOPE_ID = `app:${APP_ID}`

export { ROLES, ROLE_CONFIG, type Role } from 'deepspace'

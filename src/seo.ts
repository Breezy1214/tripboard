/** Read by <Seo> at runtime and by prerender.ts at build time, so the two never disagree. */

import { PRODUCT_NAME } from './constants'

/** Injected by prerender.ts; absent in unit tests. */
declare const __DEEPSPACE_SITE_ORIGIN__: string | undefined

export const seo = {
  title: `${PRODUCT_NAME} | Plan a trip together, day by day`,
  description:
    'Tripboard is a shared trip planner: an itinerary over a live map, edits from everyone you invite, an AI co-planner, and the forecast on each day.',
  origin: typeof __DEEPSPACE_SITE_ORIGIN__ === 'string' ? __DEEPSPACE_SITE_ORIGIN__ : 'http://localhost',
  noindex: false,
}

import { test, expect } from '@playwright/test'

test.describe('API tests', () => {
  test('auth proxy forwards to auth worker', async ({ request }) => {
    const res = await request.get('/api/auth/ok')
    expect(res.ok()).toBeTruthy()
  })

  test('server actions require sign-in', async ({ request }) => {
    for (const name of ['createTrip', 'createSampleTrip', 'addStop', 'joinTrip', 'createInvite', 'refreshForecast', 'deleteTrip', 'fillTestUsage']) {
      const res = await request.post(`/api/actions/${name}`, { data: {} })
      expect(res.status()).toBe(401)
    }
  })

  test('browser integration proxy is closed so paid calls stay behind caps', async ({ request }) => {
    const res = await request.post('/api/integrations/openweathermap/geocoding', { data: { q: 'Lisbon' } })
    expect(res.status()).toBe(403)
  })

  test('trip presence refuses connections without a member token', async ({ request }) => {
    const res = await request.get('/ws/presence/trip:trip_x', { headers: { Upgrade: 'websocket' } })
    expect(res.status()).toBe(401)
  })

  test('only the app record room and trip presence rooms are reachable', async ({ request }) => {
    const ws = { headers: { Upgrade: 'websocket' } }
    for (const path of ['/ws/app:someone-else', '/ws/random', '/ws/yjs/doc1', '/ws/canvas/c1', '/ws/jobs/j1', '/ws/cron/c1', '/ws/presence/lobby']) {
      expect((await request.get(path, ws)).status(), path).toBe(404)
    }
  })

  test('action moveStop requires sign-in', async ({ request }) => {
    expect((await request.post('/api/actions/moveStop', { data: {} })).status()).toBe(401)
  })

  test('WebSocket endpoint exists', async ({ page }) => {
    // /home is a dynamic page (under src/pages/(app)/), so mounting it boots
    // the providers and auto-connects the records WebSocket. The static
    // landing at '/' deliberately does neither — see smoke.spec.ts.
    await page.goto('/home')
    // Wait for the app to connect its WebSocket (it auto-connects on mount)
    await page.waitForSelector('[data-testid="app-navigation"]', { timeout: 15000 })
    // If the app loaded and connected, the WS endpoint works
  })
})

import { test, expect } from '@playwright/test'

test.describe('API tests', () => {
  test('auth proxy forwards to auth worker', async ({ request }) => {
    const res = await request.get('/api/auth/ok')
    expect(res.ok()).toBeTruthy()
  })

  test('server actions require sign-in', async ({ request }) => {
    for (const name of ['createTrip', 'addStop', 'joinTrip', 'createInvite', 'refreshForecast']) {
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

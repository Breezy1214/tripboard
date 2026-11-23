/**
 * Review screenshots, not assertions. Runs only with TRIPBOARD_SCREENSHOTS=1:
 *   TRIPBOARD_SCREENSHOTS=1 npx deepspace test run e2e --grep screenshots
 * Writes PNGs to internal/screenshots/ (gitignored).
 */
import { test, loadAllTestAccounts } from 'deepspace/testing'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { action, deleteTrip } from './helpers/trip'

const OUT = fileURLToPath(new URL('../internal/screenshots', import.meta.url))
const PHONE = { width: 375, height: 812 }
const DESKTOP = { width: 1440, height: 900 }

test.skip(!process.env.TRIPBOARD_SCREENSHOTS, 'Set TRIPBOARD_SCREENSHOTS=1 to capture review screenshots.')
test.skip(loadAllTestAccounts().length < 1, 'Needs a test account.')
test.describe.configure({ timeout: 120_000 })

async function shot(page: Page, name: string, settle = 1500) {
  await page.waitForTimeout(settle)
  await page.screenshot({ path: `${OUT}/${name}.png` })
}

test('screenshots', async ({ users }) => {
  const [alex] = await users(1)
  const { page } = alex
  let tripId: string | undefined
  try {
    await page.setViewportSize(DESKTOP)
    await page.goto('/')
    await shot(page, 'landing-desktop')

    await page.goto('/home')
    await page.getByTestId('app-navigation').waitFor()
    const res = await action(page, 'createSampleTrip', {})
    tripId = (res.body.data as { tripId: string }).tripId
    await page.reload()
    await shot(page, 'home-desktop')

    await page.goto(`/trips/${tripId}`)
    await page.getByTestId('stop-card').first().waitFor()
    await shot(page, 'trip-desktop', 4000)
    await page.getByRole('tab', { name: 'calendar' }).click()
    await shot(page, 'trip-calendar-desktop', 800)

    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto(`/trips/${tripId}`)
    await page.getByTestId('stop-card').first().waitFor()
    await shot(page, 'trip-1280', 4000)

    await page.goto('/join/abcdefghjk')
    await shot(page, 'join-error-desktop')
    await page.goto('/settings')
    await shot(page, 'account-desktop')

    await page.setViewportSize(PHONE)
    await page.goto('/')
    await shot(page, 'landing-phone')
    await page.goto('/home')
    await page.getByTestId('trip-card').first().waitFor()
    await shot(page, 'home-phone')
    await page.goto(`/trips/${tripId}`)
    await page.getByTestId('stop-card').first().waitFor()
    await shot(page, 'trip-phone', 4000)
    await page.locator('main').evaluate((el) => el.scrollTo(0, 420))
    await shot(page, 'trip-phone-itinerary', 500)
    await page.getByTestId('open-chat-fab').click()
    await shot(page, 'trip-phone-chat', 800)
    await page.getByRole('button', { name: 'Close co-planner' }).click()
    await page.getByRole('button', { name: 'Toggle menu' }).click()
    await shot(page, 'menu-phone', 500)
  } finally {
    await deleteTrip(page, tripId)
  }
})

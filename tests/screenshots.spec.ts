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
    await page.getByTestId('trips-empty').waitFor()
    await shot(page, 'home-empty-desktop')
    await page.getByTestId('new-trip-button').click()
    await shot(page, 'new-trip-desktop', 500)
    const res = await action(page, 'createSampleTrip', {})
    tripId = (res.body.data as { tripId: string }).tripId
    await page.reload()
    await shot(page, 'home-desktop')

    await page.goto(`/trips/${tripId}`)
    await page.getByTestId('stop-card').first().waitFor()
    await shot(page, 'trip-desktop', 4000)
    await page.getByRole('tab', { name: 'calendar' }).click()
    await shot(page, 'trip-calendar-desktop', 800)
    await page.getByRole('tab', { name: 'itinerary' }).click()
    await page.getByTestId('stop-card').first().hover()
    await page.getByRole('button', { name: /^Edit / }).first().click()
    await shot(page, 'trip-edit-desktop', 500)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.getByTestId('invite-button').click()
    await shot(page, 'trip-invite-desktop', 1500)
    await page.keyboard.press('Escape')
    const chat = page.getByTestId('trip-chat')
    await chat.getByRole('textbox').fill('What is the weather on day 1?')
    await chat.getByRole('textbox').press('Enter')
    await chat.getByText(/finished|Done/).first().waitFor({ timeout: 15_000 })
    await chat.getByRole('textbox').fill('search bakery')
    await chat.getByRole('textbox').press('Enter')
    await page.waitForTimeout(3000)
    await shot(page, 'trip-chat-desktop', 1000)

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

/**
 * Public README screenshots (no emails on screen): TRIPBOARD_DOCS=1 writes docs/*.png.
 * Two members on the sample trip, one stop added by hand and placed on the map.
 */
test('docs screenshots', async ({ users }) => {
  test.skip(!process.env.TRIPBOARD_DOCS, 'Set TRIPBOARD_DOCS=1 to refresh the README screenshots.')
  const DOCS = fileURLToPath(new URL('../docs', import.meta.url))
  const [alex, blair] = await users(2)
  let tripId: string | undefined
  try {
    const { page } = alex
    await page.setViewportSize(DESKTOP)
    await page.goto('/home')
    await page.getByTestId('app-navigation').waitFor()
    await page.evaluate(() => localStorage.setItem('tripboard:sidebar-collapsed', '1'))
    const res = await action(page, 'createSampleTrip', {})
    tripId = (res.body.data as { tripId: string }).tripId
    const invite = await action(page, 'createInvite', { tripId })
    await blair.page.goto('/home')
    await action(blair.page, 'joinTrip', { code: (invite.body.data as { code: string }).code })

    await page.goto(`/trips/${tripId}`)
    await page.getByTestId('stop-card').first().waitFor()
    const day2 = page.getByTestId('day-column').nth(1)
    await day2.getByTestId('add-stop-button').click()
    await day2.getByLabel('Title').fill('Pasteis de Belem')
    await day2.getByRole('button', { name: 'Add stop' }).click()
    await day2.getByRole('button', { name: 'Show Pasteis de Belem on the map' }).waitFor({ timeout: 20_000 })

    await blair.page.setViewportSize(DESKTOP)
    await blair.page.goto(`/trips/${tripId}`)
    await blair.page.getByTestId('day-column').nth(1).hover()
    await page.reload()
    await page.getByTestId('stop-card').first().waitFor()
    await page.mouse.move(700, 450)
    await page.getByTestId('day-viewers').first().waitFor({ timeout: 20_000 })
    await page.waitForTimeout(4000)
    await page.screenshot({ path: `${DOCS}/trip-desktop.png` })

    await page.setViewportSize(PHONE)
    await page.reload()
    await page.getByTestId('stop-card').first().waitFor()
    await page.waitForTimeout(4000)
    await page.screenshot({ path: `${DOCS}/trip-phone.png` })

    await page.setViewportSize(DESKTOP)
    await page.goto('/')
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${DOCS}/landing.png` })
  } finally {
    await deleteTrip(alex.page, tripId)
  }
})

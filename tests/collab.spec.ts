import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

// A fresh checkout has no test accounts and `users()` would throw; skip with setup steps instead.
const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 2,
  `Needs 2 usable test accounts, found ${usableTestAccounts}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" ' +
    '--password-stdin`, or fetch existing pool accounts with `npx deepspace test accounts recover --all`.',
)

test('each browser renders its own signed-in account', async ({ users }) => {
  const [a, b] = await users(2)

  await Promise.all([a.page.goto('/home'), b.page.goto('/home')])

  // Assert the email, not the name: the local registry may hold no display name, while the
  // email is what each context signed in with. Two distinct matches prove the sessions are separate.
  for (const user of [a, b]) {
    await expect(user.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })

    await expect(user.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15_000 })

    await user.page.getByRole('button', { name: 'Account menu' }).click()
    await expect(user.page.getByTestId('nav-user-email')).toHaveText(user.email, {
      timeout: 15_000,
    })
  }
})

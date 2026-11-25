import { defineConfig } from '@playwright/test'
import { chromiumLaunchOptions } from 'deepspace/testing'

// --strictPort: a busy port fails fast instead of rebinding, so tests never attach to an unrelated app.
const PORT = Number(process.env.DEEPSPACE_PORT ?? 5173)
// 127.0.0.1, not localhost: newer Chromium applies Local Network Access checks to `localhost`.
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    headless: true,
    launchOptions: chromiumLaunchOptions(),
  },
  webServer: {
    // A bare `--host` enumerates every interface, which fails in restricted containers.
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    cwd: '..',
    // /api/auth/ok answers only once workerd has booted, so no test starts against a half-up server.
    url: `${BASE_URL}/api/auth/ok`,
    reuseExistingServer: false,
    env: { TRIPBOARD_MOCK_EXTERNAL: '1', TRIPBOARD_MOCK_RUN: String(Date.now()) },
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})

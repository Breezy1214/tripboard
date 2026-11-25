import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { appIdDefine } from 'deepspace/build'

const appDir = fileURLToPath(new URL('.', import.meta.url))

// Standalone so Vitest never loads the Worker build plugins, and so tests/*.spec.ts (Playwright) stay out.
export default defineConfig({
  define: appIdDefine({ appDir }),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['prerender.test.ts', 'src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
  },
})

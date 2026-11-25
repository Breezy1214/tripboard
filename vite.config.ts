import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import generouted from '@generouted/react-router/plugin'
import { cloudflare } from '@cloudflare/vite-plugin'
import checker from 'vite-plugin-checker'
import { deepspaceBuild } from 'deepspace/build'
import { prerender } from './prerender.ts'

const appDir = fileURLToPath(new URL('.', import.meta.url))

// Only Playwright's dev server mocks external calls; never applied to `vite build`.
const mockExternalApis = (command: string) =>
  command === 'serve' && process.env.TRIPBOARD_MOCK_EXTERNAL === '1'

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    generouted(),
    // The inspector-port probe enumerates network interfaces, which restricted containers reject.
    cloudflare({
      inspectorPort: false,
      ...(mockExternalApis(command)
        ? {
            config: (config) => ({
              vars: { ...config.vars, MOCK_EXTERNAL_APIS: 'true', MOCK_RUN_ID: process.env.TRIPBOARD_MOCK_RUN ?? '' },
            }),
          }
        : {}),
    }),
    deepspaceBuild({ appDir }),
    prerender(),
    checker({
      eslint: {
        lintCommand: 'eslint .',
        useFlatConfig: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    // Routes load through import.meta.glob, which the dep scanner skips; listing them avoids a
    // late re-optimize and reload on first dev boot. Only src/pages, so worker-only modules stay out.
    entries: ['./index.html', './src/pages/**/*.tsx'],
  },
}))

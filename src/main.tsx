import { createRoot, hydrateRoot } from 'react-dom/client'
// Route-based code splitting keeps authenticated/collaborative pages out of
// the initial bundle for a public top-level route such as `/`.
import { routes } from '@generouted/react-router/lazy'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { installStaleChunkRecovery } from './stale-chunk-recovery'
import '@fontsource-variable/geist'
import './styles.css'

async function main() {
  const root = document.getElementById('root')!
  const router = createBrowserRouter(routes)
  installStaleChunkRecovery(router)

  // Load the first route's module before rendering, so a prerendered page hydrates
  // the HTML on screen instead of discarding it and repainting.
  if (!router.state.initialized) {
    await new Promise<void>((done) => {
      const stop = router.subscribe((state) => {
        if (state.initialized) {
          stop()
          done()
        }
      })
    })
  }

  const app = <RouterProvider router={router} />
  // A prerendered page marks the route it holds; everything else (client routes
  // are served the empty shell) renders from scratch.
  if (root.dataset.prerendered === window.location.pathname && !router.state.errors) {
    hydrateRoot(root, app, {
      // React recovers by repainting, but the flicker is invisible in `deepspace dev`
      // (which never prerenders), so name it.
      onRecoverableError(error) {
        console.error(
          `[prerender] The static HTML for ${window.location.pathname} did not match what React rendered, so React repainted it. ` +
            'Public pages must render the same markup without a browser: no Date.now(), Math.random(), window, or matchMedia during render.',
          error,
        )
      },
    })
  } else {
    root.replaceChildren()
    createRoot(root).render(app)
  }
}

void main()

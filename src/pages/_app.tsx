// No DeepSpace providers here on purpose: top-level pages render static (no auth fetch, no socket).

import { Suspense } from 'react'
import { Outlet, useRouteError } from 'react-router-dom'
import { ErrorScreen } from '../components/ErrorScreen'
import { ToastProvider } from '@/components/ui'

export default function App() {
  return (
    <ToastProvider>
      {/* Tests use data-testid="app-root" as the "shell mounted" hook on every page. */}
      <div data-testid="app-root" className="min-h-screen bg-background text-foreground">
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-muted-foreground">Loading...</div>}>
          <Outlet />
        </Suspense>
      </div>
    </ToastProvider>
  )
}

/** Generouted wires `_app`'s `Catch` to the root errorElement, so render crashes land here. */
export function Catch() {
  const error = useRouteError()
  return <ErrorScreen error={error} />
}

/** Root fallback shown while Generouted loads the first lazy route module. */
export function HydrateFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      Loading...
    </div>
  )
}

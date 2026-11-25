/**
 * Gated routes. Any file under src/pages/(app)/(protected)/ requires sign-in.
 * The `(protected)` folder is a Generouted route group — parentheses mean
 * it doesn't appear in the URL. For a dynamic page that does NOT require
 * sign-in, put it directly under src/pages/(app)/; for a static page, put it
 * at the top level of src/pages/.
 *
 * Children may call data hooks like `useUser()` safely because the parent
 * (app)/_layout.tsx mounts <RecordProvider> above this layout.
 *
 * The `fallback` keeps signed-out visitors inside the app's own chrome
 * (without it, AuthGate shows the SDK's full-screen, non-dismissible
 * overlay). The sign-in overlay opens on demand and can be dismissed.
 */

import { useState } from 'react'
import { Link, Outlet, useSearchParams } from 'react-router-dom'
import { AuthGate, AuthOverlay } from 'deepspace'
import { Button } from '@/components/ui'
import { CenteredCard } from '../../../components/shell/CenteredCard'

export default function ProtectedLayout() {
  return (
    <AuthGate fallback={<SignedOutPanel />}>
      <Outlet />
    </AuthGate>
  )
}

function SignedOutPanel() {
  // "Start planning" on the landing page links here with ?signin=1, so the provider picker opens at once.
  const [params] = useSearchParams()
  const [showAuthModal, setShowAuthModal] = useState(params.get('signin') === '1')

  return (
    <CenteredCard>
      <h1 className="text-xl font-semibold tracking-tight text-foreground">Sign in to continue</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Sign in with Google or GitHub to see your trips and join the ones you are invited to.
      </p>
      <Button className="mt-6 w-full" onClick={() => setShowAuthModal(true)}>
        Sign in
      </Button>
      <Link
        to="/"
        className="mt-4 inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Back to home
      </Link>
      {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} />}
    </CenteredCard>
  )
}

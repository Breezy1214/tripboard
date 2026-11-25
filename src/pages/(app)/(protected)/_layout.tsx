// The fallback keeps signed-out visitors in the app's chrome; without it AuthGate shows a non-dismissible overlay.

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
  // The landing page links here with ?signin=1 so the provider picker opens at once.
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

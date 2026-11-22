import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AuthOverlay, useAuth } from 'deepspace'
import { Button } from '@/components/ui'
import { callAction, rememberInvite, takePendingInvite } from '../../../lib/actions'

export default function JoinPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const { isLoaded, isSignedIn } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [showSignIn, setShowSignIn] = useState(false)
  const attempted = useRef(false)

  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) {
      rememberInvite(code)
      return
    }
    if (attempted.current) return
    attempted.current = true
    takePendingInvite()
    callAction<{ tripId: string }>('joinTrip', { code })
      .then(({ tripId }) => navigate(`/trips/${tripId}`, { replace: true }))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not join this trip'))
  }, [isLoaded, isSignedIn, code, navigate])

  return (
    <div data-testid="join-page" className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
      {!isLoaded ? null : !isSignedIn ? (
        <>
          <h1 className="text-xl font-semibold text-foreground">You are invited to a trip</h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to join the board and plan together.</p>
          <Button className="mt-6 w-full" onClick={() => setShowSignIn(true)}>
            Sign in to join
          </Button>
          {showSignIn && <AuthOverlay onClose={() => setShowSignIn(false)} />}
        </>
      ) : error ? (
        <>
          <h1 className="text-xl font-semibold text-foreground">Could not join</h1>
          <p role="alert" className="mt-2 text-sm text-muted-foreground">
            {error}
          </p>
          <Link to="/home" className="mt-6 text-sm font-medium text-primary hover:underline">
            Back to your trips
          </Link>
        </>
      ) : (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          Joining the trip...
        </p>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { CalendarDays, MapPin, Plus, Sparkles } from 'lucide-react'
import { Badge, Button, useToast } from '@/components/ui'
import { CreateTripForm } from '../../../components/trip/CreateTripForm'
import { callAction, takePendingInvite } from '../../../lib/actions'
import { formatRange, todayIso, tripDays } from '../../../lib/trip-dates'
import type { Trip } from '../../../types'

function tripPhase(trip: Trip, today: string): { label: string; variant: 'info' | 'success' | 'outline' } {
  if (trip.endDate < today) return { label: 'Past', variant: 'outline' }
  if (trip.startDate <= today) return { label: 'Happening now', variant: 'success' }
  return { label: 'Upcoming', variant: 'info' }
}

export default function HomePage() {
  const navigate = useNavigate()
  const { error: toastError } = useToast()
  const { records, status, error } = useQuery<Trip>('trips', { orderBy: 'startDate', orderDir: 'asc' })
  const [creating, setCreating] = useState(false)
  const [sampleLoading, setSampleLoading] = useState(false)

  useEffect(() => {
    const code = takePendingInvite()
    if (code) navigate(`/join/${code}`, { replace: true })
  }, [navigate])

  async function createSample() {
    setSampleLoading(true)
    try {
      const { tripId } = await callAction<{ tripId: string }>('createSampleTrip', {})
      navigate(`/trips/${tripId}`)
    } catch (err) {
      toastError('Could not create the sample trip', err instanceof Error ? err.message : undefined)
      setSampleLoading(false)
    }
  }

  const today = todayIso()
  const upcoming = records.filter((r) => r.data.endDate >= today)
  const past = records.filter((r) => r.data.endDate < today).reverse()

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Your trips</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan day by day with the people you travel with. Everyone sees changes as they happen.
          </p>
        </div>
        {!creating && (
          <Button onClick={() => setCreating(true)} data-testid="new-trip-button">
            <Plus aria-hidden /> New trip
          </Button>
        )}
      </header>

      {creating && (
        <div className="mb-8">
          <CreateTripForm onCancel={() => setCreating(false)} />
        </div>
      )}

      {status === 'loading' ? (
        <div className="grid gap-4 sm:grid-cols-2" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      ) : status === 'error' ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-card p-6 text-sm">
          <p className="font-medium text-foreground">Could not load your trips</p>
          <p className="mt-1 text-muted-foreground">{error ?? 'The connection failed.'} Reload the page to try again.</p>
        </div>
      ) : records.length === 0 ? (
        !creating && (
          <div
            data-testid="trips-empty"
            className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card/60 px-6 py-14 text-center"
          >
            <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-secondary text-primary">
              <MapPin aria-hidden className="size-6" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">No trips yet</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Create a trip and invite friends with a link, or open a sample trip to see how the board works.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden /> Create a trip
              </Button>
              <Button variant="outline" onClick={createSample} loading={sampleLoading} data-testid="sample-trip-button">
                <Sparkles aria-hidden /> Try a sample trip
              </Button>
            </div>
          </div>
        )
      ) : (
        <div className="space-y-10">
          {upcoming.length > 0 && <TripGrid title="Upcoming" trips={upcoming} today={today} />}
          {past.length > 0 && <TripGrid title="Past" trips={past} today={today} />}
        </div>
      )}
    </div>
  )
}

function TripGrid({
  title,
  trips,
  today,
}: {
  title: string
  trips: { recordId: string; data: Trip }[]
  today: string
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      <ul className="grid gap-4 sm:grid-cols-2">
        {trips.map(({ recordId, data }) => {
          const phase = tripPhase(data, today)
          return (
            <li key={recordId}>
              <Link
                to={`/trips/${recordId}`}
                data-testid="trip-card"
                className="group block rounded-xl border border-border bg-card p-5 shadow-card transition hover:border-primary/40 hover:shadow-card-hover"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold text-foreground group-hover:text-primary">{data.name}</h3>
                  <Badge variant={phase.variant} size="sm">
                    {phase.label}
                  </Badge>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPin aria-hidden className="size-3.5" /> {data.placeLabel || data.destination}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CalendarDays aria-hidden className="size-3.5" /> {formatRange(data.startDate, data.endDate)} ·{' '}
                  {tripDays(data.startDate, data.endDate).length} days
                </p>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

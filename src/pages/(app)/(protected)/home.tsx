import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { CalendarDays, MapPin, Plus, RotateCw, Sparkles, WifiOff } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { CreateTripForm } from '../../../components/trip/CreateTripForm'
import { callAction, takePendingInvite } from '../../../lib/actions'
import { formatRange, todayIso, tripDays } from '../../../lib/trip-dates'
import type { Trip } from '../../../types'

function tripPhase(trip: Trip, today: string): { label: string; tone: string } {
  if (trip.endDate < today) return { label: 'Past', tone: 'bg-card/90 text-muted-foreground' }
  if (trip.startDate <= today) return { label: 'Happening now', tone: 'bg-primary text-primary-foreground' }
  return { label: 'Upcoming', tone: 'bg-card/90 text-foreground' }
}

export default function HomePage() {
  const [attempt, setAttempt] = useState(0)
  // A new key re-subscribes the trips query: the in-place retry.
  return <TripList key={attempt} onRetry={() => setAttempt((n) => n + 1)} />
}

function TripList({ onRetry }: { onRetry: () => void }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { error: toastError } = useToast()
  const { records, status, error } = useQuery<Trip>('trips', { orderBy: 'startDate', orderDir: 'asc' })
  const [creating, setCreating] = useState(params.get('new') === '1')
  const [sampleLoading, setSampleLoading] = useState(false)

  useEffect(() => {
    const code = takePendingInvite()
    if (code) navigate(`/join/${code}`, { replace: true })
  }, [navigate])

  useEffect(() => {
    if (params.get('new') !== '1') return
    setCreating(true)
    setParams({}, { replace: true })
  }, [params, setParams])

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
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-foreground">My trips</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Plan day by day with the people you travel with. Everyone sees changes as they happen.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {records.length > 0 && (
            <Button variant="outline" onClick={createSample} loading={sampleLoading}>
              <Sparkles aria-hidden /> Open a sample trip
            </Button>
          )}
          {!creating && (
            <Button onClick={() => setCreating(true)} data-testid="new-trip-button">
              <Plus aria-hidden /> New trip
            </Button>
          )}
        </div>
      </header>

      {creating && (
        <div className="mb-10 max-w-2xl">
          <CreateTripForm onCancel={() => setCreating(false)} />
        </div>
      )}

      {status === 'loading' && records.length > 0 && (
        <p role="status" data-testid="trips-offline" className="mb-4 inline-flex items-center gap-1.5 rounded-lg bg-warning/10 px-2.5 py-1.5 text-xs text-foreground">
          <WifiOff aria-hidden className="size-3.5 text-warning" /> Reconnecting. The list updates when the connection is back.
        </p>
      )}

      {status === 'loading' && records.length === 0 ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-2xl border border-border bg-card" />
          ))}
        </div>
      ) : status === 'error' && records.length === 0 ? (
        <div role="alert" data-testid="trips-error" className="max-w-lg rounded-2xl border border-destructive/30 bg-card p-6 text-sm">
          <p className="font-medium text-foreground">Could not load your trips</p>
          <p className="mt-1 text-muted-foreground">{error ?? 'The connection failed.'}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
            <RotateCw aria-hidden /> Try again
          </Button>
        </div>
      ) : records.length === 0 ? (
        !creating && (
          <div
            data-testid="trips-empty"
            className="grid overflow-hidden rounded-3xl border border-border bg-card md:grid-cols-[1.1fr_1fr]"
          >
            <div className="flex flex-col justify-center p-8 sm:p-10">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">No trips yet</h2>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Open the sample Lisbon trip to see a full board with stops on the map, or start your own and invite friends with a link.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Button onClick={createSample} loading={sampleLoading} data-testid="sample-trip-button">
                  <Sparkles aria-hidden /> Try a sample trip
                </Button>
                <Button variant="outline" onClick={() => setCreating(true)}>
                  <Plus aria-hidden /> Create a trip
                </Button>
              </div>
            </div>
            <RouteArt className="hidden min-h-64 md:block" />
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

function TripGrid({ title, trips, today }: { title: string; trips: { recordId: string; data: Trip }[]; today: string }) {
  return (
    <section>
      <h2 className="mb-3 text-[15px] font-semibold text-foreground">
        {title} <span className="font-normal text-muted-foreground">{trips.length}</span>
      </h2>
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {trips.map(({ recordId, data }, i) => {
          const phase = tripPhase(data, today)
          const length = tripDays(data.startDate, data.endDate).length
          return (
            <li key={recordId}>
              <Link
                to={`/trips/${recordId}`}
                data-testid="trip-card"
                className="group block overflow-hidden rounded-2xl border border-border bg-card transition hover:border-foreground/15 hover:shadow-[0_16px_40px_-24px_rgba(14,26,21,0.35)]"
              >
                <div className="relative h-32">
                  <RouteArt seed={i} className="absolute inset-0" />
                  <span className={cn('absolute right-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-medium shadow-sm', phase.tone)}>
                    {phase.label}
                  </span>
                  <p className="absolute bottom-3 left-4 flex items-center gap-1.5 rounded-full bg-card/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm">
                    <MapPin aria-hidden className="size-3.5 text-primary" /> {data.placeLabel || data.destination}
                  </p>
                </div>
                <div className="p-4">
                  <h3 className="truncate text-[15px] font-semibold tracking-tight text-foreground group-hover:text-primary">{data.name}</h3>
                  <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                    <CalendarDays aria-hidden className="size-3.5" /> {formatRange(data.startDate, data.endDate)}
                    <span className="ml-auto text-xs">
                      {length} {length === 1 ? 'day' : 'days'}
                    </span>
                  </p>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const ROUTES = [
  'M-10 96 C 60 40, 110 120, 170 70 S 280 20, 340 60',
  'M-10 60 C 50 110, 120 20, 190 80 S 290 110, 340 40',
  'M-10 110 C 70 90, 90 30, 160 50 S 260 120, 340 80',
]

/** A quiet map-like cover: contour rings and a dotted route between stops. */
function RouteArt({ seed = 0, className }: { seed?: number; className?: string }) {
  const path = ROUTES[seed % ROUTES.length]
  return (
    <svg aria-hidden viewBox="0 0 330 140" preserveAspectRatio="xMidYMid slice" className={cn('bg-[#e6efe9]', className)}>
      <g fill="none" stroke="#cfe0d6" strokeWidth="1">
        {[28, 48, 68, 88].map((r) => (
          <ellipse key={r} cx={70 + seed * 40} cy={40} rx={r * 1.3} ry={r} />
        ))}
        {[22, 40, 58].map((r) => (
          <ellipse key={`b${r}`} cx={270 - seed * 25} cy={120} rx={r * 1.4} ry={r} />
        ))}
      </g>
      <path d={path} fill="none" stroke="#0f4c3a" strokeWidth="2" strokeLinecap="round" strokeDasharray="0.5 6" />
      <circle cx="40" cy={seed % 2 ? 78 : 72} r="5" fill="#0f4c3a" />
      <circle cx="290" cy={seed % 2 ? 66 : 50} r="5" fill="#fff" stroke="#0f4c3a" strokeWidth="2.5" />
    </svg>
  )
}

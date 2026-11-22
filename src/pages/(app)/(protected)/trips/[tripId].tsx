import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth, useMutations, usePresenceRoom, useQuery, useUser, type RecordData } from 'deepspace'
import { ArrowLeft, CalendarDays, MapPin, RotateCw, Sparkles, Trash2, WifiOff } from 'lucide-react'
import { Button, ConfirmModal, useToast } from '@/components/ui'
import { DayColumn, type Viewer } from '../../../../components/trip/DayColumn'
import type { ForecastLoad } from '../../../../components/trip/DayWeather'
import { InviteButton } from '../../../../components/trip/InviteButton'
import { PersonAvatar } from '../../../../components/trip/PersonAvatar'
import { callAction } from '../../../../lib/actions'
import { formatDay, formatRange, todayIso, tripDays, tripOverlapsForecast } from '../../../../lib/trip-dates'
import type { Stop, TeamMember, Trip } from '../../../../types'

const FORECAST_TTL_MS = 60 * 60 * 1000

// The chat brings markdown and code highlighting; load it after the board.
const TripChat = lazy(() => import('../../../../components/trip/TripChat').then((m) => ({ default: m.TripChat })))

function wideScreen() {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
}

export default function TripPage() {
  const { tripId = '' } = useParams()
  const [attempt, setAttempt] = useState(0)
  // A new key re-subscribes every query on the page: the in-place retry.
  return <TripLoader key={`${tripId}:${attempt}`} tripId={tripId} onRetry={() => setAttempt((n) => n + 1)} />
}

function TripLoader({ tripId, onRetry }: { tripId: string; onRetry: () => void }) {
  const { records, status, error } = useQuery<Trip>('trips', { where: { teamId: tripId } })
  const trip = records.find((r) => r.recordId === tripId)

  // A dropped socket puts every query back to 'loading' but keeps its records,
  // so the board (and any open editor or chat) stays mounted while it reconnects.
  if (trip) return <TripBoard trip={trip} onRetry={onRetry} />

  if (status === 'loading') {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8" aria-busy="true">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="mt-6 flex gap-4 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-72 w-72 shrink-0 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div role="alert" data-testid="trip-error" className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
        <h1 className="text-lg font-semibold text-foreground">Could not load this trip</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error ?? 'The connection failed.'}</p>
        <Button className="mt-6" onClick={onRetry}>
          <RotateCw aria-hidden /> Try again
        </Button>
      </div>
    )
  }

  return (
    <div data-testid="trip-not-found" className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
      <h1 className="text-lg font-semibold text-foreground">Trip not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        It may have been deleted, or you are not a member. Ask someone on the trip for an invite link.
      </p>
      <Link to="/home" className="mt-6 text-sm font-medium text-primary hover:underline">
        Back to your trips
      </Link>
    </div>
  )
}

function TripBoard({ trip, onRetry }: { trip: RecordData<Trip>; onRetry: () => void }) {
  const tripId = trip.recordId
  const navigate = useNavigate()
  const { error: toastError } = useToast()
  const { userId } = useAuth()
  const { user } = useUser()
  const stopsQuery = useQuery<Stop>('stops', { where: { tripId } })
  const membersQuery = useQuery<TeamMember>('team_members', { where: { teamId: tripId } })
  const { ready, putConfirmed, removeConfirmed } = useMutations<Stop>('stops')
  const { peers, connected, updateState } = usePresenceRoom(`trip:${tripId}`)
  const [viewDay, setViewDay] = useState<string | null>(null)
  const [forecastLoad, setForecastLoad] = useState<ForecastLoad>('idle')
  const [forecastAttempt, setForecastAttempt] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [chatOpen, setChatOpen] = useState(wideScreen)

  const today = todayIso()
  const { startDate, endDate, lat, lon, forecast, forecastAt } = trip.data
  const days = useMemo(() => tripDays(startDate, endDate), [startDate, endDate])
  const hasLocation = typeof lat === 'number' && typeof lon === 'number'

  const updateStateRef = useRef(updateState)
  updateStateRef.current = updateState
  useEffect(() => {
    if (connected) updateStateRef.current({ day: viewDay })
  }, [viewDay, connected])

  const forecastFresh = !!forecastAt && Date.now() - Date.parse(forecastAt) < FORECAST_TTL_MS
  const needsForecast = hasLocation && tripOverlapsForecast(startDate, endDate, today) && !forecastFresh
  useEffect(() => {
    if (!needsForecast) return
    setForecastLoad('loading')
    callAction('refreshForecast', { tripId })
      .then(() => setForecastLoad('idle'))
      .catch(() => setForecastLoad('error'))
  }, [needsForecast, tripId, forecastAttempt])

  const stopsByDay = useMemo(() => {
    const map = new Map<string, RecordData<Stop>[]>()
    for (const stop of stopsQuery.records) {
      const list = map.get(stop.data.day) ?? []
      list.push(stop)
      map.set(stop.data.day, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.data.position ?? 0) - (b.data.position ?? 0) || a.createdAt.localeCompare(b.createdAt))
    }
    return map
  }, [stopsQuery.records])

  const uniquePeers = useMemo(() => {
    const seen = new Map<string, (typeof peers)[number]>()
    for (const peer of peers) if (peer.userId !== userId) seen.set(peer.userId, peer)
    return [...seen.values()]
  }, [peers, userId])

  const members = useMemo(() => membersQuery.records.filter((m) => m.data.status !== 'removed'), [membersQuery.records])

  // Names come from the trip's own member rows (the users roster only holds
  // yourself), then from live presence for rows written before names were kept.
  const people = useMemo(() => {
    const map = new Map<string, { name?: string; imageUrl?: string }>()
    for (const m of members) map.set(m.data.userId, { name: m.data.name || undefined, imageUrl: m.data.imageUrl || undefined })
    for (const peer of uniquePeers) {
      const known = map.get(peer.userId)
      if (!known?.name && peer.userName) map.set(peer.userId, { ...known, name: peer.userName })
    }
    if (userId && user) map.set(userId, { name: user.name || undefined, imageUrl: user.imageUrl || undefined })
    return map
  }, [members, uniquePeers, userId, user])
  const nameFor = useCallback((id: string) => people.get(id)?.name, [people])

  const viewersByDay = useMemo(() => {
    const map = new Map<string, Viewer[]>()
    for (const peer of uniquePeers) {
      const day = typeof peer.state.day === 'string' ? peer.state.day : null
      if (!day) continue
      const list = map.get(day) ?? []
      list.push({ userId: peer.userId, name: peer.userName || 'Someone', imageUrl: people.get(peer.userId)?.imageUrl })
      map.set(day, list)
    }
    return map
  }, [uniquePeers, people])

  const onlineIds = new Set(uniquePeers.map((p) => p.userId))

  async function move(day: string, index: number, direction: -1 | 1) {
    const order = [...(stopsByDay.get(day) ?? [])]
    const target = index + direction
    if (target < 0 || target >= order.length) return
    ;[order[index], order[target]] = [order[target], order[index]]
    await Promise.all(
      order.map((s, i) => (s.data.position === i + 1 ? null : putConfirmed(s.recordId, { position: i + 1 }))),
    )
  }

  async function save(stop: { recordId: string; data: Stop }, patch: Partial<Stop>) {
    const next: Partial<Stop> = { ...patch }
    if (patch.day && patch.day !== stop.data.day) {
      const targetStops = stopsByDay.get(patch.day) ?? []
      next.position = Math.max(0, ...targetStops.map((s) => s.data.position ?? 0)) + 1
    } else {
      delete next.day
    }
    await putConfirmed(stop.recordId, next)
  }

  async function deleteTrip() {
    setDeleting(true)
    try {
      await callAction('deleteTrip', { tripId })
      navigate('/home', { replace: true })
    } catch (err) {
      toastError('Could not delete the trip', err instanceof Error ? err.message : undefined)
      setDeleting(false)
    }
  }

  function viewingLabel(day: unknown) {
    if (typeof day !== 'string') return 'on the trip'
    const { weekday, label } = formatDay(day)
    return `looking at ${weekday} ${label}`
  }

  return (
    <div className="flex min-h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-border bg-background/80 px-4 py-4 sm:px-6">
          <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <Link to="/home" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ArrowLeft aria-hidden className="size-3" /> All trips
              </Link>
              <h1 data-testid="trip-name" className="truncate text-2xl font-semibold tracking-tight text-foreground">
                {trip.data.name}
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin aria-hidden className="size-3.5" /> {trip.data.placeLabel || trip.data.destination}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays aria-hidden className="size-3.5" /> {formatRange(startDate, endDate)}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div data-testid="trip-members" className="flex items-center -space-x-2">
                {userId && (
                  <PersonAvatar userId={userId} name={user?.name || 'You'} imageUrl={user?.imageUrl} title="You" />
                )}
                {members
                  .filter((m) => m.data.userId !== userId)
                  .map((m) => {
                    const info = people.get(m.data.userId)
                    const peer = uniquePeers.find((p) => p.userId === m.data.userId)
                    const name = info?.name || peer?.userName || 'Trip member'
                    const online = onlineIds.has(m.data.userId)
                    return (
                      <PersonAvatar
                        key={m.recordId}
                        userId={m.data.userId}
                        name={name}
                        imageUrl={info?.imageUrl}
                        dimmed={!online}
                        title={online ? `${name} is ${viewingLabel(peer?.state.day)}` : `${name} (away)`}
                      />
                    )
                  })}
              </div>
              <span data-testid="presence-summary" className="text-xs text-muted-foreground">
                {uniquePeers.length === 0
                  ? 'Only you here'
                  : `${uniquePeers.map((p) => p.userName || 'Someone').join(', ')} here now`}
              </span>
              <InviteButton tripId={tripId} />
              {!chatOpen && (
                <Button variant="outline" size="sm" className="hidden lg:inline-flex" onClick={() => setChatOpen(true)} data-testid="open-chat">
                  <Sparkles aria-hidden /> Co-planner
                </Button>
              )}
              {trip.createdBy === userId && (
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} aria-label="Delete trip">
                  <Trash2 aria-hidden />
                </Button>
              )}
            </div>
          </div>
          {!ready && (
            <p role="status" data-testid="board-offline" className="mx-auto mt-3 flex max-w-7xl items-center gap-1.5 text-xs text-warning">
              <WifiOff aria-hidden className="size-3.5" /> Reconnecting to the board. Editing is paused until it is live; nothing you typed is lost.
            </p>
          )}
        </header>

        {/* Bottom padding on phones lets the last stops scroll clear of the floating Co-planner button. */}
        <div className="flex-1 snap-x snap-mandatory scroll-px-4 overflow-x-auto px-4 pb-24 pt-5 sm:scroll-px-6 sm:px-6 lg:pb-5">
          {stopsQuery.status === 'error' ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
              Could not load stops: {stopsQuery.error ?? 'connection failed'}.
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RotateCw aria-hidden /> Try again
              </Button>
            </div>
          ) : (
            <div data-testid="trip-board" className="mx-auto flex max-w-7xl gap-4 pb-4">
              {days.map((day, i) => (
                <DayColumn
                  key={day}
                  tripId={tripId}
                  day={day}
                  index={i}
                  days={days}
                  today={today}
                  stops={stopsByDay.get(day) ?? []}
                  viewers={viewersByDay.get(day) ?? []}
                  canWrite={ready && stopsQuery.status === 'ready'}
                  hasLocation={hasLocation}
                  weather={forecast?.days?.[day]}
                  forecastLoad={forecastLoad === 'idle' && needsForecast ? 'loading' : forecastLoad}
                  onRetryForecast={() => setForecastAttempt((n) => n + 1)}
                  nameFor={nameFor}
                  onFocusDay={setViewDay}
                  onMove={move}
                  onSave={save}
                  onDelete={(id) => removeConfirmed(id)}
                />
              ))}
            </div>
          )}
          <p className="mx-auto max-w-7xl text-xs text-muted-foreground">
            Weather data by{' '}
            <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline hover:text-foreground">
              Open-Meteo.com
            </a>
          </p>
        </div>

        <ConfirmModal
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title="Delete this trip?"
          description="All days, stops and invite links are removed for every member. This cannot be undone."
          confirmText="Delete trip"
          loading={deleting}
          onConfirm={deleteTrip}
        />
      </div>
      {userId && (
        <Suspense fallback={null}>
          <TripChat tripId={tripId} userId={userId} open={chatOpen} onClose={() => setChatOpen(false)} />
        </Suspense>
      )}
      {!chatOpen && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          data-testid="open-chat-fab"
          className="fixed bottom-5 right-5 z-20 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg lg:hidden"
        >
          <Sparkles aria-hidden className="size-4" /> Co-planner
        </button>
      )}
    </div>
  )
}

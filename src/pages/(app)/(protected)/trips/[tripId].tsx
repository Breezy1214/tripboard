import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth, useMutations, usePresenceRoom, useQuery, useUser, type RecordData } from 'deepspace'
import { ChevronsRight, ListTree, RotateCw, Sparkles, WifiOff } from 'lucide-react'
import { Button, ConfirmModal, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { CalendarView } from '../../../../components/trip/CalendarView'
import { DayColumn, type Viewer } from '../../../../components/trip/DayColumn'
import type { ForecastLoad } from '../../../../components/trip/DayWeather'
import type { MapPadding, MapPoint } from '../../../../components/trip/TripMap'
import { TripTopBar, type Person } from '../../../../components/trip/TripTopBar'
import { callAction, locateStop } from '../../../../lib/actions'
import { hasCoords } from '../../../../lib/geo'
import { formatDay, todayIso, tripDays, tripOverlapsForecast } from '../../../../lib/trip-dates'
import { useMediaQuery } from '../../../../lib/use-media-query'
import type { Stop, TeamMember, Trip } from '../../../../types'

const FORECAST_TTL_MS = 60 * 60 * 1000

// The chat brings markdown and the map brings WebGL; load both after the board.
const TripChat = lazy(() => import('../../../../components/trip/TripChat').then((m) => ({ default: m.TripChat })))
const TripMap = lazy(() => import('../../../../components/trip/TripMap'))

function startWithChatOpen() {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches
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
      <div className="flex h-full flex-col" aria-busy="true">
        <div className="h-14 border-b border-border bg-card" />
        <div className="map-fallback relative flex-1">
          <div className="absolute bottom-4 right-4 top-4 hidden w-[400px] animate-pulse rounded-2xl border border-border bg-card lg:block" />
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div role="alert" data-testid="trip-error" className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
        <h1 className="text-lg font-semibold text-foreground">Could not load this trip</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error ?? 'The connection failed.'}</p>
        <Button className="mt-6" onClick={onRetry}>
          <RotateCw aria-hidden /> Try again
        </Button>
      </div>
    )
  }

  return (
    <div data-testid="trip-not-found" className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
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
  const wide = useMediaQuery('(min-width: 1024px)')
  const xl = useMediaQuery('(min-width: 1280px)')
  const [viewDay, setViewDay] = useState<string | null>(null)
  const [forecastLoad, setForecastLoad] = useState<ForecastLoad>('idle')
  const [forecastAttempt, setForecastAttempt] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [chatOpen, setChatOpen] = useState(startWithChatOpen)
  const [planOpen, setPlanOpen] = useState(true)
  const [tab, setTab] = useState<'itinerary' | 'calendar'>('itinerary')
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(() => new Set())
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

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

  const mapPoints = useMemo(() => {
    const points: MapPoint[] = []
    for (const day of days) {
      for (const stop of stopsByDay.get(day) ?? []) {
        if (hasCoords(stop.data)) {
          points.push({ id: stop.recordId, lat: stop.data.lat, lon: stop.data.lon, label: String(points.length + 1), title: stop.data.title })
        }
      }
    }
    return points
  }, [days, stopsByDay])
  const mapLabels = useMemo(() => new Map(mapPoints.map((p) => [p.id, p.label])), [mapPoints])
  const stopCounts = useMemo(() => new Map(days.map((d) => [d, stopsByDay.get(d)?.length ?? 0])), [days, stopsByDay])

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

  function viewingLabel(day: unknown) {
    if (typeof day !== 'string') return 'on the trip'
    const { weekday, label } = formatDay(day)
    return `looking at ${weekday} ${label}`
  }

  const others: Person[] = members
    .filter((m) => m.data.userId !== userId)
    .map((m) => {
      const info = people.get(m.data.userId)
      const peer = uniquePeers.find((p) => p.userId === m.data.userId)
      const name = info?.name || peer?.userName || 'Trip member'
      const online = onlineIds.has(m.data.userId)
      return {
        userId: m.data.userId,
        name,
        imageUrl: info?.imageUrl,
        online,
        title: online ? `${name} is ${viewingLabel(peer?.state.day)}` : `${name} (away)`,
      }
    })

  const presenceSummary =
    uniquePeers.length === 0 ? 'Only you here' : `${uniquePeers.map((p) => p.userName || 'Someone').join(', ')} here now`

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
    const { day, ...fields } = patch
    await putConfirmed(stop.recordId, fields)
    if (day && day !== stop.data.day) await callAction('moveStop', { tripId, stopId: stop.recordId, day })
    if (fields.title && fields.title !== stop.data.title) locateStop(tripId, stop.recordId)
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

  function toggleDay(day: string) {
    setCollapsedDays((prev) => {
      const next = new Set(prev)
      if (next.has(day)) next.delete(day)
      else next.add(day)
      return next
    })
  }

  function openDay(day: string) {
    setTab('itinerary')
    setPlanOpen(true)
    setCollapsedDays((prev) => {
      const next = new Set(prev)
      next.delete(day)
      return next
    })
    requestAnimationFrame(() => document.getElementById(`day-${day}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  function selectStop(stopId: string) {
    setSelectedStopId(stopId)
    const stop = stopsQuery.records.find((s) => s.recordId === stopId)
    if (stop && collapsedDays.has(stop.data.day)) toggleDay(stop.data.day)
    setPlanOpen(true)
    setTab('itinerary')
    requestAnimationFrame(() =>
      listRef.current?.querySelector(`[data-stop-id="${stopId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
    )
  }

  const chatWidth = xl ? 380 : 340
  const planWidth = xl ? 420 : 360
  const mapPadding: MapPadding = wide
    ? {
        top: 32,
        bottom: 32,
        left: chatOpen ? chatWidth + 48 : 32,
        right: planOpen ? planWidth + 48 : 32,
      }
    : { top: 28, bottom: 56, left: 28, right: 64 }
  const mapChrome = wide ? { right: planOpen ? planWidth + 32 : 16, bottom: 6 } : { right: 10, bottom: 26 }

  const totalStops = stopsQuery.records.length

  return (
    <div className="flex min-h-full flex-col lg:h-full">
      <TripTopBar
        tripId={tripId}
        trip={trip.data}
        you={userId ? { userId, name: user?.name || 'You', imageUrl: user?.imageUrl || undefined } : null}
        others={others}
        presenceSummary={presenceSummary}
        memberCount={Math.max(members.length, 1)}
        canDelete={trip.createdBy === userId}
        onDelete={() => setConfirmDelete(true)}
      />

      <div className="relative flex flex-1 flex-col lg:min-h-0">
        <div className="relative h-[38dvh] min-h-56 shrink-0 overflow-hidden lg:absolute lg:inset-0 lg:h-auto">
          <Suspense fallback={<div className="map-fallback absolute inset-0" />}>
            <TripMap
              center={hasLocation ? { lat: lat as number, lon: lon as number } : null}
              points={mapPoints}
              padding={mapPadding}
              chrome={mapChrome}
              selectedId={selectedStopId}
              onSelect={selectStop}
            />
          </Suspense>
          {!hasLocation && (
            <p className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
              We could not place this destination on the map.
            </p>
          )}
        </div>

        {wide && !chatOpen && (
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            data-testid="open-chat"
            className="absolute left-4 top-4 z-10 inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground shadow-[0_8px_24px_-12px_rgba(14,26,21,0.35)] hover:bg-secondary"
          >
            <Sparkles aria-hidden className="size-4 text-primary" /> Co-planner
          </button>
        )}
        {wide && !planOpen && (
          <button
            type="button"
            onClick={() => setPlanOpen(true)}
            className="absolute right-4 top-4 z-10 inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground shadow-[0_8px_24px_-12px_rgba(14,26,21,0.35)] hover:bg-secondary"
          >
            <ListTree aria-hidden className="size-4 text-primary" /> Itinerary
          </button>
        )}

        <section
          aria-label="Itinerary"
          className={cn(
            'relative z-10 -mt-5 flex flex-1 flex-col rounded-t-3xl border-t border-border bg-card pb-24',
            'lg:absolute lg:bottom-4 lg:right-4 lg:top-4 lg:mt-0 lg:rounded-2xl lg:border lg:pb-0 lg:shadow-[0_16px_40px_-20px_rgba(14,26,21,0.35)]',
            'lg:w-[360px] xl:w-[420px]',
            wide && !planOpen && 'hidden',
          )}
        >
          <span aria-hidden className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-border lg:hidden" />
          <div className="px-5 pb-3 pt-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h1 data-testid="trip-name" className="text-xl font-semibold leading-tight tracking-tight text-foreground">
                  {trip.data.name}
                </h1>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {days.length} {days.length === 1 ? 'day' : 'days'}, {totalStops} {totalStops === 1 ? 'stop' : 'stops'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlanOpen(false)}
                aria-label="Hide itinerary"
                className="hidden size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground lg:inline-flex"
              >
                <ChevronsRight aria-hidden className="size-4" />
              </button>
            </div>
            <div role="tablist" aria-label="Trip views" className="mt-4 flex gap-5 border-b border-border">
              {(['itinerary', 'calendar'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={cn(
                    '-mb-px border-b-2 pb-2 text-[13px] font-medium capitalize transition-colors',
                    tab === id ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {id}
                </button>
              ))}
            </div>
            {!ready && (
              <p role="status" data-testid="board-offline" className="mt-3 flex items-center gap-1.5 rounded-lg bg-warning/10 px-2.5 py-1.5 text-xs text-foreground">
                <WifiOff aria-hidden className="size-3.5 shrink-0 text-warning" /> Reconnecting. Editing is paused until the board is live; nothing you typed is lost.
              </p>
            )}
          </div>

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            {stopsQuery.status === 'error' ? (
              <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
                Could not load stops: {stopsQuery.error ?? 'connection failed'}.
                <Button variant="outline" size="sm" onClick={onRetry}>
                  <RotateCw aria-hidden /> Try again
                </Button>
              </div>
            ) : tab === 'calendar' ? (
              <CalendarView days={days} today={today} stopCounts={stopCounts} forecast={forecast} onPick={openDay} />
            ) : (
              <div data-testid="trip-board" className="flex flex-col gap-6 pt-1">
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
                    collapsed={collapsedDays.has(day)}
                    mapLabels={mapLabels}
                    selectedStopId={selectedStopId}
                    onToggle={() => toggleDay(day)}
                    onRetryForecast={() => setForecastAttempt((n) => n + 1)}
                    nameFor={nameFor}
                    onFocusDay={setViewDay}
                    onSelectStop={selectStop}
                    onMove={move}
                    onSave={save}
                    onDelete={(id) => removeConfirmed(id)}
                  />
                ))}
              </div>
            )}
            <p className="mt-6 text-[11px] text-muted-foreground">
              Weather data by{' '}
              <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                Open-Meteo.com
              </a>
            </p>
          </div>
        </section>

        {userId && (
          <Suspense fallback={null}>
            <TripChat
              tripId={tripId}
              userId={userId}
              open={chatOpen}
              onClose={() => setChatOpen(false)}
              className="lg:absolute lg:inset-x-auto lg:bottom-4 lg:left-4 lg:top-4 lg:z-20 lg:h-auto lg:w-[340px] lg:rounded-2xl lg:shadow-[0_16px_40px_-20px_rgba(14,26,21,0.35)] xl:w-[380px]"
            />
          </Suspense>
        )}
      </div>

      {!chatOpen && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          data-testid="open-chat-fab"
          className="fixed bottom-5 right-5 z-20 inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-3 text-sm font-medium text-background shadow-lg lg:hidden"
        >
          <Sparkles aria-hidden className="size-4" /> Co-planner
        </button>
      )}

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
  )
}

import { useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { callAction, locateStop } from '../../lib/actions'
import { distanceKm, formatDistance, hasCoords } from '../../lib/geo'
import { formatDay } from '../../lib/trip-dates'
import type { DayWeather as DayWeatherData, Stop } from '../../types'
import { DayWeather, type ForecastLoad } from './DayWeather'
import { PersonAvatar } from './PersonAvatar'
import { StopCard, StopEditor } from './StopCard'

export interface Viewer {
  userId: string
  name: string
  imageUrl?: string
}

interface Props {
  tripId: string
  day: string
  index: number
  days: string[]
  today: string
  stops: { recordId: string; data: Stop }[]
  viewers: Viewer[]
  canWrite: boolean
  hasLocation: boolean
  weather: DayWeatherData | undefined
  forecastLoad: ForecastLoad
  collapsed: boolean
  mapLabels: Map<string, string>
  selectedStopId: string | null
  onToggle: () => void
  onRetryForecast: () => void
  nameFor: (userId: string) => string | undefined
  onFocusDay: (day: string) => void
  onSelectStop: (stopId: string) => void
  onMove: (day: string, index: number, direction: -1 | 1) => Promise<void>
  onSave: (stop: { recordId: string; data: Stop }, patch: Partial<Stop>) => Promise<void>
  onDelete: (stopId: string) => Promise<void>
}

export function DayColumn({
  tripId,
  day,
  index,
  days,
  today,
  stops,
  viewers,
  canWrite,
  hasLocation,
  weather,
  forecastLoad,
  collapsed,
  mapLabels,
  selectedStopId,
  onToggle,
  onRetryForecast,
  nameFor,
  onFocusDay,
  onSelectStop,
  onMove,
  onSave,
  onDelete,
}: Props) {
  const { error } = useToast()
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const { weekday, label } = formatDay(day)
  const isToday = day === today

  async function addStop(input: Pick<Stop, 'title' | 'time' | 'notes'>) {
    setSaving(true)
    try {
      const { stopId } = await callAction<{ stopId: string }>('addStop', { tripId, day, ...input })
      setAdding(false)
      locateStop(tripId, stopId)
    } catch (err) {
      error('Could not add the stop', err instanceof Error ? err.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      data-testid="day-column"
      data-day={day}
      id={`day-${day}`}
      aria-label={`Day ${index + 1}, ${weekday} ${label}`}
      onPointerMove={() => onFocusDay(day)}
      onFocusCapture={() => onFocusDay(day)}
      className="scroll-mt-3"
    >
      <header className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            className="flex w-full items-baseline gap-2 rounded-lg py-1 text-left"
          >
            <span className="text-[15px] font-semibold tracking-tight text-foreground">Day {index + 1}</span>
            <span className="text-[13px] text-muted-foreground">
              {weekday}, {label}
            </span>
            {isToday && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">Today</span>}
            <span className="ml-auto self-center text-xs text-muted-foreground">
              {stops.length} {stops.length === 1 ? 'stop' : 'stops'}
            </span>
            <ChevronDown aria-hidden className={cn('size-4 self-center text-muted-foreground transition-transform', collapsed && '-rotate-90')} />
          </button>
        </h2>
        {viewers.length > 0 && (
          <div data-testid="day-viewers" className="flex -space-x-2 pt-0.5" aria-label={`Viewing: ${viewers.map((v) => v.name).join(', ')}`}>
            {viewers.map((v) => (
              <PersonAvatar key={v.userId} userId={v.userId} name={v.name} imageUrl={v.imageUrl} size="sm" title={`${v.name} is looking at this day`} />
            ))}
          </div>
        )}
      </header>
      <DayWeather day={day} today={today} hasLocation={hasLocation} weather={weather} load={forecastLoad} onRetry={onRetryForecast} />

      {!collapsed && (
        <>
          <ol className="relative mt-3 flex flex-col gap-2 pl-6 before:absolute before:bottom-3 before:left-[7px] before:top-3 before:w-px before:bg-border">
            {stops.length === 0 && !adding && (
              <li className="relative rounded-2xl border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
                <TimelineDot muted />
                Nothing planned yet. Add a stop, or ask the co-planner.
              </li>
            )}
            {stops.map((stop, i) => {
              const prev = stops[i - 1]?.data
              const gap = prev && hasCoords(prev) && hasCoords(stop.data) ? formatDistance(distanceKm(prev, stop.data)) : null
              return (
                <li key={stop.recordId} className="relative">
                  {gap && (
                    <p className="-mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                      <span className="sr-only">Distance from the previous stop: </span>
                      {gap}
                    </p>
                  )}
                  <TimelineDot active={stop.recordId === selectedStopId} offset={gap ? 'top-[34px]' : 'top-5'} />
                  <StopCard
                    stop={stop}
                    days={days}
                    canWrite={canWrite}
                    isFirst={i === 0}
                    isLast={i === stops.length - 1}
                    mapLabel={mapLabels.get(stop.recordId)}
                    selected={stop.recordId === selectedStopId}
                    nameFor={nameFor}
                    onSelect={mapLabels.has(stop.recordId) ? () => onSelectStop(stop.recordId) : undefined}
                    onMove={(direction) => onMove(day, i, direction)}
                    onSave={(patch) => onSave(stop, patch)}
                    onDelete={() => onDelete(stop.recordId)}
                  />
                </li>
              )
            })}
            {adding && (
              <li className="relative">
                <TimelineDot active />
                <StopEditor stop={{ day }} busy={saving} submitLabel="Add stop" onCancel={() => setAdding(false)} onSubmit={addStop} />
              </li>
            )}
          </ol>

          {!adding && (
            <button
              type="button"
              disabled={!canWrite}
              onClick={() => setAdding(true)}
              data-testid="add-stop-button"
              className="ml-6 mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <Plus aria-hidden className="size-4" /> Add stop
            </button>
          )}
        </>
      )}
    </section>
  )
}

function TimelineDot({ active, muted, offset = 'top-5' }: { active?: boolean; muted?: boolean; offset?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute -left-[22px] size-[11px] rounded-full border-2 bg-card',
        offset,
        active ? 'border-foreground bg-foreground' : muted ? 'border-border' : 'border-primary',
      )}
    />
  )
}

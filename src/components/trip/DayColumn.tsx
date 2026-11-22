import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { callAction } from '../../lib/actions'
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
  onRetryForecast: () => void
  nameFor: (userId: string) => string | undefined
  onFocusDay: (day: string) => void
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
  onRetryForecast,
  nameFor,
  onFocusDay,
  onMove,
  onSave,
  onDelete,
}: Props) {
  const { error } = useToast()
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const { weekday, label } = formatDay(day)

  async function addStop(input: Pick<Stop, 'title' | 'time' | 'notes'>) {
    setSaving(true)
    try {
      await callAction('addStop', { tripId, day, ...input })
      setAdding(false)
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
      aria-label={`Day ${index + 1}, ${weekday} ${label}`}
      onPointerEnter={() => onFocusDay(day)}
      onFocusCapture={() => onFocusDay(day)}
      className={cn(
        'flex w-[85vw] max-w-xs shrink-0 snap-start flex-col rounded-xl border border-border bg-card p-3 sm:w-72',
        day === today && 'border-primary/50',
      )}
    >
      <header className="mb-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Day {index + 1}</p>
            <h2 className="text-base font-semibold text-foreground">
              {weekday} {label}
              {day === today && <span className="ml-2 text-xs font-medium text-primary">Today</span>}
            </h2>
          </div>
          {viewers.length > 0 && (
            <div data-testid="day-viewers" className="flex -space-x-2" aria-label={`Viewing: ${viewers.map((v) => v.name).join(', ')}`}>
              {viewers.map((v) => (
                <PersonAvatar key={v.userId} userId={v.userId} name={v.name} imageUrl={v.imageUrl} size="sm" title={`${v.name} is looking at this day`} />
              ))}
            </div>
          )}
        </div>
        <DayWeather day={day} today={today} hasLocation={hasLocation} weather={weather} load={forecastLoad} onRetry={onRetryForecast} />
      </header>

      <ol className="flex flex-1 flex-col gap-2">
        {stops.length === 0 && !adding && (
          <li className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            Nothing planned yet
          </li>
        )}
        {stops.map((stop, i) => (
          <StopCard
            key={stop.recordId}
            stop={stop}
            days={days}
            canWrite={canWrite}
            isFirst={i === 0}
            isLast={i === stops.length - 1}
            nameFor={nameFor}
            onMove={(direction) => onMove(day, i, direction)}
            onSave={(patch) => onSave(stop, patch)}
            onDelete={() => onDelete(stop.recordId)}
          />
        ))}
        {adding && (
          <li>
            <StopEditor
              stop={{ day }}
              busy={saving}
              submitLabel="Add stop"
              onCancel={() => setAdding(false)}
              onSubmit={addStop}
            />
          </li>
        )}
      </ol>

      {!adding && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 justify-start text-muted-foreground"
          disabled={!canWrite}
          onClick={() => setAdding(true)}
          data-testid="add-stop-button"
        >
          <Plus aria-hidden /> Add stop
        </Button>
      )}
    </section>
  )
}

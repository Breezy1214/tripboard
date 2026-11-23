import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { addDays } from '../../lib/trip-dates'
import { describeWeather } from '../../lib/weather'
import type { TripForecast } from '../../types'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface Props {
  days: string[]
  today: string
  stopCounts: Map<string, number>
  forecast: TripForecast | null | undefined
  onPick: (day: string) => void
}

function monthName(month: string) {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function monthKey(iso: string) {
  return iso.slice(0, 7)
}

/** The weeks (Monday first) covering one month, as ISO dates or null padding. */
function monthGrid(month: string): (string | null)[] {
  const first = `${month}-01`
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let day = first; monthKey(day) === month; day = addDays(day, 1)) cells.push(day)
  while (cells.length % 7) cells.push(null)
  return cells
}

export function CalendarView({ days, today, stopCounts, forecast, onPick }: Props) {
  const months = useMemo(() => [...new Set(days.map(monthKey))], [days])
  const tripDays = useMemo(() => new Map(days.map((d, i) => [d, i + 1])), [days])

  return (
    <div className="space-y-6">
      {months.map((month) => (
        <section key={month}>
          <h3 className="mb-2 text-[13px] font-semibold text-foreground">{monthName(month)}</h3>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((w) => (
              <span key={w} className="pb-1 text-[11px] text-muted-foreground">
                {w}
              </span>
            ))}
            {monthGrid(month).map((day, i) => {
              if (!day) return <span key={`pad-${i}`} />
              const dayNumber = tripDays.get(day)
              const count = stopCounts.get(day) ?? 0
              const weather = forecast?.days?.[day]
              const date = Number(day.slice(8))
              if (!dayNumber) {
                return (
                  <span key={day} className="flex aspect-square items-start justify-center pt-1.5 text-xs text-muted-foreground/50">
                    {date}
                  </span>
                )
              }
              const { Icon, label } = weather ? describeWeather(weather.code) : { Icon: null, label: '' }
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onPick(day)}
                  aria-label={`Day ${dayNumber}: ${count} ${count === 1 ? 'stop' : 'stops'}${label ? `, ${label}` : ''}`}
                  className={cn(
                    'flex aspect-square flex-col items-center justify-between rounded-xl border bg-accent/60 px-0.5 py-1.5 text-xs transition-colors hover:border-primary/50 hover:bg-accent',
                    day === today ? 'border-primary' : 'border-transparent',
                  )}
                >
                  <span className="font-semibold text-foreground">{date}</span>
                  {Icon && <Icon aria-hidden className="size-3.5 text-primary" />}
                  <span className="flex gap-0.5">
                    {Array.from({ length: Math.min(count, 4) }, (_, n) => (
                      <span key={n} className="size-1 rounded-full bg-primary" />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
      <p className="text-xs text-muted-foreground">Dots show the stops planned each day. Pick a day to open it in the itinerary.</p>
    </div>
  )
}

import { CloudOff, Hourglass } from 'lucide-react'
import { FORECAST_WINDOW_DAYS, forecastStatus } from '../../lib/trip-dates'
import { describeWeather } from '../../lib/weather'
import type { DayWeather as DayWeatherData } from '../../types'

export type ForecastLoad = 'idle' | 'loading' | 'error'

interface Props {
  day: string
  today: string
  hasLocation: boolean
  weather: DayWeatherData | undefined
  load: ForecastLoad
  onRetry: () => void
}

export function DayWeather({ day, today, hasLocation, weather, load, onRetry }: Props) {
  const status = forecastStatus(day, today)
  const base = 'flex min-h-6 items-center gap-1.5 text-xs text-muted-foreground'

  if (status.kind === 'past') return <div className={base} />
  if (status.kind === 'too_far') {
    return (
      <div data-testid="day-weather" className={base} title={`Opens in ${status.opensInDays} days`}>
        <Hourglass aria-hidden className="size-3.5" />
        Forecast opens {FORECAST_WINDOW_DAYS} days before
      </div>
    )
  }
  if (!hasLocation) {
    return (
      <div data-testid="day-weather" className={base}>
        <CloudOff aria-hidden className="size-3.5" /> No location for weather
      </div>
    )
  }
  if (!weather) {
    return (
      <div data-testid="day-weather" className={base}>
        {load === 'loading' ? (
          <span className="h-3 w-24 animate-pulse rounded bg-muted" aria-label="Loading weather" />
        ) : (
          <>
            <CloudOff aria-hidden className="size-3.5" /> Weather unavailable
            {load === 'error' && (
              <button type="button" onClick={onRetry} className="font-medium text-primary hover:underline">
                Retry
              </button>
            )}
          </>
        )}
      </div>
    )
  }
  const { label, Icon } = describeWeather(weather.code)
  return (
    <div data-testid="day-weather" className={`${base} text-foreground`} title={label}>
      <Icon aria-hidden className="size-4 text-primary" />
      <span className="sr-only">{label}, high </span>
      <span className="font-medium">{weather.max}°</span>
      <span className="text-muted-foreground">
        <span aria-hidden>/ </span>
        <span className="sr-only">low </span>
        {weather.min}°C
      </span>
      {weather.precip !== null && <span className="text-muted-foreground">· {weather.precip}% rain</span>}
    </div>
  )
}

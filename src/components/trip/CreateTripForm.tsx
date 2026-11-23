import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Input, Label } from '@/components/ui'
import { callAction } from '../../lib/actions'
import { MAX_TRIP_DAYS, addDays, todayIso, validateTripDates } from '../../lib/trip-dates'

interface Props {
  onCancel?: () => void
}

export function CreateTripForm({ onCancel }: Props) {
  const navigate = useNavigate()
  const defaultStart = addDays(todayIso(), 7)
  const [name, setName] = useState('')
  const [destination, setDestination] = useState('')
  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(addDays(defaultStart, 2))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const dateError = validateTripDates(startDate, endDate)
    if (!name.trim() || !destination.trim()) return setError('Add a name and a destination')
    if (dateError) return setError(dateError)
    setSaving(true)
    setError(null)
    try {
      const { tripId } = await callAction<{ tripId: string }>('createTrip', {
        name,
        destination,
        startDate,
        endDate,
      })
      navigate(`/trips/${tripId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the trip')
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      data-testid="create-trip-form"
      className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-[0_16px_40px_-24px_rgba(14,26,21,0.35)] sm:grid-cols-2 sm:p-6"
    >
      <div className="sm:col-span-2">
        <h2 className="text-base font-semibold tracking-tight text-foreground">Plan a new trip</h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">Up to {MAX_TRIP_DAYS} days. Invite people once it exists.</p>
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="trip-name">Trip name</Label>
        <Input
          id="trip-name"
          value={name}
          maxLength={80}
          placeholder="Spring in Lisbon"
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="trip-destination">Destination</Label>
        <Input
          id="trip-destination"
          value={destination}
          maxLength={120}
          placeholder="City, country"
          onChange={(e) => setDestination(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="trip-start">Start date</Label>
        <Input
          id="trip-start"
          type="date"
          value={startDate}
          onChange={(e) => {
            setStartDate(e.target.value)
            if (e.target.value > endDate) setEndDate(e.target.value)
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="trip-end">End date</Label>
        <Input
          id="trip-end"
          type="date"
          value={endDate}
          min={startDate}
          max={startDate ? addDays(startDate, MAX_TRIP_DAYS - 1) : undefined}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 sm:col-span-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={saving}>
          Create trip
        </Button>
      </div>
    </form>
  )
}

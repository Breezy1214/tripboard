import { useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Clock, MapPin, Pencil, Sparkles, Star, Trash2 } from 'lucide-react'
import { Button, ConfirmModal, Input, Label, Textarea, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { formatDay } from '../../lib/trip-dates'
import { stopIcon } from './stop-icon'
import type { Stop } from '../../types'

interface Props {
  stop: { recordId: string; data: Stop }
  days: string[]
  canWrite: boolean
  isFirst: boolean
  isLast: boolean
  mapLabel?: string
  selected?: boolean
  nameFor: (userId: string) => string | undefined
  onSelect?: () => void
  onMove: (direction: -1 | 1) => Promise<void>
  onSave: (patch: Partial<Stop>) => Promise<void>
  onDelete: () => Promise<void>
}

export function StopCard({ stop, days, canWrite, isFirst, isLast, mapLabel, selected, nameFor, onSelect, onMove, onSave, onDelete }: Props) {
  const { error } = useToast()
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const { title, time, notes, source, addedBy, address, rating, placeName } = stop.data
  const Icon = stopIcon(`${title} ${placeName ?? ''}`)
  const hasDetails = !!(notes || address || typeof rating === 'number')

  async function run(task: () => Promise<void>, failure: string) {
    setBusy(true)
    try {
      await task()
      return true
    } catch (err) {
      error(failure, err instanceof Error ? err.message : undefined)
      return false
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <StopEditor
        stop={stop.data}
        days={days}
        busy={busy}
        onCancel={() => setEditing(false)}
        onSubmit={async (patch) => {
          if (await run(() => onSave(patch), 'Could not save the stop')) setEditing(false)
        }}
      />
    )
  }

  return (
    <div
      data-testid="stop-card"
      data-stop-id={stop.recordId}
      className={cn(
        'group relative rounded-2xl border bg-card p-2.5 transition-colors',
        selected ? 'border-primary/60 ring-2 ring-primary/15' : 'border-border hover:border-foreground/15',
      )}
    >
      <div className="flex items-start gap-3">
        <Thumb label={mapLabel} title={title} onSelect={onSelect}>
          <Icon aria-hidden className="size-5" />
        </Thumb>
        <div className="min-w-0 flex-1 pb-1 pt-0.5">
          <p data-testid="stop-title" className="break-words text-[14px] font-medium leading-snug text-foreground">
            {title}
          </p>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock aria-hidden className="size-3" /> {time || 'Any time'}
          </p>
          {source === 'ai' && (
            <p data-testid="stop-ai-badge" className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
              <Sparkles aria-hidden className="size-3" /> Added by AI for {(addedBy && nameFor(addedBy)) || 'a trip member'}
            </p>
          )}
        </div>
        {hasDetails && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
          >
            Details
          </button>
        )}
      </div>
      {open && hasDetails && (
        <div className="mt-2.5 space-y-1 border-t border-border pb-8 pt-2.5 text-xs text-muted-foreground">
          {notes && <p className="whitespace-pre-line break-words text-foreground/80">{notes}</p>}
          {address && (
            <p className="flex items-center gap-1">
              <MapPin aria-hidden className="size-3 shrink-0" /> {address}
            </p>
          )}
          {typeof rating === 'number' && (
            <p className="flex items-center gap-1">
              <Star aria-hidden className="size-3 shrink-0" /> {rating.toFixed(1)}
            </p>
          )}
        </div>
      )}
      <div className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded-lg bg-card transition-opacity lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <IconButton label={`Move ${title} up`} disabled={!canWrite || busy || isFirst} onClick={() => run(() => onMove(-1), 'Could not move the stop')}>
          <ArrowUp aria-hidden />
        </IconButton>
        <IconButton label={`Move ${title} down`} disabled={!canWrite || busy || isLast} onClick={() => run(() => onMove(1), 'Could not move the stop')}>
          <ArrowDown aria-hidden />
        </IconButton>
        <IconButton label={`Edit ${title}`} disabled={!canWrite || busy} onClick={() => setEditing(true)}>
          <Pencil aria-hidden />
        </IconButton>
        <IconButton label={`Delete ${title}`} disabled={!canWrite || busy} onClick={() => setConfirmDelete(true)}>
          <Trash2 aria-hidden />
        </IconButton>
      </div>
      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this stop?"
        description={`"${title}" will be removed for everyone on the trip.`}
        confirmText="Delete"
        loading={busy}
        onConfirm={async () => {
          if (await run(onDelete, 'Could not delete the stop')) setConfirmDelete(false)
        }}
      />
    </div>
  )
}

function Thumb({ label, title, onSelect, children }: { label?: string; title: string; onSelect?: () => void; children: ReactNode }) {
  const className = 'relative flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent text-primary'
  const badge = label && (
    <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border-2 border-card bg-primary text-[10px] font-semibold text-primary-foreground">
      {label}
    </span>
  )
  if (!onSelect) {
    return (
      <span className={className}>
        {children}
        {badge}
      </span>
    )
  }
  return (
    <button type="button" onClick={onSelect} aria-label={`Show ${title} on the map`} className={cn(className, 'transition hover:bg-primary/15')}>
      {children}
      {badge}
    </button>
  )
}

function IconButton({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-4"
      {...props}
    >
      {children}
    </button>
  )
}

export function StopEditor({
  stop,
  days,
  busy,
  submitLabel = 'Save',
  onCancel,
  onSubmit,
}: {
  stop: Partial<Stop>
  days?: string[]
  busy: boolean
  submitLabel?: string
  onCancel: () => void
  onSubmit: (patch: Pick<Stop, 'title' | 'time' | 'notes'> & { day?: string }) => void | Promise<void>
}) {
  const [title, setTitle] = useState(stop.title ?? '')
  const [time, setTime] = useState(stop.time ?? '')
  const [notes, setNotes] = useState(stop.notes ?? '')
  const [day, setDay] = useState(stop.day ?? '')
  const [error, setError] = useState<string | null>(null)
  const idBase = `stop-${stop.day ?? 'new'}`

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setError('Add a title')
    setError(null)
    void onSubmit({ title: title.trim(), time, notes: notes.trim(), ...(days ? { day } : {}) })
  }

  return (
    <form onSubmit={submit} data-testid="stop-editor" className="space-y-2.5 rounded-2xl border border-primary/40 bg-card p-3 shadow-[0_8px_24px_-12px_rgba(14,26,21,0.25)]">
      <div className="grid gap-1">
        <Label htmlFor={`${idBase}-title`} className="text-xs">Title</Label>
        <Input
          id={`${idBase}-title`}
          value={title}
          maxLength={120}
          placeholder="Museum, dinner, train..."
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label htmlFor={`${idBase}-time`} className="text-xs">Time</Label>
          <Input id={`${idBase}-time`} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        {days && (
          <div className="grid gap-1">
            <Label htmlFor={`${idBase}-day`} className="text-xs">Day</Label>
            <select
              id={`${idBase}-day`}
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="h-10 rounded-lg border border-input bg-card px-2 text-sm"
            >
              {days.map((d) => {
                const { weekday, label } = formatDay(d)
                return (
                  <option key={d} value={d}>
                    {weekday} {label}
                  </option>
                )
              })}
            </select>
          </div>
        )}
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${idBase}-notes`} className="text-xs">Notes</Label>
        <Textarea
          id={`${idBase}-notes`}
          value={notes}
          maxLength={1000}
          rows={2}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" type="submit" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

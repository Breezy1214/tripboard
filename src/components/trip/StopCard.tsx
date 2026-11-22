import { useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react'
import { useUserLookup } from 'deepspace'
import { ArrowDown, ArrowUp, Clock, MapPin, Pencil, Sparkles, Star, Trash2 } from 'lucide-react'
import { Button, ConfirmModal, Input, Label, Textarea, useToast } from '@/components/ui'
import { formatDay } from '../../lib/trip-dates'
import type { Stop } from '../../types'

interface Props {
  stop: { recordId: string; data: Stop }
  days: string[]
  canWrite: boolean
  isFirst: boolean
  isLast: boolean
  onMove: (direction: -1 | 1) => Promise<void>
  onSave: (patch: Partial<Stop>) => Promise<void>
  onDelete: () => Promise<void>
}

export function StopCard({ stop, days, canWrite, isFirst, isLast, onMove, onSave, onDelete }: Props) {
  const { error } = useToast()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const { getName } = useUserLookup()
  const { title, time, notes, source, addedBy, address, rating } = stop.data

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
    <li
      data-testid="stop-card"
      className="group rounded-lg border border-border bg-background p-3 shadow-card"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {time && (
            <p className="mb-0.5 flex items-center gap-1 text-xs font-medium text-primary">
              <Clock aria-hidden className="size-3" /> {time}
            </p>
          )}
          <p data-testid="stop-title" className="break-words text-sm font-medium text-foreground">
            {title}
          </p>
          {notes && <p className="mt-1 whitespace-pre-line break-words text-xs text-muted-foreground">{notes}</p>}
          {(address || typeof rating === 'number') && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {address && (
                <span className="inline-flex items-center gap-1">
                  <MapPin aria-hidden className="size-3" /> {address}
                </span>
              )}
              {typeof rating === 'number' && (
                <span className="inline-flex items-center gap-1">
                  <Star aria-hidden className="size-3" /> {rating.toFixed(1)}
                </span>
              )}
            </p>
          )}
          {source === 'ai' && (
            <p data-testid="stop-ai-badge" className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              <Sparkles aria-hidden className="size-3" /> Added by AI for {(addedBy && getName(addedBy)) || 'a trip member'}
            </p>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-0.5">
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
    </li>
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
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-4"
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
    <form onSubmit={submit} data-testid="stop-editor" className="space-y-2 rounded-lg border border-primary/40 bg-background p-3">
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
              className="h-10 rounded-md border border-input bg-transparent px-2 text-sm"
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

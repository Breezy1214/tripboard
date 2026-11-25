import { cn } from '@/lib/utils'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { CalendarDays, Check, ChevronDown, MapPin, MoreHorizontal, Plus, Trash2, Users } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui'
import { formatRange } from '../../lib/trip-dates'
import type { Trip } from '../../types'
import { InviteButton } from './InviteButton'
import { PersonAvatar } from './PersonAvatar'

export interface Person {
  userId: string
  name: string
  imageUrl?: string
  online: boolean
  title: string
}

interface Props {
  tripId: string
  trip: Trip
  you: { userId: string; name: string; imageUrl?: string } | null
  others: Person[]
  presenceSummary: string
  memberCount: number
  canDelete: boolean
  onDelete: () => void
}

export function TripTopBar({ tripId, trip, you, others, presenceSummary, memberCount, canDelete, onDelete }: Props) {
  const navigate = useNavigate()
  const trips = useQuery<Trip>('trips', { orderBy: 'startDate', orderDir: 'asc' })

  return (
    <header className="shrink-0 border-b border-border bg-card">
      <div className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 lg:flex-nowrap lg:px-5">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                aria-label="Switch trip"
                className="flex min-w-0 max-w-[48vw] items-center gap-1.5 rounded-lg px-1.5 py-1 text-[15px] font-semibold tracking-tight text-foreground hover:bg-secondary sm:max-w-80 lg:max-w-64"
              >
                <span className="truncate">{trip.name}</span>
                <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </button>
            }
          />
          <DropdownMenuContent align="start" className="w-64">
            {trips.records.map((t) => (
              <DropdownMenuItem key={t.recordId} onClick={() => navigate(`/trips/${t.recordId}`)}>
                <span className="flex-1 truncate">{t.data.name}</span>
                {t.recordId === tripId && <Check aria-hidden className="size-4 text-primary" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/home')}>All trips</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ul
          aria-label="Trip details"
          className="order-last flex w-full items-stretch overflow-x-auto rounded-xl border border-border bg-background text-[13px] text-foreground lg:order-none lg:w-auto"
        >
          <li className="flex shrink-0 items-center gap-1.5 px-3 py-1.5">
            <MapPin aria-hidden className="size-3.5 text-muted-foreground" />
            {trip.placeLabel || trip.destination}
          </li>
          <li className="flex shrink-0 items-center gap-1.5 border-l border-border px-3 py-1.5">
            <CalendarDays aria-hidden className="size-3.5 text-muted-foreground" />
            {formatRange(trip.startDate, trip.endDate)}
          </li>
          <li className="flex shrink-0 items-center gap-1.5 border-l border-border px-3 py-1.5">
            <Users aria-hidden className="size-3.5 text-muted-foreground" />
            {memberCount} {memberCount === 1 ? 'traveler' : 'travelers'}
          </li>
        </ul>

        <div className="ml-auto flex items-center gap-2">
          {/* On phones the stack shows only once someone else is on the trip. */}
          <div className={cn('items-center gap-2', others.length > 0 ? 'flex' : 'hidden sm:flex')}>
            <div data-testid="trip-members" className="flex items-center -space-x-2">
              {you && <PersonAvatar userId={you.userId} name={you.name} imageUrl={you.imageUrl} title="You" />}
              {others.map((p) => (
                <PersonAvatar key={p.userId} userId={p.userId} name={p.name} imageUrl={p.imageUrl} dimmed={!p.online} title={p.title} />
              ))}
            </div>
            <span data-testid="presence-summary" className="hidden max-w-44 truncate text-xs text-muted-foreground 2xl:inline">
              {presenceSummary}
            </span>
          </div>
          <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
          <InviteButton tripId={tripId} />
          <Link
            to="/home?new=1"
            className="hidden h-9 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 md:inline-flex lg:hidden 2xl:inline-flex"
          >
            <Plus aria-hidden className="size-4" /> New trip
          </Link>
          {canDelete && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    aria-label="Trip options"
                    className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <MoreHorizontal aria-hidden className="size-4" />
                  </button>
                }
              />
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 aria-hidden /> Delete trip
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  )
}

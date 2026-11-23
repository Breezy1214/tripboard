import { useQuery } from 'deepspace'
import { ChevronsLeft, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ChatPanel } from '../ChatPanel'

interface Props {
  tripId: string
  userId: string
  open: boolean
  onClose: () => void
  className?: string
}

const PROMPTS = ['What is the weather on day 1?', 'Find a good breakfast spot near the center', 'Add a sunset viewpoint on the last day']

/**
 * The co-planner: one chat per user per trip. A floating panel over the map
 * on large screens and a bottom sheet on phones. It stays mounted while
 * closed so a reply in flight is not cut off.
 */
export function TripChat({ tripId, userId, open, onClose, className }: Props) {
  const chats = useQuery<{ userId: string; tripId: string }>('ai-chats', { where: { userId, tripId } })
  const chatId = chats.records[0]?.recordId ?? null

  return (
    <>
      <div aria-hidden onClick={onClose} className={cn('fixed inset-0 z-30 bg-foreground/25 lg:hidden', !open && 'hidden')} />
      <aside
        data-testid="trip-chat"
        aria-label="AI co-planner"
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 flex h-[85dvh] flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-2xl',
          className,
          !open && 'hidden',
        )}
      >
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span aria-hidden className="flex size-9 items-center justify-center rounded-xl bg-accent text-primary">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Co-planner</h2>
            <p className="truncate text-xs text-muted-foreground">Knows this trip. Its edits show for everyone.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close co-planner"
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X aria-hidden className="size-4 lg:hidden" />
            <ChevronsLeft aria-hidden className="hidden size-4 lg:block" />
          </button>
        </header>
        {chats.status === 'error' ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            Could not load the chat: {chats.error ?? 'connection failed'}. Reload to try again.
          </p>
        ) : (
          <ChatPanel
            chatId={chatId}
            userId={userId}
            tripId={tripId}
            compact
            disabled={chats.status === 'loading'}
            emptyStatePrompts={PROMPTS}
            className="min-h-0 flex-1"
          />
        )}
      </aside>
    </>
  )
}

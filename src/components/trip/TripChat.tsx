import { useQuery } from 'deepspace'
import { Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ChatPanel } from '../ChatPanel'

interface Props {
  tripId: string
  userId: string
  open: boolean
  onClose: () => void
}

const PROMPTS = ['What is the weather on day 1?', 'Find a good breakfast spot near the center', 'Add a sunset viewpoint on the last day']

/**
 * The co-planner: one chat per user per trip. A side panel on large screens
 * and a bottom drawer on phones. It stays mounted while closed so a reply in
 * flight is not cut off.
 */
export function TripChat({ tripId, userId, open, onClose }: Props) {
  const chats = useQuery<{ userId: string; tripId: string }>('ai-chats', { where: { userId, tripId } })
  const chatId = chats.records[0]?.recordId ?? null

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={cn('fixed inset-0 z-30 bg-black/30 lg:hidden', !open && 'hidden')}
      />
      <aside
        data-testid="trip-chat"
        aria-label="AI co-planner"
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 flex h-[85dvh] flex-col overflow-hidden rounded-t-2xl border-t border-border bg-background shadow-2xl',
          'lg:sticky lg:top-0 lg:z-auto lg:h-[calc(100dvh-3rem)] lg:w-[380px] lg:shrink-0 lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-none',
          !open && 'hidden',
        )}
      >
        <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Sparkles aria-hidden className="size-4 text-primary" /> Co-planner
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Knows this trip. What it adds shows up for everyone.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close co-planner"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X aria-hidden className="size-4" />
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

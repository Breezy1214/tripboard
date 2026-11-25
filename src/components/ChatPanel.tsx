/**
 * DO-backed AI chat surface.
 *
 * Pass `chatId={null}` to create a chat on first send. The panel keeps the
 * created id itself; `onChatCreated` merely notifies, and a parent-passed
 * `chatId` — including a change back to null for "new chat" — always wins.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { AlertCircle, ArrowUp, Square } from 'lucide-react'
import { useQuery } from 'deepspace'
import { ChatLoading, EmptyState, MessageTurn, ThinkingIndicator } from './ChatPanel.messages'
import { useStreamingChat } from './ChatPanel.stream'
import { CHAT_MESSAGE_MAX_LENGTH } from '../ai/errors'

type AiMessageData = {
  chatId: string
  userId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  parts?: unknown[]
}

type RenderMessage = {
  id: string
  role: AiMessageData['role']
  content: string
  parts?: unknown[]
}

export type ChatPanelProps = {
  /** Active chat. `null` creates one on first send and the panel keeps it — a never-passed `chatId` means one chat per mount; remount with `key` for a new one. */
  chatId: string | null
  /** Current user id; scopes the messages query as defense in depth. */
  userId: string
  /** The trip this chat belongs to. */
  tripId: string
  /** Notified with the id when the panel creates a chat on first send. */
  onChatCreated?: (chatId: string) => void
  /** Clickable prompts shown when the conversation is empty. */
  emptyStatePrompts?: string[]
  /** Applied to the outer container. */
  className?: string
  /** Optional content rendered above the messages. */
  header?: ReactNode
  /** Tighter spacing for narrow containers. */
  compact?: boolean
  /** Suspends send while a parent-owned create is in flight. */
  disabled?: boolean
  /** The parent is still finding the chat; show loading instead of the empty state. */
  loading?: boolean
}

const DEFAULT_PROMPTS = [
  'What is the weather on day 2?',
  'Find a good breakfast spot',
  'Add a sunset viewpoint on the last day',
]

export function ChatPanel({
  chatId,
  userId,
  tripId,
  onChatCreated,
  emptyStatePrompts = DEFAULT_PROMPTS,
  className,
  header,
  compact = false,
  disabled = false,
  loading = false,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickToBottomRef = useRef(true)
  const [input, setInput] = useState('')

  // Uncontrolled fallback: with `chatId={null}` the panel keeps the chat it
  // auto-creates on first send, so the overlay, the messages query, and later
  // sends all target that chat. Any prop change — including back to null,
  // which means "new chat" — takes precedence and clears it.
  const [ownChatId, setOwnChatId] = useState<string | null>(null)
  const [seenChatId, setSeenChatId] = useState(chatId)
  if (seenChatId !== chatId) {
    setSeenChatId(chatId)
    setOwnChatId(null)
  }
  const activeChatId = chatId ?? ownChatId

  const handleChatCreated = useCallback(
    (id: string) => {
      setOwnChatId(id)
      onChatCreated?.(id)
    },
    [onChatCreated],
  )

  const { send, stop, retry, isLoading, error, inFlight } = useStreamingChat({
    chatId: activeChatId,
    tripId,
    onChatCreated: handleChatCreated,
  })

  const queryWhere = useMemo(
    () => ({ chatId: activeChatId ?? '__none__', userId }),
    [activeChatId, userId],
  )
  const { records, status: messagesStatus } = useQuery<AiMessageData>('ai-messages', {
    where: queryWhere,
    orderBy: 'createdAt',
    orderDir: 'asc',
  })
  const persisted = useMemo<RenderMessage[]>(
    () => records.map((record) => ({
      id: record.recordId,
      role: record.data.role,
      content: record.data.content ?? '',
      parts: record.data.parts,
    })),
    [records],
  )
  const persistedIds = useMemo(
    () => new Set(persisted.map((message) => message.id)),
    [persisted],
  )
  const messages = useMemo<RenderMessage[]>(() => {
    const overlay = inFlight.filter((message) => {
      if (message.forChatId !== activeChatId) return false
      if (persistedIds.has(message.id)) return false
      return !message.serverId || !persistedIds.has(message.serverId)
    })
    return [...persisted, ...overlay]
  }, [activeChatId, inFlight, persisted, persistedIds])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const trackPosition = () => {
      const bottomGap = element.scrollHeight - element.scrollTop - element.clientHeight
      stickToBottomRef.current = bottomGap < 80
    }
    element.addEventListener('scroll', trackPosition, { passive: true })
    return () => element.removeEventListener('scroll', trackPosition)
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (!element || !stickToBottomRef.current) return
    element.scrollTo({
      top: element.scrollHeight,
      behavior: isLoading ? 'auto' : 'smooth',
    })
  }, [isLoading, messages])

  useEffect(() => {
    const element = inputRef.current
    if (!element) return
    if (!input) {
      element.style.height = ''
      return
    }
    const frame = requestAnimationFrame(() => {
      element.style.height = 'auto'
      element.style.height = `${Math.min(element.scrollHeight, 200)}px`
    })
    return () => cancelAnimationFrame(frame)
  }, [input])

  const canSend = input.trim().length > 0 && !isLoading && !disabled

  function submit() {
    if (!canSend) return
    const content = input.trim()
    setInput('')
    void send(content)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter commits an active IME composition; it must not also send it.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  function selectPrompt(prompt: string) {
    setInput(prompt)
    inputRef.current?.focus()
  }

  const lastMessage = messages[messages.length - 1]
  const streamingAssistantId =
    isLoading && lastMessage?.role === 'assistant' ? lastMessage.id : null
  const waitingForAssistant = isLoading && lastMessage?.role === 'user'
  const horizontalPadding = compact ? 'px-4' : 'px-6'
  const textSize = compact ? 'text-[13px]' : 'text-[14px]'
  const turnGap = compact ? 'gap-6' : 'gap-8'

  return (
    <div
      className={`relative flex h-full min-h-0 flex-col bg-card text-foreground ${textSize} ${className ?? ''}`}
    >
      {header && <div className="shrink-0">{header}</div>}

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-atomic="false"
        aria-label="Assistant conversation"
        className={`min-h-0 flex-1 overflow-y-auto ${horizontalPadding} py-5`}
      >
        {messages.length === 0 && (loading || (activeChatId && messagesStatus === 'loading')) ? (
          <ChatLoading />
        ) : messages.length === 0 ? (
          <EmptyState prompts={emptyStatePrompts} onPick={selectPrompt} />
        ) : (
          <div className={`mx-auto flex max-w-[44rem] flex-col ${turnGap}`}>
            {messages.map((message) => (
              <MessageTurn
                key={message.id}
                role={message.role}
                content={message.content}
                parts={message.parts}
                isStreaming={message.id === streamingAssistantId}
              />
            ))}
            {waitingForAssistant && <ThinkingIndicator />}
          </div>
        )}
      </div>

      {error && (
        <div className={`mx-auto mb-2 w-full max-w-[44rem] ${horizontalPadding}`} role="alert" data-testid="chat-error">
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="flex-1 text-[13px] leading-relaxed">{error.message}</div>
            {error.name !== 'NotRetryable' && (
              <button
                type="button"
                onClick={retry}
                className="rounded-md border border-destructive/30 px-2 py-0.5 text-[12px] font-medium transition-colors hover:bg-destructive/10"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      )}

      <div className={`shrink-0 ${horizontalPadding} pb-3 pt-2`}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="mx-auto w-full max-w-[44rem]"
        >
          <div className="relative rounded-2xl border border-border bg-background shadow-[0_1px_2px_rgba(14,26,21,0.04)] transition-colors focus-within:border-foreground/25 focus-within:ring-4 focus-within:ring-foreground/[0.04]">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              maxLength={CHAT_MESSAGE_MAX_LENGTH}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              placeholder={disabled ? 'Connecting…' : 'Ask about places, weather or plans…'}
              aria-label="Message the co-planner"
              className="block w-full resize-none bg-transparent px-4 pt-3 pb-12 leading-[1.5] text-foreground placeholder:text-muted-foreground/60 outline-none disabled:cursor-not-allowed"
            />

            <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-center justify-between">
              <span className="px-2 text-[11px] text-muted-foreground/70">
                {input.length > CHAT_MESSAGE_MAX_LENGTH - 200 ? `${input.length}/${CHAT_MESSAGE_MAX_LENGTH}` : ''}
              </span>

              {isLoading ? (
                <button
                  type="button"
                  onClick={stop}
                  aria-label="Stop generating"
                  className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90"
                >
                  <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!canSend}
                  aria-label="Send message"
                  className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background transition-all hover:opacity-90 disabled:bg-muted disabled:text-muted-foreground/60 disabled:cursor-not-allowed"
                >
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </form>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          The co-planner can get things wrong. Check before you go.
        </p>
      </div>
    </div>
  )
}

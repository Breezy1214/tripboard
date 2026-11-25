import { useState } from 'react'
import { Check, Copy, UserPlus } from 'lucide-react'
import { Button, Input, Modal } from '@/components/ui'
import { callAction } from '../../lib/actions'

export function InviteButton({ tripId }: { tripId: string }) {
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  async function openInvite() {
    setOpen(true)
    if (link) return
    setLoading(true)
    setError(null)
    try {
      const { code } = await callAction<{ code: string }>('createInvite', { tripId })
      setLink(`${window.location.origin}/join/${code}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create an invite link')
    } finally {
      setLoading(false)
    }
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Copy failed. Select the link and copy it by hand.')
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openInvite} data-testid="invite-button">
        <UserPlus aria-hidden /> Invite
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} size="sm">
        <Modal.Header>
          <Modal.Title>Invite people to this trip</Modal.Title>
          <Modal.Description>Anyone with this link can join after signing in. Members edit the same board; each keeps a private co-planner chat.</Modal.Description>
        </Modal.Header>
        <Modal.Body>
          {loading ? (
            <div className="h-10 animate-pulse rounded-md bg-muted" aria-label="Creating link" />
          ) : link ? (
            <div className="flex gap-2">
              <Input data-testid="invite-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              <Button variant="secondary" onClick={copy} aria-label="Copy invite link" className="shrink-0">
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          ) : null}
          {error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </Modal.Body>
        <Modal.Footer>
          {error && !link && (
            <Button variant="secondary" onClick={openInvite}>
              Try again
            </Button>
          )}
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Done
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}

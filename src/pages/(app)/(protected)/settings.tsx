import { signOut, useUser } from 'deepspace'
import { LogOut } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage, Button } from '@/components/ui'

export default function SettingsPage() {
  const { user } = useUser()

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
      <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-foreground">Account</h1>
      <p className="mt-1 text-sm text-muted-foreground">You sign in with Google or GitHub; your name and photo come from there.</p>

      <section className="mt-8 max-w-xl rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-4">
          <Avatar className="size-14 ring-1 ring-inset ring-border">
            <AvatarImage src={user?.imageUrl ?? undefined} referrerPolicy="no-referrer" />
            <AvatarFallback>{(user?.name?.[0] ?? user?.email?.[0] ?? '?').toUpperCase()}</AvatarFallback>
          </Avatar>
          <dl className="min-w-0 text-sm">
            <dt className="sr-only">Name</dt>
            <dd className="truncate text-base font-semibold text-foreground">{user?.name || 'No name set'}</dd>
            <dt className="sr-only">Email</dt>
            <dd className="truncate text-muted-foreground">{user?.email ?? 'No email'}</dd>
          </dl>
        </div>
        <Button variant="outline" className="mt-6" onClick={() => signOut()}>
          <LogOut aria-hidden /> Sign out
        </Button>
      </section>
    </div>
  )
}

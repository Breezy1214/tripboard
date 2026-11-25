// Tests rely on the data-testid hooks: app-navigation, nav-sign-in-button, nav-user-name, nav-user-email.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthOverlay, signOut, useAuthProfileReady, useQuery } from 'deepspace'
import { ChevronsUpDown, LogOut, Map, Menu, PanelLeft, Plus, Search, Settings, X } from 'lucide-react'
import { PRODUCT_NAME } from '../constants'
import { cn } from '../lib/utils'
import type { Trip } from '../types'
import { BrandMark } from './shell/BrandMark'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui'

const COLLAPSE_KEY = 'tripboard:sidebar-collapsed'

function readCollapsed() {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

export default function Navigation() {
  const { isLoaded, isSignedIn, user, userLoading } = useAuthProfileReady({ requireUser: true })
  const location = useLocation()
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [search, setSearch] = useState('')
  const trips = useQuery<Trip>('trips', { orderBy: 'startDate', orderDir: 'asc' })

  const profileReady = !isSignedIn || (!userLoading && !!user)

  useEffect(() => setDrawerOpen(false), [location.pathname])

  function toggleCollapsed() {
    setCollapsed((prev) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, prev ? '0' : '1')
      } catch {
        /* storage is optional */
      }
      return !prev
    })
  }

  const recent = useMemo(() => {
    const query = search.trim().toLowerCase()
    const list = [...trips.records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const matches = query
      ? list.filter((t) => `${t.data.name} ${t.data.destination}`.toLowerCase().includes(query))
      : list
    return matches.slice(0, 6)
  }, [trips.records, search])

  const rail = collapsed
  const hideOnRail = rail ? 'lg:hidden' : ''

  const navItem = (to: string, label: string, icon: ReactNode, count?: number) => {
    const active = location.pathname === to || (to === '/home' && location.pathname.startsWith('/trips/'))
    return (
      <Link
        key={to}
        to={to}
        title={label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors',
          active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          rail && 'lg:justify-center lg:px-0',
        )}
      >
        {icon}
        <span className={cn('flex-1', hideOnRail)}>{label}</span>
        {count !== undefined && count > 0 && (
          <span className={cn('text-xs tabular-nums text-muted-foreground', hideOnRail)}>{count}</span>
        )}
      </Link>
    )
  }

  return (
    <nav
      data-testid="app-navigation"
      className={cn(
        'relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4',
        'lg:h-full lg:flex-col lg:items-stretch lg:gap-0 lg:border-b-0 lg:border-r lg:px-0',
        rail ? 'lg:w-[68px]' : 'lg:w-64',
      )}
    >
      <Link to="/home" className="flex items-center gap-2 lg:hidden" aria-label={`${PRODUCT_NAME} home`}>
        <BrandMark />
        <span className="text-[15px] font-semibold tracking-tight text-foreground">{PRODUCT_NAME}</span>
      </Link>
      <div className="flex-1 lg:hidden" />
      {isLoaded && !isSignedIn && (
        <button
          type="button"
          onClick={() => setShowAuthModal(true)}
          className="rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground lg:hidden"
        >
          Sign in
        </button>
      )}
      <button
        type="button"
        className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground lg:hidden"
        onClick={() => setDrawerOpen((open) => !open)}
        aria-label="Toggle menu"
        aria-expanded={drawerOpen}
      >
        {drawerOpen ? <X aria-hidden className="size-4" /> : <Menu aria-hidden className="size-4" />}
      </button>

      <div
        aria-hidden
        onClick={() => setDrawerOpen(false)}
        className={cn('fixed inset-0 top-14 bg-foreground/20 lg:hidden', !drawerOpen && 'hidden')}
      />

      <div
        className={cn(
          'fixed bottom-0 left-0 top-14 flex w-72 flex-col border-r border-border bg-card px-3 pb-3 pt-4',
          'lg:static lg:flex lg:h-full lg:w-full lg:border-r-0 lg:pt-4',
          !drawerOpen && 'hidden',
          rail && 'lg:px-2.5',
        )}
      >
        <div className={cn('mb-4 hidden items-center gap-2 px-1 lg:flex', rail && 'lg:flex-col lg:px-0')}>
          <Link to="/home" className="flex min-w-0 flex-1 items-center gap-2" aria-label={`${PRODUCT_NAME} home`}>
            <BrandMark />
            <span className={cn('text-[15px] font-semibold tracking-tight text-foreground', hideOnRail)}>{PRODUCT_NAME}</span>
          </Link>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <PanelLeft aria-hidden className="size-4" />
          </button>
        </div>

        {isSignedIn && (
          <>
            <label className={cn('relative mb-3 block', hideOnRail)}>
              <span className="sr-only">Search trips</span>
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && recent[0]) navigate(`/trips/${recent[0].recordId}`)
                }}
                placeholder="Search trips"
                className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/25"
              />
            </label>

            <Link
              to="/home?new=1"
              title="New trip"
              className={cn(
                'mb-5 flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground transition hover:bg-primary/90',
              )}
            >
              <Plus aria-hidden className="size-4" />
              <span className={hideOnRail}>New trip</span>
            </Link>

            <div className="flex flex-col gap-0.5">
              {navItem('/home', 'My trips', <Map aria-hidden className="size-4 shrink-0" />, trips.records.length)}
              {navItem('/settings', 'Account', <Settings aria-hidden className="size-4 shrink-0" />)}
            </div>

            <div className={cn('mt-6 min-h-0 flex-1 overflow-y-auto border-t border-border pt-4', hideOnRail)}>
              <p className="mb-1.5 px-2.5 text-xs font-medium text-muted-foreground">
                {search.trim() ? 'Matching trips' : 'Recent trips'}
              </p>
              {recent.length === 0 ? (
                <p className="px-2.5 text-xs text-muted-foreground/80">
                  {search.trim() ? 'No trip matches that.' : 'Trips you plan show up here.'}
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {recent.map((trip) => {
                    const active = location.pathname === `/trips/${trip.recordId}`
                    return (
                      <li key={trip.recordId}>
                        <Link
                          to={`/trips/${trip.recordId}`}
                          className={cn(
                            'block truncate rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
                            active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                          )}
                        >
                          {trip.data.name}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </>
        )}

        {!isSignedIn && <div className="flex-1" />}

        <div className="mt-3 border-t border-border pt-3">
          {!isLoaded ? null : isSignedIn && !profileReady ? (
            <div className="flex items-center gap-2.5 px-1.5 py-1.5">
              <div className="size-8 animate-pulse rounded-full bg-muted" />
              <div className={cn('h-4 flex-1 animate-pulse rounded bg-muted', hideOnRail)} />
            </div>
          ) : isSignedIn && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    aria-label="Account menu"
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl border border-border bg-background px-2 py-2 text-left transition-colors hover:bg-secondary',
                      rail && 'lg:justify-center lg:border-0 lg:bg-transparent lg:px-0',
                    )}
                  >
                    <Avatar className="size-8 ring-1 ring-inset ring-border">
                      <AvatarImage src={user.imageUrl ?? undefined} referrerPolicy="no-referrer" />
                      <AvatarFallback className="text-[11px]">
                        {(user.name?.[0] ?? user.email?.[0] ?? '?').toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className={cn('min-w-0 flex-1', hideOnRail)}>
                      <span data-testid="nav-user-name" className="block truncate text-[13px] font-medium text-foreground">
                        {user.name || user.email}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">{user.email}</span>
                    </span>
                    <ChevronsUpDown aria-hidden className={cn('size-3.5 text-muted-foreground', hideOnRail)} />
                  </button>
                }
              />
              <DropdownMenuContent align="start" side="top" className="w-56">
                <DropdownMenuLabel>
                  <div className="truncate font-medium text-foreground">{user.name || 'Signed in'}</div>
                  <div data-testid="nav-user-email" className="truncate text-xs font-normal text-muted-foreground">
                    {user.email}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut()}>
                  <LogOut aria-hidden />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className={cn('space-y-2 px-1', rail && 'lg:px-0')}>
              <p className={cn('text-xs text-muted-foreground', hideOnRail)}>Sign in to plan trips with your group.</p>
              <button
                data-testid="nav-sign-in-button"
                onClick={() => setShowAuthModal(true)}
                className="h-9 w-full rounded-lg bg-primary text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
              >
                Sign in
              </button>
            </div>
          )}
        </div>
      </div>

      {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} />}
    </nav>
  )
}

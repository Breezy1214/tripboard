import type { Role } from './constants'

export interface NavItem {
  path: string
  label: string
  roles?: Role[]
  devOnly?: boolean
}

export const nav: NavItem[] = [
  { path: '/home', label: 'Trips' },
  { path: '/settings', label: 'Account' },
  // ── Features add nav items below this line ──
]

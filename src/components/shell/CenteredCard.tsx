import type { ReactNode } from 'react'
import { BrandMark } from './BrandMark'

export function CenteredCard({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="flex min-h-full items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-8 text-center shadow-[0_24px_48px_-32px_rgba(14,26,21,0.35)]">
        <BrandMark className="mx-auto mb-5 size-11 rounded-2xl" />
        {children}
      </div>
    </div>
  )
}

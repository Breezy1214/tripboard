import { cn } from '@/lib/utils'

export function BrandMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary', className)}>
      <svg viewBox="0 0 20 20" className="size-[18px]" fill="none">
        <path d="M5 14.5c0-4 10-3 10-8.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="0.1 3.2" />
        <circle cx="5" cy="14.5" r="2.4" fill="#fff" />
        <circle cx="15" cy="5.5" r="2.4" fill="#9fd4bd" />
      </svg>
    </span>
  )
}

import { getUserColor } from 'deepspace'
import { cn } from '@/lib/utils'

interface Props {
  userId: string
  name: string
  imageUrl?: string | null
  size?: 'sm' | 'md'
  dimmed?: boolean
  title?: string
}

export function PersonAvatar({ userId, name, imageUrl, size = 'md', dimmed, title }: Props) {
  const color = getUserColor(userId)
  return (
    <span
      title={title ?? name}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-background font-semibold text-white',
        size === 'sm' ? 'size-6 text-[10px]' : 'size-8 text-xs',
        dimmed && 'opacity-40 grayscale',
      )}
      style={{ backgroundColor: color }}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
      ) : (
        (name.trim()[0] ?? '?').toUpperCase()
      )}
      <span className="sr-only">{name}</span>
    </span>
  )
}

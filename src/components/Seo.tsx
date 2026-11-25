import type { ReactElement } from 'react'

// Lives in the app, not the SDK: importing the `deepspace` root would pull its client chunk into the static landing page.
export interface SeoProps {
  title: string
  description: string
  /** `https://host`, no trailing slash. */
  origin?: string
  /** Starts with `/`. */
  path?: string
  /** 1200x630, absolute or root-relative to `origin`. */
  ogImage?: string
  type?: 'website' | 'article'
  noindex?: boolean
}

/**
 * React 19 hoists these tags into <head>; prerender.ts stamps them into the static HTML.
 * React removes the <title> on unmount, so routes without <Seo> render their own.
 */
export function Seo({
  title,
  description,
  origin,
  path,
  ogImage,
  type = 'website',
  noindex = false,
}: SeoProps): ReactElement {
  const canonical = origin && path ? `${origin}${path}` : undefined
  const image = ogImage ? (ogImage.startsWith('/') && origin ? `${origin}${ogImage}` : ogImage) : undefined
  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      {noindex ? <meta name="robots" content="noindex, nofollow" /> : null}
      {canonical ? <link rel="canonical" href={canonical} /> : null}
      <meta property="og:type" content={type} />
      {canonical ? <meta property="og:url" content={canonical} /> : null}
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      {image ? <meta property="og:image" content={image} /> : null}
      <meta name="twitter:card" content={image ? 'summary_large_image' : 'summary'} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      {image ? <meta name="twitter:image" content={image} /> : null}
    </>
  )
}

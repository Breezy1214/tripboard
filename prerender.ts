/**
 * Prerenders the public pages in src/prerender-entry.tsx after `vite build`, so crawlers
 * that skip JavaScript read real content. Writes flat `<route>.html` (a nested
 * `about/index.html` would 307 to a trailing slash), `_spa.html` for client routes, and the
 * sitemap. A Vite plugin because `deepspace deploy` runs `vite build` directly.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build as viteBuild, type Plugin, type ResolvedConfig } from 'vite'
import react from '@vitejs/plugin-react'

const appDir = fileURLToPath(new URL('.', import.meta.url))
const ENTRY = 'src/prerender-entry.tsx'
const SHELL_FILE = '_spa.html'
const ROOT_PLACEHOLDER = '<div id="root"></div>'
/** src/pages/_app.tsx's root element; React 19 puts hoisted head tags before it. */
const BODY_ANCHOR = '<div data-testid="app-root"'
/** Re-entrancy guard: the nested SSR build must not run this plugin again. */
const PASS_ENV = 'DEEPSPACE_PRERENDER_PASS'

interface Entry {
  PRERENDER_ROUTES: readonly string[]
  render(route: string): string
  seo: { origin: string; noindex: boolean }
}

/** `deepspace deploy` sets DEEPSPACE_SITE_ORIGIN; a plain `vite build` falls back to wrangler.toml's name. */
function siteOrigin(): string {
  if (process.env.DEEPSPACE_SITE_ORIGIN) return process.env.DEEPSPACE_SITE_ORIGIN
  const name = /^name\s*=\s*"([^"]+)"/m.exec(readFileSync(join(appDir, 'wrangler.toml'), 'utf8'))?.[1]
  return name ? `https://${name}.app.space` : 'http://localhost'
}

export function prerender(): Plugin {
  let config: ResolvedConfig
  let ran = false

  return {
    name: 'prerender',
    enforce: 'post',
    config() {
      return { define: { __DEEPSPACE_SITE_ORIGIN__: JSON.stringify(siteOrigin()) } }
    },
    configResolved(resolved) {
      config = resolved
    },
    async closeBundle() {
      if (config.command !== 'build' || ran || process.env[PASS_ENV]) return
      // Each environment has its own closeBundle; only the client output has the template.
      const clientDir = join(config.root, 'dist', 'client')
      const envOutDir = this.environment?.config?.build?.outDir
      if (envOutDir ? resolve(config.root, envOutDir) !== clientDir : this.environment?.name !== 'client') return
      ran = true

      const templatePath = join(clientDir, 'index.html')
      const template = readFileSync(templatePath, 'utf8')
      if (!template.includes(ROOT_PLACEHOLDER)) {
        throw new Error(`[prerender] dist/client/index.html has no '${ROOT_PLACEHOLDER}' to fill — keep the scaffold's empty root container.`)
      }

      // Isolated SSR pass with the client's defines and alias, and (via PASS_ENV) not this plugin.
      const ssrDir = join(config.root, 'dist', 'prerender')
      process.env[PASS_ENV] = '1'
      try {
        await viteBuild({
          configFile: false,
          root: config.root,
          mode: 'production',
          logLevel: 'warn',
          define: config.define,
          resolve: { alias: { '@': join(config.root, 'src') }, dedupe: ['react', 'react-dom'] },
          plugins: [react()],
          build: {
            ssr: join(config.root, ENTRY),
            outDir: ssrDir,
            emptyOutDir: true,
            rollupOptions: { output: { entryFileNames: 'entry.mjs' } },
          },
        })
      } finally {
        delete process.env[PASS_ENV]
      }
      const entry = (await import(pathToFileURL(join(ssrDir, 'entry.mjs')).href)) as Entry
      const { origin, noindex } = entry.seo

      writeFileSync(join(clientDir, SHELL_FILE), noindex ? withNoindexMeta(template) : template)

      const routes = entry.PRERENDER_ROUTES
      const indexableRoutes: string[] = []
      for (const route of routes) {
        const html = entry.render(route)
        const at = html.indexOf(BODY_ANCHOR)
        if (at < 0) throw new Error(`[prerender] ${route} rendered no '${BODY_ANCHOR}' — src/pages/_app.tsx root markup changed?`)
        const head = html.slice(0, at)
        const body = html.slice(at)
        if (!head.includes('<title>') || !head.includes('name="description"')) {
          throw new Error(`[prerender] ${route} rendered no <title>/description — render <Seo {...seo} path="${route}" /> first in the page.`)
        }
        if (!body.includes('<h') && !body.includes('<p')) {
          throw new Error(`[prerender] ${route} rendered an empty page — public pages must return markup without a browser.`)
        }
        let page = stampHead(template, head).replace(
          ROOT_PLACEHOLDER,
          // A replacer function, because a replacement string would expand `$&` in page copy.
          // data-prerendered tells src/main.tsx to hydrate instead of repainting.
          () => `<div id="root" data-prerendered="${route}">${body}</div>`,
        )
        if (noindex) page = withNoindexMeta(page)
        if (!hasNoindexMeta(page)) indexableRoutes.push(route)
        if (page.includes('__DEEPSPACE_APP_ID__')) {
          throw new Error(`[prerender] ${route} contains the literal __DEEPSPACE_APP_ID__; the deploy would refuse it.`)
        }
        const file = join(clientDir, route === '/' ? 'index.html' : `${route.slice(1)}.html`)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, page)
      }

      const robotsPath = join(clientDir, 'robots.txt')
      if (noindex) {
        // Crawlers must fetch the HTML to see noindex, including when an
        // already indexed site switches policy. robots.txt is not access control.
        writeFileSync(robotsPath, 'User-agent: *\nAllow: /\n')
        rmSync(join(clientDir, 'sitemap.xml'), { force: true })
      } else {
        const robots = existsSync(robotsPath) ? readFileSync(robotsPath, 'utf8') : 'User-agent: *\nAllow: /\n'
        if (!/^Sitemap:/m.test(robots)) writeFileSync(robotsPath, `${robots.trimEnd()}\n\nSitemap: ${origin}/sitemap.xml\n`)
        writeFileSync(
          join(clientDir, 'sitemap.xml'),
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexableRoutes
            .map((route) => `  <url><loc>${origin}${route}</loc></url>`)
            .join('\n')}\n</urlset>\n`,
        )
      }

      rmSync(ssrDir, { recursive: true, force: true })
      console.log(`[prerender] wrote ${routes.length} page(s) [${routes.join(', ')}], ${SHELL_FILE}, robots.txt${noindex ? ' (noindex)' : ', sitemap.xml'}`)
    },
  }
}

/**
 * Replaces the template's default head tags with the page's <Seo> output. Throws if a strip
 * finds nothing, since a changed tag shape would otherwise ship two conflicting titles.
 */
function stampHead(template: string, head: string): string {
  const stripped = template
    .replace(/<title>[\s\S]*?<\/title>\s*/g, '')
    .replace(/<meta\s+name="(?:description|robots)"[^>]*>\s*/g, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/g, '')
    .replace(/<meta\s+(?:property|name)="(?:og|twitter):[^>]*>\s*/g, '')
  for (const leftover of ['<title', 'name="description"', 'rel="canonical"', 'property="og:']) {
    if (stripped.includes(leftover)) {
      throw new Error(`[prerender] could not strip '${leftover}' from index.html — keep its head to the scaffold's shape and put SEO tags in <Seo>.`)
    }
  }
  return stripped.replace('</head>', () => `${head}\n  </head>`)
}

function withNoindexMeta(template: string): string {
  if (hasNoindexMeta(template)) return template
  return template.replace('</head>', () => `<meta name="robots" content="noindex, nofollow"/>\n  </head>`)
}

/** React's <Seo> serializes quoted attributes; accept either quote and order. */
function hasNoindexMeta(html: string): boolean {
  return (html.match(/<meta\b[^>]*>/gi) ?? []).some((tag) =>
    /\bname\s*=\s*["']robots["']/i.test(tag) &&
    /\bcontent\s*=\s*["'][^"']*\b(?:noindex|none)\b[^"']*["']/i.test(tag),
  )
}

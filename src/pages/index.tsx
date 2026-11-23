/**
 * Landing page — a STATIC page (no DeepSpace providers, prerendered at build).
 * Keep it renderable without a browser: no window/document during render.
 */

import { Link } from 'react-router-dom'
import { CloudSun, Map, Sparkles, Users } from 'lucide-react'
import { BrandMark } from '../components/shell/BrandMark'
import { Seo } from '../components/Seo'
import { PRODUCT_NAME } from '../constants'
import { seo } from '../seo'

const FEATURES = [
  {
    Icon: Sparkles,
    title: 'A co-planner that knows your trip',
    body: 'Ask for places or the weather and it adds stops everyone sees. It can only do what you can do on the trip.',
  },
  { Icon: Map, title: 'Every stop on one map', body: 'Days run down the itinerary, stops are numbered on the map, and the walk between them is measured.' },
  { Icon: Users, title: 'Live with your group', body: 'Edits show up for everyone at once, and you can see who is looking at which day.' },
  { Icon: CloudSun, title: 'Weather on each day', body: 'The 16-day forecast appears on each day as soon as your dates come into range.' },
]

const SAMPLE_STOPS = [
  { n: 1, title: 'Check in near Baixa', time: '15:00', x: 61, y: 62 },
  { n: 2, title: 'Sunset at the miradouro', time: '19:30', x: 71, y: 38 },
  { n: 3, title: 'Tram 28 to Alfama', time: '09:30', x: 85, y: 50 },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <span className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
            <BrandMark />
            {PRODUCT_NAME}
          </span>
          <Link to="/home" className="rounded-lg px-3 py-1.5 text-sm font-medium text-foreground hover:bg-secondary">
            Sign in
          </Link>
        </header>

        <main className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-16 pt-8 lg:grid-cols-[1fr_1.15fr] lg:gap-16 lg:pt-16">
          <section>
            <h1 className="max-w-xl text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-[56px]">
              Plan the trip together, one day at a time.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
              One shared board for the whole group. Invite friends with a link, build the itinerary side by side, and let the
              co-planner find places and fill in the days.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                to="/home"
                className="inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90"
              >
                Start planning
              </Link>
              <span className="text-sm text-muted-foreground">Free. Sign in with Google, then open the sample trip.</span>
            </div>
          </section>

          <section aria-label="Example trip board" className="relative">
            <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border border-border bg-[#e6efe9]">
              <svg aria-hidden viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
                <path d="M0 240 C 90 222, 170 262, 250 244 S 360 214, 400 226 L 400 300 L 0 300 Z" fill="#cfe3f0" />
                <path d="M30 40 C 70 20, 120 40, 110 80 S 40 110, 30 40 Z" fill="#d3e7d8" />
                <path d="M300 230 C 330 200, 380 214, 372 238 S 310 250, 300 230 Z" fill="#d3e7d8" />
                <g fill="none" stroke="#dbe7df" strokeWidth="1.2">
                  {[24, 44, 64].map((r) => (
                    <ellipse key={r} cx="90" cy="170" rx={r * 1.3} ry={r * 0.75} />
                  ))}
                </g>
                <g stroke="#ffffff" strokeLinecap="round" fill="none">
                  <path d="M0 96 C 120 120, 230 70, 400 110" strokeWidth="6" />
                  <path d="M0 190 C 110 170, 250 210, 400 176" strokeWidth="4" />
                  <path d="M150 0 C 170 100, 130 190, 175 300" strokeWidth="4" />
                  <path d="M262 0 C 255 80, 300 150, 282 300" strokeWidth="6" />
                  <path d="M330 0 C 340 60, 370 90, 400 96" strokeWidth="3" />
                </g>
                <path
                  d={`M ${SAMPLE_STOPS.map((s) => `${s.x * 4} ${s.y * 3}`).join(' L ')}`}
                  fill="none"
                  stroke="#0f4c3a"
                  strokeWidth="2.5"
                  strokeDasharray="3 4"
                  strokeLinecap="round"
                />
              </svg>
              {SAMPLE_STOPS.map((s) => (
                <span
                  key={s.n}
                  aria-hidden
                  className="trip-marker absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${s.x}%`, top: `${s.y}%` }}
                >
                  {s.n}
                </span>
              ))}
            </div>

            <div className="absolute -bottom-6 left-4 w-[72%] max-w-72 rounded-2xl border border-border bg-card p-4 shadow-[0_24px_48px_-24px_rgba(14,26,21,0.4)] sm:-left-6">
              <p className="text-[13px] font-semibold text-foreground">
                Day 1 <span className="font-normal text-muted-foreground">Fri, Lisbon</span>
              </p>
              <ul className="mt-3 space-y-2">
                {SAMPLE_STOPS.map((s) => (
                  <li key={s.n} className="flex items-center gap-2.5 rounded-xl border border-border px-2.5 py-2">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                      {s.n}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{s.title}</span>
                    <span className="text-[11px] text-muted-foreground">{s.time}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="absolute -top-5 right-4 hidden w-[55%] max-w-64 rounded-2xl sm:block border border-border bg-card p-3.5 shadow-[0_24px_48px_-24px_rgba(14,26,21,0.4)] sm:-right-5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Sparkles aria-hidden className="size-3.5 text-primary" /> Co-planner
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Saturday looks rainy. I added the tile museum in the morning and moved the tram ride to Sunday.
              </p>
            </div>
          </section>
        </main>

        <section className="mt-10 border-t border-border bg-card">
          <ul className="mx-auto grid max-w-6xl gap-x-10 gap-y-8 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ Icon, title, body }) => (
              <li key={title}>
                <span aria-hidden className="mb-4 flex size-9 items-center justify-center rounded-xl bg-accent text-primary">
                  <Icon className="size-4" />
                </span>
                <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}

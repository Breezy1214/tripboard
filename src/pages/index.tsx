/**
 * Landing page — a STATIC page (no DeepSpace providers, prerendered at build).
 * Keep it renderable without a browser: no window/document during render.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { PRODUCT_NAME } from '../constants'
import { seo } from '../seo'

const FEATURES = [
  {
    title: 'An AI co-planner that knows your trip',
    body: 'Ask it for places or the weather and it adds stops everyone sees. It can only do what you can do on the trip.',
  },
  { title: 'A column per day', body: 'Every day of the trip gets its own column. Add, edit and reorder stops in place.' },
  { title: 'Live with your group', body: 'Changes show up for everyone at once, and you can see who is looking at which day.' },
  { title: 'Weather on each day', body: 'The 16-day forecast appears on each day as soon as your dates come into range.' },
]

const SAMPLE_DAYS = [
  { day: 'Fri', stops: ['Check in near Baixa', 'Sunset at the miradouro'] },
  { day: 'Sat', stops: ['Tram 28 to Alfama', 'Lunch at the market'] },
  { day: 'Sun', stops: ['Day trip to Sintra'] },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span aria-hidden className="flex size-6 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
              T
            </span>
            {PRODUCT_NAME}
          </span>
          <Link to="/home" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Sign in
          </Link>
        </header>

        <main className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-10 lg:grid-cols-[1.1fr_1fr] lg:pt-20">
          <section>
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Plan the trip together, one day at a time.
            </h1>
            <p className="mt-5 max-w-lg text-lg text-muted-foreground">
              Tripboard gives your group one shared board for the whole trip. Invite friends with a link, build the
              itinerary side by side, and ask the AI co-planner to find places and fill in the days.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/home"
                className="inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90"
              >
                Start planning
              </Link>
              <span className="self-center text-sm text-muted-foreground">
                Sign in with Google. Free. Then try the sample trip in one click.
              </span>
            </div>
          </section>

          <section aria-label="Example trip board" className="rounded-2xl border border-border bg-card p-4 shadow-card">
            <p className="mb-3 text-sm font-semibold text-foreground">Lisbon long weekend</p>
            <div className="grid grid-cols-3 gap-3">
              {SAMPLE_DAYS.map(({ day, stops }) => (
                <div key={day} className="rounded-xl bg-background p-2.5">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{day}</p>
                  <ul className="space-y-2">
                    {stops.map((stop) => (
                      <li key={stop} className="rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground">
                        {stop}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </main>

        <section className="border-t border-border bg-card/50">
          <ul className="mx-auto grid max-w-6xl gap-8 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ title, body }) => (
              <li key={title}>
                <h2 className="text-base font-semibold text-foreground">{title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}

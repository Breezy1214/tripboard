// Pages under (app)/ get auth and the records socket; top-level pages stay static.

import { Suspense, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { DeepSpaceAuthProvider, useAuthStatus } from 'deepspace'
import { RecordProvider, RecordScope, AgentTools } from 'deepspace'
import Navigation from '../../components/Navigation'
import { useToast } from '@/components/ui'
import { PRODUCT_NAME, SCOPE_ID } from '../../constants'
import { schemas } from '../../schemas'

export default function AppLayout() {
  return (
    <DeepSpaceAuthProvider>
      {/* The prerendered landing owns the document <title> and React drops it
          when <Seo> unmounts, so every route without <Seo> sets its own. */}
      <title>{PRODUCT_NAME}</title>
      <AuthBoot>
        <div className="flex h-dvh flex-col overflow-hidden bg-background lg:flex-row">
          <Navigation />
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <Suspense fallback={<div className="flex items-center justify-center h-full text-muted-foreground">Loading...</div>}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </AuthBoot>
    </DeepSpaceAuthProvider>
  )
}

/** Holds a plain background until the session check resolves, matching the pre-JS page (no layout jump). */
function AuthBoot({ children }: { children: ReactNode }) {
  const { isLoaded } = useAuthStatus()
  // Record writes resolve before the server answers, so a denied write only
  // surfaces through onWriteError. Toast it so it is never silent.
  const { error, warning } = useToast()

  if (!isLoaded) {
    return <div aria-busy="true" className="fixed inset-0 bg-background" />
  }

  return (
    <RecordProvider
      allowAnonymous
      onWriteError={(e) =>
        e.kind === 'permission' ? warning(e.title, e.detail) : error(e.title, e.detail)
      }
    >
      <RecordScope roomId={SCOPE_ID} schemas={schemas}>
        <AgentTools />
        {children}
      </RecordScope>
    </RecordProvider>
  )
}

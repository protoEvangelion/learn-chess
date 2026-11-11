import type { ReactNode } from 'react'
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignIn,
  useClerk,
  useUser,
} from '@clerk/clerk-react'
import { isAllowedClerkUser } from '@/lib/access'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

function MissingKey() {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <p className="auth-eyebrow">Auth</p>
        <h1>Clerk is not configured</h1>
        <p>Add VITE_CLERK_PUBLISHABLE_KEY to .env.local.</p>
      </div>
    </div>
  )
}

function AllowedOnly({ children }: { children: ReactNode }) {
  const { isLoaded, user } = useUser()
  const { signOut } = useClerk()

  if (!isLoaded) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <p className="auth-note">Checking your account…</p>
        </div>
      </div>
    )
  }

  if (!isAllowedClerkUser(user)) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <p className="auth-eyebrow">Private</p>
          <h1>This account can’t open 3D Chess</h1>
          <p>Sign out, then sign in with the owner account.</p>
          <button
            type="button"
            className="auth-button"
            onClick={() => void signOut({ redirectUrl: '/' })}
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

export function ClerkGate({ children }: { children: ReactNode }) {
  if (!PUBLISHABLE_KEY) return <MissingKey />

  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl="/"
      appearance={{
        variables: {
          colorPrimary: '#2dd4bf',
          colorBackground: '#0b0714',
          colorText: '#f4f4f5',
          colorInputBackground: '#140d20',
          colorInputText: '#f4f4f5',
        },
      }}
    >
      <SignedOut>
        <div className="auth-screen">
          <div className="auth-card auth-card-signin">
            <p className="auth-eyebrow">Private</p>
            <h1>3D Chess</h1>
            <p>Sign in to play.</p>
            <SignIn routing="hash" />
          </div>
        </div>
      </SignedOut>
      <SignedIn>
        <AllowedOnly>{children}</AllowedOnly>
      </SignedIn>
    </ClerkProvider>
  )
}

/** The only Clerk account allowed to use this app. */
export const ALLOWED_EMAIL = 'simpletrack@pm.me'

type ClerkEmailUser = {
  primaryEmailAddress?: { emailAddress?: string | null } | null
  emailAddresses?: Array<{ emailAddress?: string | null } | null> | null
} | null

export function clerkEmails(user: ClerkEmailUser): string[] {
  const raw = [
    user?.primaryEmailAddress?.emailAddress,
    ...(user?.emailAddresses ?? []).map((entry) => entry?.emailAddress),
  ]

  return raw
    .filter((email): email is string => typeof email === 'string' && email.length > 0)
    .map((email) => email.trim().toLowerCase())
}

export function isAllowedClerkUser(user: ClerkEmailUser): boolean {
  return clerkEmails(user).includes(ALLOWED_EMAIL)
}

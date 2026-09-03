import { getCurrentActor } from "@/lib/auth/session";
import { Header } from "@/components/layout/Header";

/**
 * The signed-in application shell: persistent header/nav plus the skip link
 * that targets each page's `<main id="main-content">`.
 *
 * This lives in a route group rather than in the root layout so the
 * authentication and error screens (`/login`, `not-found`, `forbidden`) can
 * render without any app chrome at all -- a focused sign-in screen should not
 * carry a navigation bar it cannot navigate anywhere from. Route groups do not
 * appear in the URL, so every route moved in here keeps the exact path it had.
 *
 * Resolving the actor here rather than in the root layout also means the
 * chromeless routes no longer pay for a Supabase `getUser()` plus a DB lookup
 * they never used.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await getCurrentActor();

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:border focus:border-line focus:bg-surface-raised focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-fg focus:shadow-md"
      >
        Skip to main content
      </a>
      <Header actor={actor} />
      {children}
    </>
  );
}

import { getCurrentActor } from "@/lib/auth/session";
import { Header } from "@/components/layout/Header";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppTopBar } from "@/components/layout/AppTopBar";

/**
 * The signed-in application shell: sidebar navigation, a top bar, and the
 * skip link that targets each page's `<main id="main-content">`.
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
 *
 * WHY THE PAGES DID NOT HAVE TO CHANGE FOR THIS: every page owns its own
 * `<main className="mx-auto w-full max-w-Nxl ...">`. The shell wraps around
 * that, so each page keeps centring itself -- just inside the content column
 * rather than inside the viewport. Twenty-nine pages, none of them edited to
 * put a sidebar beside them.
 *
 * Two states get no sidebar at all, because neither can navigate anywhere:
 * a signed-out visitor on a public page, and a user who must change their
 * password before anything else (src/proxy.ts redirects them there from
 * everywhere). Both fall back to the slim Header.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await getCurrentActor();
  const showShell = actor !== null && !actor.mustChangePassword;

  const skipLink = (
    <a
      href="#main-content"
      className="focus:border-line focus:bg-surface-raised focus:text-brand-fg sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-60 focus:rounded-md focus:border focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md"
    >
      Skip to main content
    </a>
  );

  /* The progressive-enhancement helpers (auto-submitting filters, submit
     spinners, show/hide password). Deferred, same-origin and tiny; every
     control it touches works without it, so loading it once for the whole
     signed-in shell costs nothing and means no page has to remember to
     ask for it. The chromeless screens load it themselves via
     FocusedScreen, since they are outside this layout. */
  const enhance = <script defer src="/enhance.js" />;

  if (!showShell) {
    return (
      <>
        {skipLink}
        <Header actor={actor} />
        {children}
        {enhance}
      </>
    );
  }

  return (
    <>
      {skipLink}
      <div className="app-shell">
        <AppSidebar actor={actor} />
        {/* Dismisses the drawer on tap. Rendered always and hidden by CSS
            above lg and whenever the drawer is closed, so opening it needs
            no markup change -- one attribute on <html> does everything. */}
        <div className="app-scrim hidden [html[data-drawer='open']_&]:block" data-drawer-close="" aria-hidden="true" />
        <div className="app-main">
          <AppTopBar actor={actor} />
          {children}
        </div>
      </div>
      {enhance}
    </>
  );
}

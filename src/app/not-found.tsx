import Link from "next/link";
import { ArrowLeft, LayoutDashboard } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { FocusedScreen } from "@/components/layout/FocusedScreen";

/**
 * Custom 404. Because it sits at the app root rather than inside the
 * `(portal)` route group, it renders chromeless -- which is also what makes it
 * safe for signed-out visitors, who are the ones most likely to arrive at an
 * unmatched URL.
 *
 * Reached by any URL the app doesn't match. It would also cover `notFound()`
 * calls from a route segment, but nothing calls that today -- and it would not
 * render if it did: an interrupt thrown mid-render is delivered through the
 * client-side error boundary, which this app's CSP (`script-src 'self'`, no
 * nonce) blocks, so it would paint a blank page. Unmatched URLs are routed
 * before rendering and are server-rendered normally, which is why this page
 * works. Verified against a production build.
 *
 * Deliberately says nothing about *which* route was missed: NotFoundError in
 * src/lib/errors.ts is thrown both for records that don't exist and for
 * records the actor may not see, and the two must stay indistinguishable so
 * this page can't be used to probe for real IDs.
 *
 * "Return to dashboard" points at /portal, which redirects a signed-out
 * visitor to /login on its own -- so the primary action is right either way.
 */
export default function NotFound() {
  return (
    <FocusedScreen className="max-w-lg text-center">
      <MissingRecordMark />

      <p className="font-heading mt-8 text-6xl leading-none font-semibold text-brand-fg sm:text-7xl">404</p>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-fg">Page not found</h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-balance text-fg-secondary">
        The page you are looking for does not exist, has been moved, or you may not have permission to access it.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/portal" className={buttonClasses("primary", "md", "h-11")}>
          <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
          Return to dashboard
        </Link>
        <button type="button" data-history-back className={buttonClasses("secondary", "md", "enhance-only h-11")}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Go back
        </button>
      </div>
    </FocusedScreen>
  );
}

/**
 * An academic record with a section missing -- line art in the brand palette
 * rather than an illustration, so it reads as part of the same system as the
 * rest of the portal and stays legible in both themes.
 */
function MissingRecordMark() {
  return (
    <svg
      viewBox="16 2 124 130"
      className="mx-auto h-32 w-auto"
      role="img"
      aria-label="An academic record with a missing section"
    >
      {/* The record behind, just enough to suggest a file of them. */}
      <rect x="46" y="24" width="86" height="96" rx="10" className="fill-surface stroke-line" strokeWidth="2" />
      {/* The record in front, with its top-right corner folded away. */}
      <path
        d="M28 24a8 8 0 0 1 8-8h56l26 26v66a8 8 0 0 1-8 8H36a8 8 0 0 1-8-8V24Z"
        className="fill-surface-raised stroke-brand"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M92 16v18a8 8 0 0 0 8 8h18" className="fill-none stroke-brand" strokeWidth="2" strokeLinejoin="round" />
      {/* Two intact rows, then the gap where the rest should be. */}
      <path
        d="M44 58h34M44 70h48"
        className="stroke-line-strong"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <rect
        x="43"
        y="82"
        width="66"
        height="22"
        rx="6"
        className="fill-brand-subtle stroke-brand-secondary"
        strokeWidth="2"
        strokeDasharray="5 5"
      />
    </svg>
  );
}

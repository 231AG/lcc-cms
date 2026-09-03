import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, LayoutDashboard } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { FocusedScreen } from "@/components/layout/FocusedScreen";

export const metadata: Metadata = { title: "Access denied" };

/**
 * Access Denied, kept distinct from the 404 on purpose: "this page does not
 * exist" and "this page exists but is not yours" are different answers, and
 * telling a signed-in user which one applies is the difference between a dead
 * end and knowing to ask for access.
 *
 * That distinction is safe *here* because reaching this page means a
 * permission check refused a named action for an identified actor. It does not
 * extend to records: NotFoundError in src/lib/errors.ts stays deliberately
 * identical for "missing" and "not visible to you", so per-record probing
 * still gets a 404, never this page.
 *
 * A normal route rather than Next's `forbidden()` + app/forbidden.tsx, which
 * would return a real 403 status: auth interrupts are delivered through the
 * client-side error boundary, and this app's CSP (`script-src 'self'`, no
 * nonce) blocks the inline script that carries them, so `forbidden()` renders
 * a blank page here -- verified against a production build. A plain route is
 * server-rendered and works with no client JavaScript at all, at the cost of a
 * 200 status on a screen that semantically means 403. Worth revisiting if the
 * CSP ever moves to nonces.
 *
 * Says nothing about the route, the required permission or the actor's role --
 * enough to act on, nothing to map the system's internals with.
 */
export default function AccessDeniedPage() {
  return (
    <FocusedScreen className="max-w-lg text-center">
      <RestrictedRecordMark />

      <p className="font-heading mt-8 text-5xl leading-none font-semibold text-brand-fg sm:text-6xl">403</p>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-fg">Access denied</h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-balance text-fg-secondary">
        You do not have permission to view this page. If you believe you should, contact the Admin office to have your
        account&rsquo;s access reviewed.
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

/** The same academic record as the 404 mark, closed with a lock rather than
 * missing a section -- one visual family, two clearly different states. */
function RestrictedRecordMark() {
  return (
    <svg
      viewBox="16 2 124 130"
      className="mx-auto h-32 w-auto"
      role="img"
      aria-label="An academic record closed with a padlock"
    >
      <rect x="46" y="24" width="86" height="96" rx="10" className="fill-surface stroke-line" strokeWidth="2" />
      <path
        d="M28 24a8 8 0 0 1 8-8h56l26 26v66a8 8 0 0 1-8 8H36a8 8 0 0 1-8-8V24Z"
        className="fill-surface-raised stroke-brand"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M92 16v18a8 8 0 0 0 8 8h18" className="fill-none stroke-brand" strokeWidth="2" strokeLinejoin="round" />
      <path d="M44 58h30" className="stroke-line-strong" strokeWidth="3" strokeLinecap="round" />
      {/* Padlock, sitting over the record's lower half. */}
      <path
        d="M60 84v-8a13 13 0 0 1 26 0v8"
        className="fill-none stroke-brand-secondary"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <rect x="50" y="84" width="46" height="30" rx="7" className="fill-brand-subtle stroke-brand" strokeWidth="2" />
      <circle cx="73" cy="96" r="3.5" className="fill-brand" />
      <path d="M73 99.5v5" className="stroke-brand" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

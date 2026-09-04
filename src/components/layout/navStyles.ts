/**
 * Shared styling for every interactive item in the nav bar: neutral by
 * default, a soft Lavender-tinted surface with Deep Orchid text on hover
 * (which on dark resolves to a slightly lighter, lavender-tinted surface --
 * same behaviour, per-theme values). No full brand-coloured fill: that reads
 * as a permanently "selected" item and dominates the bar in dark mode.
 *
 * Lives in its own module because both the Header (a Server Component: the
 * account controls) and MainNav (a Client Component: the links and menus)
 * use it, and a "use client" file must not be the source of truth for
 * something a server file imports.
 */
export const navItem =
  "rounded-md px-3 py-1.5 text-fg-secondary transition-colors hover:bg-brand-subtle hover:text-brand-fg " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/**
 * The active/current item. Deep Orchid text on the Lavender-tinted surface,
 * with the indicator itself drawn as a pseudo-element so switching between
 * active and inactive never changes an item's size -- a border would shift
 * every neighbour by 2px.
 *
 * `navItemActive` underlines the item with a Deep Orchid bar (top-level bar
 * items); `navItemActiveInset` draws the same bar down the left edge
 * (items stacked inside a dropdown or the mobile panel).
 */
const activeBase = "bg-brand-subtle font-semibold text-brand-fg relative";

export const navItemActive =
  `${activeBase} after:pointer-events-none after:absolute after:inset-x-2 after:-bottom-0.5 ` +
  "after:h-0.5 after:rounded-full after:bg-primary";

export const navItemActiveInset =
  `${activeBase} before:pointer-events-none before:absolute before:top-1.5 before:bottom-1.5 before:left-1 ` +
  "before:w-0.5 before:rounded-full before:bg-primary";

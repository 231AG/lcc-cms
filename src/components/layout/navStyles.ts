/**
 * Styling for the interactive items in the slim signed-out / must-change-
 * password header: neutral by default, a soft brand-tinted surface with
 * brand text on hover (which on dark resolves to a slightly lighter,
 * tinted surface -- same behaviour, per-theme values).
 *
 * The active/current variants that used to live here went with the top
 * navigation when the sidebar replaced it; SidebarLink owns that treatment
 * now.
 */
export const navItem =
  "rounded-lg px-3 py-1.5 text-fg-secondary transition-colors hover:bg-brand-subtle hover:text-brand-fg " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

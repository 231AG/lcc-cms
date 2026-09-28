import { Moon, Sun } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * Light/dark switch for the header. Available to every role (and to signed-out
 * visitors), since it is a display preference rather than a permission.
 *
 * A Server Component with no client JS of its own: the click is handled by the
 * delegated listener in public/theme.js, which finds this button by its
 * `data-theme-toggle` attribute. That keeps the page at 0 KB of React client
 * bundle, matching the rest of the app, and means the toggle does not depend
 * on hydration.
 *
 * Both states are rendered into the HTML and CSS picks one -- the
 * `.theme-when-light` / `.theme-when-dark` rules in globals.css mirror the same
 * `data-theme` cascade the colour tokens use. So the correct icon and label are
 * right on the very first paint, with no JavaScript involved in choosing them.
 *
 * The preference is stored per-browser in localStorage: the app has no
 * user-settings table (nothing in src/lib/db/schema/*, nothing on `Actor`), and
 * per-browser storage already survives reload and sign-out/sign-in without
 * adding a column, a migration or a server round trip to a display setting.
 */
export function ThemeToggle({
  className,
  tooltipAlign = "end",
}: {
  className?: string;
  tooltipAlign?: "start" | "center" | "end";
}) {
  // The tooltip names what a click will do, which depends on the current
  // theme -- so both phrasings render, and the same theme-when-* rules that
  // pick the icon pick the words.
  const tip = (
    <>
      <span className="theme-when-light">Dark mode</span>
      <span className="theme-when-dark">Light mode</span>
    </>
  );

  return (
    <Tooltip label={tip} align={tooltipAlign}>
      <button
        type="button"
        data-theme-toggle=""
        className={cn(
          "flex items-center justify-center rounded-md px-2 py-1.5 text-fg-secondary transition-colors",
          "hover:bg-brand-subtle hover:text-brand-fg",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
          className,
        )}
      >
        <span className="theme-when-light inline-flex items-center">
          <Moon className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Switch to dark mode</span>
        </span>
        <span className="theme-when-dark items-center">
          <Sun className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Switch to light mode</span>
        </span>
      </button>
    </Tooltip>
  );
}

import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The shell for screens that deliberately carry no app chrome: sign-in, 404
 * and 403. These live outside the `(portal)` route group, so there is no
 * header, no nav and no skip link to compete with a single focused task.
 *
 * The theme toggle still has to be reachable, so it floats in the top-right
 * corner rather than requiring a whole navigation bar to host it.
 *
 * `enhance.js` is loaded here rather than in the root layout because these are
 * the only screens with progressive-enhancement controls, and it is what
 * reveals them (see `.enhance-only` in globals.css). Deferred, so it never
 * blocks the first paint the way the theme script must.
 */
export function FocusedScreen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="screen-glow relative flex min-h-dvh flex-1 flex-col items-center justify-center px-5 py-16 outline-none sm:px-6"
    >
      <ThemeToggle className="absolute top-4 right-4 sm:top-6 sm:right-6" />
      <div className={cn("w-full", className)}>{children}</div>
      <script defer src="/enhance.js" />
    </main>
  );
}

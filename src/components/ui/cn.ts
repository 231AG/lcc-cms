/** Tiny classname joiner -- avoids adding a `clsx`/`tailwind-merge` dependency for
 * something this small. Falsy values are dropped; no dedupe/merge logic, so callers
 * put overrides last the way plain string concatenation already required. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

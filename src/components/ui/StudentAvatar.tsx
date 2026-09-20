import { cn } from "./cn";

/**
 * A student's photograph, or their initials when there isn't one.
 *
 * Used on the two profile screens only. Deliberately NOT in the Student
 * Listing or any other table: a column of faces makes a dense table harder
 * to scan, not easier, and the tables in this app are how staff actually
 * work.
 *
 * `<img>` rather than `next/image`: the source is an authenticated route
 * that streams bytes out of Postgres, so there is nothing for the image
 * optimizer to fetch, resize or cache, and pointing it at a private URL
 * would put one student's photograph in a shared on-disk cache.
 *
 * The initials fall back to a neutral glyph-free tile rather than a stock
 * silhouette, which always reads as "this person has no face on file"
 * rather than as a picture of them.
 */

const SIZES = {
  sm: { box: "h-12 w-12 rounded-xl", text: "text-sm" },
  md: { box: "h-20 w-20 rounded-2xl", text: "text-xl" },
  lg: { box: "h-28 w-28 rounded-[1.25rem]", text: "text-2xl" },
} as const;

export type AvatarSize = keyof typeof SIZES;

/** First letters of the first and last name parts, at most two. */
export function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export function StudentAvatar({
  studentId,
  name,
  hasPhoto,
  version,
  size = "md",
  className,
}: {
  studentId: string;
  /** Full name, used for the initials and for the image's alt text. */
  name: string;
  hasPhoto: boolean;
  /** Anything that changes when the photo does -- the upload timestamp.
   *  The serve route is cached for five minutes per browser, so without
   *  this a replaced photo keeps showing the old one until it expires. */
  version?: string | number;
  size?: AvatarSize;
  className?: string;
}) {
  const { box, text } = SIZES[size];

  if (hasPhoto) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element --
         see the note above: an authenticated, private, DB-backed source is
         exactly what next/image must not be pointed at. */
      <img
        src={`/api/students/${studentId}/photo${version ? `?v=${encodeURIComponent(String(version))}` : ""}`}
        alt={`Photograph of ${name}`}
        className={cn(box, "border-line bg-surface-subtle shrink-0 border object-cover shadow-sm", className)}
      />
    );
  }

  return (
    <span
      // The initials duplicate the name that is always rendered beside this,
      // so they are decoration for a sighted reader rather than content.
      aria-hidden="true"
      className={cn(
        box,
        text,
        "bg-gradient-brand text-on-primary flex shrink-0 items-center justify-center font-bold tracking-wide shadow-sm select-none",
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

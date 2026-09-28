import { UserRound } from "lucide-react";
import { cn } from "./cn";

/**
 * A student's photograph, or a person glyph when there isn't one.
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
 * With no photo on file the tile shows a plain person outline on a neutral
 * ground: it reads as "no photograph yet" at a glance, where a coloured
 * tile of initials read as a badge or a button.
 */

const SIZES = {
  sm: { box: "h-12 w-12 rounded-xl", glyph: "h-6 w-6" },
  md: { box: "h-20 w-20 rounded-2xl", glyph: "h-10 w-10" },
  lg: { box: "h-28 w-28 rounded-[1.25rem]", glyph: "h-14 w-14" },
} as const;

export type AvatarSize = keyof typeof SIZES;

export function StudentAvatar({
  studentId,
  name,
  hasPhoto,
  version,
  size = "md",
  className,
}: {
  studentId: string;
  /** Full name, used for the image's alt text. */
  name: string;
  hasPhoto: boolean;
  /** Anything that changes when the photo does -- the upload timestamp.
   *  The serve route is cached for five minutes per browser, so without
   *  this a replaced photo keeps showing the old one until it expires. */
  version?: string | number;
  size?: AvatarSize;
  className?: string;
}) {
  const { box, glyph } = SIZES[size];

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
      // The name is always rendered beside this, so the glyph is decoration
      // for a sighted reader rather than content.
      aria-hidden="true"
      className={cn(
        box,
        "border-line bg-surface-subtle text-fg-subtle flex shrink-0 items-center justify-center border shadow-sm select-none",
        className,
      )}
    >
      <UserRound className={glyph} strokeWidth={1.5} />
    </span>
  );
}

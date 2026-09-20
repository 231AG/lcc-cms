/**
 * What an uploaded file actually is, and how large one may be.
 *
 * Its own module, free of `server-only`, because none of this touches the
 * server: it is arithmetic over the first twelve bytes of a buffer. That
 * also makes it directly testable, which matters more here than for most
 * pure functions -- this is the check that decides what the photo route
 * will later hand back with a Content-Type header.
 */

/** 2 MB. Also a CHECK on the column, so it is true of the data and not
 *  merely true of this code path. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoContentType = (typeof ACCEPTED_PHOTO_TYPES)[number];

/**
 * What the bytes actually are, ignoring what the upload claimed.
 *
 * A browser's `file.type` is taken from the file extension; it is a claim
 * by whoever is uploading, not a fact about the content. Since this route
 * later serves those bytes back with a Content-Type, believing the claim
 * would let someone store an HTML document and have the app serve it as
 * their own origin. Reading the leading bytes is the cheap way to refuse
 * that, and it is why the declared type is discarded rather than trusted.
 *
 * Returns null when the bytes are not one of the three formats.
 */
export function sniffImageType(bytes: Uint8Array): PhotoContentType | null {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && PNG.every((b, i) => bytes[i] === b)) return "image/png";

  // WebP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

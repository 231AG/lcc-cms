import { describe, expect, it } from "vitest";
import { sniffImageType, MAX_PHOTO_BYTES } from "../imageFormat";

/**
 * The format check, on its own.
 *
 * This is the part of the upload path that decides what the serve route
 * will later hand back with a Content-Type header, so it is worth testing
 * as a pure function rather than only through a database round trip: a
 * browser's `file.type` comes from the file extension and is a claim by
 * whoever is uploading, not a fact about the bytes.
 */

const jpeg = (extra: number[] = []) => new Uint8Array([0xff, 0xd8, 0xff, ...extra]);
const png = (extra: number[] = []) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...extra]);
const webp = () =>
  new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x24, 0x00, 0x00, 0x00, // chunk size, any value
    0x57, 0x45, 0x42, 0x50, // "WEBP"
  ]);

describe("sniffImageType", () => {
  it("recognises the three accepted formats by their leading bytes", () => {
    expect(sniffImageType(jpeg())).toBe("image/jpeg");
    expect(sniffImageType(png())).toBe("image/png");
    expect(sniffImageType(webp())).toBe("image/webp");
  });

  it("refuses an HTML document even though it is what a browser would upload as text/html", () => {
    // The case that matters: this route serves bytes back from the app's
    // own origin. Storing markup and handing it back as a document would
    // be a stored XSS against every viewer of that profile.
    const html = new TextEncoder().encode("<!DOCTYPE html><script>alert(1)</script>");
    expect(sniffImageType(html)).toBeNull();
  });

  it("refuses an SVG, which IS an image and is exactly why it is not accepted", () => {
    // SVG can carry script. It is excluded from the accepted set on
    // purpose, so the sniffer must not be tempted to recognise it.
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImageType(svg)).toBeNull();
  });

  it("refuses a file whose extension lied about it", () => {
    // What arrives as "portrait.jpg" with type image/jpeg, but is a PDF.
    const pdf = new TextEncoder().encode("%PDF-1.7\n%\xE2\xE3\xCF\xD3");
    expect(sniffImageType(pdf)).toBeNull();
  });

  it("refuses a truncated header rather than reading past the end", () => {
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull(); // one byte short of JPEG
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull(); // short PNG
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBeNull(); // RIFF with no WEBP
  });

  it("does not accept a RIFF container that is not WebP", () => {
    // A WAV file is also RIFF. The four bytes at offset 8 are what
    // separate the two, which is why the check reads them.
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);
    expect(sniffImageType(wav)).toBeNull();
  });

  it("caps uploads at 2 MB, matching the CHECK on the column", () => {
    // If these two ever disagree, the service raises a ValidationError the
    // user can read and the database raises a constraint violation they
    // cannot. They are kept equal on purpose.
    expect(MAX_PHOTO_BYTES).toBe(2 * 1024 * 1024);
  });
});

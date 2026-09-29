/**
 * The open page's "still here" signal. Someone typing into a long form
 * makes no requests, so the page calls this every few minutes while it is
 * being used; the proxy records the request as activity, which is all
 * this endpoint is for (src/lib/auth/idle.ts). Nothing is read or
 * returned.
 */
export function POST() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

/**
 * Signing out after an hour without activity, for every role (decided
 * 29 Sep 2026). Before this, a session lived for the session cookie's 12
 * hours whether or not anyone was using it, so a computer left signed in
 * in an office stayed signed in all day.
 *
 * The proxy keeps the time of the last real request in a cookie of its
 * own, bound to the Supabase session it belongs to and signed with a
 * server-only secret, so it can be neither edited forward nor carried over
 * to another session. A request that finds more than an hour since that
 * time ends the session and goes to the sign-in page. Router prefetches
 * are not activity -- they happen without anyone touching the page.
 *
 * Deliberately in-cookie rather than a database write on every request:
 * this runs on every page and data request the proxy sees.
 */

export const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
export const ACTIVITY_COOKIE = "lcc-last-active";

const encoder = new TextEncoder();

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  let binary = "";
  for (const byte of mac) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** "<epoch ms>.<signature over session and time>" */
export async function activityCookieValue(sessionId: string, at: number, secret: string): Promise<string> {
  return `${at}.${await sign(secret, `${sessionId}.${at}`)}`;
}

/**
 * The last-activity time the cookie vouches for, or null when there is no
 * cookie or it does not verify for this session (a fresh sign-in, a cookie
 * from an earlier session, or one that has been altered).
 */
export async function readLastActivity(value: string | undefined, sessionId: string, secret: string): Promise<number | null> {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const at = Number(value.slice(0, dot));
  if (!Number.isSafeInteger(at) || at <= 0) return null;
  const expected = await sign(secret, `${sessionId}.${at}`);
  const given = value.slice(dot + 1);
  // Constant-time comparison, so a forged signature cannot be found a
  // character at a time.
  if (given.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? at : null;
}

export function isIdle(lastActivity: number, now: number): boolean {
  return now - lastActivity > IDLE_TIMEOUT_MS;
}

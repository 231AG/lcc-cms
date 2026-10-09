// A (cont.) Session handling: idle timeout, admin reset vs existing sessions.
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { SVC, PASSWORD, callAction, login, req, Jar, ensureAccount, sql, runTs, record } from "./lib.mjs";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function sessionIdOf(jar) {
  // @supabase/ssr stores the session as base64url JSON (possibly chunked .0/.1)
  const parts = [...jar.c].filter(([k]) => k.startsWith("sb-")).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  const joined = parts.join("").replace(/^base64-/, "");
  const session = JSON.parse(Buffer.from(joined.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  return JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString()).session_id;
}
const activityCookie = (sid, at) => `${at}.${b64url(createHmac("sha256", SVC).update(`${sid}.${at}`).digest())}`;

// ---- A7: idle timeout — enforced, but only if the client presents its activity cookie
{
  const s = await login("2024902");
  const sid = sessionIdOf(s.jar);
  const twoHoursAgo = Date.now() - 2 * 3600 * 1000;
  // (1) honest browser: stale, validly signed activity cookie -> must be signed out
  const stale = new Jar(); for (const [k, v] of s.jar.c) stale.c.set(k, v); stale.c.set("lcc-last-active", activityCookie(sid, twoHoursAgo));
  const r1 = await req("/portal", { jar: stale });
  record("A7a", "Idle timeout signs out a session with a stale activity cookie", /reason=idle/.test(r1.headers.get("location") ?? "") ? "PASS" : "FAIL", `status ${r1.status} -> ${r1.headers.get("location")}`);
  // (2) the same session cookie WITHOUT the activity cookie (what anyone who copied the session cookie does)
  const s2 = await login("2024902");
  const noAct = new Jar(); for (const [k, v] of s2.jar.c) if (k !== "lcc-last-active") noAct.c.set(k, v);
  const r2 = await req("/portal", { jar: noAct });
  const body = await r2.text();
  const ok = r2.status === 200 && !/Please sign in/.test(body);
  record("A7b", "Idle timeout cannot be skipped by omitting the activity cookie", ok ? "FAIL" : "PASS",
    `session cookie alone (no lcc-last-active) -> ${r2.status}${ok ? " and the signed-in portal is served: the 1-hour idle rule only binds clients that choose to send the cookie" : ""}`);
}

// ---- H3: admin password reset vs the student's existing session --------------
{
  const id = sql("select id from app.app_user where login_identifier='2021903'")[0][0];
  await ensureAccount({ identifier: "2021903", role: "STUDENT", displayName: "2021903" });
  const old = await login("2021903");                                  // the "stolen" session
  const okBefore = (await req("/portal", { jar: old.jar })).status;
  runTs("helpers/reset-password.ts", [id, "/tmp/claude-0/audit-tmp-pw"]);
  const temp = readFileSync("/tmp/claude-0/audit-tmp-pw", "utf8");
  const afterReset = await req("/portal", { jar: old.jar });
  const loc = afterReset.headers.get("location") ?? "";
  // The old session now sits on the forced-change path, which asks for no current password:
  const take = await callAction("changePasswordAction", { newPassword: "Attacker-Chosen-77x", confirmPassword: "Attacker-Chosen-77x" }, { jar: old.jar, page: "/change-password" });
  const attacker = (await login("2021903", "Attacker-Chosen-77x")).location;
  const student = (await login("2021903", temp)).location;
  const takeover = take.location === "/portal" && attacker === "/portal";
  record("H3", "After an admin password reset, the OLD session cannot take over the account", takeover ? "FAIL" : "PASS",
    `old session before reset: ${okBefore}; after reset /portal -> ${afterReset.status} ${loc}; old session set its own password without knowing any: ${take.location}; attacker's password then logs in: ${attacker}; the real student's fresh temporary password logs in: ${student}`);
  await ensureAccount({ identifier: "2021903", role: "STUDENT", displayName: "2021903" });   // restore
}

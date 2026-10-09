// A. Authentication — black-box against the LOCAL production build.
import { readFileSync } from "node:fs";
import { APP, ANON, SVC, AUTH, PASSWORD, callAction, login, req, Jar, ensureAccount, sql, runTs, record } from "./lib.mjs";

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const timeLogin = async (ident, pw, n = 9) => {
  const t = [];
  let loc;
  for (let i = 0; i < n; i++) { const s = performance.now(); const r = await login(ident, pw); t.push(performance.now() - s); loc = r.location; }
  return { ms: Math.round(median(t)), loc };
};

// ---- A5: session cookie flags (real login response) ------------------------
{
  const r = await callAction("loginAction", { identifier: "2020901", password: PASSWORD }, { jar: new Jar() });
  const sc = r.headers.getSetCookie();
  const auth = sc.filter((c) => c.startsWith("sb-"));
  const flags = auth.map((c) => ({ httpOnly: /httponly/i.test(c), secure: /;\s*secure/i.test(c), sameSite: (c.match(/samesite=(\w+)/i) ?? [])[1], maxAge: (c.match(/max-age=(\d+)/i) ?? [])[1] }));
  const ok = flags.length > 0 && flags.every((f) => f.httpOnly && f.secure && /lax/i.test(f.sameSite ?? "") && Number(f.maxAge) <= 43200);
  record("A5a", "Session cookie flags (HttpOnly, Secure, SameSite=Lax, <=12h)", ok ? "PASS" : "FAIL", JSON.stringify(flags));
}

// ---- A2: enumeration — responses and timing --------------------------------
{
  const cases = [
    ["existing student, wrong password", "2024902", "wrong-Pass-9"],
    ["non-existent student ID (valid format)", "2019000", "wrong-Pass-9"],
    ["malformed identifier", "not-an-id!", "wrong-Pass-9"],
    ["existing staff, wrong password", "registrar", "wrong-Pass-9"],
    ["non-existent staff", "no.such.staff", "wrong-Pass-9"],
    ["DISABLED staff, CORRECT password", "admin.disabled", PASSWORD],
  ];
  const out = [];
  for (const [label, ident, pw] of cases) out.push([label, await timeLogin(ident, pw)]);
  const detail = out.map(([l, v]) => `${l.padEnd(42)} -> ${v.loc}  median ${v.ms}ms`).join("\n        ");
  const sameRedirect = new Set(out.slice(0, 5).map(([, v]) => v.loc)).size === 1;
  const msExisting = out[0][1].ms, msMissing = out[1][1].ms;
  record("A2a", "Login failure response identical for existing/missing/malformed IDs", sameRedirect ? "PASS" : "FAIL", detail);
  record("A2b", "Login timing: existing vs non-existent student ID", Math.abs(msExisting - msMissing) > 60 ? "FAIL" : "PASS", `existing ${msExisting}ms vs missing ${msMissing}ms (local GoTrue; hosted timing may differ)`);
  record("A2c", "Disabled account reveals itself only with the correct password", out[5][1].loc.includes("disabled") ? "INFO" : "PASS", `disabled+correct pw -> ${out[5][1].loc} (needs the real password, so not enumeration)`);
}

// ---- A1: brute force / lockout ---------------------------------------------
{
  await ensureAccount({ identifier: "2026555", role: "STUDENT", displayName: "Brute Force Target" });
  const N = 60; let blocked = 0, errors = 0; const t0 = performance.now();
  for (let i = 0; i < N; i++) { const r = await login("2026555", `guess-${i}-x`); if (!/error=1/.test(r.location ?? "")) { blocked++; } if (r.status >= 500) errors++; }
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  const after = await login("2026555", PASSWORD);
  record("A1", `No rate limit / lockout on login (${N} wrong guesses, then the right password)`,
    blocked === 0 && after.location === "/portal" ? "FAIL" : "PASS",
    `${N} guesses in ${secs}s, throttled=${blocked}, 5xx=${errors}; right password afterwards -> ${after.location}. (App has no limiter; hosted Supabase Auth applies its own per-IP limits — dashboard setting, cannot be verified from here.)`);
}

// ---- A4: forced first-login password change cannot be skipped --------------
{
  const f = await login("2026777");
  record("A4a", "Forced-change user is sent to /change-password at login", f.location === "/change-password" ? "PASS" : "FAIL", f.location);
  const targets = ["/portal", "/planning", "/admin/students", "/admin/accounts", "/admin/audit", "/portal/transcript", "/portal/grades", "/grading-policy", "/api/students/00000000-0000-4000-8000-000000000000/photo", "/admin/students/export", "/admin/export/00000000-0000-4000-8000-000000000000/results"];
  const bad = [];
  for (const t of targets) { const r = await req(t, { jar: f.jar }); const loc = r.headers.get("location") ?? ""; if (!(r.status >= 300 && r.status < 400 && loc.includes("/change-password"))) bad.push(`${t} -> ${r.status} ${loc}`); }
  record("A4b", `Direct navigation by a forced-change user is redirected (${targets.length} URLs)`, bad.length ? "FAIL" : "PASS", bad.join(" | ") || "all redirected to /change-password");
  // server actions while forced
  const r1 = await callAction("startPlanAction", { semesterId: "00000000-0000-4000-8000-000000000000" }, { jar: f.jar });
  record("A4c", "Server action by a forced-change user is stopped before it runs", /change-password/.test(r1.location ?? "") ? "PASS" : "FAIL", `status ${r1.status} location ${r1.location}`);
  // x-middleware-subrequest bypass attempt
  const hdr = "src/proxy:src/proxy:src/proxy:src/proxy:src/proxy"; 
  const r2 = await req("/portal", { jar: f.jar, headers: { "x-middleware-subrequest": hdr } });
  record("A4d", "x-middleware-subrequest header does not bypass the proxy", /change-password/.test(r2.headers.get("location") ?? "") ? "PASS" : "FAIL", `status ${r2.status} location ${r2.headers.get("location")}`);
}

// ---- A6: logout really ends the session (replay the old cookie) ------------
{
  const s = await login("2021903");
  const oldCookie = s.jar.header();
  const before = await req("/portal", { jar: s.jar });
  const out = await callAction("signOutAction", {}, { jar: s.jar, page: "/portal" });
  const replay = new Jar(); for (const kv of oldCookie.split("; ")) { const i = kv.indexOf("="); replay.c.set(kv.slice(0, i), kv.slice(i + 1)); }
  const after = await req("/portal", { jar: replay });
  const body = await after.text();
  const stillIn = after.status === 200 && !/Please sign in|login/i.test(body) && /Welcome|Dashboard|Christiana/i.test(body);
  record("A6a", "Replaying a session cookie after logout does not work", stillIn ? "FAIL" : "PASS", `before logout ${before.status}; logout ${out.status}; replay -> ${after.status}${stillIn ? " (still signed in!)" : ""}`);
}

// ---- H3: does an admin password reset end the student's existing sessions? --
{
  const id = sql("select id from app.app_user where login_identifier='2021903'")[0][0];
  await ensureAccount({ identifier: "2021903", role: "STUDENT", displayName: "2021903" });
  const old = await login("2021903");                               // the "stolen" session
  const okBefore = (await req("/portal", { jar: old.jar })).status;
  runTs("helpers/reset-password.ts", [id, "/tmp/claude-0/audit-tmp-pw"]);
  const temp = readFileSync("/tmp/claude-0/audit-tmp-pw", "utf8");
  const afterReset = await req("/portal", { jar: old.jar });
  const loc = afterReset.headers.get("location") ?? "";
  // Can the OLD session now set a new password WITHOUT knowing any password (forced-change path)?
  const take = await callAction("changePasswordAction", { newPassword: "Attacker-Chosen-77x", confirmPassword: "Attacker-Chosen-77x" }, { jar: old.jar, page: "/change-password" });
  const oldPwWorks = (await login("2021903", temp)).location;
  const attackerWorks = (await login("2021903", "Attacker-Chosen-77x")).location;
  record("H3", "Admin password reset ends the old session / blocks takeover by it",
    attackerWorks === "/portal" || attackerWorks === "/change-password" && false ? "FAIL" : (/change-password/.test(loc) && take.location === "/portal" ? "FAIL" : "PASS"),
    `old session before reset ${okBefore}; after reset /portal -> ${afterReset.status} ${loc}; old session then changed the password -> ${take.location}; real student's fresh temp password now logs in -> ${oldPwWorks}; attacker's chosen password logs in -> ${attackerWorks}`);
  await ensureAccount({ identifier: "2021903", role: "STUDENT", displayName: "2021903" }); // restore
}

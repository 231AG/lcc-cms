// F: CSRF (Origin check on Server Actions), error leakage, redirects. LOCAL ONLY.
import { APP, actions, login, req, sql, record, Jar } from "./lib.mjs";
const reg = await login("registrar");
const a = actions.createCollegeAction;
const mk = (code) => { const fd = new FormData(); fd.append(`$ACTION_ID_${a.id}`, ""); fd.append("name", "CSRF probe " + code); fd.append("code", code); return fd; };
const count = (code) => sql(`select count(*) from app.college where code='${code}'`)[0][0];
const post = (headers, code) => fetch(`${APP}/admin/structure`, { method: "POST", redirect: "manual", headers: { cookie: reg.jar.header(), ...headers }, body: mk(code) });

let r = await post({ Origin: "https://evil.example" }, "CSRF1");
record("F-csrf-origin", "Server Action POST with a foreign Origin header is rejected", count("CSRF1") === "0" ? "PASS" : "FAIL", `status ${r.status}, row created: ${count("CSRF1")}`);
r = await post({ Origin: "https://evil.example", Host: "127.0.0.1:3100", "X-Forwarded-Host": "evil.example" }, "CSRF2");
record("F-csrf-xfh", "Foreign Origin + attacker-chosen X-Forwarded-Host (only a client that controls its own headers can send this; a victim browser cannot)", "INFO", `status ${r.status}, row created: ${count("CSRF2")}`);
r = await post({ Origin: "null" }, "CSRF3");
record("F-csrf-null", "Origin: null (sandboxed iframe / data: form) is rejected", count("CSRF3") === "0" ? "PASS" : "FAIL", `status ${r.status}, row created: ${count("CSRF3")}`);
r = await post({}, "CSRF4");
record("F-csrf-noorigin", "No Origin header at all (non-browser client)", "INFO", `status ${r.status}, row created: ${count("CSRF4")} (browsers always send Origin on cross-site POST; this is the normal curl/test path)`);
// cross-site cookie flags decide whether a cross-site form post carries the session at all
// error leakage
const bogus = await fetch(`${APP}/admin/structure`, { method: "POST", headers: { "Next-Action": "deadbeef", "Content-Type": "text/plain" }, body: "[]" });
record("F-err-bogus-action", "Unknown Server Action id returns a bare error", bogus.status < 500 || !/at |node_modules|Error:/.test(await bogus.clone().text()) ? "PASS" : "FAIL", `status ${bogus.status}: ${(await bogus.text()).slice(0, 80)}`);
const t = await (await req("/api/students/not-a-uuid/photo", { jar: reg.jar })).text();
record("F-err-badid", "Malformed id on the photo route does not leak SQL or a stack", /Failed query|select |at \w+|postgres/i.test(t) ? "FAIL" : "PASS", `body: ${t.slice(0, 100) || "(empty)"}`);
const t2 = await req("/admin/students/not-a-uuid", { jar: reg.jar });
const b2 = await t2.text();
record("F-err-badpage", "Malformed id on a page does not leak SQL or a stack", /Failed query|select "|node_modules|at \w+ \(/i.test(b2) ? "FAIL" : "PASS", `status ${t2.status}`);
// open redirect on login
const lr = await fetch(`${APP}/login?next=https://evil.example&redirect=https://evil.example&returnTo=//evil.example`, { redirect: "manual" });
record("F-open-redirect", "Login page does not honour next/redirect parameters to other origins", /evil/.test(lr.headers.get("location") ?? "") ? "FAIL" : "PASS", `status ${lr.status}`);
// double-slash / backslash redirects after login
const l2 = await (await import("./lib.mjs")).callAction("loginAction", { identifier: "registrar", password: "Audit-Local-Pass-1", next: "//evil.example", redirectTo: "https://evil.example" }, { jar: new Jar() });
record("F-open-redirect-post", "Login action ignores a posted next/redirectTo", /evil/.test(l2.location ?? "") ? "FAIL" : "PASS", `-> ${l2.location}`);

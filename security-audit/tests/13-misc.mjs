// D/F misc: upload type sniffing, audit-log contents, session ping. LOCAL ONLY.
import { APP, actions, login, req, sql, record, Jar } from "./lib.mjs";
const reg = await login("registrar");
const sid = sql("select id from app.app_user where login_identifier='2021903'")[0][0];
const up = async (bytes, type, name) => {
  const fd = new FormData(); fd.append(`$ACTION_ID_${actions.uploadStudentPhotoAction.id}`, ""); fd.append("studentId", sid); fd.append("photo", new Blob([bytes], { type }), name);
  const r = await fetch(`${APP}/admin/students/${sid}`, { method: "POST", redirect: "manual", headers: { cookie: reg.jar.header() }, body: fd });
  return decodeURIComponent((r.headers.get("location") ?? "").replace(/\+/g, " ")) + ` [${r.status}]`;
};
const svg = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>`);
const html = new TextEncoder().encode(`<html><script>alert(1)</script></html>`);
const poly = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode("<script>alert(1)</script>")]);   // JPEG magic + script
for (const [label, bytes, type, name] of [["SVG claiming image/png", svg, "image/png", "a.png"], ["HTML claiming image/jpeg", html, "image/jpeg", "a.jpg"], ["SVG as image/svg+xml", svg, "image/svg+xml", "a.svg"]]) {
  const m = await up(bytes, type, name);
  const stored = sql(`select content_type from app.student_photo where student_id='${sid}'`)[0]?.[0];
  record(`D-upload-${label.split(" ")[0]}`, `Upload: ${label} is rejected`, /error=/.test(m) ? "PASS" : "FAIL", `${m.slice(-90)} stored type=${stored}`);
}
const m = await up(poly, "image/jpeg", "p.jpg");
const stored = sql(`select content_type, byte_size from app.student_photo where student_id='${sid}'`)[0];
const served = await req(`/api/students/${sid}/photo`, { jar: reg.jar });
console.log("polyglot (JPEG magic + <script>):", m.slice(-80), "stored", stored, "served", served.status, served.headers.get("content-type"), "nosniff:", served.headers.get("x-content-type-options"), "CD:", served.headers.get("content-disposition"));
record("D-upload-polyglot", "JPEG-magic file with script payload: served only as image/jpeg with nosniff", !stored || (served.headers.get("content-type") === "image/jpeg" && served.headers.get("x-content-type-options") === "nosniff") ? "PASS" : "FAIL", `stored=${stored} served ct=${served.headers.get("content-type")}`);
sql(`delete from app.student_photo where student_id='${sid}'`);

// audit log must not hold secrets
const pw = sql(`select action, count(*) from audit.audit_log where (coalesce(old_value::text,'') || coalesce(new_value::text,'') || coalesce(reason,'')) ~* '(password|temporary|secret|token)' and (coalesce(old_value::text,'') || coalesce(new_value::text,'')) !~* '^\\{"must_change_password"' group by 1`);
console.log("audit rows mentioning password/secret/token:", JSON.stringify(pw));
const leaked = sql(`select count(*) from audit.audit_log where (coalesce(old_value::text,'') || coalesce(new_value::text,'')) ~ '[A-Za-z0-9]{10}' and (coalesce(old_value::text,'')||coalesce(new_value::text,'')) ~* '(temporaryPassword|"password"|tempPass)'`)[0][0];
record("D-audit-no-secrets", "Audit log never records a password value", leaked === "0" ? "PASS" : "FAIL", `rows with a password-like field: ${leaked}`);
// session ping
const p1 = await fetch(`${APP}/api/session/ping`, { method: "POST" });
const p2 = await fetch(`${APP}/api/session/ping`, { method: "POST", headers: { cookie: reg.jar.header() } });
console.log("ping anon:", p1.status, "ping signed-in:", p2.status, p2.headers.getSetCookie?.().map((c) => c.split("=")[0]));

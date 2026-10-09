// D/E: stored-XSS probes, hostile search strings, semester state-machine abuse. LOCAL ONLY.
import { callAction, login, req, sql, record } from "./lib.mjs";
const reg = await login("registrar");
const sa = await login("sa.audit");
const stu = sql("select id, department_id from app.student where student_number='2021903'")[0];
const XSS = `"><img src=x onerror=alert(1)><script>alert(2)</script>`;
// --- stored XSS: put hostile markup in the profile text fields
const up = await callAction("updateStudentProfileAction", {
  studentId: stu[0], studentNumber: "2021903", firstName: XSS, middleName: "<b>m</b>", lastName: "O'Brien <svg onload=alert(3)>",
  departmentId: stu[1], enrolmentYear: "2021", status: "ACTIVE", gender: "FEMALE",
  address: XSS, parentGuardian: XSS, countyOfOrigin: XSS, degree: XSS, minor: XSS,
}, { jar: reg.jar, page: `/admin/students/${stu[0]}` });
console.log("profile update:", up.status, decodeURIComponent((up.location ?? "").replace(/\+/g, " ")).slice(0, 120));
const stored = sql(`select first_name, address from app.student where id='${stu[0]}'`)[0];
console.log("stored first_name:", stored[0].slice(0, 60));
const sem = sql("select id from app.semester where state='CLOSED' limit 1")[0][0];
const pages = [`/admin/students`, `/admin/students/${stu[0]}`, `/admin/transcripts?studentId=${stu[0]}`, `/admin/students/${stu[0]}/grade-sheet/${sem}`, `/admin/students?q=${encodeURIComponent(XSS)}`, `/admin/students/print`];
let raw = 0, detail = [];
for (const p of pages) {
  const t = await (await req(p, { jar: reg.jar })).text();
  const hits = (t.match(/<img src=x onerror|<script>alert|<svg onload/g) ?? []).length;
  raw += hits; detail.push(`${p.replace(stu[0], "<id>").slice(0, 40)}:${hits}`);
}
const asStudent = await login("2021903");
const sp = await (await req("/portal", { jar: asStudent.jar })).text();
const spt = await (await req("/portal/transcript", { jar: asStudent.jar })).text();
raw += (sp.match(/<img src=x onerror|<script>alert|<svg onload/g) ?? []).length + (spt.match(/<img src=x onerror|<script>alert|<svg onload/g) ?? []).length;
record("D-xss-stored", "Hostile markup in student fields is rendered as text on every page", raw === 0 ? "PASS" : "FAIL", `unescaped occurrences: ${raw} (${detail.join(", ")}, portal, transcript)`);
// restore the name
await callAction("updateStudentProfileAction", { studentId: stu[0], studentNumber: "2021903", firstName: "Christiana", middleName: "", lastName: "Tarnue-Johnson", departmentId: stu[1], enrolmentYear: "2021", status: "ACTIVE", gender: "FEMALE", address: "", parentGuardian: "", countyOfOrigin: "", degree: "", minor: "" }, { jar: reg.jar, page: `/admin/students/${stu[0]}` });

// --- hostile search / pagination strings must not 500
const bad = ["%", "_", "%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%", "' OR 1=1 --", "\\", "a".repeat(5000), "\u0000", "💥"];
let fails = [];
for (const q of bad) { const r = await req(`/admin/students?q=${encodeURIComponent(q)}&page=999999999999&pageSize=-1`, { jar: reg.jar }); if (r.status >= 500) fails.push(JSON.stringify(q.slice(0, 20)) + "→" + r.status); }
record("D-search-hostile", "Hostile search strings and absurd page numbers do not crash the student list", fails.length ? "FAIL" : "PASS", fails.join("; ") || "all 200");
const aud = await req(`/admin/audit?page=999999999&actor=%27&action=%25&from=notadate&to=9999-99-99`, { jar: sa.jar });
record("D-audit-filters", "Audit log filters with garbage values do not crash", aud.status >= 500 ? "FAIL" : "PASS", `status ${aud.status}`);

// --- semester state machine abuse
const closed = sql("select id from app.semester where state='CLOSED' limit 1")[0][0];
const open = sql("select id from app.semester where state='OPEN' and id not in ('5cc65eb0-d028-4c29-af88-c41bb858dea1') limit 1")[0][0];
const draft = sql("select id from app.semester where state='DRAFT' limit 1")?.[0]?.[0];
const tr = async (jar, id, to, reason = "audit") => { const r = await callAction("transitionSemesterAction", { semesterId: id, toState: to, reason }, { jar, page: "/admin/calendar" }); return decodeURIComponent((r.location ?? "").replace(/\+/g, " ")); };
const stateOf = (id) => sql(`select state from app.semester where id='${id}'`)[0][0];
const cases = [
  ["admin: CLOSED -> OPEN", reg.jar, closed, "OPEN"], ["admin: CLOSED -> IN_PROGRESS (reopen)", reg.jar, closed, "IN_PROGRESS"], ["admin: CLOSED -> DRAFT", reg.jar, closed, "DRAFT"],
  ["admin: OPEN -> CLOSED (skips a step)", reg.jar, open, "CLOSED"], ["admin: OPEN -> DRAFT (backwards)", reg.jar, open, "DRAFT"], ["admin: OPEN -> BOGUS", reg.jar, open, "BOGUS"],
  ["SA: OPEN -> IN_PROGRESS", sa.jar, open, "IN_PROGRESS"],
];
for (const [label, jar, id, to] of cases) {
  const before = stateOf(id); const msg = await tr(jar, id, to); const after = stateOf(id);
  const legal = (label.startsWith("SA: OPEN -> IN_PROGRESS")) ;
  record(`E-sem-${label.replace(/\W+/g, "_")}`, `Semester ${label}`, (legal ? after === "IN_PROGRESS" : after === before) ? "PASS" : "FAIL", `${before} -> ${after} ${msg.slice(-90)}`);
}
// SA reopening a CLOSED semester: needs reason; admin cannot
const noReason = await tr(sa.jar, closed, "IN_PROGRESS", "");
console.log("SA reopen without reason:", stateOf(closed), noReason.slice(-80));
const closedAfter = stateOf(closed);
record("E-sem-reopen-needs-reason", "Reopening a CLOSED semester without a reason is refused", closedAfter === "CLOSED" ? "PASS" : "FAIL", `${closedAfter}`);

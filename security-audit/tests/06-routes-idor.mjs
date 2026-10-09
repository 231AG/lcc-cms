// B: page/route access by role, and student-vs-student (IDOR) probes. LOCAL ONLY.
import { writeFileSync } from "node:fs";
import { req, callAction, login, Jar, sql, record } from "./lib.mjs";

const one = (q) => sql(q)[0]?.[0];
const A = one("select id from app.app_user where login_identifier='2020901'");
const B = one("select id from app.app_user where login_identifier='2024902'");
const victimPlan = one("select p.id from app.course_plan p join app.app_user u on u.id=p.student_id where u.login_identifier='20261212'");
const victimItem = one(`select id from app.course_plan_item where plan_id='${victimPlan}' limit 1`);
const victimSem = one(`select semester_id from app.course_plan where id='${victimPlan}'`);
const offering = one(`select id from app.course_offering where semester_id='${victimSem}' and status='PUBLISHED' limit 1`);
const sem = one("select id from app.semester where state='CLOSED' limit 1");
const sub = one("select id from app.grade_submission limit 1") ?? "00000000-0000-4000-8000-000000000000";
const photoStudent = one("select student_id from app.student_photo limit 1");

const who = { anonymous: new Jar(), student: (await login("2020901")).jar, admin: (await login("registrar")).jar, super_admin: (await login("sa.audit")).jar };

// ---- pages ---------------------------------------------------------------
const pages = [
  "/", "/login", "/access-denied", "/portal", "/portal/grades", "/portal/transcript", `/portal/grade-sheet/${sem}`, "/planning", "/grading-policy", "/change-password",
  "/admin/students", `/admin/students/${B}`, `/admin/students/${B}/grade-sheet/${sem}`, "/admin/students/print", "/admin/accounts", "/admin/audit", "/admin/calendar",
  "/admin/export", `/admin/export/${sem}/print`, "/admin/grade-corrections", "/admin/grade-review", `/admin/grade-review/${sub}`, "/admin/grades", "/admin/historical",
  "/admin/historical/import", "/admin/login-slips", "/admin/no-grades", "/admin/offerings", "/admin/offerings/print", "/admin/planning", `/admin/planning/${victimPlan}`,
  `/admin/planning/${victimPlan}/control-sheet`, "/admin/registrations", "/admin/structure", "/admin/structure/import", "/admin/student-grades", "/admin/student-plan", "/admin/transcripts",
  `/admin/transcripts?studentId=${B}`, "/admin/historical/progress", "/api/health", "/api/session/ping",
];
const routes = [`/api/students/${A}/photo`, `/api/students/${B}/photo`, photoStudent ? `/api/students/${photoStudent}/photo` : null, `/admin/export/${sem}`, `/admin/export/${sem}/results`, "/admin/offerings/export", "/admin/students/export"].filter(Boolean);
const rows = [];
for (const p of [...pages, ...routes]) {
  const o = { path: p };
  for (const [role, jar] of Object.entries(who)) {
    const r = await req(p, { jar: role === "anonymous" ? new Jar() : jar });
    const t = await r.text();
    const denied = /Not available to your role|You do not have access|access-denied/i.test(t) ? " [denied-page]" : "";
    o[role] = `${r.status}${r.headers.get("location") ? "->" + r.headers.get("location").replace(/^https?:\/\/[^/]+/, "") : ""}${denied}${/text\/csv/.test(r.headers.get("content-type") ?? "") ? " [CSV " + t.length + "B]" : ""}${/^image\//.test(r.headers.get("content-type") ?? "") ? " [IMAGE]" : ""}`;
  }
  rows.push(o);
}
writeFileSync(new URL("./results/06-pages.json", import.meta.url), JSON.stringify(rows, null, 1));
for (const o of rows) console.log(o.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>").padEnd(46), "|", o.anonymous.padEnd(22), "|", o.student.padEnd(34), "|", o.admin.padEnd(26), "|", o.super_admin);

// ---- student A vs student B / victim's plan ------------------------------
const before = sql(`select status, (select count(*) from app.course_plan_item where plan_id='${victimPlan}') from app.course_plan where id='${victimPlan}'`)[0];
const jarA = who.student;
const res = {};
res.add = await callAction("addPlanItemAction", { planId: victimPlan, offeringId: offering, semesterId: victimSem }, { jar: jarA });
res.remove = await callAction("removePlanItemAction", { planItemId: victimItem, semesterId: victimSem }, { jar: jarA });
res.submit = await callAction("submitPlanAction", { planId: victimPlan, semesterId: victimSem }, { jar: jarA });
res.del = await callAction("deleteDraftPlanAction", { planId: victimPlan, semesterId: victimSem }, { jar: jarA });
const after = sql(`select status, (select count(*) from app.course_plan_item where plan_id='${victimPlan}') from app.course_plan where id='${victimPlan}'`)[0] ?? ["GONE", "0"];
for (const [k, r] of Object.entries(res)) console.log("  A->victim", k.padEnd(7), r.status, decodeURIComponent((r.location ?? "").replace(/\+/g, " ")).slice(0, 120));
console.log("  victim plan before/after:", before.join("/"), "->", after.join("/"));
record("B2", "Student cannot add/remove/submit/delete another student's course plan", before.join() === after.join() ? "PASS" : "FAIL", `before=${before.join("/")} after=${after.join("/")}`);

const phB = await req(`/api/students/${B}/photo`, { jar: jarA });
record("B3", "Student A cannot fetch student B's photo", phB.status === 200 ? "FAIL" : "PASS", `status ${phB.status}`);

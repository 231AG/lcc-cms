// B: every server action x {anonymous, student, admin, super admin}, with
// harmless garbage input (non-existent ids). LOCAL ONLY (lib.mjs refuses
// non-loopback targets). Classifies each call:
//   DENIED   = refused before any business logic ("Not available to your role",
//              redirect to /login or /access-denied)
//   ERROR500 = the action threw (unhandled)
//   REACHED  = got past the authorization gate (validation / not-found / etc.)
import { writeFileSync } from "node:fs";
import { actions, callAction, callRpc, postForm, req, login, Jar, sql, record } from "./lib.mjs";

const ZERO = "00000000-0000-4000-8000-000000000000";
const studentId = sql("select id from app.app_user where login_identifier='2020901'")[0][0];
const semId = sql("select id from app.semester limit 1")[0]?.[0] ?? ZERO;

const idFields = ["id", "studentId", "semesterId", "offeringId", "courseId", "collegeId", "departmentId", "planId", "planItemId",
  "itemId", "submissionId", "correctionId", "userId", "accountId", "academicYearId", "meetingId", "recordId", "registrationId", "prerequisiteId", "requiredCourseId"];
const fields = Object.fromEntries(idFields.map((k) => [k, ZERO]));
Object.assign(fields, { label: "x", name: "x", code: "X1", reason: "audit", decision: "x", toState: "OPEN", password: "x", identifier: "x", displayName: "x", role: "ADMIN" });

const who = {
  anonymous: new Jar(),
  student: (await login("2020901")).jar,
  admin: (await login("registrar")).jar,
  super_admin: (await login("sa.audit")).jar,
};

const skip = new Set(["loginAction", "signOutAction", "changePasswordAction"]);
const manual = { studentId: ZERO, yearLabel: "2000/2001", sequence: 1, rows: [], confirmed: false };
const rpcArgs = {
  previewGradeSheetImportAction: [""],
  commitGradeSheetImportAction: ["", "x.csv", false, false],
  checkManualEntryAction: [manual],
  saveManualEntryAction: [manual],
  previewCourseImportAction: [""],
  commitCourseImportAction: ["", {}],
  issueLoginSlipsAction: [[ZERO]],
  logGradeSheetPrintAction: [studentId, semId],
  logTranscriptPrintAction: [studentId],
  logSemesterPrintAction: [semId],
  logOwnTranscriptPrintAction: [],
};
// useActionState forms: replay the hidden fields the server renders.
const statePages = { createStaffAccountAction: "/admin/accounts", enrollStudentAction: "/admin/students", resetStudentPasswordAction: `/admin/students/${studentId}` };
const stateExtra = {
  createStaffAccountAction: [["identifier", "x"], ["displayName", "x"], ["role", "ADMIN"]],
  enrollStudentAction: [["studentNumber", "x"]],
  resetStudentPasswordAction: [["studentId", ZERO]],
};
// What React's progressive-enhancement form posts for a useActionState action.
const stateFields = Object.fromEntries(Object.keys(statePages).map((name) => [name, [
  ["$ACTION_REF_1", ""],
  ["$ACTION_1:0", JSON.stringify({ id: actions[name].id, bound: "$@1" })],
  ["$ACTION_1:1", "[{}]"],
]]));

const classify = (r, loc) => {
  const body = r.text;
  if (/\/login|\/access-denied/.test(loc)) return "DENIED(login/denied-redirect)";
  if (/Not available to your role/i.test(loc + body)) return "DENIED(forbidden)";
  if (r.status >= 500) return "ERROR500";
  return "REACHED";
};

const rows = [];
for (const [name, a] of Object.entries(actions)) {
  if (skip.has(name)) continue;
  const page = a.pages.find((p) => !p.includes("[")) ?? a.pages[0].replace("[id]", studentId).replace("[semesterId]", semId).replace("[planId]", ZERO).replace("[submissionId]", ZERO);
  const out = { name, file: a.file, page };
  for (const [role, jar0] of Object.entries(who)) {
    const jar = role === "anonymous" ? new Jar() : jar0;
    let r;
    try {
      if (statePages[name]) {
        if (!stateFields[name]) { out[role] = "ERR no form fields"; continue; }
        r = await postForm(statePages[name], [...stateFields[name], ...stateExtra[name]], { jar });
      } else if (rpcArgs[name]) r = await callRpc(name, rpcArgs[name], { jar, page });
      else r = await callAction(name, fields, { jar, page });
    } catch (e) { out[role] = "ERR " + e.message; continue; }
    const loc = r.location ? decodeURIComponent(r.location.replace(/\+/g, " ")) : "";
    out[role] = `${classify(r, loc)} [${r.status}${loc ? " -> " + loc.slice(0, 90) : ""}]${r.status === 200 ? " " + r.text.replace(/\s+/g, " ").slice(0, 110) : ""}`;
  }
  rows.push(out);
}
writeFileSync(new URL("./results/03-authz.json", import.meta.url), JSON.stringify(rows, null, 1));
const short = (s) => s.startsWith("DENIED") ? "deny " : s.startsWith("REACHED") ? "REACH" : s.startsWith("ERROR500") ? "500  " : "ERR  ";
console.log("action".padEnd(40), "anon  stud  admin super");
for (const r of rows) console.log(r.name.padEnd(40), short(r.anonymous), short(r.student), short(r.admin), short(r.super_admin));
const anonReach = rows.filter((r) => r.anonymous.startsWith("REACHED"));
record("B1", "No server action runs for an anonymous caller", anonReach.length ? "FAIL" : "PASS", anonReach.map((r) => r.name).join(", "));
const anon500 = rows.filter((r) => r.anonymous.startsWith("ERROR500")).length;
record("B1b", "Anonymous call to an action ends in an unhandled 500 (not a redirect)", anon500 ? "INFO" : "PASS", `${anon500} of ${rows.length} actions`);

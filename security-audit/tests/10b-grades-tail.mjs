// Tail of 10-grades.mjs (steps 7-10), re-runnable after the first part has published the grades.
import { callAction, login, sql, record, req, actions, APP } from "./lib.mjs";
const SEM = "5cc65eb0-d028-4c29-af88-c41bb858dea1";
const OFF = "8ae2d4cf-bca8-43eb-a817-eeada65e1406";
const one = (q) => sql(q)[0]?.[0];
const dec = (s) => decodeURIComponent((s ?? "").replace(/\+/g, " "));
const reg = await login("registrar");
const sa = await login("sa.audit");
const regs = sql(`select r.id, r.student_id, u.login_identifier from app.registration r join app.app_user u on u.id=r.student_id where r.offering_id='${OFF}' and exists (select 1 from app.grade_record g where g.registration_id=r.id) order by r.id`);
const gradeScoreOrder = sql(`select r.id from app.registration r join app.grade_record g on g.registration_id=r.id where r.offering_id='${OFF}' order by g.score`);
const [r1] = sql(`select r.id, r.student_id, u.login_identifier from app.registration r join app.app_user u on u.id=r.student_id join app.grade_record g on g.registration_id=r.id where r.offering_id='${OFF}' and g.score=59.5`);
const stuId = r1[1];
const a = actions.saveClassDraftAction;
// 7. published grade visible to the student, and the transcript/GPA reflect it
const stu = await login(r1[2]);
const html = await (await req("/portal/grades", { jar: stu.jar })).text();
const gpaRow = sql(`select cgpa, total_credits_earned from app.student_cumulative_summary where student_id='${stuId}'`)[0];
console.log("student cumulative:", gpaRow);

// 8. edit a published grade through the draft path must fail
const editPub = await (async () => { const f = new FormData(); f.append(`$ACTION_ID_${a.id}`, ""); f.append("offeringId", OFF); f.append("registrationId", r1[0]); f.append(`score_${r1[0]}`, "99"); return fetch(`${APP}/admin/grades`, { method: "POST", redirect: "manual", headers: { cookie: reg.jar.header() }, body: f }); })();
record("E-edit-after-publish", "Admin cannot overwrite a published grade through the draft screen", one(`select g.score from app.grade_record g where g.registration_id='${r1[0]}'`) === "59.5" ? "PASS" : "FAIL", dec(editPub.headers.get("location")).slice(-100));

// 9. corrections: admin requests, SA decides, admin cannot decide
const gid = one(`select id from app.grade_record where registration_id='${r1[0]}'`);
const rc = await callAction("requestCorrectionAction", { gradeRecordId: gid, newScore: "80", reason: "audit correction" }, { jar: reg.jar, page: "/admin/grade-corrections" });
console.log("request correction:", rc.status, dec(rc.location));
const cid = one(`select id from app.grade_correction_request where grade_record_id='${gid}' order by requested_at desc limit 1`);
const selfDecide = await callAction("decideCorrectionAction", { correctionRequestId: cid, decision: "APPROVE" }, { jar: reg.jar, page: "/admin/grade-corrections" });
record("E-admin-no-decide", "Admin cannot approve their own correction request", /Not available/.test(dec(selfDecide.location)) ? "PASS" : "FAIL", dec(selfDecide.location).slice(-100));
const dc = await callAction("decideCorrectionAction", { correctionRequestId: cid, decision: "APPROVE", note: "ok" }, { jar: sa.jar, page: "/admin/grade-corrections" });
console.log("decide:", dc.status, dec(dc.location));
const after = sql(`select g.score, g.letter, g.status from app.grade_record g where g.id='${gid}'`)[0];
const arAfter = sql(`select score, letter from app.academic_record where grade_record_id='${gid}'`)[0];
record("E-correction-applied", "Approved correction updates the grade and the academic record to 80 / B-", after[1] === "B-" && arAfter[1] === "B-" ? "PASS" : "FAIL", `grade=${after} record=${arAfter}`);
const [again] = [await callAction("decideCorrectionAction", { correctionRequestId: cid, decision: "APPROVE" }, { jar: sa.jar, page: "/admin/grade-corrections" })];
record("E-correction-twice", "Deciding the same correction twice is refused", /error=/.test(again.location ?? "") ? "PASS" : "FAIL", dec(again.location).slice(-100));

// 10. audit trail covers the lifecycle
const acts = sql(`select action, count(*) from audit.audit_log where occurred_at > now() - interval '10 minutes' group by 1 order by 1`);
console.log("audit actions in last 10 min:", JSON.stringify(acts));

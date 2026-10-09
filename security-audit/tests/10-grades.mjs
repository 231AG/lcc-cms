// E: grade lifecycle end to end on the LOCAL database: DRAFT -> SUBMITTED -> PUBLISHED, corrections,
// visibility to the student, bad inputs, double approval, audit trail. LOCAL ONLY.
import { callAction, login, sql, record, req } from "./lib.mjs";

const SEM = "5cc65eb0-d028-4c29-af88-c41bb858dea1";
const OFF = "8ae2d4cf-bca8-43eb-a817-eeada65e1406";
const one = (q) => sql(q)[0]?.[0];
const dec = (s) => decodeURIComponent((s ?? "").replace(/\+/g, " "));
const reg = await login("registrar");
const sa = await login("sa.audit");

// 1. open the semester for grading (OPEN -> IN_PROGRESS)
let r = await callAction("transitionSemesterAction", { semesterId: SEM, toState: "IN_PROGRESS", reason: "audit local test" }, { jar: reg.jar, page: "/admin/calendar" });
console.log("transition:", r.status, dec(r.location));
const state = one(`select state from app.semester where id='${SEM}'`);
if (state !== "IN_PROGRESS") { console.log("semester state is", state, "- cannot continue"); process.exit(1); }

const regs = sql(`select r.id, r.student_id, u.login_identifier from app.registration r join app.app_user u on u.id=r.student_id where r.offering_id='${OFF}' order by r.id`);
const [r1, r2, r3, r4] = regs;
const save = (fields, jar = reg.jar) => callAction("saveClassDraftAction", { offeringId: OFF, ...fields }, { jar, page: "/admin/grades" });

// 2. bad score inputs: friendly error or crash?
for (const bad of ["abc", "101", "-1", "NaN", "1e3", "Infinity", "0x10", "59,5"]) {
  const x = await save({ registrationId: r1[0], [`score_${r1[0]}`]: bad });
  const verdict = x.status === 500 ? "FAIL" : "PASS";
  record(`E-score-${bad}`, `Grade entry with score "${bad}"`, verdict, `status ${x.status} ${dec(x.location).slice(-90)}`);
}
const stored = sql(`select count(*) from app.grade_record where registration_id='${r1[0]}'`)[0][0];
record("E-score-none-stored", "No grade row was stored by any of the invalid scores", stored === "0" ? "PASS" : "FAIL", `rows=${stored}`);

// 3. valid scores incl. the rounding edges
const ok = await save({ registrationId: [r1[0], r2[0], r3[0]].join(","), [`score_${r1[0]}`]: "59.46", [`score_${r2[0]}`]: "94.45", [`score_${r3[0]}`]: "100" });
// formData.getAll("registrationId") needs repeated fields - callAction takes plain pairs, so add them one by one:
const fd = new FormData();
const a = (await import("./lib.mjs")).actions.saveClassDraftAction;
fd.append(`$ACTION_ID_${a.id}`, ""); fd.append("offeringId", OFF);
for (const [id, s] of [[r1[0], "59.46"], [r2[0], "94.45"], [r3[0], "100"]]) { fd.append("registrationId", id); fd.append(`score_${id}`, s); }
const { APP } = await import("./lib.mjs");
const saved = await fetch(`${APP}/admin/grades`, { method: "POST", redirect: "manual", headers: { cookie: reg.jar.header() }, body: fd });
console.log("save drafts:", saved.status, dec(saved.headers.get("location")));
const rows = sql(`select r.id, g.score, g.letter, g.status from app.grade_record g join app.registration r on r.id=g.registration_id where r.offering_id='${OFF}' order by g.score`);
console.log("grade rows:", JSON.stringify(rows));
record("E-round-letter", "59.46 -> F, 94.45 -> A-, 100 -> A+", rows.map((x) => x[2]).sort().join() === "A+,A-,F" ? "PASS" : "FAIL", JSON.stringify(rows.map((x) => [x[1], x[2]])));

// 4. a student cannot see a DRAFT grade (DB level and page)
const stuId = r1[1];
const visible = sql(`begin; select set_config('request.jwt.claim.sub','${stuId}',true); set local role authenticated; select count(*) from app.grade_record; rollback;`).flat().filter((x) => /^\d+$/.test(x))[0];
record("E-draft-hidden", "A student cannot read their own DRAFT grade row", visible === "0" ? "PASS" : "FAIL", `visible rows for the student at DB level: ${visible}`);

// 5. submit, then edit after submit must fail
const sub = await callAction("submitClassAction", { offeringId: OFF, confirmPartial: "on", partialNote: "audit partial" }, { jar: reg.jar, page: "/admin/grades" });
console.log("submit:", sub.status, dec(sub.location));
const submission = sql(`select id, status from app.grade_submission where offering_id='${OFF}'`)[0];
console.log("submission:", submission);
const edit = await (async () => { const f = new FormData(); f.append(`$ACTION_ID_${a.id}`, ""); f.append("offeringId", OFF); f.append("registrationId", r1[0]); f.append(`score_${r1[0]}`, "99"); const x = await fetch(`${APP}/admin/grades`, { method: "POST", redirect: "manual", headers: { cookie: reg.jar.header() }, body: f }); return x; })();
const afterEdit = one(`select g.score from app.grade_record g where g.registration_id='${r1[0]}'`);
record("E-edit-after-submit", "Admin cannot change a score after it was submitted", afterEdit === "59.5" ? "PASS" : "FAIL", `score now ${afterEdit}; response ${dec(edit.headers.get("location")).slice(-100)}`);

// 6. admin cannot approve; SA can; double approval is harmless
const sid = submission[0];
const adminApprove = await callAction("approveSubmissionAction", { submissionId: sid }, { jar: reg.jar, page: `/admin/grade-review/${sid}` });
record("E-admin-no-approve", "Admin cannot approve (publish) grades", /Not available/.test(dec(adminApprove.location)) ? "PASS" : "FAIL", dec(adminApprove.location).slice(-100));
const [ap1, ap2] = await Promise.all([1, 2].map(() => callAction("approveSubmissionAction", { submissionId: sid }, { jar: sa.jar, page: `/admin/grade-review/${sid}` })));
console.log("approve x2:", ap1.status, dec(ap1.location).slice(-80), "|", ap2.status, dec(ap2.location).slice(-80));
const ar = sql(`select count(*), count(distinct grade_record_id) from app.academic_record where grade_record_id in (select id from app.grade_record where submission_id='${sid}')`)[0];
record("E-double-approve", "Approving twice in parallel yields one academic record per grade", ar[0] === ar[1] && ar[0] === "3" ? "PASS" : "FAIL", `records=${ar[0]} distinct=${ar[1]}`);
const st = sql(`select g.status from app.grade_record g join app.registration r on r.id=g.registration_id where r.offering_id='${OFF}'`).flat().join();
console.log("grade statuses:", st);

// 7. published grade visible to the student, and the transcript/GPA reflect it
const stu = await login(r1[2]);
const html = await (await req("/portal/grades", { jar: stu.jar })).text();
const gpaRow = sql(`select cumulative_gpa from app.student_cumulative_summary where student_id='${stuId}'`)[0];
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

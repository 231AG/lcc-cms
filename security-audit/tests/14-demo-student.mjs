// Local check of the demo student created by docs/demo/create-demo-student-2026999.sql
import { login, req, callAction, sql } from "./lib.mjs";
const strip = (t) => t.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const r = await login("2026999", "hawa2026");
console.log("login ->", r.location);
const g = strip(await (await req("/portal/grades", { jar: r.jar })).text());
console.log("MY GRADES:", g.slice(g.indexOf("My grades"), g.indexOf("My grades") + 700));
const p = strip(await (await req("/planning", { jar: r.jar })).text());
console.log("PLANNING:", p.slice(p.indexOf("Course planning"), p.indexOf("Course planning") + 500));
const sem = sql("select id from app.semester s where state='OPEN' and exists (select 1 from app.course_offering o join app.course c on c.id=o.course_id where o.semester_id=s.id and c.code='PADM116') limit 1")[0][0];
const s = await callAction("startPlanAction", { semesterId: sem }, { jar: r.jar, page: "/planning" });
console.log("start plan ->", s.status, decodeURIComponent((s.location ?? "").replace(/\+/g, " ")).slice(0, 100));
const offering = sql(`select o.id from app.course_offering o join app.course c on c.id=o.course_id where o.semester_id='${sem}' and c.code='PADM116'`)[0][0];
const planId = sql("select id from app.course_plan where student_id=(select id from app.app_user where login_identifier='2026999')")[0]?.[0];
const a = await callAction("addPlanItemAction", { planId, offeringId: offering, semesterId: sem }, { jar: r.jar, page: "/planning" });
console.log("add PADM116 ->", a.status, decodeURIComponent((a.location ?? "").replace(/\+/g, " ")).slice(0, 160));
const sb = await callAction("submitPlanAction", { planId, semesterId: sem }, { jar: r.jar, page: "/planning" });
console.log("submit ->", sb.status, decodeURIComponent((sb.location ?? "").replace(/\+/g, " ")).slice(0, 160));
console.log("plan status:", sql("select status from app.course_plan where id='" + planId + "'")[0][0]);

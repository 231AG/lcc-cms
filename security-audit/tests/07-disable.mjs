// B/A: disabling an account takes effect immediately for an already-open session; and what it does NOT revoke.
import { req, callAction, login, sql, record, AUTH, ANON, PASSWORD } from "./lib.mjs";
const strip = (t) => t.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const target = sql("select id from app.app_user where login_identifier='admin.b'")[0][0];
const victim = await login("admin.b");
const sa = await login("sa.audit");
const pre = strip(await (await req("/admin/students", { jar: victim.jar })).text());
const d = await callAction("disableAccountAction", { targetUserId: target }, { jar: sa.jar, page: "/admin/accounts" });
const post = strip(await (await req("/admin/students", { jar: victim.jar })).text());
const act = await callAction("createCollegeAction", { name: "Disabled Admin College", code: "DAC" }, { jar: victim.jar, page: "/admin/structure" });
const created = sql("select count(*) from app.college where code='DAC'")[0][0];
record("B4", "Disabled admin's already-open session is cut off at once", /Student Listing/.test(pre) && /Please sign in/.test(post) && created === "0" ? "PASS" : "FAIL", `before: ${/Student Listing/.test(pre)}, after shows 'Please sign in': ${/Please sign in/.test(post)}, action status ${act.status}, college created: ${created}`);
// Does the Supabase Auth user stay usable? (the app's own checks are what stop them)
const tok = await fetch(`${AUTH}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin.b@staff.lcc-eportal.invalid", password: PASSWORD }) });
const tj = await tok.json();
record("B5", "Disabling an account also disables its Supabase Auth login / revokes its tokens", tok.status === 200 ? "FAIL" : "PASS", `Supabase Auth still issues a session to the disabled user directly: HTTP ${tok.status}${tj.access_token ? " (token issued)" : ""}. Only the app's status check blocks them; DB RLS helper app.current_user_role() ignores status.`);
const audit = sql(`select action, actor_role_snapshot from audit.audit_log where entity_id='${target}' order by id desc limit 1`)[0];
record("B6", "Disable is audit-logged", audit?.[0] === "USER_DISABLED" ? "PASS" : "FAIL", String(audit));
await callAction("enableAccountAction", { targetUserId: target }, { jar: sa.jar, page: "/admin/accounts" });

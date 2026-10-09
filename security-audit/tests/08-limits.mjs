// D/BUG: input size limits. The photo cap is 2 MB and the import screens take pasted/uploaded text,
// but Next's Server Action body limit is 1 MB unless next.config sets serverActions.bodySizeLimit.
import { readFileSync } from "node:fs";
import { callAction, callRpc, login, sql, record, req } from "./lib.mjs";
const sid = sql("select id from app.app_user where login_identifier='2020901'")[0][0];
const adm = (await login("registrar")).jar;
const mk = (path) => new Blob([readFileSync(path)], { type: "image/png" });
for (const [label, path] of [["small (60x60)", "/tmp/claude-0/photo-small.png"], ["1.5 MB (under the 2 MB app cap)", "/tmp/claude-0/photo-1_5mb.png"]]) {
  const fd = new FormData();
  fd.append("studentId", sid); fd.append("photo", mk(path), "p.png");
  const a = (await import("./lib.mjs")).actions.uploadStudentPhotoAction;
  fd.append(`$ACTION_ID_${a.id}`, "");
  const { APP } = await import("./lib.mjs");
  const res = await fetch(`${APP}/admin/students/${sid}`, { method: "POST", redirect: "manual", headers: { cookie: adm.header() }, body: fd });
  const loc = decodeURIComponent((res.headers.get("location") ?? "").replace(/\+/g, " "));
  const body = (await res.text()).slice(0, 200).replace(/\s+/g, " ");
  const ok = res.status === 303 && !/error=/.test(loc);
  record(`D-photo-${label.split(" ")[0]}`, `Photo upload ${label}`, ok ? "PASS" : "FAIL", `status ${res.status} location=${loc.slice(0, 120)} body=${body.slice(0, 120)}`);
}
// large text import (e.g. a full past-grades sheet) over RPC
for (const kb of [900, 1100, 3000]) {
  const text = "x".repeat(kb * 1024);
  const r = await callRpc("previewGradeSheetImportAction", [text], { jar: adm, page: "/admin/historical/import" });
  record(`D-import-${kb}KB`, `Grade-sheet import preview with ${kb} KB of text`, r.status === 200 ? "PASS" : "FAIL", `status ${r.status} ${r.text.slice(0, 160).replace(/\s+/g, " ")}`);
}

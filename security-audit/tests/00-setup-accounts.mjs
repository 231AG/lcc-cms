// Creates the LOCAL accounts every other test uses. Safe to re-run.
import { ensureAccount, login, sql, PASSWORD } from "./lib.mjs";
const ids = {};
ids.registrar = await ensureAccount({ identifier: "registrar", role: "ADMIN", displayName: "Registrar (local)" });
ids.adminB = await ensureAccount({ identifier: "admin.b", role: "ADMIN", displayName: "Admin B (audit)" });
ids.saA = await ensureAccount({ identifier: "sa.audit", role: "SUPER_ADMIN", displayName: "Super Admin A (audit)" });
ids.saB = await ensureAccount({ identifier: "sa.b", role: "SUPER_ADMIN", displayName: "Super Admin B (audit)" });
ids.adminDisabled = await ensureAccount({ identifier: "admin.disabled", role: "ADMIN", displayName: "Disabled Admin", status: "DISABLED" });
ids.studentForced = await ensureAccount({ identifier: "2026777", role: "STUDENT", displayName: "Forced Change", mustChange: true });
for (const n of ["2020901", "2024902", "2021903"]) {
  const id = sql(`select id from app.app_user where login_identifier='${n}'`)[0]?.[0];
  if (!id) throw new Error("student " + n + " missing - rebuild sample data");
  await ensureAccount({ identifier: n, role: "STUDENT", displayName: n });
}
for (const [who, ident] of [["registrar","registrar"],["super admin","sa.audit"],["student A","2020901"],["student B","2024902"]]) {
  const r = await login(ident);
  console.log(who.padEnd(12), "->", r.status, r.location, "cookies:", [...r.jar.c.keys()].join(","));
}

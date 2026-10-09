// Calls the app's own resetStudentPassword service as the local registrar admin and
// writes the temporary password to the file given as argv[3] (never to stdout).
import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appUser } from "@/lib/db/schema";
import { resetStudentPassword } from "@/lib/students/students";

async function main() {
  const [, , studentId, outFile] = process.argv;
  const reg = await db.query.appUser.findFirst({ where: eq(appUser.loginIdentifier, "registrar") });
  const r = await resetStudentPassword({ userId: reg!.id, role: "ADMIN" }, studentId);
  writeFileSync(outFile, r.temporaryPassword, { mode: 0o600 });
}
main().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });

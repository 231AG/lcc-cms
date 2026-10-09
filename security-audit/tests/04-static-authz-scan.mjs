// Static check: every exported service function that takes an `actor` must reach
// a permission/ownership guard in its own body or via a helper it calls in the same file.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root = new URL("../../src/lib/", import.meta.url).pathname;
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== "__tests__") walk(p); } else if (/\.ts$/.test(f) && !/\.test\./.test(f)) files.push(p); } })(root);
const guard = /assertCan\(|can\(actor|requireStaff|assertOwn|actor\.role\s*(===|!==)|authorizePlanSubject|assertStudent|assertStaff|ForbiddenError|asUser\(actor/;
let total = 0; const unguarded = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const re = /export async function (\w+)\s*\(([^)]*)\)[^{]*\{/g;
  let m;
  while ((m = re.exec(src))) {
    if (!/\bactor\b/.test(m[2])) continue;
    total++;
    // body = from match to next top-level "\nexport " or "\nasync function"/"\nfunction"
    const rest = src.slice(m.index + m[0].length);
    const end = rest.search(/\n(?:export |async function |function |const \w+ = )/);
    const body = rest.slice(0, end === -1 ? undefined : end);
    if (!guard.test(body)) unguarded.push(`${f.replace(root, "src/lib/")}: ${m[1]}`);
  }
}
console.log(`${total} exported service functions take an actor; ${unguarded.length} show no guard in their own body:`);
console.log(unguarded.join("\n"));

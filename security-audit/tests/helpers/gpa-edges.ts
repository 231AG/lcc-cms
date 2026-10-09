import { deriveLetterFromScore, roundHalfUp, computeSemesterSummary } from "../../../src/lib/gpa/engine";
import { execFileSync } from "node:child_process";
const rows = execFileSync("psql", ["-h","127.0.0.1","-p","54329","-U","postgres","-d","lcc_tr","-At","-F","|","-c","select letter,min_score,max_score,grade_point,counts_in_gpa,counts_in_attempted,counts_in_earned from app.grade_scale order by display_order"], { encoding: "utf8" }).trim().split("\n").map((l) => l.split("|"));
const scale = rows.map(([letter, min, max, gp, g, a, e]) => ({ letter, minScore: min === "" ? null : +min, maxScore: max === "" ? null : +max, gradePoint: gp === "" ? null : gp, countsInGpa: g === "t", countsInAttempted: a === "t", countsInEarned: e === "t" }));
function main() {
  for (const s of [0, 0.4, 0.5, 58.9, 59, 59.4, 59.45, 59.49, 59.5, 59.6, 60, 62.5, 94.4, 94.49, 94.5, 99.5, 99.9, 100, 100.0, -0.01, 100.01, NaN, Infinity, -Infinity, 1e400]) {
    let out: string;
    try { const d = deriveLetterFromScore(s, scale); out = `${d.letter} (gp ${d.gradePoint}) stored-score=${roundHalfUp(s, 1)}  academic_record.score=${Math.round(Number(roundHalfUp(s, 1)))}`; }
    catch (e) { out = "THROWS " + (e as Error).constructor.name + ": " + (e as Error).message.slice(0, 60); }
    console.log(String(s).padEnd(9), out);
  }
}
main();

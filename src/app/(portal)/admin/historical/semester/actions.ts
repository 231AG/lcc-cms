"use server";

import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import {
  checkSemesterEdit,
  saveSemesterEdit,
  type SemesterEditCheck,
  type SemesterEditInput,
  type SemesterEditResult,
} from "@/lib/historical/semesterEdit";

/** What the browser sends, re-typed here: nothing from it is trusted. */
function clean(raw: SemesterEditInput): SemesterEditInput {
  const rows = Array.isArray(raw?.rows) ? raw.rows.slice(0, 40) : [];
  return {
    studentId: String(raw?.studentId ?? ""),
    semesterId: String(raw?.semesterId ?? ""),
    reason: String(raw?.reason ?? "").slice(0, 500),
    confirmed: raw?.confirmed === true,
    rows: rows.map((r) => {
      const nc = r?.newCourse;
      return {
        recordId: r?.recordId ? String(r.recordId) : undefined,
        code: String(r?.code ?? "").slice(0, 20),
        creditHours: Number(r?.creditHours),
        letter: String(r?.letter ?? "").slice(0, 4),
        newCourse:
          nc?.mode === "catalogue"
            ? { mode: "catalogue" as const, title: String(nc.title ?? "").slice(0, 120), departmentId: String(nc.departmentId ?? "") }
            : nc?.mode === "asPrinted"
              ? { mode: "asPrinted" as const, title: String(nc.title ?? "").slice(0, 120) }
              : undefined,
      };
    }),
  };
}

export type SemesterCheckOutcome = { ok: true; check: SemesterEditCheck } | { ok: false; error: string };
export type SemesterSaveOutcome = { ok: true; result: SemesterEditResult } | { ok: false; error: string };

export async function checkSemesterEditAction(input: SemesterEditInput): Promise<SemesterCheckOutcome> {
  const actor = await requireActor();
  try {
    return { ok: true, check: await checkSemesterEdit(actor, clean(input)) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function saveSemesterEditAction(input: SemesterEditInput): Promise<SemesterSaveOutcome> {
  const actor = await requireActor();
  try {
    return { ok: true, result: await saveSemesterEdit(actor, clean(input)) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message };
    throw err;
  }
}

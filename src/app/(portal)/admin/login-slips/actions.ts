"use server";

import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { issueLoginSlips, type IssueLoginSlipsResult } from "@/lib/identity/loginSlips";

export type IssueLoginSlipsOutcome = { ok: true; result: IssueLoginSlipsResult } | { ok: false; error: string };

/** Returned, not redirected: the new passwords exist only in this response,
 *  for the page to print. */
export async function issueLoginSlipsAction(studentIds: string[]): Promise<IssueLoginSlipsOutcome> {
  const actor = await requireActor();
  try {
    return { ok: true, result: await issueLoginSlips(actor, Array.isArray(studentIds) ? studentIds.map(String) : []) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message };
    throw err;
  }
}

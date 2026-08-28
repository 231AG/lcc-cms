"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { dropRegistration, registerDirect } from "@/lib/planning/planning";

function errorRedirect(offeringId: string, message: string): never {
  redirect(`/admin/registrations?offeringId=${offeringId}&error=${encodeURIComponent(message)}`);
}

export async function registerDirectAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const offeringId = String(formData.get("offeringId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  try {
    await registerDirect(actor, studentId, offeringId, reason);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(offeringId, err.message);
    throw err;
  }
  redirect(`/admin/registrations?offeringId=${offeringId}`);
}

export async function dropRegistrationAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const offeringId = String(formData.get("offeringId") ?? "");
  const registrationId = String(formData.get("registrationId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  try {
    await dropRegistration(actor, registrationId, reason);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(offeringId, err.message);
    throw err;
  }
  redirect(`/admin/registrations?offeringId=${offeringId}`);
}

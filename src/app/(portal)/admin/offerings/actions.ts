"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { addMeeting, cancelOffering, createOffering, publishOffering, removeMeeting, updateOffering } from "@/lib/offerings/offerings";

function errorRedirect(semesterId: string, message: string): never {
  redirect(`/admin/offerings?semesterId=${semesterId}&error=${encodeURIComponent(message)}`);
}

export async function createOfferingAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  const capacityRaw = String(formData.get("capacity") ?? "").trim();
  try {
    await createOffering(actor, {
      semesterId,
      courseId: String(formData.get("courseId") ?? ""),
      section: String(formData.get("section") ?? ""),
      instructorName: String(formData.get("instructorName") ?? ""),
      capacity: capacityRaw ? Number(capacityRaw) : undefined,
    });
  } catch (err) {
    if (err instanceof AppError) errorRedirect(semesterId, err.message);
    throw err;
  }
  redirect(`/admin/offerings?semesterId=${semesterId}`);
}

export async function updateOfferingAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  const offeringId = String(formData.get("offeringId") ?? "");
  const capacityRaw = String(formData.get("capacity") ?? "").trim();
  try {
    await updateOffering(actor, offeringId, {
      instructorName: String(formData.get("instructorName") ?? ""),
      capacity: capacityRaw ? Number(capacityRaw) : null,
    });
  } catch (err) {
    if (err instanceof AppError) errorRedirect(semesterId, err.message);
    throw err;
  }
  redirect(`/admin/offerings?semesterId=${semesterId}`);
}

export async function publishOfferingAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  const offeringId = String(formData.get("offeringId") ?? "");
  try {
    await publishOffering(actor, offeringId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(semesterId, err.message);
    throw err;
  }
  redirect(`/admin/offerings?semesterId=${semesterId}`);
}

export async function cancelOfferingAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  const offeringId = String(formData.get("offeringId") ?? "");
  try {
    await cancelOffering(actor, offeringId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(semesterId, err.message);
    throw err;
  }
  redirect(`/admin/offerings?semesterId=${semesterId}`);
}

export async function addMeetingAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  const offeringId = String(formData.get("offeringId") ?? "");
  try {
    await addMeeting(actor, offeringId, {
      dayOfWeek: Number(formData.get("dayOfWeek") ?? 0),
      startTime: String(formData.get("startTime") ?? ""),
      endTime: String(formData.get("endTime") ?? ""),
      room: String(formData.get("room") ?? ""),
    });
  } catch (err) {
    if (err instanceof AppError) errorRedirect(semesterId, err.message);
    throw err;
  }
  redirect(`/admin/offerings?semesterId=${semesterId}`);
}

export async function removeMeetingAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  const meetingId = String(formData.get("meetingId") ?? "");
  try {
    await removeMeeting(actor, meetingId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(semesterId, err.message);
    throw err;
  }
  redirect(`/admin/offerings?semesterId=${semesterId}`);
}

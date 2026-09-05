"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { addMeeting, cancelOffering, createOffering, publishOffering, removeMeeting, updateOffering } from "@/lib/offerings/offerings";
import { addPlanItem, getOrCreateDraftPlan } from "@/lib/planning/planning";

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
      courseCode: String(formData.get("courseCode") ?? ""),
      section: String(formData.get("section") ?? ""),
      // Blank instructor and capacity are left undefined rather than sent
      // as "" / NaN, so the service layer's documented defaults apply.
      instructorName: String(formData.get("instructorName") ?? ""),
      capacity: capacityRaw ? Number(capacityRaw) : undefined,
      // Checkboxes: one entry per ticked day.
      days: formData.getAll("days").map((d) => Number(d)),
      room: String(formData.get("room") ?? ""),
      startTime: String(formData.get("startTime") ?? ""),
      endTime: String(formData.get("endTime") ?? ""),
    });
  } catch (err) {
    if (err instanceof AppError) errorRedirect(semesterId, err.message);
    throw err;
  }
  redirect(`/admin/offerings?semesterId=${semesterId}`);
}

/**
 * The student-side action on the offerings table: put this offering into my
 * plan for the semester I am looking at.
 *
 * "Their current course plan" is the draft for that semester -- created on
 * the spot if they have not started one, which is what makes this a single
 * click rather than "go to Course planning, start a plan, come back". Every
 * rule still applies: getOrCreateDraftPlan and addPlanItem enforce the
 * semester being open, the plan being editable, and the duplicate and
 * prerequisite checks, so this is a shortcut through the UI, not around
 * the validators.
 */
export async function addOfferingToMyPlanAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  const offeringId = String(formData.get("offeringId") ?? "");
  try {
    const plan = await getOrCreateDraftPlan(actor, semesterId);
    await addPlanItem(actor, plan.id, offeringId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(semesterId, err.message);
    throw err;
  }
  redirect(`/admin/offerings?semesterId=${semesterId}&added=1`);
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

/**
 * Removes a whole timetable slot.
 *
 * A row in the offerings table is one room at one time, and the days it meets
 * on are collapsed into it -- so an "MWF 09:00-10:30 in B4" row is three
 * `offering_meeting` rows and removing it has to remove all three. Removing
 * only Monday's and leaving Wednesday and Friday behind would silently do a
 * third of what the button says.
 *
 * Sequential rather than parallel: `removeMeeting` audits each deletion, and
 * three of them at once through the same connection buys nothing at this size.
 */
export async function removeMeetingAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  const meetingIds = String(formData.get("meetingIds") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  try {
    for (const meetingId of meetingIds) {
      await removeMeeting(actor, meetingId);
    }
  } catch (err) {
    if (err instanceof AppError) errorRedirect(semesterId, err.message);
    throw err;
  }
  redirect(`/admin/offerings?semesterId=${semesterId}`);
}

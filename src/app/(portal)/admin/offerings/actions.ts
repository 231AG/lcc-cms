"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import {
  addMeeting,
  cancelOffering,
  createOffering,
  publishOffering,
  reinstateOffering,
  removeMeeting,
  rescheduleMeetings,
  UnknownCourseCodeError,
  updateOffering,
  deleteOffering,
} from "@/lib/offerings/offerings";
import { courseCodeKey, effectiveCourseCode } from "@/lib/courses/courseCode";

function errorRedirect(semesterId: string, message: string): never {
  redirect(`/admin/offerings?semesterId=${semesterId}&error=${encodeURIComponent(message)}`);
}

/**
 * Everything the Add-an-offering form holds, as query parameters.
 *
 * The form can come back to the user twice before anything is written --
 * once to offer to create an unknown course, once to confirm it -- and on
 * neither trip should they retype a word of what they had already filled
 * in. A GET redirect is how this app carries state between server round
 * trips everywhere else, so the whole form rides along in the URL rather
 * than the page growing a client-side store to remember it.
 */
function formStateParams(formData: FormData): URLSearchParams {
  const params = new URLSearchParams();
  const carry = ["semesterId", "courseCode", "section", "room", "startTime", "endTime", "instructorName", "capacity"];
  for (const name of carry) {
    const value = String(formData.get(name) ?? "").trim();
    if (value) params.set(name, value);
  }
  for (const day of formData.getAll("days")) params.append("days", String(day));
  for (const name of ["newCourseCode", "newTitle", "newCreditHours", "newDepartmentId"]) {
    const value = String(formData.get(name) ?? "").trim();
    if (value) params.set(name, value);
  }
  // The panel's code wins where it differs, so the round trip has to carry
  // the winner as the Course box's value too -- otherwise the confirmation
  // screen would print the code that was overridden, which is the one
  // moment this form must not be wrong about.
  const panelCode = String(formData.get("newCourseCode") ?? "").trim();
  if (panelCode) params.set("courseCode", panelCode);

  // Intent is deliberately NOT carried. Publish-or-draft is re-chosen on
  // the confirmation screen, because by then the registrar has seen what
  // the course actually is -- and that is a fair moment to change their
  // mind about making it visible to students.
  return params;
}

export async function createOfferingAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  const capacityRaw = String(formData.get("capacity") ?? "").trim();
  const courseCode = String(formData.get("courseCode") ?? "");

  // The "not on record yet" panel. Title, credit hours and department are
  // all needed before a course can be created; a half-filled panel is
  // treated as not filled at all, so a stray keystroke in one field cannot
  // start a creation.
  const newTitle = String(formData.get("newTitle") ?? "").trim();
  const newCreditHoursRaw = String(formData.get("newCreditHours") ?? "").trim();
  const newDepartmentId = String(formData.get("newDepartmentId") ?? "").trim();
  const newCourseFilled = !!(newTitle && newCreditHoursRaw && newDepartmentId);

  // The panel carries the code as well, so it reads as the whole course
  // rather than three details about a code kept somewhere else. It arrives
  // pre-filled from the Course box, and when it differs it WINS -- for the
  // course created and for the offering. That is not a silent override:
  // the panel is the more specific statement of intent, and nothing is
  // written until the confirmation step, which prints the exact code.
  const newCourseCode = String(formData.get("newCourseCode") ?? "").trim();
  const code = effectiveCourseCode(courseCode, newCourseCode);

  // Confirmation is tied to the exact code it was given for. Editing the
  // code after confirming -- the likeliest way to fix a typo, and so the
  // likeliest way to introduce a second one -- makes the confirmation
  // stale and asks again.
  const confirmedFor = String(formData.get("confirmCourse") ?? "").trim();
  const confirmed = !!confirmedFor && courseCodeKey(confirmedFor) === courseCodeKey(code);

  try {
    await createOffering(actor, {
      semesterId,
      courseCode: code,
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
      newCourse:
        newCourseFilled && confirmed
          ? { departmentId: newDepartmentId, title: newTitle, creditHours: Number(newCreditHoursRaw) }
          : undefined,
      publish: String(formData.get("intent") ?? "") === "publish",
    });
  } catch (err) {
    // An unknown code is not a refusal any more, it is the next question:
    // come back with the form intact and either the panel to describe the
    // course, or the confirmation of what is about to be created.
    if (err instanceof UnknownCourseCodeError) {
      const params = formStateParams(formData);
      params.set("stage", newCourseFilled ? "confirm" : "course");
      redirect(`/admin/offerings?${params.toString()}`);
    }
    if (err instanceof AppError) {
      // Every other refusal keeps the form too. Losing eight filled fields
      // over one bad end time is its own small cruelty.
      const params = formStateParams(formData);
      params.set("error", err.message);
      if (newCourseFilled) params.set("stage", "course");
      redirect(`/admin/offerings?${params.toString()}`);
    }
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

/**
 * Removes the offering for good.
 *
 * Confirmed from a banner above the table rather than a popover inside a
 * row: the table's scroll wrapper carries `contain: paint`, which clips
 * anything a row tries to open over it, and a confirmation that is half
 * cut off is worse than none.
 */
export async function deleteOfferingAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  const offeringId = String(formData.get("offeringId") ?? "");
  let summary;
  try {
    summary = await deleteOffering(actor, offeringId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(semesterId, err.message);
    throw err;
  }
  redirect(`/admin/offerings?semesterId=${semesterId}&deleted=${encodeURIComponent(summary.code)}`);
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

export async function reinstateOfferingAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  const offeringId = String(formData.get("offeringId") ?? "");
  try {
    await reinstateOffering(actor, offeringId);
  } catch (err) {
    if (err instanceof AppError) errorRedirect(semesterId, err.message);
    throw err;
  }
  redirect(`/admin/offerings?semesterId=${semesterId}`);
}

/** Moves one timetable slot -- every day of it -- to a new time and room. */
export async function rescheduleMeetingsAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const semesterId = String(formData.get("semesterId") ?? "");
  const meetingIds = String(formData.get("meetingIds") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  try {
    await rescheduleMeetings(actor, meetingIds, {
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

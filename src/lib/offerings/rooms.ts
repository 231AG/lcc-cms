/**
 * The rooms the College teaches in.
 *
 * A fixed list rather than free text: `offering_meeting.room` was typed by
 * hand, which is how one room ends up recorded as "PAPE 1", "Pape1" and
 * "pape 1" and stops being something you can group a timetable by.
 *
 * Deliberately NOT a database CHECK. Meetings recorded before this list
 * existed may name rooms that are not on it, and a CHECK would make those
 * rows invalid retroactively -- an offering nobody can edit because a
 * column it does not touch fails validation. The list is enforced where
 * rooms are chosen (a select on the form) and validated on the way in;
 * an existing off-list value is left alone and still displayed.
 */
export const ROOMS = [
  "PAPE 1",
  "PAPE 2",
  "PAPE 3",
  "PAPE 4",
  "OVR 1",
  "OVR 2",
  "OVR 3",
  "OVR 4",
  "OVR 5",
  "OVR 6",
] as const;

export type Room = (typeof ROOMS)[number];

export function isRoom(value: string): value is Room {
  return (ROOMS as readonly string[]).includes(value);
}

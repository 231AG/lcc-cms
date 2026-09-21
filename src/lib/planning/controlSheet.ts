import { and, eq, inArray } from "drizzle-orm";
import { asUser } from "@/lib/db/asUser";
import {
  college as collegeTable,
  course,
  coursePlan,
  coursePlanItem,
  courseOffering,
  department as departmentTable,
  offeringMeeting,
  semester as semesterTable,
  student as studentTable,
} from "@/lib/db/schema";
import { fullName } from "@/lib/students/name";
import { formatCourseCode } from "@/lib/courses/courseCode";
import { formatDays } from "@/lib/offerings/offeringRows";
import { assertCan, type Actor } from "@/lib/permissions/kernel";
import { ValidationError } from "@/lib/errors";

/**
 * The Control Sheet: what a student is actually registered for, on paper.
 *
 * Approved courses only. A control sheet is the student's copy of their
 * enrolment, not a transcript of the review -- a course the Registrar
 * refused is not something they are enrolled in, and printing it beside
 * the ones they are is how somebody turns up to the wrong class.
 *
 * Read through asUser like every other read here, so RLS applies and the
 * sheet cannot become a way to read a plan the actor could not open on
 * screen.
 */
export interface ControlSheetCourse {
  code: string;
  title: string;
  section: string;
  creditHours: number;
  days: string;
  room: string;
  time: string;
}

export interface ControlSheet {
  studentName: string;
  studentNumber: string;
  /** The student's department. The College has no separate major field --
   *  the department IS the programme of study, which is the same reading
   *  the Grade Sheet prints under "Major". */
  major: string;
  college: string;
  semesterName: string;
  planStatus: string;
  courses: ControlSheetCourse[];
  totalCreditHours: number;
}

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "—");

export async function getControlSheet(actor: Actor, planId: string): Promise<ControlSheet> {
  await assertCan(actor, "planning.reviewPlan");

  return asUser(actor.userId, async (tx) => {
    const plan = await tx.query.coursePlan.findFirst({ where: eq(coursePlan.id, planId) });
    if (!plan) throw new ValidationError("Plan not found.");

    const [student, semester] = await Promise.all([
      tx.query.student.findFirst({ where: eq(studentTable.id, plan.studentId) }),
      tx.query.semester.findFirst({ where: eq(semesterTable.id, plan.semesterId) }),
    ]);
    if (!student) throw new ValidationError("Student not found.");

    const department = student.departmentId
      ? await tx.query.department.findFirst({ where: eq(departmentTable.id, student.departmentId) })
      : undefined;
    const college = department
      ? await tx.query.college.findFirst({ where: eq(collegeTable.id, department.collegeId) })
      : undefined;

    const items = await tx.query.coursePlanItem.findMany({
      where: and(eq(coursePlanItem.planId, planId), eq(coursePlanItem.status, "APPROVED")),
    });

    const offeringIds = [...new Set(items.map((i) => i.offeringId))];
    const [offerings, meetings] = await Promise.all([
      offeringIds.length
        ? tx.query.courseOffering.findMany({ where: inArray(courseOffering.id, offeringIds) })
        : Promise.resolve([]),
      offeringIds.length
        ? tx.query.offeringMeeting.findMany({ where: inArray(offeringMeeting.offeringId, offeringIds) })
        : Promise.resolve([]),
    ]);
    const courseIds = [...new Set(items.map((i) => i.courseId))];
    const courses = courseIds.length
      ? await tx.query.course.findMany({ where: inArray(course.id, courseIds) })
      : [];

    const rows: ControlSheetCourse[] = items.map((item) => {
      const offering = offerings.find((o) => o.id === item.offeringId);
      const courseRow = courses.find((c) => c.id === item.courseId);
      const mine = meetings.filter((m) => m.offeringId === item.offeringId);
      // A course with two meetings has two rooms and two times; the sheet
      // shows the first and says so with a "+1" rather than silently
      // printing one of them as if it were the whole story.
      const first = mine[0];
      const extra = mine.length > 1 ? ` +${mine.length - 1}` : "";
      return {
        code: courseRow ? formatCourseCode(courseRow.code) : "—",
        title: courseRow?.title ?? "—",
        section: offering?.section ?? "—",
        creditHours: offering?.frozenCreditHours ?? courseRow?.creditHours ?? 0,
        days: mine.length ? formatDays(mine.map((m) => m.dayOfWeek)) : "—",
        room: first?.room ? `${first.room}${extra}` : "—",
        time: first ? `${hhmm(first.startTime)}–${hhmm(first.endTime)}${extra}` : "—",
      };
    });
    rows.sort((a, b) => a.code.localeCompare(b.code));

    return {
      studentName: fullName(student).toUpperCase(),
      studentNumber: student.studentNumber,
      major: department ? department.name : "—",
      college: college ? college.name : "—",
      semesterName: semester?.name ?? "—",
      planStatus: plan.status,
      courses: rows,
      totalCreditHours: rows.reduce((sum, r) => sum + r.creditHours, 0),
    };
  });
}

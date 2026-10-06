import { Badge } from "@/components/ui/Badge";
import { enrollmentLabel } from "@/lib/students/enrollment";
import { LEVEL_LABEL, type StudentLevel } from "@/lib/students/level";

/**
 * A student's Status as the College uses the word -- their level, Freshman
 * to Senior -- for the "choose a student" lists. Enrollment is added beside
 * it only when it is not the ordinary Active (a Graduated or Suspended
 * student), because that is when it changes what can be done for them.
 */
export function StudentStatus({ level, enrollment }: { level: StudentLevel; enrollment: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-fg">{LEVEL_LABEL[level]}</span>
      {enrollment !== "ACTIVE" && <Badge tone="neutral">{enrollmentLabel(enrollment)}</Badge>}
    </span>
  );
}

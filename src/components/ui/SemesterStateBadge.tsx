import { Badge, type Tone } from "./Badge";
import { SEMESTER_STATE_LABEL, type SemesterState } from "@/lib/academic/semesterStateMachine";

/**
 * A semester's state, rendered the same way everywhere it appears.
 *
 * There are only four states now, and they showed up in four different
 * places (calendar, portal home, offerings, export) with four separate
 * copies of the same switch statement -- one of which was already stale.
 * Badge's own convention is that each call site maps its status to a
 * `Tone`; this is that mapping for semesters, done once.
 *
 * Draft is deliberately the quiet one and Closed the neutral one: the two
 * states worth noticing at a glance are the live ones.
 */
const STATE_TONE: Record<SemesterState, Tone> = {
  DRAFT: "neutral",
  OPEN: "success",
  IN_PROGRESS: "brand",
  CLOSED: "info",
};

export function SemesterStateBadge({ state, className }: { state: string; className?: string }) {
  // Takes a plain string, not a SemesterState: most callers have a raw
  // `semester.state` column value in hand. An unrecognised value still
  // renders, as itself, rather than throwing or silently vanishing.
  const known = state in STATE_TONE ? (state as SemesterState) : undefined;
  return (
    <Badge tone={known ? STATE_TONE[known] : "neutral"} className={className}>
      {known ? SEMESTER_STATE_LABEL[known] : state}
    </Badge>
  );
}

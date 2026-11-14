"use client";

import { useMemo, useState } from "react";
import { Label, Select, Required } from "@/components/ui/Form";

export interface AffiliationDepartment {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  collegeId: string;
  collegeName: string;
}

/**
 * College, Department (major) and Minor on the student edit form.
 *
 * College is not stored on the student: it is the College of the chosen
 * department. So the College select only narrows the Department list, and
 * changing it forces a fresh Department choice -- which is how a wrong
 * College is corrected. Departments that are switched off are still listed
 * (marked), because a student can legitimately belong to one.
 *
 * The Minor is stored as plain text on the student, so the dropdown submits
 * the department's name; a value that matches no department (an older
 * free-text entry) stays selectable so saving does not silently drop it.
 */
export function StudentAffiliationFields({
  departments,
  currentDepartmentId,
  currentMinor,
}: {
  departments: AffiliationDepartment[];
  currentDepartmentId: string;
  currentMinor: string | null;
}) {
  const current = departments.find((d) => d.id === currentDepartmentId);
  const [collegeId, setCollegeId] = useState(current?.collegeId ?? "");
  const [departmentId, setDepartmentId] = useState(currentDepartmentId);

  const colleges = useMemo(() => {
    const seen = new Map<string, string>();
    for (const d of departments) if (!seen.has(d.collegeId)) seen.set(d.collegeId, d.collegeName);
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [departments]);

  const inCollege = useMemo(
    () => departments.filter((d) => d.collegeId === collegeId).sort((a, b) => a.name.localeCompare(b.name)),
    [departments, collegeId],
  );

  const minorOptions = useMemo(
    () => [...departments].sort((a, b) => a.name.localeCompare(b.name)),
    [departments],
  );
  const minorIsLegacy = !!currentMinor && !departments.some((d) => d.name === currentMinor);
  const departmentChanged = departmentId !== currentDepartmentId;

  return (
    <>
      <div>
        <Label htmlFor="collegeId" className="text-xs">
          College
          <Required />
        </Label>
        {/* Not submitted: it only narrows the Department list below. */}
        <Select
          id="collegeId"
          value={collegeId}
          onChange={(e) => {
            setCollegeId(e.target.value);
            setDepartmentId("");
          }}
          className="max-w-md"
        >
          {colleges.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="departmentId" className="text-xs">
          Department (major)
          <Required />
        </Label>
        <Select
          id="departmentId"
          name="departmentId"
          required
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          className="max-w-md"
        >
          <option value="" disabled>
            Select department
          </option>
          {inCollege.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.isActive ? "" : " (inactive)"}
            </option>
          ))}
        </Select>
      </div>
      {departmentChanged && departmentId && (
        <label className="border-line bg-surface-subtle flex max-w-md items-start gap-2 rounded-md border p-3 text-xs text-fg-secondary">
          <input type="checkbox" name="recalculateMajorFlags" value="1" className="mt-0.5" />
          <span>
            The department was entered by mistake. Recalculate which imported past grades count as <strong>major</strong>{" "}
            courses. Leave this unticked if the student really changed major; past grades then keep the status they had
            at the time.
          </span>
        </label>
      )}
      <div>
        <Label htmlFor="minor" className="text-xs">
          Minor
        </Label>
        <Select id="minor" name="minor" defaultValue={currentMinor ?? ""} className="max-w-md">
          <option value="">None</option>
          {minorIsLegacy && <option value={currentMinor ?? ""}>{currentMinor}</option>}
          {minorOptions.map((d) => (
            <option key={d.id} value={d.name}>
              {d.name}
              {d.isActive ? "" : " (inactive)"}
            </option>
          ))}
        </Select>
      </div>
    </>
  );
}

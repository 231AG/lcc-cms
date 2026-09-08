"use client";

import { useActionState, useMemo, useState } from "react";
import { Card, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Label, Input, Select, Required } from "@/components/ui/Form";
import { enrollStudentAction, type EnrollStudentState } from "./actions";

const initialState: EnrollStudentState = {};

export interface DepartmentOption {
  id: string;
  name: string;
  collegeId: string;
  collegeName: string;
}

/**
 * The enrolment form.
 *
 * College is a real required field on the form but is NOT part of the
 * record: a student belongs to a department, and a department already
 * names its college, so storing it again would create two places for the
 * same fact to disagree. What it does is narrow the Department list --
 * which is the only reason to ask for it, and why the Department select is
 * disabled until a college is chosen rather than showing every department
 * in the College at once.
 *
 * A grid rather than the wrapping flex row this used to be: at ten fields
 * the old layout reflowed into ragged columns whose labels no longer lined
 * up with anything, and a required-field asterisk is only useful if you
 * can see which control it belongs to.
 */
export function EnrollStudentForm({ departments }: { departments: DepartmentOption[] }) {
  const [state, formAction, pending] = useActionState(enrollStudentAction, initialState);
  const [collegeId, setCollegeId] = useState("");

  // Derived from the departments themselves, so the picker can never offer a
  // college with nothing enrollable under it.
  const colleges = useMemo(() => {
    const seen = new Map<string, string>();
    for (const d of departments) if (!seen.has(d.collegeId)) seen.set(d.collegeId, d.collegeName);
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [departments]);

  const visibleDepartments = useMemo(
    () => (collegeId ? departments.filter((d) => d.collegeId === collegeId) : []),
    [departments, collegeId],
  );

  return (
    <Card className="mb-8">
      <CardBody>
        <CardTitle className="mb-3">Enrol a student</CardTitle>

        {state.error && (
          <Alert tone="danger" className="mb-3">
            {state.error}
          </Alert>
        )}

        {state.success && (
          <Alert tone="success" className="mb-3">
            <p className="font-medium">Student enrolled.</p>
            <p>
              Student ID: <code>{state.success.studentNumber}</code>
            </p>
            <p>
              Temporary password: <code>{state.success.temporaryPassword}</code>
            </p>
            <p className="mt-1 text-xs">
              Shown once. Hand this to the student directly -- it is not stored anywhere in
              plaintext and will not be shown again.
            </p>
          </Alert>
        )}

        <form action={formAction}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor="studentNumber" className="text-xs">
                Student ID
                <Required />
              </Label>
              <Input id="studentNumber" name="studentNumber" required placeholder="202634" />
            </div>
            <div>
              <Label htmlFor="firstName" className="text-xs">
                First name
                <Required />
              </Label>
              <Input id="firstName" name="firstName" required />
            </div>
            <div>
              <Label htmlFor="middleName" className="text-xs">
                Middle name
              </Label>
              <Input id="middleName" name="middleName" />
            </div>
            <div>
              <Label htmlFor="lastName" className="text-xs">
                Last name
                <Required />
              </Label>
              <Input id="lastName" name="lastName" required />
            </div>
            <div>
              <Label htmlFor="gender" className="text-xs">
                Gender
                <Required />
              </Label>
              <Select id="gender" name="gender" required defaultValue="">
                <option value="" disabled>
                  Select gender
                </option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="enrolmentYear" className="text-xs">
                Enrolment year
                <Required />
              </Label>
              <Input id="enrolmentYear" name="enrolmentYear" type="number" required placeholder="2026" />
            </div>
            <div>
              <Label htmlFor="collegeId" className="text-xs">
                College
                <Required />
              </Label>
              {/* Not submitted -- see the component comment. It gates the
                  Department list below it. */}
              <Select
                id="collegeId"
                required
                value={collegeId}
                onChange={(e) => setCollegeId(e.target.value)}
              >
                <option value="" disabled>
                  Select college
                </option>
                {colleges.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="departmentId" className="text-xs">
                Department
                <Required />
              </Label>
              <Select id="departmentId" name="departmentId" required defaultValue="" disabled={!collegeId}>
                <option value="" disabled>
                  {collegeId ? "Select department" : "Choose a college first"}
                </option>
                {visibleDepartments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="minor" className="text-xs">
                Minor
              </Label>
              <Input id="minor" name="minor" placeholder="None" />
            </div>
            <div>
              <Label htmlFor="contactPhone" className="text-xs">
                Phone
              </Label>
              <Input id="contactPhone" name="contactPhone" />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Enrolling..." : "Enrol student"}
            </Button>
            <p className="text-xs text-fg-muted">
              Fields marked <span className="text-danger-fg">*</span> are required.
            </p>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

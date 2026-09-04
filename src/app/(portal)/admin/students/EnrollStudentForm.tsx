"use client";

import { useActionState } from "react";
import { Card, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Label, Input, Select } from "@/components/ui/Form";
import { enrollStudentAction, type EnrollStudentState } from "./actions";

const initialState: EnrollStudentState = {};

export function EnrollStudentForm({
  departments,
}: {
  departments: Array<{ id: string; code: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(enrollStudentAction, initialState);

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

        <form action={formAction} className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="studentNumber" className="text-xs">
              Student ID
            </Label>
            <Input id="studentNumber" name="studentNumber" required placeholder="202634" className="w-32" />
          </div>
          <div>
            <Label htmlFor="firstName" className="text-xs">
              First name
            </Label>
            <Input id="firstName" name="firstName" required />
          </div>
          <div>
            <Label htmlFor="lastName" className="text-xs">
              Last name
            </Label>
            <Input id="lastName" name="lastName" required />
          </div>
          <div>
            <Label htmlFor="departmentId" className="text-xs">
              Department
            </Label>
            <Select id="departmentId" name="departmentId" required>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="enrolmentYear" className="text-xs">
              Enrolment year
            </Label>
            <Input id="enrolmentYear" name="enrolmentYear" type="number" required placeholder="2026" className="w-24" />
          </div>
          <div>
            <Label htmlFor="contactPhone" className="text-xs">
              Contact phone (optional)
            </Label>
            <Input id="contactPhone" name="contactPhone" />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Enrolling..." : "Enrol student"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

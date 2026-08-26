"use client";

import { useActionState } from "react";
import { enrollStudentAction, type EnrollStudentState } from "./actions";

const initialState: EnrollStudentState = {};

export function EnrollStudentForm({
  departments,
}: {
  departments: Array<{ id: string; code: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(enrollStudentAction, initialState);

  return (
    <div className="mb-8 rounded border border-gray-200 p-4">
      <h2 className="mb-3 font-medium">Enrol a student</h2>

      {state.error && (
        <p className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}

      {state.success && (
        <div className="mb-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
          <p className="font-medium">Student enrolled.</p>
          <p>
            Student ID: <code>{state.success.studentNumber}</code>
          </p>
          <p>
            Temporary password: <code>{state.success.temporaryPassword}</code>
          </p>
          <p className="mt-1 text-xs text-green-800">
            Shown once. Hand this to the student directly -- it is not stored anywhere in
            plaintext and will not be shown again.
          </p>
        </div>
      )}

      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="studentNumber" className="mb-1 block text-xs font-medium">
            Student ID
          </label>
          <input
            id="studentNumber"
            name="studentNumber"
            required
            placeholder="202634"
            className="w-32 rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label htmlFor="firstName" className="mb-1 block text-xs font-medium">
            First name
          </label>
          <input id="firstName" name="firstName" required className="rounded border border-gray-300 px-2 py-1 text-sm" />
        </div>
        <div>
          <label htmlFor="lastName" className="mb-1 block text-xs font-medium">
            Last name
          </label>
          <input id="lastName" name="lastName" required className="rounded border border-gray-300 px-2 py-1 text-sm" />
        </div>
        <div>
          <label htmlFor="departmentId" className="mb-1 block text-xs font-medium">
            Department
          </label>
          <select
            id="departmentId"
            name="departmentId"
            required
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="enrolmentYear" className="mb-1 block text-xs font-medium">
            Enrolment year
          </label>
          <input
            id="enrolmentYear"
            name="enrolmentYear"
            type="number"
            required
            placeholder="2026"
            className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label htmlFor="contactPhone" className="mb-1 block text-xs font-medium">
            Contact phone (optional)
          </label>
          <input id="contactPhone" name="contactPhone" className="rounded border border-gray-300 px-2 py-1 text-sm" />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Enrolling..." : "Enrol student"}
        </button>
      </form>
    </div>
  );
}

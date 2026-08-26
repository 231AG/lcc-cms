"use client";

import { useActionState } from "react";
import { resetStudentPasswordAction, type ResetPasswordState } from "./actions";

const initialState: ResetPasswordState = {};

export function ResetPasswordForm({ studentId }: { studentId: string }) {
  const [state, formAction, pending] = useActionState(resetStudentPasswordAction, initialState);

  return (
    <div className="mt-2">
      {state.error && (
        <p className="mb-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
      {state.success && (
        <div className="mb-2 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
          <p className="font-medium">Password reset.</p>
          <p>
            Temporary password: <code>{state.success.temporaryPassword}</code>
          </p>
          <p className="mt-1 text-xs text-green-800">
            Shown once. Hand this to the student directly.
          </p>
        </div>
      )}
      <form action={formAction}>
        <input type="hidden" name="studentId" value={studentId} />
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium disabled:opacity-60"
        >
          {pending ? "Resetting..." : "Reset password"}
        </button>
      </form>
    </div>
  );
}

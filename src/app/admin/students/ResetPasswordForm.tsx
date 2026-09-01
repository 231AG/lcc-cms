"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { resetStudentPasswordAction, type ResetPasswordState } from "./actions";

const initialState: ResetPasswordState = {};

export function ResetPasswordForm({ studentId }: { studentId: string }) {
  const [state, formAction, pending] = useActionState(resetStudentPasswordAction, initialState);

  return (
    <div className="mt-2">
      {state.error && (
        <Alert tone="danger" className="mb-2">
          {state.error}
        </Alert>
      )}
      {state.success && (
        <Alert tone="success" className="mb-2">
          <p className="font-medium">Password reset.</p>
          <p>
            Temporary password: <code>{state.success.temporaryPassword}</code>
          </p>
          <p className="mt-1 text-xs">Shown once. Hand this to the student directly.</p>
        </Alert>
      )}
      <form action={formAction}>
        <input type="hidden" name="studentId" value={studentId} />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Resetting..." : "Reset password"}
        </Button>
      </form>
    </div>
  );
}

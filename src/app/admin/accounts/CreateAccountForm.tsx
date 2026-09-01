"use client";

import { useActionState } from "react";
import { Card, CardBody, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Label, Input, Select } from "@/components/ui/Form";
import { createStaffAccountAction, type CreateAccountState } from "./actions";

const initialState: CreateAccountState = {};

export function CreateAccountForm() {
  const [state, formAction, pending] = useActionState(
    createStaffAccountAction,
    initialState,
  );

  return (
    <Card className="mb-8">
      <CardBody>
        <CardTitle className="mb-3">Create Admin / Super Admin account</CardTitle>

        {state.error && (
          <Alert tone="danger" className="mb-3">
            {state.error}
          </Alert>
        )}

        {state.success && (
          <Alert tone="success" className="mb-3">
            <p className="font-medium">Account created.</p>
            <p>
              Username: <code>{state.success.username}</code>
            </p>
            <p>
              Temporary password: <code>{state.success.temporaryPassword}</code>
            </p>
            <p className="mt-1 text-xs">
              Shown once. Hand this to the new user directly -- it is not stored anywhere
              in plaintext and will not be shown again.
            </p>
          </Alert>
        )}

        <form action={formAction} className="flex flex-col gap-3">
          <div>
            <Label htmlFor="username">Username</Label>
            <Input id="username" name="username" type="text" required className="max-w-sm" />
          </div>
          <div>
            <Label htmlFor="displayName">Display name</Label>
            <Input id="displayName" name="displayName" type="text" required className="max-w-sm" />
          </div>
          <div>
            <Label htmlFor="role">Role</Label>
            <Select id="role" name="role" required defaultValue="" className="max-w-sm">
              <option value="" disabled>
                Select a role
              </option>
              <option value="ADMIN">Admin</option>
              <option value="SUPER_ADMIN">Super Admin</option>
            </Select>
          </div>
          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? "Creating..." : "Create account"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

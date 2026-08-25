"use client";

import { useActionState } from "react";
import { createStaffAccountAction, type CreateAccountState } from "./actions";

const initialState: CreateAccountState = {};

export function CreateAccountForm() {
  const [state, formAction, pending] = useActionState(
    createStaffAccountAction,
    initialState,
  );

  return (
    <div className="mb-8 rounded border border-gray-200 p-4">
      <h2 className="mb-3 font-medium">Create Admin / Super Admin account</h2>

      {state.error && (
        <p className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}

      {state.success && (
        <div className="mb-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
          <p className="font-medium">Account created.</p>
          <p>
            Username: <code>{state.success.username}</code>
          </p>
          <p>
            Temporary password: <code>{state.success.temporaryPassword}</code>
          </p>
          <p className="mt-1 text-xs text-green-800">
            Shown once. Hand this to the new user directly -- it is not stored anywhere
            in plaintext and will not be shown again.
          </p>
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-3">
        <div>
          <label htmlFor="username" className="mb-1 block text-sm font-medium">
            Username
          </label>
          <input
            id="username"
            name="username"
            type="text"
            required
            className="w-full max-w-sm rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="displayName" className="mb-1 block text-sm font-medium">
            Display name
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            required
            className="w-full max-w-sm rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="role" className="mb-1 block text-sm font-medium">
            Role
          </label>
          <select
            id="role"
            name="role"
            required
            defaultValue=""
            className="w-full max-w-sm rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Select a role
            </option>
            <option value="ADMIN">Admin</option>
            <option value="SUPER_ADMIN">Super Admin</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Creating..." : "Create account"}
        </button>
      </form>
    </div>
  );
}

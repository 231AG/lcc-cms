import type { Metadata } from "next";
import Image from "next/image";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Label, Input } from "@/components/ui/Form";
import { loginAction } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

/**
 * S-01 (plan Section 20.3). Plain server-rendered form, no client
 * JavaScript -- errors are surfaced via a redirect + query param rather
 * than client-side state, keeping this page at effectively 0 KB of
 * business-logic JS (REQ-D03, DER-25).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main id="main-content" tabIndex={-1} className="flex flex-1 items-center justify-center px-4 py-12 outline-none">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Image src="/lcc-logo.png" alt="Liberia Christian College seal" width={70} height={79} className="mb-3 h-16 w-auto" priority />
          <h1 className="text-xl font-semibold text-neutral-900">Liberia Christian College</h1>
          <p className="mt-1 text-sm text-neutral-600">E-Portal sign in</p>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          {error === "disabled" && (
            <Alert tone="danger" className="mb-4">
              This account has been disabled. Contact the Admin office.
            </Alert>
          )}
          {error === "1" && (
            <Alert tone="danger" className="mb-4">
              Student ID/username or password is incorrect.
            </Alert>
          )}

          <form action={loginAction} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="identifier">Student ID or Username</Label>
              <Input id="identifier" name="identifier" type="text" required autoComplete="username" />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required autoComplete="current-password" />
            </div>
            <Button type="submit" className="mt-2 w-full">
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}

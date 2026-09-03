import type { Metadata } from "next";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Label, Input } from "@/components/ui/Form";
import { FocusedScreen } from "@/components/layout/FocusedScreen";
import { loginAction } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

/**
 * S-01 (plan Section 20.3). Plain server-rendered form, no client
 * JavaScript -- errors are surfaced via a redirect + query param rather
 * than client-side state, keeping this page at effectively 0 KB of
 * business-logic JS (REQ-D03, DER-25).
 *
 * The page sits outside the `(portal)` route group, so it renders with no
 * header or nav at all: a sign-in screen has nowhere to navigate to, and the
 * chrome only competed with the one thing the visitor is here to do.
 *
 * The show/hide password control and the in-flight submit state come from
 * public/enhance.js, not from React state -- both stay hidden unless that
 * script actually ran, so the form is never decorated with controls that do
 * nothing. Field labels and the button text are load-bearing: e2e/*.spec.ts
 * drives this form by accessible name ("Student ID or Username", "Password",
 * "Sign in"), so those strings must not change.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <FocusedScreen className="max-w-[25rem]">
      <div className="mb-9 flex flex-col items-center text-center">
        {/* The app's one hero moment: the Deep Orchid -> Lavender Haze
            gradient, contained to the seal tile rather than run across the
            page. */}
        <span className="bg-gradient-brand mb-6 flex h-28 w-28 items-center justify-center rounded-[1.75rem] p-[3px] shadow-sm">
          <span className="bg-seal-backdrop flex h-full w-full items-center justify-center rounded-[1.6rem]">
            <Image
              src="/lcc-logo.png"
              alt="Liberia Christian College seal"
              width={200}
              height={227}
              className="h-[5.5rem] w-auto"
              priority
            />
          </span>
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-fg sm:text-[1.75rem]">
          Liberia Christian College
        </h1>
        <p className="mt-2.5 text-sm tracking-wide text-fg-muted uppercase">E-Portal Sign In</p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        {error === "disabled" && (
          <Alert tone="danger" className="mb-5">
            This account has been disabled. Contact the Admin office.
          </Alert>
        )}
        {error === "1" && (
          <Alert tone="danger" className="mb-5">
            Student ID/username or password is incorrect.
          </Alert>
        )}

        <form action={loginAction} data-submit-feedback className="flex flex-col gap-5">
          <div>
            <Label htmlFor="identifier" className="mb-1.5">
              Student ID or Username
            </Label>
            <Input id="identifier" name="identifier" type="text" required autoComplete="username" className="h-11" />
          </div>

          <div>
            <Label htmlFor="password" className="mb-1.5">
              Password
            </Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="h-11 pr-11"
              />
              <button
                type="button"
                data-password-toggle="password"
                aria-label="Show password"
                aria-pressed="false"
                className="enhance-only absolute inset-y-0 right-0 items-center rounded-r-md px-3 text-fg-muted transition-colors hover:text-brand-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring"
              >
                <Eye className="h-4 w-4" data-when="hidden" aria-hidden="true" />
                <EyeOff className="h-4 w-4" data-when="shown" aria-hidden="true" />
              </button>
            </div>
          </div>

          <Button type="submit" className="mt-1 h-11 w-full">
            <svg
              className="submit-spinner h-4 w-4 animate-spin"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
              <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Sign in
          </Button>
        </form>
      </div>

      {/* Accounts are created and reset by the Admin office -- there is no
          self-service recovery flow, so this points at the real one instead of
          linking to a page that doesn't exist. */}
      <p className="mt-6 text-center text-sm text-fg-muted">
        Forgot your password? Contact the Admin office to have it reset.
      </p>
    </FocusedScreen>
  );
}

import type { Metadata } from "next";
import Image from "next/image";
import { Eye, EyeOff, LogIn, ShieldCheck } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Label, Input } from "@/components/ui/Form";
import { SubmitButton } from "@/components/ui/SubmitButton";
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
 * "Sign in"), so those strings must not change -- which is also why this
 * screen still asks for a Student ID rather than the email address the
 * design reference shows. There are no email logins in this system.
 *
 * The layout is the reference's three bands: who this is, a welcome, and
 * the form itself. Everything above the card is presentation -- the form
 * below it is byte-for-byte the same fields, names and action as before.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <FocusedScreen className="max-w-[30rem]">
      {/* Identity row. Small and left-aligned: the seal had been a 7rem hero
          tile, which on a phone pushed the actual form below the fold. */}
      <div className="mb-6 flex items-center gap-3">
        <span className="bg-gradient-brand flex h-11 w-11 shrink-0 items-center justify-center rounded-xl p-[2px] shadow-sm">
          <span className="bg-seal-backdrop flex h-full w-full items-center justify-center overflow-hidden rounded-[0.6rem]">
            <Image
              src="/lcc-logo.png"
              alt="Liberia Christian College seal"
              width={200}
              height={227}
              className="h-[85%] w-auto"
              priority
            />
          </span>
        </span>
        <span className="min-w-0">
          <span className="text-fg block text-sm leading-tight font-bold">Liberia Christian College</span>
          <span className="text-fg-muted block text-[11px] leading-tight">E-Portal</span>
        </span>
      </div>

      {/* The welcome band. A tint rather than a fill, so the heading keeps
          full text contrast against it under both themes. */}
      <div className="bg-gradient-welcome mb-6 rounded-2xl px-6 py-8 text-center">
        <span className="bg-surface/80 text-brand-fg mb-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold tracking-[0.06em] uppercase shadow-sm">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Secure login
        </span>
        <h1 className="text-fg text-2xl font-bold tracking-tight text-balance sm:text-[1.75rem]">Welcome back</h1>
        <p className="text-fg-secondary mt-2 text-sm">
          Sign in to your <span className="font-semibold">Liberia Christian College</span> account
        </p>
      </div>

      <div className="border-line bg-surface overflow-hidden rounded-xl border shadow-sm">
        <div className="border-line-subtle flex items-center gap-3 border-b px-6 py-4">
          <span className="bg-gradient-brand text-on-primary flex h-9 w-9 items-center justify-center rounded-lg shadow-sm">
            <LogIn className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <h2 className="text-fg text-base font-bold">Sign In</h2>
        </div>

        <div className="p-6 sm:p-7">
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
                <RequiredMark />
              </Label>
              <Input
                id="identifier"
                name="identifier"
                type="text"
                required
                autoComplete="username"
                placeholder="Enter your Student ID or username"
                className="h-11"
              />
            </div>

            <div>
              <Label htmlFor="password" className="mb-1.5">
                Password
                <RequiredMark />
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="h-11 pr-11"
                />
                <button
                  type="button"
                  data-password-toggle="password"
                  aria-label="Show password"
                  aria-pressed="false"
                  className="enhance-only text-fg-muted hover:text-brand-fg focus-visible:outline-focus-ring absolute inset-y-0 right-0 items-center rounded-r-md px-3 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                >
                  <Eye className="h-4 w-4" data-when="hidden" aria-hidden="true" />
                  <EyeOff className="h-4 w-4" data-when="shown" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* bg-gradient-brand over the primary variant: a background-IMAGE
                on top of the variant's background-colour, so the two do not
                fight (cn is a plain joiner with no tailwind-merge) and the
                solid brand colour is still what shows if the gradient ever
                fails to resolve. */}
            <SubmitButton className="bg-gradient-brand mt-1 h-11 w-full shadow-sm">
              <svg className="submit-spinner h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
                <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Sign in
            </SubmitButton>
          </form>
        </div>

        {/* Accounts are created and reset by the Admin office -- there is no
            self-service recovery flow, so this points at the real one rather
            than the reference's "Reset?" link to a page that doesn't exist. */}
        <p className="border-line-subtle bg-surface-subtle text-fg-muted border-t px-6 py-4 text-center text-sm">
          Forgot your password? Contact the Admin office to have it reset.
        </p>
      </div>
    </FocusedScreen>
  );
}

/**
 * The reference's red asterisk -- and deliberately NOT the shared
 * `<Required />`, which pairs the glyph with a visually-hidden " (required)".
 * That extra word becomes part of the label's accessible name, and this form
 * is driven by `getByLabel("Password", { exact: true })` in four e2e specs.
 * An `aria-hidden` node is excluded from accessible-name computation, so this
 * marks the field for a sighted reader while leaving the name exactly
 * "Password". Nothing is lost for assistive tech: both inputs carry
 * `required`, which is what actually announces the constraint.
 */
function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-danger-fg ml-0.5">
      *
    </span>
  );
}

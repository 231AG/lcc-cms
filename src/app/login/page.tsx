import type { Metadata } from "next";
import Image from "next/image";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Label, Input } from "@/components/ui/Form";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { FocusedScreen } from "@/components/layout/FocusedScreen";
import { loginAction } from "./actions";
import campus from "./lcc-campus.webp";

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
 * The College's own building fills the screen behind a single sign-in card.
 * The photograph is presentation only -- the form is byte-for-byte the same
 * fields, names and action as before.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <FocusedScreen
      className="max-w-[27rem]"
      backdrop={
        <>
          {/* Decorative: the campus is named in the caption below, so the
              image itself stays out of the accessibility tree. Softly blurred
              so it reads as a setting behind the card rather than competing
              with it; scaled up slightly so the blur has no pale edge. */}
          <Image
            src={campus}
            alt=""
            fill
            priority
            placeholder="blur"
            sizes="100vw"
            className="scale-105 object-cover object-[50%_35%] blur-[3px]"
          />
          {/* Darkens the photo evenly, and more at the foot, so the card and
              the caption read against it in either theme. */}
          <div className="photo-scrim absolute inset-0" />
          <p className="absolute bottom-4 left-5 text-xs font-medium text-white/85 sm:bottom-6 sm:left-6">
            Liberia Christian College &middot; Main Campus, 5th Street
          </p>
        </>
      }
    >
      <div className="border-line bg-surface/95 rounded-2xl border p-6 shadow-float backdrop-blur-sm sm:p-8">
        <div className="flex flex-col items-center text-center">
          <span className="bg-seal-backdrop flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl p-1.5">
            <Image
              src="/lcc-logo.png"
              alt="Liberia Christian College seal"
              width={200}
              height={227}
              className="h-full w-auto"
              priority
            />
          </span>
          <p className="text-brand-fg mt-4 text-xl leading-tight font-extrabold tracking-tight">
            Liberia Christian College
          </p>
          <p className="text-fg-muted mt-1 text-[11px] font-semibold tracking-[0.14em] uppercase">E-Portal</p>
        </div>

        <div className="border-line-subtle mt-6 border-t pt-6">
          <div className="flex items-center gap-3">
            <span className="bg-gradient-brand text-on-primary flex h-9 w-9 items-center justify-center rounded-lg shadow-sm">
              <LogIn className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <h1 className="text-fg text-base font-bold">Sign In</h1>
          </div>

          <div className="mt-6">
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

              <SubmitButton className="mt-1 h-11 w-full">
                <svg className="submit-spinner h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
                  <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Sign in
              </SubmitButton>
            </form>

            {/* Accounts are created and reset by the Admin office -- there is
                no self-service recovery flow, so this points at the real one. */}
            <p className="text-fg-muted mt-6 text-sm">
              Forgot your password? Contact the Admin office to have it reset.
            </p>
          </div>
        </div>
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

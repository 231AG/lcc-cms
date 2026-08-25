import { loginAction } from "./actions";

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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-xl font-semibold">Liberia Christian College</h1>
      <p className="mb-6 text-sm text-gray-600">E-Portal sign in</p>

      {error === "disabled" && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          This account has been disabled. Contact the Admin office.
        </p>
      )}
      {error === "1" && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          Student ID/username or password is incorrect.
        </p>
      )}

      <form action={loginAction} className="flex flex-col gap-4">
        <div>
          <label htmlFor="identifier" className="mb-1 block text-sm font-medium">
            Student ID or Username
          </label>
          <input
            id="identifier"
            name="identifier"
            type="text"
            required
            autoComplete="username"
            className="w-full rounded border border-gray-300 px-3 py-2 text-base"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded border border-gray-300 px-3 py-2 text-base"
          />
        </div>
        <button
          type="submit"
          className="rounded bg-blue-700 px-4 py-2 font-medium text-white"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}

import Image from "next/image";
import type { LoginSlip } from "@/lib/identity/loginSlips";
import { PORTAL_ADDRESS } from "@/lib/college";

/**
 * The slips, two across on white paper, to cut along the dashed lines --
 * eight to an A4 page. Everything a student needs to sign in the first
 * time, and nothing about anyone else.
 *
 * The password is set in a monospaced face, spaced out, because it is read
 * off paper and typed: the alphabet already leaves out 0 so it cannot be
 * taken for O (src/lib/identity/temporaryPassword.ts).
 */
export function LoginSlipSheet({ slips }: { slips: LoginSlip[] }) {
  return (
    <div className="login-slips mx-auto max-w-[210mm] bg-white text-black shadow-card print:shadow-none">
      <div className="grid grid-cols-2">
        {slips.map((s) => (
          <section
            key={s.studentId}
            className="login-slip flex min-h-[68mm] flex-col border border-dashed border-neutral-400 px-5 py-4"
            aria-label={`Login slip for ${s.name}`}
          >
            <div className="flex items-center gap-2.5 border-b border-neutral-300 pb-2">
              <Image src="/lcc-logo.png" alt="" width={200} height={227} className="h-9 w-auto" />
              <div className="leading-tight">
                <p className="text-[13px] font-extrabold tracking-wide text-[#5e2b8c] uppercase">Liberia Christian College</p>
                <p className="text-[10.5px] font-semibold tracking-[0.12em] text-neutral-600 uppercase">E-Portal sign-in</p>
              </div>
            </div>

            <p className="mt-2.5 text-[15px] font-bold">{s.name}</p>
            <p className="text-[11.5px] text-neutral-600">{s.departmentName}</p>

            <dl className="mt-2.5 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5">
              <dt className="text-[11px] font-semibold tracking-wide text-neutral-600 uppercase">Student ID</dt>
              <dd className="font-mono text-[17px] font-bold tracking-[0.08em]">{s.studentNumber}</dd>
              <dt className="text-[11px] font-semibold tracking-wide text-neutral-600 uppercase">Password</dt>
              <dd className="font-mono text-[17px] font-bold tracking-[0.18em]">{s.temporaryPassword}</dd>
            </dl>

            <div className="mt-auto pt-2.5 text-[10.5px] leading-snug text-neutral-700">
              <p>
                Sign in at <span className="font-semibold text-black">{PORTAL_ADDRESS}</span>
              </p>
              <p>You will be asked to choose your own password the first time you sign in. Keep this slip private.</p>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

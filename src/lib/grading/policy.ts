import { asUser } from "@/lib/db/asUser";
import type { gradeScale } from "@/lib/db/schema";
import { assertCan, type Actor } from "@/lib/permissions/kernel";

export interface GradingPolicyView {
  activeVersion: number;
  scale: Array<typeof gradeScale.$inferSelect>;
  versionHistory: Array<{ policyVersion: number; effectiveFrom: Date; isActive: boolean }>;
  settings: Array<{ key: string; value: unknown; description: string | null }>;
}

/**
 * X-08 (plan Section 20.5): "Active grade scale and institution settings;
 * version history." Read-only for every role -- STUDENT/ADMIN/SUPER_ADMIN
 * all hold `gradingPolicy.view` (Stage 11 permission matrix) since knowing
 * how a grade converts to points is not privileged information. Proposing
 * a new grade-scale version (the plan's "Approve a proposed new version")
 * has no service implementation anywhere in this codebase yet -- there is
 * nothing to gate a write against, so this file is read-only by omission,
 * not by design choice.
 */
export async function getGradingPolicy(actor: Actor): Promise<GradingPolicyView> {
  await assertCan(actor, "gradingPolicy.view");

  return asUser(actor.userId, async (tx) => {
    const allRows = await tx.query.gradeScale.findMany({ orderBy: (t, { asc }) => [asc(t.policyVersion), asc(t.displayOrder)] });
    const now = new Date();
    const inEffect = allRows.filter((r) => new Date(r.effectiveFrom) <= now);
    const activeVersion = inEffect.length ? Math.max(...inEffect.map((r) => r.policyVersion)) : 0;

    const versionMap = new Map<number, Date>();
    for (const r of allRows) {
      const existing = versionMap.get(r.policyVersion);
      if (!existing || new Date(r.effectiveFrom) < existing) versionMap.set(r.policyVersion, new Date(r.effectiveFrom));
    }
    const versionHistory = [...versionMap.entries()]
      .map(([policyVersion, effectiveFrom]) => ({ policyVersion, effectiveFrom, isActive: policyVersion === activeVersion }))
      .sort((a, b) => b.policyVersion - a.policyVersion);

    const settingsRows = await tx.query.institutionSetting.findMany({ orderBy: (t, { asc }) => asc(t.key) });

    return {
      activeVersion,
      scale: allRows.filter((r) => r.policyVersion === activeVersion),
      versionHistory,
      settings: settingsRows.map((s) => ({ key: s.key, value: s.value, description: s.description })),
    };
  });
}

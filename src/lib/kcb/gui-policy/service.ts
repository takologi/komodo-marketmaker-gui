import "server-only";

import { logDebugEvent } from "@/lib/debug/logger";
import { kcbPaths } from "@/lib/kcb/paths";
import { ensureKcbLayout, readJsonFile, writeJsonFile } from "@/lib/kcb/storage";
import { GuiPolicy, GuiPairPolicy } from "@/lib/kcb/types";

// ---------------------------------------------------------------------------
// GUI policy service
//
// gui-policy.json is KCB-managed storage for display preferences only.
// Its contents have no KCB/KDF runtime consequences.
// KCB is the custodian; the GUI reads and writes through the KCB API layer.
// ---------------------------------------------------------------------------

function defaultGuiPolicy(): GuiPolicy {
  return { version: 1, trading_pairs: [] };
}

export async function getGuiPolicy(): Promise<GuiPolicy> {
  await ensureKcbLayout();
  try {
    return await readJsonFile<GuiPolicy>(kcbPaths.guiPolicy());
  } catch {
    return defaultGuiPolicy();
  }
}

function validateGuiPolicy(policy: GuiPolicy): string[] {
  const errors: string[] = [];
  if (policy.version !== 1) errors.push("gui-policy version must be 1");
  if (!Array.isArray(policy.trading_pairs)) errors.push("trading_pairs must be an array");
  for (let i = 0; i < (policy.trading_pairs ?? []).length; i++) {
    const p = policy.trading_pairs[i];
    if (!p.base) errors.push(`trading_pairs[${i}]: missing base`);
    if (!p.rel) errors.push(`trading_pairs[${i}]: missing rel`);
  }
  return errors;
}

export async function saveGuiPolicy(policy: GuiPolicy): Promise<GuiPolicy> {
  await ensureKcbLayout();
  const errors = validateGuiPolicy(policy);
  if (errors.length > 0) {
    throw new Error(`Invalid gui-policy: ${errors.join("; ")}`);
  }
  await writeJsonFile(kcbPaths.guiPolicy(), policy);
  await logDebugEvent({
    severity: "debug",
    title: "KCB gui-policy saved",
    body: "Saved gui-policy.json",
    details: { path: kcbPaths.guiPolicy(), pairCount: policy.trading_pairs.length },
  });
  return policy;
}

/**
 * Merge an updated list of pair display preferences into the current
 * gui-policy.json without touching any other field.
 * Pairs are keyed by "BASE/REL" (canonical direction in the supplied list).
 */
export async function savePairPolicies(pairs: GuiPairPolicy[]): Promise<GuiPolicy> {
  const current = await getGuiPolicy();

  // Build index of incoming pairs to allow O(1) lookup.
  const incoming = new Map<string, GuiPairPolicy>();
  for (const p of pairs) {
    incoming.set(`${p.base}/${p.rel}`, p);
  }

  // Update existing entries that appear in the incoming set; keep the rest.
  const updated = current.trading_pairs.map((existing) => {
    const key = `${existing.base}/${existing.rel}`;
    return incoming.has(key) ? { ...existing, ...incoming.get(key) } : existing;
  });

  // Append pairs that are genuinely new (not in the current list at all).
  const existingKeys = new Set(current.trading_pairs.map((p) => `${p.base}/${p.rel}`));
  for (const [key, p] of incoming) {
    if (!existingKeys.has(key)) {
      updated.push(p);
    }
  }

  return saveGuiPolicy({ ...current, trading_pairs: updated });
}

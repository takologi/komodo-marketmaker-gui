import "server-only";

import { getBootstrapConfig } from "@/lib/kcb/bootstrap/service";
import { getGuiPolicy } from "@/lib/kcb/gui-policy/service";
import { ResolvedPair } from "@/lib/kcb/types";
import { JsonObject, JsonValue } from "@/lib/kdf/types";

// ---------------------------------------------------------------------------
// Pair resolver
//
// Canonical pair list = (pairs derived from bootstrap) merged with gui-policy.
//
// Bootstrap is the authority for WHICH pairs exist (operational config).
// gui-policy is the authority for HOW they are displayed (display config).
//
// Resolution algorithm:
//   1. Walk direct_orders — each entry contributes one pair (base/rel as written).
//   2. Walk simple_mm.start_payload.cfg keys ("BASE/REL" strings).
//   3. Deduplicate: A/B and B/A resolve to the same pair; keep the direction
//      that appears first in the traversal order.
//   4. If gui-policy has a trading_pairs list, use its direction for any pair
//      that also appears there (gui-policy controls canonical direction).
//   5. Merge show / show_all_orders from gui-policy; defaults: show=true,
//      show_all_orders=false.
// ---------------------------------------------------------------------------

/** Normalised pair key, always SMALLER/LARGER alphabetically, for deduplication. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}/${b}` : `${b}/${a}`;
}

function extractSimpleMmPairs(startPayload: JsonValue | undefined): Array<{ base: string; rel: string }> {
  if (!startPayload || typeof startPayload !== "object" || Array.isArray(startPayload)) return [];
  const cfg = (startPayload as JsonObject)["cfg"];
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return [];

  const pairs: Array<{ base: string; rel: string }> = [];
  for (const key of Object.keys(cfg as JsonObject)) {
    const slash = key.indexOf("/");
    if (slash < 1) continue;
    const base = key.slice(0, slash).trim().toUpperCase();
    const rel = key.slice(slash + 1).trim().toUpperCase();
    if (base && rel) pairs.push({ base, rel });
  }
  return pairs;
}

export async function getResolvedPairs(): Promise<ResolvedPair[]> {
  const [config, guiPolicy] = await Promise.all([getBootstrapConfig(), getGuiPolicy()]);

  // Maps normalised dedup key → first-seen direction + source.
  const seen = new Map<string, ResolvedPair>();

  function addIfNew(base: string, rel: string, source: ResolvedPair["source"]) {
    const key = pairKey(base, rel);
    if (!seen.has(key)) {
      seen.set(key, { base, rel, show: true, show_all_orders: false, source });
    }
  }

  // Step 1: direct_orders
  for (const o of config.direct_orders ?? []) {
    addIfNew(o.base.toUpperCase(), o.rel.toUpperCase(), "direct_orders");
  }

  // Step 2: simple_mm cfg keys
  for (const { base, rel } of extractSimpleMmPairs(config.simple_mm.start_payload)) {
    addIfNew(base, rel, "simple_mm_cfg");
  }

  // Step 3: apply gui-policy direction and display preferences
  const guiPairMap = new Map<string, { base: string; rel: string; show?: boolean; show_all_orders?: boolean }>();
  for (const p of guiPolicy.trading_pairs) {
    const base = p.base.toUpperCase();
    const rel = p.rel.toUpperCase();
    guiPairMap.set(pairKey(base, rel), { base, rel, show: p.show, show_all_orders: p.show_all_orders });
  }

  // Merge / add gui-policy entries.
  for (const [key, overrides] of guiPairMap) {
    if (seen.has(key)) {
      const existing = seen.get(key)!;
      seen.set(key, {
        // gui-policy may override the canonical direction
        base: overrides.base,
        rel: overrides.rel,
        show: overrides.show ?? existing.show,
        show_all_orders: overrides.show_all_orders ?? existing.show_all_orders,
        source: existing.source,
      });
    } else {
      // gui-policy can declare a pair that isn't in bootstrap (manual addition).
      seen.set(key, {
        base: overrides.base,
        rel: overrides.rel,
        show: overrides.show ?? true,
        show_all_orders: overrides.show_all_orders ?? false,
        source: "gui_policy",
      });
    }
  }

  return Array.from(seen.values());
}

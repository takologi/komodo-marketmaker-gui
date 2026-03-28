import "server-only";

import { rename } from "node:fs/promises";

import { logDebugEvent } from "@/lib/debug/logger";
import { fetchSimpleMmStatusOptional, fetchVersionOptional } from "@/lib/kdf/client";
import { kcbPaths } from "@/lib/kcb/paths";
import { ensureKcbLayout, readJsonFile, writeJsonFile } from "@/lib/kcb/storage";

interface ResolvedCapabilities {
  resolved_at: string;
  capabilities: {
    version_method_available: boolean;
    simple_mm_status_available: boolean;
  };
  local_overrides: unknown;
}

export async function getResolvedCapabilities(): Promise<ResolvedCapabilities> {
  await ensureKcbLayout();
  let local: unknown;
  try {
    local = await readJsonFile<unknown>(kcbPaths.capabilitiesLocal());
  } catch (error) {
    const backup = `${kcbPaths.capabilitiesLocal()}.corrupt.${Date.now()}`;
    try {
      await rename(kcbPaths.capabilitiesLocal(), backup);
    } catch {
      // Best effort backup if file is missing or rename fails.
    }

    local = {
      notes: "Local capability overrides. Add only deployment-specific constraints.",
      overrides: {},
    };
    await writeJsonFile(kcbPaths.capabilitiesLocal(), local);

    await logDebugEvent({
      severity: "warning",
      title: "KCB capabilities overrides recovered",
      body: "kdf-capabilities.local.json was missing/invalid; regenerated default",
      details: {
        backup,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }

  const [version, simpleMm] = await Promise.all([
    fetchVersionOptional(),
    fetchSimpleMmStatusOptional(),
  ]);

  const resolved: ResolvedCapabilities = {
    resolved_at: new Date().toISOString(),
    capabilities: {
      version_method_available: version.available,
      simple_mm_status_available: simpleMm.available,
    },
    local_overrides: local,
  };

  await writeJsonFile(kcbPaths.resolvedCapabilities(), resolved);
  return resolved;
}

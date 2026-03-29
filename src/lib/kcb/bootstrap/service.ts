import "server-only";

import { rename } from "node:fs/promises";

import { logDebugEvent } from "@/lib/debug/logger";
import { getCoinDefinitions } from "@/lib/kcb/coins/provider";
import { activateCoin, startSimpleMmIfNeeded } from "@/lib/kcb/kdf-control";
import { kcbPaths } from "@/lib/kcb/paths";
import { ensureKcbLayout, readJsonFile, writeJsonFile } from "@/lib/kcb/storage";
import {
  BootstrapConfig,
  BootstrapStatusState,
  LastApplyState,
} from "@/lib/kcb/types";
import { JsonObject, JsonValue } from "@/lib/kdf/types";

function defaultBootstrapConfig(): BootstrapConfig {
  return {
    version: 1,
    kcb_log_level: "info",
    coins: [],
    simple_mm: {
      enabled: false,
      start_on_apply: false,
    },
  };
}

export async function getBootstrapConfig(): Promise<BootstrapConfig> {
  await ensureKcbLayout();
  try {
    return await readJsonFile<BootstrapConfig>(kcbPaths.bootstrapConfig());
  } catch (error) {
    const backup = `${kcbPaths.bootstrapConfig()}.corrupt.${Date.now()}`;
    try {
      await rename(kcbPaths.bootstrapConfig(), backup);
    } catch {
      // Best effort backup if file does not exist or cannot be renamed.
    }

    const def = defaultBootstrapConfig();
    await writeJsonFile(kcbPaths.bootstrapConfig(), def);

    await logDebugEvent({
      severity: "warning",
      title: "KCB bootstrap config recovered",
      body: "bootstrap-config.json was missing/invalid; regenerated default config",
      details: {
        error: error instanceof Error ? error.message : String(error),
        backup,
      },
    });

    return def;
  }
}

export function validateBootstrapConfig(config: BootstrapConfig): string[] {
  const errors: string[] = [];
  if (config.version !== 1) {
    errors.push("bootstrap-config version must be 1");
  }
  if (!Array.isArray(config.coins)) {
    errors.push("coins must be an array");
  }

  for (const coin of config.coins || []) {
    if (!coin.coin) {
      errors.push("each coin entry must define coin ticker");
    }
    if (!coin.activation?.method) {
      errors.push(`coin ${coin.coin || "unknown"} must define activation.method`);
    }

    const method = (coin.activation?.method || "").toLowerCase();
    const methodNeedsServers = method === "enable" || method === "electrum";
    const activationServers = coin.activation?.servers;
    const paramsServers = coin.activation?.params?.servers;
    const hasActivationServers = Array.isArray(activationServers);
    const hasParamServers = Array.isArray(paramsServers);

    if (methodNeedsServers && !hasActivationServers && !hasParamServers) {
      errors.push(
        `coin ${coin.coin || "unknown"} (${coin.activation.method}) must define activation.servers as a non-empty array`,
      );
    }

    if (activationServers !== undefined && !Array.isArray(activationServers)) {
      errors.push(`coin ${coin.coin || "unknown"} activation.servers must be an array when provided`);
    }

    if (paramsServers !== undefined && !Array.isArray(paramsServers)) {
      errors.push(`coin ${coin.coin || "unknown"} activation.params.servers must be an array when provided`);
    }
  }

  if (config.simple_mm.enabled && config.simple_mm.start_on_apply) {
    const payload = config.simple_mm.start_payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      errors.push("simple_mm.start_payload must be an object when simple_mm.start_on_apply is true");
    }
  }

  return errors;
}

export async function saveBootstrapConfig(config: BootstrapConfig): Promise<BootstrapConfig> {
  await ensureKcbLayout();
  const errors = validateBootstrapConfig(config);
  if (errors.length > 0) {
    throw new Error(`Invalid bootstrap config: ${errors.join("; ")}`);
  }
  await writeJsonFile(kcbPaths.bootstrapConfig(), config);
  return config;
}

async function setBootstrapStatus(status: BootstrapStatusState): Promise<void> {
  await writeJsonFile(kcbPaths.bootstrapStatus(), status);
}

export async function applyBootstrapConfig(): Promise<LastApplyState> {
  await ensureKcbLayout();
  const cfg = await getBootstrapConfig();
  const errors = validateBootstrapConfig(cfg);
  if (errors.length > 0) {
    throw new Error(`Bootstrap validation failed: ${errors.join("; ")}`);
  }

  await setBootstrapStatus({
    updated_at: new Date().toISOString(),
    status: "applying",
    message: "KCB bootstrap apply running",
  });

  await logDebugEvent({
    severity: "info",
    title: "KCB bootstrap apply started",
    body: "Bootstrap apply started",
    details: {
      coinCount: cfg.coins.length,
      simpleMmEnabled: cfg.simple_mm.enabled,
      startSimpleMmOnApply: cfg.simple_mm.start_on_apply,
    },
  });

  const summary: JsonObject = {
    coin_activation_attempts: 0,
    coin_activation_success: 0,
    mm_start_attempted: false,
    mm_start_result: "skipped",
  };

  const applyErrors: string[] = [];

  try {
    await getCoinDefinitions();

    for (const coinCfg of cfg.coins) {
      summary.coin_activation_attempts = ((summary.coin_activation_attempts as number) || 0) + 1;

      const activationParams = { ...(coinCfg.activation.params || {}) } as JsonObject;
      if (coinCfg.activation.servers) {
        activationParams.servers = coinCfg.activation.servers as unknown as JsonValue;
      }

      if (!Array.isArray(activationParams.servers)) {
        delete activationParams.servers;
      }

      try {
        await activateCoin(coinCfg.coin, coinCfg.activation.method, activationParams);
        summary.coin_activation_success = ((summary.coin_activation_success as number) || 0) + 1;
      } catch (error) {
        applyErrors.push(
          `activation failed for ${coinCfg.coin}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (cfg.simple_mm.enabled && cfg.simple_mm.start_on_apply) {
      summary.mm_start_attempted = true;
      try {
        const result = await startSimpleMmIfNeeded(cfg.simple_mm.start_payload);
        summary.mm_start_result = result ? "started" : "already_running_or_skipped";
      } catch (error) {
        summary.mm_start_result = "failed";
        applyErrors.push(`simple MM start failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const state: LastApplyState = {
      applied_at: new Date().toISOString(),
      ok: applyErrors.length === 0,
      summary,
      errors: applyErrors,
    };

    await writeJsonFile(kcbPaths.lastApply(), state);

    await setBootstrapStatus({
      updated_at: new Date().toISOString(),
      status: state.ok ? "done" : "failed",
      message: state.ok
        ? "Bootstrap apply finished successfully"
        : "Bootstrap apply completed with errors",
    });

    await logDebugEvent({
      severity: state.ok ? "info" : "warning",
      title: "KCB bootstrap apply completed",
      body: state.ok ? "Bootstrap apply succeeded" : "Bootstrap apply completed with issues",
      details: state,
    });

    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logDebugEvent({
      severity: "error",
      title: "KCB bootstrap apply failed",
      body: "Bootstrap apply failed with exception",
      details: { message },
    });

    await setBootstrapStatus({
      updated_at: new Date().toISOString(),
      status: "failed",
      message: `Bootstrap apply failed: ${message}`,
    });
    throw error;
  }
}

export async function getLastApplyState(): Promise<LastApplyState> {
  await ensureKcbLayout();
  return readJsonFile<LastApplyState>(kcbPaths.lastApply());
}

export async function getBootstrapStatusState(): Promise<BootstrapStatusState> {
  await ensureKcbLayout();
  return readJsonFile<BootstrapStatusState>(kcbPaths.bootstrapStatus());
}

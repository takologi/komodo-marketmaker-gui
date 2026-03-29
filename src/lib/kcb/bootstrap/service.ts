import "server-only";

import { rename } from "node:fs/promises";

import { logDebugEvent } from "@/lib/debug/logger";
import { getCoinDefinitions } from "@/lib/kcb/coins/provider";
import { activateCoin, startSimpleMmIfNeeded } from "@/lib/kcb/kdf-control";
import { kcbPaths } from "@/lib/kcb/paths";
import { ensureKcbLayout, readJsonFile, writeJsonFile } from "@/lib/kcb/storage";
import {
  BootstrapConfig,
  BootstrapCoinConfig,
  BootstrapStatusState,
  LastApplyState,
} from "@/lib/kcb/types";
import { JsonObject, JsonValue } from "@/lib/kdf/types";

interface ResolvedServers {
  servers: JsonValue[] | null;
  source: "activation.servers" | "activation.params.servers" | "coins_config.electrum" | "none";
}

function findCoinDefinition(coinDefinitions: JsonValue, ticker: string): JsonObject | null {
  const norm = ticker.toUpperCase();

  if (Array.isArray(coinDefinitions)) {
    for (const item of coinDefinitions) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const candidate = item as JsonObject;
      const coin = typeof candidate.coin === "string" ? candidate.coin.toUpperCase() : "";
      if (coin === norm) return candidate;
    }
    return null;
  }

  if (!coinDefinitions || typeof coinDefinitions !== "object") return null;

  const table = coinDefinitions as JsonObject;
  const direct = table[norm];
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as JsonObject;
  }

  for (const value of Object.values(table)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const candidate = value as JsonObject;
    const coin = typeof candidate.coin === "string" ? candidate.coin.toUpperCase() : "";
    if (coin === norm) return candidate;
  }

  return null;
}

function serversFromCoinDefinition(coinDef: JsonObject | null): JsonValue[] | null {
  if (!coinDef) return null;
  const electrum = coinDef.electrum;
  if (!Array.isArray(electrum)) return null;

  const servers: JsonValue[] = [];
  for (const node of electrum) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    const entry = node as JsonObject;
    if (typeof entry.url !== "string" || !entry.url) continue;
    servers.push({ url: entry.url });
  }

  return servers.length > 0 ? servers : null;
}

function resolveActivationServers(coinCfg: BootstrapCoinConfig, coinDefinitions: JsonValue): ResolvedServers {
  const activationServers = coinCfg.activation?.servers;
  if (Array.isArray(activationServers) && activationServers.length > 0) {
    return {
      servers: activationServers as unknown as JsonValue[],
      source: "activation.servers",
    };
  }

  const paramsServers = coinCfg.activation?.params?.servers;
  if (Array.isArray(paramsServers) && paramsServers.length > 0) {
    return {
      servers: paramsServers as JsonValue[],
      source: "activation.params.servers",
    };
  }

  const coinDef = findCoinDefinition(coinDefinitions, coinCfg.coin);
  const coinConfigServers = serversFromCoinDefinition(coinDef);
  if (coinConfigServers) {
    return {
      servers: coinConfigServers,
      source: "coins_config.electrum",
    };
  }

  return {
    servers: null,
    source: "none",
  };
}

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
    const path = kcbPaths.bootstrapConfig();
    const config = await readJsonFile<BootstrapConfig>(path);

    await logDebugEvent({
      severity: "debug",
      title: "KCB bootstrap config loaded",
      body: "Loaded bootstrap-config.json",
      details: {
        path,
      },
    });

    await logDebugEvent({
      severity: "trace",
      title: "KCB bootstrap config content",
      body: "bootstrap-config.json payload",
      details: config,
    });

    return config;
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

    if (activationServers !== undefined && !Array.isArray(activationServers)) {
      errors.push(`coin ${coin.coin || "unknown"} activation.servers must be an array when provided`);
    }

    if (paramsServers !== undefined && !Array.isArray(paramsServers)) {
      errors.push(`coin ${coin.coin || "unknown"} activation.params.servers must be an array when provided`);
    }

    if (methodNeedsServers && Array.isArray(activationServers) && activationServers.length === 0) {
      errors.push(`coin ${coin.coin || "unknown"} activation.servers must not be empty when provided`);
    }

    if (methodNeedsServers && Array.isArray(paramsServers) && paramsServers.length === 0) {
      errors.push(`coin ${coin.coin || "unknown"} activation.params.servers must not be empty when provided`);
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
    await logDebugEvent({
      severity: "debug",
      title: "KCB bootstrap config validation failed",
      body: "Rejected bootstrap-config.json while saving",
      details: {
        path: kcbPaths.bootstrapConfig(),
        errors,
      },
    });

    await logDebugEvent({
      severity: "trace",
      title: "KCB bootstrap config rejected payload",
      body: "Payload that failed bootstrap validation",
      details: config,
    });

    throw new Error(`Invalid bootstrap config: ${errors.join("; ")}`);
  }
  await writeJsonFile(kcbPaths.bootstrapConfig(), config);

  await logDebugEvent({
    severity: "debug",
    title: "KCB bootstrap config saved",
    body: "Saved bootstrap-config.json",
    details: {
      path: kcbPaths.bootstrapConfig(),
    },
  });

  await logDebugEvent({
    severity: "trace",
    title: "KCB bootstrap config saved content",
    body: "Persisted bootstrap-config.json payload",
    details: config,
  });

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
    await logDebugEvent({
      severity: "debug",
      title: "KCB bootstrap apply validation failed",
      body: "bootstrap-config.json failed validation during apply",
      details: {
        path: kcbPaths.bootstrapConfig(),
        errors,
      },
    });

    await logDebugEvent({
      severity: "trace",
      title: "KCB bootstrap apply invalid config",
      body: "Config payload rejected at apply time",
      details: cfg,
    });

    throw new Error(`Bootstrap validation failed: ${errors.join("; ")}`);
  }

  await logDebugEvent({
    severity: "debug",
    title: "KCB bootstrap apply config path",
    body: "Applying bootstrap-config.json from path",
    details: {
      path: kcbPaths.bootstrapConfig(),
    },
  });

  await logDebugEvent({
    severity: "trace",
    title: "KCB bootstrap apply config content",
    body: "Config payload used for apply",
    details: cfg,
  });

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
    const coinDefinitions = await getCoinDefinitions();

    await logDebugEvent({
      severity: "debug",
      title: "KCB bootstrap coin definitions loaded",
      body: "Loaded coins_config cache for activation fallback",
      details: {
        cachePath: kcbPaths.coinsConfigCache(),
        topLevelType: Array.isArray(coinDefinitions) ? "array" : typeof coinDefinitions,
      },
    });

    for (const coinCfg of cfg.coins) {
      summary.coin_activation_attempts = ((summary.coin_activation_attempts as number) || 0) + 1;

      const activationParams = { ...(coinCfg.activation.params || {}) } as JsonObject;
      const method = (coinCfg.activation.method || "").toLowerCase();
      const methodNeedsServers = method === "enable" || method === "electrum";
      const resolvedServers = resolveActivationServers(coinCfg, coinDefinitions);

      if (resolvedServers.servers) {
        activationParams.servers = resolvedServers.servers;
      } else {
        delete activationParams.servers;
      }

      await logDebugEvent({
        severity: "debug",
        title: "KCB activation params resolved",
        body: `Resolved activation payload for coin=${coinCfg.coin}`,
        details: {
          coin: coinCfg.coin,
          method: coinCfg.activation.method,
          methodNeedsServers,
          serversSource: resolvedServers.source,
          serversCount: Array.isArray(activationParams.servers) ? activationParams.servers.length : 0,
        },
      });

      await logDebugEvent({
        severity: "trace",
        title: "KCB activation payload",
        body: `Final activation payload for coin=${coinCfg.coin}`,
        details: {
          coin: coinCfg.coin,
          activationMethod: coinCfg.activation.method,
          params: activationParams,
        },
      });

      if (methodNeedsServers && !Array.isArray(activationParams.servers)) {
        applyErrors.push(
          `activation failed for ${coinCfg.coin}: no activation servers found in bootstrap config or coins_config.json`,
        );
        continue;
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
      await logDebugEvent({
        severity: "debug",
        title: "KCB simple MM start requested",
        body: "Starting simple market maker from bootstrap config",
        details: {
          path: kcbPaths.bootstrapConfig(),
        },
      });

      await logDebugEvent({
        severity: "trace",
        title: "KCB simple MM start payload",
        body: "simple_mm.start_payload used for start_simple_market_maker_bot",
        details: cfg.simple_mm.start_payload,
      });

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

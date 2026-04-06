import "server-only";

import { rename } from "node:fs/promises";

import { logDebugEvent } from "@/lib/debug/logger";
import { getCoinDefinitions, refreshCoinDefinitions, ensureKdfCoinsFile } from "@/lib/kcb/coins/provider";
import { activateCoin, startSimpleMmIfNeeded } from "@/lib/kcb/kdf-control";
import { applyDirectOrders } from "@/lib/kcb/orders/service";
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
  diagnostics: JsonObject;
}

function objectKeysLimited(value: JsonObject, max = 40): string[] {
  return Object.keys(value).slice(0, max);
}

function summarizeCoinDefinition(coinDef: JsonObject | null): JsonObject {
  if (!coinDef) {
    return {
      found: false,
    };
  }

  const electrum = coinDef.electrum;
  const electrumIsArray = Array.isArray(electrum);
  const electrumEntries = electrumIsArray ? electrum.length : 0;
  const sampleUrls = electrumIsArray
    ? electrum
      .filter((node): node is JsonObject => Boolean(node && typeof node === "object" && !Array.isArray(node)))
      .map((node) => (typeof node.url === "string" ? node.url : ""))
      .filter(Boolean)
      .slice(0, 5)
    : [];

  return {
    found: true,
    keys: objectKeysLimited(coinDef),
    hasCoinField: typeof coinDef.coin === "string",
    hasElectrumField: Object.prototype.hasOwnProperty.call(coinDef, "electrum"),
    electrumType: Array.isArray(electrum) ? "array" : typeof electrum,
    electrumEntries,
    sampleUrls,
  };
}

function summarizeCoinDefinitionsRoot(coinDefinitions: JsonValue): JsonObject {
  if (Array.isArray(coinDefinitions)) {
    return {
      rootType: "array",
      rootLength: coinDefinitions.length,
    };
  }

  if (coinDefinitions && typeof coinDefinitions === "object") {
    const obj = coinDefinitions as JsonObject;
    const coinsNode = obj.coins;
    return {
      rootType: "object",
      rootKeys: objectKeysLimited(obj),
      hasCoinsArray: Array.isArray(coinsNode),
      coinsArrayLength: Array.isArray(coinsNode) ? coinsNode.length : 0,
    };
  }

  return {
    rootType: typeof coinDefinitions,
  };
}

function findCoinDefinition(coinDefinitions: JsonValue, ticker: string): JsonObject | null {
  const norm = ticker.toUpperCase();
  const visited = new Set<JsonValue>();

  function visit(node: JsonValue): JsonObject | null {
    if (!node || typeof node !== "object") return null;
    if (visited.has(node)) return null;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item);
        if (found) return found;
      }
      return null;
    }

    const obj = node as JsonObject;
    const coin = typeof obj.coin === "string" ? obj.coin.toUpperCase() : "";
    if (coin === norm) return obj;

    const direct = obj[norm];
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
      return direct as JsonObject;
    }

    for (const value of Object.values(obj)) {
      const found = visit(value);
      if (found) return found;
    }

    return null;
  }

  return visit(coinDefinitions);
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
    const server: JsonObject = { url: entry.url };
    if (typeof entry.protocol === "string" && entry.protocol) {
      server.protocol = entry.protocol;
    }
    servers.push(server);
  }

  return servers.length > 0 ? servers : null;
}

function resolveActivationServers(coinCfg: BootstrapCoinConfig, coinDefinitions: JsonValue): ResolvedServers {
  const activationServers = coinCfg.activation?.servers;
  if (Array.isArray(activationServers) && activationServers.length > 0) {
    return {
      servers: activationServers as unknown as JsonValue[],
      source: "activation.servers",
      diagnostics: {
        resolution: "used activation.servers from bootstrap",
        bootstrapServersCount: activationServers.length,
      },
    };
  }

  const paramsServers = coinCfg.activation?.params?.servers;
  if (Array.isArray(paramsServers) && paramsServers.length > 0) {
    return {
      servers: paramsServers as JsonValue[],
      source: "activation.params.servers",
      diagnostics: {
        resolution: "used activation.params.servers from bootstrap",
        paramsServersCount: paramsServers.length,
      },
    };
  }

  const coinDef = findCoinDefinition(coinDefinitions, coinCfg.coin);
  const coinDefSummary = summarizeCoinDefinition(coinDef);
  const coinConfigServers = serversFromCoinDefinition(coinDef);
  if (coinConfigServers) {
    return {
      servers: coinConfigServers,
      source: "coins_config.electrum",
      diagnostics: {
        resolution: "used coin definition electrum servers",
        coinDefinition: coinDefSummary,
        resolvedServersCount: coinConfigServers.length,
      },
    };
  }

  return {
    servers: null,
    source: "none",
    diagnostics: {
      resolution: "no servers found in bootstrap or coin definitions",
      coinDefinition: coinDefSummary,
    },
  };
}

function resolveRequiredConfirmations(coinCfg: BootstrapCoinConfig, coinDefinitions: JsonValue): number | undefined {
  const fromActivationParams = coinCfg.activation?.params?.required_confirmations;
  if (typeof fromActivationParams === "number" && Number.isFinite(fromActivationParams) && fromActivationParams >= 0) {
    return fromActivationParams;
  }

  const coinDef = findCoinDefinition(coinDefinitions, coinCfg.coin);
  if (!coinDef) return undefined;

  const candidate = coinDef.required_confirmations;
  if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) {
    return candidate;
  }

  return undefined;
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

  if (config.direct_orders !== undefined) {
    if (!Array.isArray(config.direct_orders)) {
      errors.push("direct_orders must be an array");
    } else {
      for (let i = 0; i < config.direct_orders.length; i++) {
        const o = config.direct_orders[i];
        if (!o.base) errors.push(`direct_orders[${i}]: missing base`);
        if (!o.rel) errors.push(`direct_orders[${i}]: missing rel`);
        if (!o.price) errors.push(`direct_orders[${i}]: missing price`);
        if (!o.volume) errors.push(`direct_orders[${i}]: missing volume`);
      }
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

  // Ensure the KDF coins file exists before activating any coin. KDF reads this
  // file at startup; if it's missing, coin activations that depend on it will fail.
  await ensureKdfCoinsFile();

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
    direct_orders_attempted: 0,
    direct_orders_success: 0,
    mm_start_attempted: false,
    mm_start_result: "skipped",
  };

  const applyErrors: string[] = [];

  try {
    let coinDefinitions = await getCoinDefinitions();
    let refreshedCoinDefinitionsOnServerMiss = false;

    await logDebugEvent({
      severity: "debug",
      title: "KCB bootstrap coin definitions loaded",
      body: "Loaded coins_config cache for activation fallback",
      details: {
        cachePath: kcbPaths.coinsConfigCache(),
        ...summarizeCoinDefinitionsRoot(coinDefinitions),
      },
    });

    await logDebugEvent({
      severity: "trace",
      title: "KCB bootstrap coin definitions snapshot",
      body: "coins_config root snapshot used for activation resolution",
      details: summarizeCoinDefinitionsRoot(coinDefinitions),
    });

    for (const coinCfg of cfg.coins) {
      summary.coin_activation_attempts = ((summary.coin_activation_attempts as number) || 0) + 1;

      const activationParams = { ...(coinCfg.activation.params || {}) } as JsonObject;
      const method = (coinCfg.activation.method || "").toLowerCase();
      const methodNeedsServers = method === "enable" || method === "electrum";
      let resolvedServers = resolveActivationServers(coinCfg, coinDefinitions);

      if (methodNeedsServers && !resolvedServers.servers && !refreshedCoinDefinitionsOnServerMiss) {
        refreshedCoinDefinitionsOnServerMiss = true;

        await logDebugEvent({
          severity: "warning",
          title: "KCB activation servers unresolved",
          body: `No activation servers resolved for ${coinCfg.coin}; forcing coins_config refresh and retrying`,
          details: {
            coin: coinCfg.coin,
            method: coinCfg.activation.method,
            initialSource: resolvedServers.source,
            initialDiagnostics: resolvedServers.diagnostics,
            cachePath: kcbPaths.coinsConfigCache(),
          },
        });

        await refreshCoinDefinitions();
        coinDefinitions = await getCoinDefinitions();
        resolvedServers = resolveActivationServers(coinCfg, coinDefinitions);

        await logDebugEvent({
          severity: "debug",
          title: "KCB activation servers retry result",
          body: `Retried activation server resolution for ${coinCfg.coin}`,
          details: {
            coin: coinCfg.coin,
            method: coinCfg.activation.method,
            retriedSource: resolvedServers.source,
            serversCount: resolvedServers.servers?.length || 0,
            retriedDiagnostics: resolvedServers.diagnostics,
            coinDefinitionsRoot: summarizeCoinDefinitionsRoot(coinDefinitions),
          },
        });
      }

      if (resolvedServers.servers) {
        activationParams.servers = resolvedServers.servers;
      } else {
        delete activationParams.servers;
      }

      if (activationParams.required_confirmations === undefined) {
        const inheritedConfs = resolveRequiredConfirmations(coinCfg, coinDefinitions);
        if (inheritedConfs !== undefined) {
          activationParams.required_confirmations = inheritedConfs;
        }
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
          resolutionDiagnostics: resolvedServers.diagnostics,
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
        const errorMessage = error instanceof Error ? error.message : String(error);
        const enableWithServers = method === "enable" && Array.isArray(activationParams.servers);
        const nativeWalletConfigMissing = /native wallet configuration/i.test(errorMessage);
        const hint = enableWithServers && nativeWalletConfigMissing
          ? " Hint: this looks like a native daemon activation path; try activation.method='electrum' for Electrum-based activation."
          : "";
        applyErrors.push(
          `activation failed for ${coinCfg.coin}: ${errorMessage}${hint}`,
        );
      }
    }

    const directOrders = cfg.direct_orders ?? [];
    if (directOrders.length > 0) {
      summary.direct_orders_attempted = directOrders.length;

      await logDebugEvent({
        severity: "debug",
        title: "KCB direct orders apply",
        body: `Applying ${directOrders.length} direct order(s) from bootstrap config`,
        details: { count: directOrders.length },
      });

      const orderResults = await applyDirectOrders(directOrders);
      const succeeded = orderResults.filter((r) => r.ok).length;
      summary.direct_orders_success = succeeded;

      for (const r of orderResults) {
        if (!r.ok) {
          applyErrors.push(`direct order ${r.base}/${r.rel}: ${r.error}`);
        }
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

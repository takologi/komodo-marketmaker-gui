import "server-only";

import { join } from "node:path";

import { getKcbConfigDir } from "@/lib/kcb/env";

export function kcbPath(...parts: string[]): string {
  return join(getKcbConfigDir(), ...parts);
}

export const kcbPaths = {
  root: () => getKcbConfigDir(),
  configDir: () => kcbPath("config"),
  cacheDir: () => kcbPath("cache"),
  stateDir: () => kcbPath("state"),
  logsDir: () => kcbPath("logs"),
  cacheCoinsDir: () => kcbPath("cache", "coins"),
  cacheIconsDir: () => kcbPath("cache", "icons"),

  bootstrapConfig: () => kcbPath("config", "bootstrap-config.json"),
  capabilitiesLocal: () => kcbPath("config", "kdf-capabilities.local.json"),
  coinSources: () => kcbPath("config", "coin-sources.json"),

  coinsConfigCache: () => kcbPath("cache", "coins", "coins_config.json"),
  coinsMetaCache: () => kcbPath("cache", "coins", "coins_config.meta.json"),

  bootstrapStatus: () => kcbPath("state", "bootstrap-status.json"),
  lastApply: () => kcbPath("state", "last-apply.json"),
  resolvedCapabilities: () => kcbPath("state", "resolved-capabilities.json"),
};

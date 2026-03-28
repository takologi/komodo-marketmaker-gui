import "server-only";

import { homedir } from "node:os";

function parseMs(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSeconds(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getKcbConfigDir(): string {
  return process.env.KCB_CONFIG_DIR || `${homedir()}/.kcb`;
}

export function getKcbCoinsConfigUrl(): string {
  return (
    process.env.KCB_COINS_CONFIG_URL ||
    "https://raw.githubusercontent.com/KomodoPlatform/coins/master/coins"
  );
}

export function getKcbIconsBaseUrl(): string {
  return process.env.KCB_ICONS_BASE_URL || "https://raw.githubusercontent.com/KomodoPlatform/coins/master/icons";
}

export function getKcbHttpTimeoutMs(): number {
  return parseMs(process.env.KCB_HTTP_TIMEOUT_MS, 15000);
}

export function getKcbLogLevel(): string {
  return (process.env.KCB_LOG_LEVEL || "info").toLowerCase();
}

export function getCommandRetentionSeconds(): number {
  return parseSeconds(process.env.KCB_COMMAND_RETENTION_SECONDS, 30);
}

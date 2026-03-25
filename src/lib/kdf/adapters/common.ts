import { JsonValue } from "@/lib/kdf/types";

export function asString(value: JsonValue | undefined, fallback = "-"): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

export function asNumber(value: JsonValue | undefined, fallback = 0): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function asObject(
  value: JsonValue | undefined,
): { [key: string]: JsonValue } | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as { [key: string]: JsonValue };
  }
  return undefined;
}

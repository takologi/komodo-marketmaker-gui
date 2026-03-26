export const DEBUG_SEVERITIES = [
  "critical",
  "error",
  "warning",
  "info",
  "debug",
  "trace",
] as const;

export type DebugSeverity = (typeof DEBUG_SEVERITIES)[number];

export interface DebugMessage {
  id: string;
  timestamp: string;
  severity: DebugSeverity;
  title: string;
  body: string;
}

const severityRank: Record<DebugSeverity, number> = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

export function normalizeSeverity(
  value: string | undefined,
  fallback: DebugSeverity,
): DebugSeverity {
  if (!value) return fallback;
  const lowered = value.toLowerCase();
  return (DEBUG_SEVERITIES as readonly string[]).includes(lowered)
    ? (lowered as DebugSeverity)
    : fallback;
}

export function isSeverityAtOrAbove(
  value: DebugSeverity,
  threshold: DebugSeverity,
): boolean {
  return severityRank[value] <= severityRank[threshold];
}

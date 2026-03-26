import "server-only";

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { sendMessageToClient } from "@/lib/debug/popup-bus";
import { getRuntimeDebugLevels } from "@/lib/debug/runtime-levels";
import {
  DebugSeverity,
  isSeverityAtOrAbove,
} from "@/lib/debug/severity";

function getLogFilePath(): string {
  return process.env.LOG_FILE || "./logs/komodo-marketmaker-gui.log";
}

function safeStringify(input: unknown): string {
  try {
    const text = JSON.stringify(input);
    if (!text) return "null";
    if (text.length <= 20_000) return text;
    return `${text.slice(0, 20_000)}...[truncated]`;
  } catch {
    return String(input);
  }
}

async function appendToLogFile(line: string): Promise<void> {
  const filePath = getLogFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${line}\n`, "utf8");
}

export async function logDebugEvent(input: {
  severity: DebugSeverity;
  title: string;
  body: string;
  details?: unknown;
}): Promise<void> {
  const timestamp = new Date().toISOString();
  const details = input.details !== undefined ? ` details=${safeStringify(input.details)}` : "";
  const line = `[${timestamp}] [${input.severity.toUpperCase()}] ${input.title} :: ${input.body}${details}`;
  const runtimeLevels = getRuntimeDebugLevels();

  if (isSeverityAtOrAbove(input.severity, runtimeLevels.logLevel)) {
    try {
      await appendToLogFile(line);
    } catch (error) {
      console.error("Failed to append debug log file:", error);
      console.error(line);
    }
  }

  if (isSeverityAtOrAbove(input.severity, runtimeLevels.messageLevel)) {
    sendMessageToClient({
      timestamp,
      severity: input.severity,
      title: input.title,
      body: `${input.body}${details}`,
    });
  }
}

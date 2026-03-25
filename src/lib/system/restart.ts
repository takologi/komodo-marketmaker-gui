import "server-only";

import { access } from "node:fs/promises";
import { constants as FsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type RestartMode = "disabled" | "systemctl" | "script";

function getRestartMode(): RestartMode {
  const raw = (process.env.MM2_RESTART_MODE ?? "disabled").toLowerCase();
  if (raw === "systemctl" || raw === "script" || raw === "disabled") {
    return raw;
  }
  return "disabled";
}

function validateServiceName(serviceName: string): boolean {
  return /^[a-zA-Z0-9_.@-]+\.service$/.test(serviceName);
}

function validateAbsoluteScriptPath(path: string): boolean {
  return /^\/[a-zA-Z0-9._\/-]+$/.test(path);
}

export function isAuthorizedRestartToken(token: string | null): boolean {
  const expected = process.env.MM2_RESTART_TOKEN;
  if (!expected) return false;
  return token === expected;
}

export async function triggerRestart(): Promise<string> {
  const mode = getRestartMode();

  if (mode === "disabled") {
    throw new Error("Restart mode is disabled. Set MM2_RESTART_MODE to enable it.");
  }

  if (mode === "systemctl") {
    const serviceName = process.env.MM2_SYSTEMD_SERVICE;
    if (!serviceName || !validateServiceName(serviceName)) {
      throw new Error(
        "MM2_SYSTEMD_SERVICE is required and must match *.service in systemctl mode.",
      );
    }

    const { stdout, stderr } = await execFileAsync("systemctl", ["restart", serviceName], {
      timeout: 20_000,
    });
    const output = [stdout, stderr].filter(Boolean).join("\n").trim();
    return output || `systemctl restart ${serviceName} executed.`;
  }

  const scriptPath = process.env.MM2_RESTART_SCRIPT;
  if (!scriptPath || !validateAbsoluteScriptPath(scriptPath)) {
    throw new Error(
      "MM2_RESTART_SCRIPT must be an absolute safe path when MM2_RESTART_MODE=script.",
    );
  }

  await access(scriptPath, FsConstants.X_OK);

  const { stdout, stderr } = await execFileAsync(scriptPath, [], { timeout: 20_000 });
  const output = [stdout, stderr].filter(Boolean).join("\n").trim();
  return output || `Restart script executed: ${scriptPath}`;
}

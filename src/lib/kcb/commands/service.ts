import "server-only";

import { randomUUID } from "node:crypto";
import { rename } from "node:fs/promises";

import { applyBootstrapConfig } from "@/lib/kcb/bootstrap/service";
import { refreshCoinDefinitions } from "@/lib/kcb/coins/provider";
import { getCommandRetentionSeconds } from "@/lib/kcb/env";
import { restartKdfViaSystem } from "@/lib/kcb/kdf-control";
import { kcbPaths } from "@/lib/kcb/paths";
import { ensureKcbLayout, readJsonFile, writeJsonFile } from "@/lib/kcb/storage";
import { CommandPriority, KcbCommandRecord } from "@/lib/kcb/types";
import { logDebugEvent } from "@/lib/debug/logger";
import { JsonObject } from "@/lib/kdf/types";

type KcbCommandType = "restart_kdf" | "apply_bootstrap" | "refresh_coins";

interface KcbCommandRequest {
  type: KcbCommandType;
  priority?: CommandPriority;
  payload?: JsonObject;
}

interface CommandStore {
  queue: string[];
  commands: KcbCommandRecord[];
}

const INITIAL_STORE: CommandStore = { queue: [], commands: [] };
let queueRunner: Promise<void> | null = null;
let cleanupTimer: NodeJS.Timeout | null = null;
let storeLock: Promise<void> = Promise.resolve();

function commandsPath(): string {
  return `${kcbPaths.stateDir()}/commands.json`;
}

async function loadStore(): Promise<CommandStore> {
  await ensureKcbLayout();
  try {
    return await readJsonFile<CommandStore>(commandsPath());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const corruptedBackup = `${commandsPath()}.corrupt.${Date.now()}`;
    try {
      await rename(commandsPath(), corruptedBackup);
    } catch {
      // Best effort backup only.
    }

    await logDebugEvent({
      severity: "error",
      title: "KCB command store recovery",
      body: "Command store missing/corrupt, recreating with empty state",
      details: { message, backup: corruptedBackup },
    });

    await writeJsonFile(commandsPath(), INITIAL_STORE);
    return { ...INITIAL_STORE };
  }
}

async function saveStore(store: CommandStore): Promise<void> {
  await writeJsonFile(commandsPath(), store);
}

async function withStoreLock<T>(action: () => Promise<T>): Promise<T> {
  const previous = storeLock;
  let release: (() => void) | undefined;
  storeLock = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await action();
  } finally {
    release?.();
  }
}

async function cleanupClosedCommandsNow(): Promise<void> {
  await withStoreLock(async () => {
    const store = await loadStore();
    const cleaned = cleanupRetention(store.commands);
    if (cleaned.length !== store.commands.length) {
      store.commands = cleaned;
      await saveStore(store);
    }
  });
}

function ensureCleanupJobStarted(): void {
  if (cleanupTimer) return;

  const intervalMs = Math.max(5_000, getCommandRetentionSeconds() * 1_000);
  cleanupTimer = setInterval(() => {
    void cleanupClosedCommandsNow();
  }, intervalMs);
  cleanupTimer.unref?.();
}

function cleanupRetention(records: KcbCommandRecord[]): KcbCommandRecord[] {
  const now = Date.now();
  const retentionMs = getCommandRetentionSeconds() * 1000;
  if (retentionMs <= 0) return records;

  return records.filter((cmd) => {
    if (!cmd.finished_at) return true;
    return now - Date.parse(cmd.finished_at) <= retentionMs;
  });
}

async function execute(type: KcbCommandType): Promise<JsonObject> {
  if (type === "restart_kdf") {
    const output = await restartKdfViaSystem();
    return { output };
  }

  if (type === "apply_bootstrap") {
    const result = await applyBootstrapConfig();
    return {
      ok: result.ok,
      applied_at: result.applied_at,
      errors: result.errors,
      summary: result.summary,
    };
  }

  const result = await refreshCoinDefinitions();
  return {
    fetched_at: result.fetchedAt,
    source_url: result.sourceUrl,
    item_count: result.itemCount,
  };
}

async function runQueue(): Promise<void> {
  while (true) {
    const cmd = await withStoreLock(async () => {
      const store = await loadStore();
      const nextId = store.queue.shift();
      if (!nextId) {
        return null;
      }

      const next = store.commands.find((record) => record.id === nextId);
      if (!next) {
        await saveStore({ ...store, commands: cleanupRetention(store.commands) });
        return null;
      }

      next.status = "running";
      await saveStore({ ...store, commands: cleanupRetention(store.commands) });
      return { ...next };
    });

    if (!cmd) {
      break;
    }

    await logDebugEvent({
      severity: "info",
      title: "KCB command running",
      body: `Command started: ${cmd.type}`,
      details: { id: cmd.id, priority: cmd.priority, created_at: cmd.created_at },
    });

    try {
      const summary = await execute(cmd.type as KcbCommandType);
      const finishedAt = new Date().toISOString();
      await withStoreLock(async () => {
        const store = await loadStore();
        const item = store.commands.find((record) => record.id === cmd.id);
        if (item) {
          item.status = "done";
          item.summary = summary;
          item.finished_at = finishedAt;
        }
        store.commands = cleanupRetention(store.commands);
        await saveStore(store);
      });

      await logDebugEvent({
        severity: "info",
        title: "KCB command completed",
        body: `Command completed: ${cmd.type}`,
        details: { id: cmd.id, finished_at: finishedAt, summary },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finishedAt = new Date().toISOString();
      await withStoreLock(async () => {
        const store = await loadStore();
        const item = store.commands.find((record) => record.id === cmd.id);
        if (item) {
          item.status = "failed";
          item.error_message = message;
          item.finished_at = finishedAt;
        }
        store.commands = cleanupRetention(store.commands);
        await saveStore(store);
      });

      await logDebugEvent({
        severity: "error",
        title: "KCB command failed",
        body: `Command failed: ${cmd.type}`,
        details: {
          id: cmd.id,
          finished_at: finishedAt,
          error: message,
        },
      });
    }
  }
}

function startRunner(): void {
  if (queueRunner) return;
  queueRunner = runQueue()
    .catch(() => undefined)
    .finally(() => {
      queueRunner = null;
    });
}

export async function enqueueKcbCommand(request: KcbCommandRequest): Promise<KcbCommandRecord> {
  ensureCleanupJobStarted();
  const cmd = await withStoreLock(async () => {
    const store = await loadStore();

    const priority: CommandPriority = request.priority ?? "normal";
    const now = new Date().toISOString();

    const next: KcbCommandRecord = {
      id: randomUUID(),
      type: request.type,
      priority,
      status: "queued",
      created_at: now,
      finished_at: null,
    };

    store.commands.push(next);
    store.commands = cleanupRetention(store.commands);

    if (priority === "high") {
      store.queue.unshift(next.id);
    } else {
      store.queue.push(next.id);
    }

    await saveStore(store);
    return next;
  });

  await logDebugEvent({
    severity: "info",
    title: "KCB command queued",
    body: `Queued command: ${cmd.type}`,
    details: {
      id: cmd.id,
      priority: cmd.priority,
      created_at: cmd.created_at,
    },
  });
  startRunner();
  return cmd;
}

export async function listKcbCommands(): Promise<KcbCommandRecord[]> {
  ensureCleanupJobStarted();
  return withStoreLock(async () => {
    const store = await loadStore();
    store.commands = cleanupRetention(store.commands);
    await saveStore(store);
    return [...store.commands].sort((a, b) => b.created_at.localeCompare(a.created_at));
  });
}

export async function getKcbCommandById(id: string): Promise<KcbCommandRecord | null> {
  const commands = await listKcbCommands();
  return commands.find((command) => command.id === id) || null;
}

interface StartupBootstrapEnqueueResult {
  queued: boolean;
  commandId?: string;
  reason?: string;
}

export async function enqueueBootstrapApplyOnStartup(): Promise<StartupBootstrapEnqueueResult> {
  ensureCleanupJobStarted();

  const result = await withStoreLock(async () => {
    const store = await loadStore();

    const existing = store.commands.find(
      (cmd) => cmd.type === "apply_bootstrap" && (cmd.status === "queued" || cmd.status === "running"),
    );

    if (existing) {
      return {
        queued: false,
        commandId: existing.id,
        reason: `existing apply_bootstrap command is already ${existing.status}`,
      };
    }

    const now = new Date().toISOString();
    const next: KcbCommandRecord = {
      id: randomUUID(),
      type: "apply_bootstrap",
      priority: "high",
      status: "queued",
      created_at: now,
      finished_at: null,
    };

    store.commands.push(next);
    store.commands = cleanupRetention(store.commands);
    store.queue.unshift(next.id);
    await saveStore(store);

    return {
      queued: true,
      commandId: next.id,
    };
  });

  if (result.queued) {
    await logDebugEvent({
      severity: "info",
      title: "KCB startup bootstrap queued",
      body: "Queued apply_bootstrap automatically on server startup",
      details: {
        id: result.commandId,
      },
    });
    startRunner();
  } else {
    await logDebugEvent({
      severity: "debug",
      title: "KCB startup bootstrap skipped",
      body: "Skipped auto-queue because apply_bootstrap is already queued/running",
      details: result,
    });
  }

  return result;
}

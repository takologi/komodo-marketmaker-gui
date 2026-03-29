import "server-only";

import { logDebugEvent } from "@/lib/debug/logger";
import { enqueueBootstrapApplyOnStartup } from "@/lib/kcb/commands/service";

declare global {
  var __kcbStartupInitPromise: Promise<void> | undefined;
}

export function ensureKcbStartupInitialized(): void {
  if (globalThis.__kcbStartupInitPromise) return;

  globalThis.__kcbStartupInitPromise = (async () => {
    try {
      const result = await enqueueBootstrapApplyOnStartup();
      await logDebugEvent({
        severity: "debug",
        title: "KCB startup initialization complete",
        body: "Startup bootstrap initialization finished",
        details: result,
      });
    } catch (error) {
      await logDebugEvent({
        severity: "error",
        title: "KCB startup initialization failed",
        body: "Failed to initialize startup bootstrap apply",
        details: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  })();
}

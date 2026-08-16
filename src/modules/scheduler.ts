import { getPrefAny } from "./config";
import { isRunning, runPipeline } from "./pipeline";

const STARTUP_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // check once per hour

/**
 * Start the auto-run loop when enabled. The loop exits when the plugin
 * shuts down (addon.data.alive becomes false).
 */
export function initScheduler(): void {
  if (!getPrefAny("autoRun.enable")) {
    return;
  }
  void scheduleLoop();
}

async function scheduleLoop(): Promise<void> {
  await Zotero.Promise.delay(STARTUP_DELAY_MS);
  while (addon.data.alive) {
    if (getPrefAny("autoRun.enable") && !isRunning() && isDue()) {
      try {
        await runPipeline();
      } catch (err) {
        ztoolkit.log(`Scheduled run failed: ${err}`);
      }
    }
    await Zotero.Promise.delay(CHECK_INTERVAL_MS);
  }
}

function isDue(): boolean {
  const intervalMs =
    Math.max(1, Number(getPrefAny("autoRun.intervalHours")) || 168) * 3600_000;
  return Date.now() - Number(getPrefAny("autoRun.lastRun") || 0) >= intervalMs;
}

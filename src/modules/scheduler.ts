import { getPrefAny } from "./config";
import { isRunning, runPipeline } from "./pipeline";

const STARTUP_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // check once per hour

/**
 * Always start the check loop on startup. The loop re-reads
 * autoRun.enable every cycle, so toggling the preference mid-session
 * (including enabling it) takes effect immediately without a restart.
 */
export function initScheduler(): void {
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

const FILE_NAME = "paperRadarProcessed.json";
const BACKUP_FILE_NAME = "paperRadarProcessed.prev.json";
const RETENTION_MS = 90 * 86400_000;

export type ProcessedMap = Record<string, number>;

function profilePath(fileName: string): string {
  // Zotero.getProfileDirectory() returns an nsIFile of the current profile.
  const profileDir = (Zotero as any).getProfileDirectory().path as string;
  const sep = (Zotero as any).isWin ? "\\" : "/";
  return `${profileDir}${sep}${fileName}`;
}

function filePath(): string {
  return profilePath(FILE_NAME);
}

/**
 * Load processed-paper records, dropping entries older than 90 days.
 * Missing or corrupted files yield an empty map.
 */
export async function loadProcessed(): Promise<ProcessedMap> {
  const map: ProcessedMap = {};
  try {
    const text = await (Zotero.File as any).getContentsAsync(filePath());
    const data = JSON.parse(text);
    const cutoff = Date.now() - RETENTION_MS;
    if (Array.isArray(data)) {
      for (const key of data) {
        map[key] = Date.now();
      }
    } else if (data && typeof data === "object") {
      for (const [key, ts] of Object.entries(data)) {
        if (typeof ts === "number" && ts >= cutoff) {
          map[key] = ts;
        }
      }
    }
  } catch {
    // No history yet, or unreadable file — start fresh.
  }
  return map;
}

export async function saveProcessed(map: ProcessedMap): Promise<boolean> {
  try {
    await (Zotero.File as any).putContentsAsync(
      filePath(),
      JSON.stringify(map, null, 2),
    );
    return true;
  } catch (err) {
    ztoolkit.log(`Failed to save processed records: ${err}`);
    return false;
  }
}

/**
 * Copy the current processed-record map to a side file before it is discarded,
 * so a criteria change that triggers re-evaluation stays recoverable.
 */
export async function backupProcessed(map: ProcessedMap): Promise<boolean> {
  try {
    await (Zotero.File as any).putContentsAsync(
      profilePath(BACKUP_FILE_NAME),
      JSON.stringify(map, null, 2),
    );
    return true;
  } catch (err) {
    ztoolkit.log(`Failed to back up processed records: ${err}`);
    return false;
  }
}

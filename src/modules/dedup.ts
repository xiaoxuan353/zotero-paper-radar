const FILE_NAME = "paperRadarProcessed.json";
const RETENTION_MS = 90 * 86400_000;

export type ProcessedMap = Record<string, number>;

function filePath(): string {
  // Zotero.getProfileDirectory() returns an nsIFile of the current profile.
  const profileDir = (Zotero as any).getProfileDirectory().path as string;
  const sep = (Zotero as any).isWin ? "\\" : "/";
  return `${profileDir}${sep}${FILE_NAME}`;
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

export async function saveProcessed(map: ProcessedMap): Promise<void> {
  try {
    await (Zotero.File as any).putContentsAsync(
      filePath(),
      JSON.stringify(map, null, 2),
    );
  } catch (err) {
    ztoolkit.log(`Failed to save processed records: ${err}`);
  }
}

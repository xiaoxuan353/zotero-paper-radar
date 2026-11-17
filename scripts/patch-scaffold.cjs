/*
 * zotero-plugin-scaffold 0.8.2 is ESM-only ("exports" has no "require"
 * condition). The CLI loads zotero-plugin.config.ts through jiti, which
 * resolves it with CJS `require` semantics and then fails with
 * `No "exports" main defined` — a build that used to work only while jiti's
 * cache happened to be warm.
 *
 * This adds a "require" condition pointing at the same ESM entry, which jiti
 * can load. Idempotent, and a no-op once the scaffold ships a CJS export (or
 * after upgrading to a scaffold version that does).
 */
const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "node_modules",
  "zotero-plugin-scaffold",
  "package.json",
);

try {
  if (!fs.existsSync(target)) {
    process.exit(0); // dependency not installed yet (e.g. before npm install)
  }
  const raw = fs.readFileSync(target, "utf8");
  const pkg = JSON.parse(raw);
  const root = pkg.exports && pkg.exports["."];
  if (!root || typeof root !== "object" || root.require) {
    process.exit(0); // already patched, or a layout we should not touch
  }
  if (!root.import) {
    process.exit(0);
  }
  root.require = root.import;
  fs.writeFileSync(target, JSON.stringify(pkg, null, 2) + "\n");
  console.log(
    "[patch-scaffold] added CJS require condition to zotero-plugin-scaffold",
  );
} catch (err) {
  console.warn("[patch-scaffold] skipped:", err && err.message);
}

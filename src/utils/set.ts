// ============================================================================
//  set() — Test Data Utility v2
// ----------------------------------------------------------------------------
//  USAGE:
//  import { set, sets, override, merge } from "@utils/set";
//
//  const data = set("purchaseOrderData", 1);     // Get Set 1
//  const data = set("purchaseOrderData", "Set 2"); // Get by name
//  const all  = sets("purchaseOrderData");        // Get all enabled sets
// ============================================================================

import * as fs   from "fs";
import * as path from "path";

// ✅ FIX — find project root reliably on Windows + Mac + CI
// Walks UP from this file until it finds playwright.config.ts
function findProjectRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (
      fs.existsSync(path.join(dir, "playwright.config.ts")) ||
      fs.existsSync(path.join(dir, "playwright.config.js")) ||
      fs.existsSync(path.join(dir, "package.json"))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  // Fallback to process.cwd()
  return process.cwd();
}

const PROJECT_ROOT = findProjectRoot();
const DATA_DIR     = path.join(PROJECT_ROOT, "test-data", "ui");

// ✅ Debug log — shows exactly where it's looking
console.log(`[set] Project root : ${PROJECT_ROOT}`);
console.log(`[set] Data dir     : ${DATA_DIR}`);

// Cache loaded files
const fileCache = new Map<string, Record<string, unknown>[]>();

// ============================================================================
//  INTERNAL — auto-create template if file does not exist
// ============================================================================
function createTemplateFile(fileName: string, baseFile: string): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`[set] Created directory: ${DATA_DIR}`);
  }

  const template = {
    profile: `${fileName} Profile`,
    sets: [
      { setName: "Set 1", description: "Fill in your values", enabled: true },
      { setName: "Set 2", description: "Fill in your values", enabled: true }
    ]
  };

  fs.writeFileSync(baseFile, JSON.stringify(template, null, 2), "utf-8");
  console.log(`[set] ✅ Auto-created: ${baseFile}`);
}

// ============================================================================
//  INTERNAL — load and parse JSON file
// ============================================================================
function loadSets(fileName: string): Record<string, unknown>[] {
  if (fileCache.has(fileName)) return fileCache.get(fileName)!;

  const env      = process.env.ENVIRONMENT || "qa";
  const baseFile = path.join(DATA_DIR, `${fileName}.json`);
  const envFile  = path.join(DATA_DIR, `${fileName}.${env}.json`);

  // ✅ Show exact path being loaded — easy to debug
  console.log(`[set] Loading → ${baseFile}`);
  console.log(`[set] File exists: ${fs.existsSync(baseFile)}`);

  if (!fs.existsSync(baseFile)) {
    createTemplateFile(fileName, baseFile);
  }

  // ✅ Parse with clear error if JSON is malformed
  let raw: any;
  try {
    const content = fs.readFileSync(baseFile, "utf-8");
    console.log(`[set] File content preview → ${content.substring(0, 100)}...`);
    raw = JSON.parse(content);
  } catch (err: any) {
    throw new Error(
      `[set] Failed to parse ${baseFile}\n` +
      `Error: ${err.message}\n` +
      `Check the file for syntax errors (trailing commas, missing quotes etc.)`
    );
  }

  // ✅ Handle both array format and { sets: [] } format
  let loaded: Record<string, unknown>[];
  if (Array.isArray(raw)) {
    loaded = raw;
  } else if (Array.isArray(raw.sets)) {
    loaded = raw.sets;
  } else {
    throw new Error(
      `[set] Invalid format in ${fileName}.json\n` +
      `Expected: { "sets": [...] } or [...]\n` +
      `Got: ${JSON.stringify(raw).substring(0, 100)}`
    );
  }

  console.log(`[set] Total sets found : ${loaded.length}`);

  // Apply env-specific overrides if file exists
  if (fs.existsSync(envFile)) {
    const envRaw  = JSON.parse(fs.readFileSync(envFile, "utf-8"));
    const envSets: Record<string, unknown>[] = Array.isArray(envRaw)
      ? envRaw : Array.isArray(envRaw.sets) ? envRaw.sets : [];

    loaded = loaded.map(base => {
      const envMatch = envSets.find(
        e => String(e.setName).toLowerCase() === String(base.setName).toLowerCase()
      );
      return envMatch ? { ...base, ...envMatch } : base;
    });

    console.log(`[set] Env overrides applied: ${fileName}.${env}.json`);
  }

  // Filter disabled sets
  const active = loaded.filter(s => s.enabled !== false);
  console.log(`[set] Enabled sets  : ${active.length}`);
  active.forEach((s, i) => console.log(`  ${i + 1}. ${s.setName}`));

  fileCache.set(fileName, active);
  return active;
}

// ============================================================================
//  set() — Get one set by 1-based index or name
// ============================================================================
export function set(fileName: string, setRef: number | string): any {
  const allSets = loadSets(fileName);

  if (typeof setRef === "number") {
    if (setRef < 1 || setRef > allSets.length) {
      throw new Error(
        `[set] Index ${setRef} out of range.\n` +
        `"${fileName}" has ${allSets.length} enabled set(s).`
      );
    }
    const result = allSets[setRef - 1];
    console.log(`[set] set("${fileName}", ${setRef}) →`, JSON.stringify(result));
    return result;
  }

  const match = allSets.find(
    s => String(s.setName).toLowerCase() === setRef.toLowerCase()
  );

  if (!match) {
    const available = allSets.map(s => s.setName).join(", ");
    throw new Error(
      `[set] "${setRef}" not found in "${fileName}".\n` +
      `Available: ${available}`
    );
  }

  console.log(`[set] set("${fileName}", "${setRef}") →`, JSON.stringify(match));
  return match;
}

// ============================================================================
//  sets() — Get ALL enabled sets
// ============================================================================
export function sets(fileName: string): any[] {
  return loadSets(fileName);
}

// ============================================================================
//  override() — Get set with fields overridden
// ============================================================================
export function override(
  fileName:  string,
  setRef:    number | string,
  overrides: Record<string, unknown>
): any {
  const base   = set(fileName, setRef);
  const merged = { ...base, ...overrides };
  console.log(`[set] override applied:`, overrides);
  return merged;
}

// ============================================================================
//  merge() — Combine fields from multiple JSON files
// ============================================================================
export function merge(
  ...sources: Array<[fileName: string, setRef: number | string]>
): any {
  return sources.reduce((acc, [fileName, setRef]) => ({
    ...acc,
    ...set(fileName, setRef),
  }), {});
}
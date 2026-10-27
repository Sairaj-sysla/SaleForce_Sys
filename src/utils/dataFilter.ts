// ============================================================================
//  DATA FILTER UTILITY v2
//  - Supports multiple filter types and comparison metrics
//  - Validates data file exists with clear error messages
//  - Logs what sets are loaded and filtered
//  - Supports env override: TEST_SETS=Set2,Set3 npx playwright test
// ============================================================================

import * as fs   from "fs";
import * as path from "path";

export type FilterType       = "setName" | "index";
export type ComparisonMetric = "between" | "equalTo" | "greaterThan" | "lessThan" | "all";

export interface DataFilterOptions {
  filterType?:  FilterType;
  comparison?:  ComparisonMetric;
  from?:        string | number;
  to?:          string | number;
  onlyEnabled?: boolean;
}

export function loadTestData<T extends { setName: string; enabled: boolean }>(
  fileName: string,
  options:  DataFilterOptions = {}
): T[] {

  const {
    filterType  = "setName",
    comparison  = "all",
    from,
    to,
    onlyEnabled = true,
  } = options;

  // ── Load JSON ──────────────────────────────────────────────────────────────
  const filePath = path.resolve(process.cwd(), "test-data", "ui", `${fileName}.json`);

  // ✅ Clear error if file missing
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[loadTestData] File not found: ${filePath}\n` +
      `Expected at: test-data/ui/${fileName}.json`
    );
  }

  const raw  = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  let sets: T[] = (raw.sets ?? []) as T[];

  if (sets.length === 0) {
    throw new Error(`[loadTestData] No sets found in ${fileName}.json`);
  }

  // ✅ ENV OVERRIDE — TEST_SETS=Set 2,Set 3 npx playwright test
  // Allows CI/CD to control which sets run without editing code
  const envOverride = process.env.TEST_SETS;
  if (envOverride) {
    const envNames = envOverride.split(",").map(s => s.trim());
    const filtered = sets.filter((s: T) => envNames.includes(s.setName));
    console.log(`[loadTestData] ENV override TEST_SETS="${envOverride}" → ${filtered.length} set(s)`);
    return filtered;
  }

  // ── Step 1: Apply enabled filter ──────────────────────────────────────────
  if (onlyEnabled) {
    const before = sets.length;
    sets = sets.filter((s: T) => s.enabled === true);
    const skipped = before - sets.length;
    if (skipped > 0) {
      console.log(`[loadTestData] Skipped ${skipped} disabled set(s)`);
    }
  }

  // ── Step 2: Apply comparison filter ───────────────────────────────────────
  if (comparison !== "all" && (from || to)) {
    sets = applyFilter<T>(sets, filterType, comparison, from, to);
  }

  // ✅ Log final sets that will run
  console.log(`[loadTestData] "${fileName}" → ${sets.length} set(s) will run:`);
  sets.forEach((s: T, i: number) => console.log(`  ${i + 1}. ${s.setName}`));

  if (sets.length === 0) {
    throw new Error(
      `[loadTestData] No sets matched filter: ${JSON.stringify(options)}\n` +
      `Check your from/to values match setNames in the JSON`
    );
  }

  return sets;
}

// ── Private filter logic ───────────────────────────────────────────────────
function applyFilter<T extends { setName: string; enabled: boolean }>(
  sets:       T[],
  filterType: FilterType,
  comparison: ComparisonMetric,
  from?:      string | number,
  to?:        string | number
): T[] {

  if (filterType === "setName") {
    const names = sets.map((s: T) => s.setName);
    switch (comparison) {
      case "equalTo":     return sets.filter((s: T) => s.setName === String(from));
      case "greaterThan": { const i = names.indexOf(String(from)); return i === -1 ? [] : sets.slice(i + 1); }
      case "lessThan":    { const i = names.indexOf(String(from)); return i === -1 ? [] : sets.slice(0, i); }
      case "between": {
        const fi = names.indexOf(String(from));
        const ti = names.indexOf(String(to));
        if (fi === -1) throw new Error(`[loadTestData] "from" set not found: "${from}"`);
        if (ti === -1) throw new Error(`[loadTestData] "to" set not found: "${to}"`);
        return sets.slice(fi, ti + 1);
      }
      default: return sets;
    }
  } else {
    const f = Number(from);
    const t = Number(to);
    switch (comparison) {
      case "equalTo":     return sets.filter((_: T, i: number) => i + 1 === f);
      case "greaterThan": return sets.filter((_: T, i: number) => i + 1 >  f);
      case "lessThan":    return sets.filter((_: T, i: number) => i + 1 <  f);
      case "between":     return sets.filter((_: T, i: number) => i + 1 >= f && i + 1 <= t);
      default:            return sets;
    }
  }
}
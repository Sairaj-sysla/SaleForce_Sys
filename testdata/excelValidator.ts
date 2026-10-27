// testdata/ExcelValidator.ts
//
// Single class handling all excel.json validation + UI cross-checking.
// Replaces both JsonValidator.ts and UiValidator.ts.
//
// ── Three verification modes ──────────────────────────────────────────────────
//
//  1. verifyEntry(testDataName, options?)
//     Reads excel.json entry → verifies cells against xlsx + evaluates formulas
//     Called by TestData.validate() — can also be called directly in spec
//
//  2. verifyAllEntries(options?)
//     Runs verifyEntry() for every entry in excel.json
//
//  3. verifyUiFields(page, testDataName, locatorMap, options?)
//     Reads UI field values → cross-checks against 3 sources:
//       a. test-data.json data[]    — what was filled into the form
//       b. test-data.json expected  — what the UI should show after action
//       c. excel.json cells[]       — what the xlsx has for this field
//
// ── mandatory flag ────────────────────────────────────────────────────────────
//
//  Set per cell/formula in excel.json:
//    mandatory: true  → failure throws (hard fail) — blocks the test
//    mandatory: false → failure warns only — test continues
//
//  Override at call level via options.overrideMandatory:
//    true      → all checks hard fail regardless of excel.json flag
//    false     → all checks soft warn regardless of excel.json flag
//    undefined → use per-cell/formula flag from excel.json (default)
//
// ── Usage in spec ─────────────────────────────────────────────────────────────
//
//  // Verify excel.json cells + formulas for one entry
//  await ExcelValidator.verifyEntry("Orange_Login_Data");
//  await ExcelValidator.verifyEntry("Orange_Login_Data", { overrideMandatory: true });
//
//  // Verify every entry in excel.json at once
//  await ExcelValidator.verifyAllEntries();
//
//  // Verify single formula
//  await ExcelValidator.verifyFormula("Orange_Login_Data", 2, "TotalPrice", 100000);
//
//  // Verify UI fields against data + expected + xlsx
//  await ExcelValidator.verifyUiFields(page, "Orange_Login_Data", {
//    Username: el.username,
//    Password: el.password,
//  });
//
//  // Same but override all to hard fail
//  await ExcelValidator.verifyUiFields(page, "Orange_Login_Data", {
//    Username: el.username,
//  }, { overrideMandatory: true });

import * as fs          from "fs";
import { type Page }    from "@playwright/test";
import { type Locator } from "@playwright/test";
import { expect }       from "@playwright/test";
import { evaluate }     from "mathjs";
import { configManager } from "../src/config/env.index";
import { ExcelData }     from "./ExcelData";
import { TestData }      from "./TestData";
import type { CellEntry, ExcelEntry, FormulaEntry } from "./types";

// ── Public types ───────────────────────────────────────────────────────────────

// Map of field name → Playwright locator
// Field name must match column name in excel.json cells[]
// e.g. { Username: el.username, Password: el.password }
export interface LocatorMap {
  [fieldName: string]: Locator;
}

// Options for overriding mandatory flag at call level
export interface ValidatorOptions {
  // true      → all hard fail regardless of excel.json mandatory flag
  // false     → all soft warn regardless of excel.json mandatory flag
  // undefined → use mandatory flag per cell/formula from excel.json (default)
  overrideMandatory?: boolean;
}

// ── Internal types ─────────────────────────────────────────────────────────────

interface ExcelFailure {
  passType:  "cell" | "formula";
  row:       number;
  column:    string;
  expected:  unknown;
  actual:    unknown;
  mandatory: boolean;
  message:   string;
}

interface UiFailure {
  field:     string;
  checkType: "data" | "expected" | "excel";
  expected:  unknown;
  actual:    unknown;
  mandatory: boolean;
  message:   string;
}

// ── Class ──────────────────────────────────────────────────────────────────────

export class ExcelValidator {
  private static readonly jsonCache = new Map<string, ExcelEntry[]>();

  // =========================================================================
  // PUBLIC API — excel.json verification
  // =========================================================================

  // verifyEntry(testDataName, options?)
  //
  // How it verifies:
  //   Pass 1 — cells[]:
  //     For each { row, column, expected, mandatory } in cells[]:
  //       → reads xlsx cell at that row + column via ExcelData.verifyCell()
  //       → compares actual vs expected
  //       → mandatory:true  = failure goes to hard[] → throws at end
  //       → mandatory:false = failure goes to soft[] → warns at end
  //
  //   Pass 2 — formulas[]:
  //     For each { formula, inputs, expected, mandatory } in formulas[]:
  //       → strips "=" from formula string e.g. "=D2*E2" → "D2*E2"
  //       → replaces cell addresses with column names → "UnitPrice*Quantity"
  //       → builds scope → { UnitPrice: 50000, Quantity: 2 }
  //       → math.evaluate("UnitPrice*Quantity", scope) → 100000
  //       → compares result vs expected
  //       → mandatory:true/false same as cells
  //
  //   Collects ALL failures before throwing — never stops at first failure
  static async verifyEntry(
    testDataName: string,
    options?:     ValidatorOptions
  ): Promise<void> {
    const entry    = ExcelValidator.findEntry(testDataName);
    const fullPath = configManager.getExcelFilePath(entry.filePath);
    const hard:    ExcelFailure[] = [];
    const soft:    ExcelFailure[] = [];

    // ── Pass 1 — cells against live xlsx ──────────────────────────────────
    for (const cell of entry.cells) {
      try {
        await ExcelData.verifyCell(
          fullPath, entry.sheet, cell.row, cell.column, cell.expected
        );
      } catch (error) {
        const actual      = await ExcelValidator.tryReadCellValue(
          fullPath, entry.sheet, cell.row, cell.column
        );
        const isMandatory = options?.overrideMandatory ?? cell.mandatory;
        const failure: ExcelFailure = {
          passType:  "cell",
          row:       cell.row,
          column:    cell.column,
          expected:  cell.expected,
          actual,
          mandatory: isMandatory,
          message:   ExcelValidator.errorMessage(error),
        };
        isMandatory ? hard.push(failure) : soft.push(failure);
      }
    }

    // ── Pass 2 — formulas via mathjs ───────────────────────────────────────
    for (const formula of entry.formulas) {
      const actual      = ExcelValidator.tryEvaluateFormula(formula);
      const isMandatory = options?.overrideMandatory ?? formula.mandatory;

      try {
        expect(actual).toBe(formula.expected);
      } catch (error) {
        const failure: ExcelFailure = {
          passType:  "formula",
          row:       formula.row,
          column:    formula.column,
          expected:  formula.expected,
          actual,
          mandatory: isMandatory,
          message:   ExcelValidator.errorMessage(error),
        };
        isMandatory ? hard.push(failure) : soft.push(failure);
      }
    }

    ExcelValidator.reportExcelFailures(testDataName, entry, hard, soft);
  }

  // verifyAllEntries(options?)
  //
  // Runs verifyEntry() for every entry in excel.json.
  // Collects all entry-level failures before throwing once.
  // Soft entries (mandatory:false) warn but never contribute to throw.
  static async verifyAllEntries(options?: ValidatorOptions): Promise<void> {
    const entries  = ExcelValidator.loadJson();
    const failures: string[] = [];

    for (const entry of entries) {
      try {
        await ExcelValidator.verifyEntry(entry.testDataName, options);
      } catch (error) {
        failures.push(ExcelValidator.errorMessage(error));
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `ExcelValidator.verifyAllEntries: ${failures.length} entry/entries failed:\n` +
        failures.map((f, i) => `  ${i + 1}. ${f}`).join("\n")
      );
    }
  }

  // verifyFormula(testDataName, row, columnName, expected)
  //
  // Verifies one formula from excel.json by testDataName + row + column.
  // Evaluates via mathjs — never reads the xlsx.
  //
  // How it evaluates:
  //   formula "=D2*E2", inputs { D2: UnitPrice:50000, E2: Quantity:2 }
  //   → strips "=" → "D2*E2"
  //   → replaces D2 with "UnitPrice", E2 with "Quantity" → "UnitPrice*Quantity"
  //   → scope = { UnitPrice: 50000, Quantity: 2 }
  //   → math.evaluate("UnitPrice*Quantity", scope) = 100000
  //   → expect(100000).toBe(expected)
  static async verifyFormula(
    testDataName: string,
    row:          number,
    columnName:   string,
    expected:     unknown
  ): Promise<void> {
    const entry        = ExcelValidator.findEntry(testDataName);
    const formulaEntry = entry.formulas.find(
      f => f.row === row && f.column === columnName
    );

    if (!formulaEntry) {
      throw new Error(
        `ExcelValidator.verifyFormula: no formula found for ` +
        `testDataName "${testDataName}", row ${row}, column "${columnName}"`
      );
    }

    const actual = ExcelValidator.evaluateFormula(formulaEntry);

    try {
      expect(actual).toBe(expected);
    } catch {
      throw new Error(
        `ExcelValidator.verifyFormula: testDataName "${testDataName}", ` +
        `sheet "${entry.sheet}", row ${row}, column "${columnName}", ` +
        `formula "${formulaEntry.formula}", ` +
        `expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`
      );
    }
  }

  // =========================================================================
  // PUBLIC API — UI verification
  // =========================================================================

  // verifyUiFields(page, testDataName, locatorMap, options?)
  //
  // For each field in locatorMap:
  //
  //   Step 1 — Read actual value from UI:
  //     If element is input/textarea/select → page.inputValue()
  //     Otherwise (span, div etc.)          → element.textContent()
  //
  //   Step 2 — Check 1 [data]: UI === data[0][field] from test-data.json
  //     Verifies the form was filled correctly
  //
  //   Step 3 — Check 2 [expected]: UI === expected[field] from test-data.json
  //     Verifies post-action UI matches expected (only if field exists in expected)
  //
  //   Step 4 — Check 3 [excel]: UI === xlsx cell value from excel.json entry
  //     Cross-checks UI against what the xlsx says (only if field in excel.json cells[])
  //
  //   mandatory flag per field from excel.json cells[].mandatory
  //   overrideMandatory in options overrides all fields at call level
  static async verifyUiFields(
    page:         Page,
    testDataName: string,
    locatorMap:   LocatorMap,
    options?:     ValidatorOptions
  ): Promise<void> {
    const hard: UiFailure[] = [];
    const soft: UiFailure[] = [];

    const entry        = TestData.get(testDataName);
    const data         = entry.data[0]  ?? {};
    const expected     = entry.expected ?? {};
    const excelEntry   = ExcelValidator.tryGetEntry(testDataName);
    const xlsxFullPath = excelEntry
      ? configManager.getExcelFilePath(excelEntry.filePath)
      : null;

    for (const [fieldName, locator] of Object.entries(locatorMap)) {

      // Step 1 — read actual from UI
      const actual      = await ExcelValidator.readUiValue(locator, fieldName);
      const excelCell   = excelEntry?.cells.find(c => c.column === fieldName);
      const isMandatory = options?.overrideMandatory ??
                          excelCell?.mandatory       ??
                          true;   // default true if not in excel.json

      // Step 2 — Check 1: UI === data[0][field]
      if (fieldName in data) {
        const dataExpected = data[fieldName];
        if (!ExcelValidator.valuesMatch(actual, dataExpected)) {
          const f: UiFailure = {
            field:     fieldName,
            checkType: "data",
            expected:  dataExpected,
            actual,
            mandatory: isMandatory,
            message:
              `UI value does not match data[0]: ` +
              `expected ${JSON.stringify(dataExpected)}, ` +
              `actual ${JSON.stringify(actual)}`,
          };
          isMandatory ? hard.push(f) : soft.push(f);
        }
      }

      // Step 3 — Check 2: UI === expected[field]
      if (fieldName in expected) {
        const expValue = expected[fieldName];
        if (!ExcelValidator.valuesMatch(actual, expValue)) {
          const f: UiFailure = {
            field:     fieldName,
            checkType: "expected",
            expected:  expValue,
            actual,
            mandatory: isMandatory,
            message:
              `UI value does not match expected: ` +
              `expected ${JSON.stringify(expValue)}, ` +
              `actual ${JSON.stringify(actual)}`,
          };
          isMandatory ? hard.push(f) : soft.push(f);
        }
      }

      // Step 4 — Check 3: UI === xlsx cell
      if (excelCell && xlsxFullPath) {
        try {
          const xlsxValue = await ExcelData.getCellValue(
            xlsxFullPath,
            excelEntry!.sheet,
            excelCell.row,
            fieldName
          );
          if (!ExcelValidator.valuesMatch(actual, xlsxValue)) {
            const f: UiFailure = {
              field:     fieldName,
              checkType: "excel",
              expected:  xlsxValue,
              actual,
              mandatory: isMandatory,
              message:
                `UI value does not match xlsx cell (row ${excelCell.row}): ` +
                `expected ${JSON.stringify(xlsxValue)}, ` +
                `actual ${JSON.stringify(actual)}`,
            };
            isMandatory ? hard.push(f) : soft.push(f);
          }
        } catch (error) {
          console.warn(
            `ExcelValidator.verifyUiFields: skipping xlsx check for ` +
            `field "${fieldName}" — ${ExcelValidator.errorMessage(error)}`
          );
        }
      }
    }

    ExcelValidator.reportUiFailures(testDataName, hard, soft);
  }

  // =========================================================================
  // PUBLIC API — metadata + cache
  // =========================================================================

  // Returns excel.json entry metadata — description, sheet, filePath, cells, formulas
  // Useful in test.beforeAll for logging what will be validated
  static getEntry(testDataName: string): ExcelEntry {
    return ExcelValidator.findEntry(testDataName);
  }

  // Clears excel.json cache — call in test.afterAll()
  static reload(): void {
    ExcelValidator.jsonCache.clear();
  }

  // =========================================================================
  // PRIVATE — failure reporting
  // =========================================================================

  private static reportExcelFailures(
    testDataName: string,
    entry:        ExcelEntry,
    hard:         ExcelFailure[],
    soft:         ExcelFailure[]
  ): void {
    if (soft.length > 0) {
      console.warn(
        `ExcelValidator.verifyEntry: "${testDataName}" — ` +
        `${soft.length} non-mandatory check(s) failed (warnings only):\n` +
        ExcelValidator.formatExcelFailures(soft)
      );
    }

    if (hard.length > 0) {
      const desc = entry.description ? ` (${entry.description})` : "";
      throw new Error(
        `ExcelValidator.verifyEntry: "${testDataName}"${desc} — ` +
        `${hard.length} mandatory check(s) failed:\n` +
        ExcelValidator.formatExcelFailures(hard)
      );
    }
  }

  private static reportUiFailures(
    testDataName: string,
    hard:         UiFailure[],
    soft:         UiFailure[]
  ): void {
    if (soft.length > 0) {
      console.warn(
        `ExcelValidator.verifyUiFields: "${testDataName}" — ` +
        `${soft.length} non-mandatory UI check(s) failed:\n` +
        ExcelValidator.formatUiFailures(soft)
      );
    }

    if (hard.length > 0) {
      throw new Error(
        `ExcelValidator.verifyUiFields: "${testDataName}" — ` +
        `${hard.length} mandatory UI check(s) failed:\n` +
        ExcelValidator.formatUiFailures(hard)
      );
    }
  }

  private static formatExcelFailures(failures: ExcelFailure[]): string {
    return failures.map((f, i) =>
      `  ${i + 1}. [${f.mandatory ? "FAIL" : "warn"}][${f.passType}] ` +
      `row ${f.row}, column "${f.column}", ` +
      `expected ${JSON.stringify(f.expected)}, actual ${JSON.stringify(f.actual)}`
    ).join("\n");
  }

  private static formatUiFailures(failures: UiFailure[]): string {
    return failures.map((f, i) =>
      `  ${i + 1}. [${f.mandatory ? "FAIL" : "warn"}][${f.checkType}] ` +
      `field "${f.field}" — ${f.message}`
    ).join("\n");
  }

  // =========================================================================
  // PRIVATE — UI reading
  // =========================================================================

  private static async readUiValue(
    locator:   Locator,
    fieldName: string
  ): Promise<string> {
    try {
      const tag = await locator.evaluate(
        (el: Element) => el.tagName.toLowerCase()
      );

      // input, textarea, select → inputValue() returns current value
      if (["input", "textarea", "select"].includes(tag)) {
        return (await locator.inputValue()).trim();
      }

      // div, span, p etc. → textContent()
      return (await locator.textContent() ?? "").trim();

    } catch (error) {
      throw new Error(
        `ExcelValidator.readUiValue: could not read field "${fieldName}" — ` +
        ExcelValidator.errorMessage(error)
      );
    }
  }

  // Compare without throwing — used for UI checks
  private static valuesMatch(actual: unknown, expected: unknown): boolean {
    try {
      expect(actual).toEqual(expected);
      return true;
    } catch {
      return false;
    }
  }

  // =========================================================================
  // PRIVATE — formula evaluation
  // =========================================================================

  private static evaluateFormula(entry: FormulaEntry): unknown {
    const text = entry.formula.startsWith("=")
      ? entry.formula.slice(1)
      : entry.formula;

    const scope: Record<string, number> = {};
    let   expression = text;

    for (const [address, input] of Object.entries(entry.inputs)) {
      scope[input.columnName] = input.value;
      expression = expression.replace(
        new RegExp(`\\b${ExcelValidator.escapeRegExp(address)}\\b`, "g"),
        input.columnName
      );
    }

    try {
      return evaluate(expression, scope);
    } catch (error) {
      throw new Error(
        `ExcelValidator.evaluateFormula: row ${entry.row}, ` +
        `column "${entry.column}", formula "${entry.formula}", ` +
        `expression "${expression}" — ${ExcelValidator.errorMessage(error)}`
      );
    }
  }

  private static tryEvaluateFormula(formula: FormulaEntry): unknown {
    try {
      return ExcelValidator.evaluateFormula(formula);
    } catch (error) {
      return `[unevaluable: ${ExcelValidator.errorMessage(error)}]`;
    }
  }

  private static async tryReadCellValue(
    filePath:   string,
    sheet:      string,
    row:        number,
    columnName: string
  ): Promise<unknown> {
    try {
      return await ExcelData.getCellValue(filePath, sheet, row, columnName);
    } catch (error) {
      return `[unreadable: ${ExcelValidator.errorMessage(error)}]`;
    }
  }

  // =========================================================================
  // PRIVATE — json loading + parsing
  // =========================================================================

  private static findEntry(testDataName: string): ExcelEntry {
    const entries = ExcelValidator.loadJson();
    const entry   = entries.find(e => e.testDataName === testDataName);

    if (!entry) {
      throw new Error(
        `ExcelValidator.findEntry: testDataName "${testDataName}" ` +
        `not found in excel.json.\n` +
        `Available: ${entries.map(e => e.testDataName).join(", ")}`
      );
    }

    return entry;
  }

  // Returns undefined instead of throwing — used for optional excel.json lookup
  private static tryGetEntry(testDataName: string): ExcelEntry | undefined {
    try {
      return ExcelValidator.findEntry(testDataName);
    } catch {
      return undefined;
    }
  }

  private static loadJson(): ExcelEntry[] {
    const fullPath = configManager.getExcelJsonPath();
    const cached   = ExcelValidator.jsonCache.get(fullPath);
    if (cached) return cached;

    if (!fs.existsSync(fullPath)) {
      throw new Error(
        `ExcelValidator.loadJson: excel.json not found at "${fullPath}"`
      );
    }

    const parsed = JSON.parse(
      fs.readFileSync(fullPath, "utf8")
    ) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error(`ExcelValidator.loadJson: excel.json must be an array`);
    }

    const entries = parsed.map((item, i) =>
      ExcelValidator.toEntry(item, i)
    );

    ExcelValidator.jsonCache.set(fullPath, entries);
    return entries;
  }

  private static toEntry(value: unknown, index: number): ExcelEntry {
    if (!ExcelValidator.isRecord(value)) {
      throw new Error(`ExcelValidator.toEntry: entry ${index} must be an object`);
    }

    if (typeof value.id !== "number") {
      throw new Error(`ExcelValidator.toEntry: entry ${index} missing numeric id`);
    }

    if (
      typeof value.testDataName !== "string" ||
      value.testDataName.trim() === ""
    ) {
      throw new Error(
        `ExcelValidator.toEntry: entry id ${value.id} missing testDataName`
      );
    }

    if (
      typeof value.filePath !== "string" ||
      value.filePath.trim() === ""
    ) {
      throw new Error(
        `ExcelValidator.toEntry: "${value.testDataName}" missing filePath`
      );
    }

    if (
      typeof value.sheet !== "string" ||
      value.sheet.trim() === ""
    ) {
      throw new Error(
        `ExcelValidator.toEntry: "${value.testDataName}" missing sheet`
      );
    }

    if (!Array.isArray(value.cells) || !Array.isArray(value.formulas)) {
      throw new Error(
        `ExcelValidator.toEntry: "${value.testDataName}" cells and formulas must be arrays`
      );
    }

    const name = value.testDataName;

    return {
      id:           value.id,
      testDataName: name,
      description:  typeof value.description === "string"
                      ? value.description
                      : undefined,
      filePath:     value.filePath,
      sheet:        value.sheet,
      cells:        value.cells.map((c, i) =>
        ExcelValidator.toCellEntry(c, name, i)
      ),
      formulas:     value.formulas.map((f, i) =>
        ExcelValidator.toFormulaEntry(f, name, i)
      ),
    };
  }

  private static toCellEntry(
    value:        unknown,
    testDataName: string,
    index:        number
  ): CellEntry {
    if (!ExcelValidator.isRecord(value)) {
      throw new Error(
        `ExcelValidator.toCellEntry: "${testDataName}" cell ${index} must be an object`
      );
    }

    if (
      typeof value.row !== "number" ||
      !Number.isInteger(value.row)  ||
      value.row < 1
    ) {
      throw new Error(
        `ExcelValidator.toCellEntry: "${testDataName}" cell ${index} invalid row`
      );
    }

    if (
      typeof value.column !== "string" ||
      value.column.trim() === ""
    ) {
      throw new Error(
        `ExcelValidator.toCellEntry: "${testDataName}" cell ${index} invalid column`
      );
    }

    return {
      row:       value.row,
      column:    value.column,
      expected:  value.expected,
      mandatory: value.mandatory !== false,   // defaults to true if omitted
    };
  }

  private static toFormulaEntry(
    value:        unknown,
    testDataName: string,
    index:        number
  ): FormulaEntry {
    if (!ExcelValidator.isRecord(value)) {
      throw new Error(
        `ExcelValidator.toFormulaEntry: "${testDataName}" formula ${index} must be an object`
      );
    }

    if (
      typeof value.row !== "number" ||
      !Number.isInteger(value.row)  ||
      value.row < 1
    ) {
      throw new Error(
        `ExcelValidator.toFormulaEntry: "${testDataName}" formula ${index} invalid row`
      );
    }

    if (
      typeof value.column !== "string" ||
      value.column.trim() === ""
    ) {
      throw new Error(
        `ExcelValidator.toFormulaEntry: "${testDataName}" formula ${index} invalid column`
      );
    }

    if (
      typeof value.formula !== "string" ||
      value.formula.trim() === ""
    ) {
      throw new Error(
        `ExcelValidator.toFormulaEntry: "${testDataName}" formula ${index} invalid formula`
      );
    }

    if (!ExcelValidator.isFormulaInputs(value.inputs)) {
      throw new Error(
        `ExcelValidator.toFormulaEntry: "${testDataName}" formula ${index} invalid inputs`
      );
    }

    return {
      row:       value.row,
      column:    value.column,
      formula:   value.formula,
      expected:  value.expected,
      mandatory: value.mandatory !== false,   // defaults to true if omitted
      inputs:    value.inputs,
    };
  }

  private static isFormulaInputs(
    value: unknown
  ): value is FormulaEntry["inputs"] {
    if (!ExcelValidator.isRecord(value)) return false;

    return Object.values(value).every(
      input =>
        ExcelValidator.isRecord(input)       &&
        typeof input.columnName === "string" &&
        input.columnName.trim() !== ""       &&
        typeof input.value      === "number"
    );
  }

  private static isRecord(
    value: unknown
  ): value is Record<string, unknown> {
    return (
      typeof value === "object" &&
      value !== null            &&
      !Array.isArray(value)
    );
  }

  private static escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private static errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
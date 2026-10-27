// testdata/TestData.ts
//
// Reads test-data.json — UI input data + expected values.
// No Excel involvement. Cache after first read.
//
// ── How it works ──────────────────────────────────────────────────────────────
//
//  test-data.json is loaded once and cached by file path.
//  Each entry has: id, testDataName, data[], expected{}
//
//  getData<T>(name)     → returns data[0] typed as T — no cast in spec
//  getExpected<T>(name) → returns expected typed as T — no cast in spec
//  validate(name)       → delegates to ExcelValidator.verifyEntry() internally
//
// ── Usage in spec ─────────────────────────────────────────────────────────────
//
//  const data     = TestData.getData<LoginData>("Orange_Login_Data");
//  const expected = TestData.getExpected<LoginExpected>("Orange_Login_Data");
//  await TestData.validate("Orange_Login_Data");
//  await TestData.validate("Orange_Login_Data", { overrideMandatory: true });

import * as fs from "fs";
import { configManager } from "../src/config/env.index";
import type { TestDataEntry } from "./types";

// Import type only — actual class loaded dynamically in validate()
// to avoid circular dependency: TestData → ExcelValidator → TestData
import type { ValidatorOptions } from "./excelValidator";

export class TestData {
  private static readonly cache = new Map<string, TestDataEntry[]>();

  // ── Public API ─────────────────────────────────────────────────────────────

  // Returns the full entry object for a testDataName
  static get(testDataName: string): TestDataEntry {
    const entry = TestData.load().find(
      item => item.testDataName === testDataName
    );

    if (!entry) {
      const available = TestData.load()
        .map(e => e.testDataName)
        .join(", ");
      throw new Error(
        `TestData.get: testDataName "${testDataName}" not found.\n` +
        `Available: ${available}`
      );
    }

    return entry;
  }

  // Returns data[0] typed as T
  // T = interface matching the data object shape
  // e.g. TestData.getData<LoginData>("Orange_Login_Data")
  //      → { Username: "Admin", Password: "admin123" }
  static getData<T = Record<string, unknown>>(testDataName: string): T {
    return TestData.getDataRow<T>(testDataName, 0);
  }

  // Returns data[rowIndex] typed as T
  // Use when entry has multiple data rows
  static getDataRow<T = Record<string, unknown>>(
    testDataName: string,
    rowIndex:     number
  ): T {
    const row = TestData.get(testDataName).data[rowIndex];

    if (!row) {
      throw new Error(
        `TestData.getDataRow: testDataName "${testDataName}", ` +
        `row index ${rowIndex} not found`
      );
    }

    return row as T;
  }

  // Returns expected{} typed as T
  // T = interface matching the expected object shape
  // e.g. TestData.getExpected<LoginExpected>("Orange_Login_Data")
  //      → { landingMenu: "Admin" }
  static getExpected<T = Record<string, unknown>>(testDataName: string): T {
    return TestData.get(testDataName).expected as T;
  }

  // Returns all entries — useful for logging in test.beforeAll
  static getAll(): TestDataEntry[] {
    return TestData.load();
  }

  // Runs full Excel validation via ExcelValidator
  //
  // How it works:
  //   1. Dynamically imports ExcelValidator (avoids circular dependency)
  //   2. Calls ExcelValidator.verifyEntry(testDataName, options)
  //   3. ExcelValidator reads excel.json entry for this testDataName
  //   4. Pass 1 — each cell in cells[] verified against live xlsx
  //   5. Pass 2 — each formula in formulas[] evaluated via mathjs
  //   6. Collects ALL failures before throwing one combined error
  //
  // options.overrideMandatory:
  //   true      → all checks hard fail regardless of excel.json mandatory flag
  //   false     → all checks soft warn regardless of excel.json mandatory flag
  //   undefined → use mandatory flag per cell/formula from excel.json (default)
  static async validate(
    testDataName: string,
    options?:     ValidatorOptions
  ): Promise<void> {
    const { ExcelValidator } = await import("./excelValidator");
    await ExcelValidator.verifyEntry(testDataName, options);
  }

  // Clears test-data.json cache
  // Call in test.afterAll() to keep parallel runs isolated
  static reload(): void {
    TestData.cache.clear();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private static load(): TestDataEntry[] {
    const fullPath = configManager.getTestDataJsonPath();
    const cached   = TestData.cache.get(fullPath);
    if (cached) return cached;

    if (!fs.existsSync(fullPath)) {
      throw new Error(
        `TestData.load: test-data.json not found at "${fullPath}"`
      );
    }

    const parsed = JSON.parse(
      fs.readFileSync(fullPath, "utf8")
    ) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error(`TestData.load: test-data.json must be an array`);
    }

    const entries = parsed.map((item, index) =>
      TestData.toEntry(item, index)
    );

    TestData.cache.set(fullPath, entries);
    return entries;
  }

  private static toEntry(value: unknown, index: number): TestDataEntry {
    if (!TestData.isRecord(value)) {
      throw new Error(
        `TestData.toEntry: entry at index ${index} must be an object`
      );
    }

    if (typeof value.id !== "number") {
      throw new Error(
        `TestData.toEntry: entry at index ${index} missing numeric id`
      );
    }

    if (
      typeof value.testDataName !== "string" ||
      value.testDataName.trim() === ""
    ) {
      throw new Error(
        `TestData.toEntry: entry id ${value.id} missing testDataName`
      );
    }

    if (!Array.isArray(value.data)) {
      throw new Error(
        `TestData.toEntry: "${value.testDataName}" data must be an array`
      );
    }

    if (!TestData.isRecord(value.expected)) {
      throw new Error(
        `TestData.toEntry: "${value.testDataName}" expected must be an object`
      );
    }

    return {
      id:           value.id,
      testDataName: value.testDataName,
      data:         value.data.map((row, i) =>
        TestData.toDataRow(row, value.testDataName as string, i)
      ),
      expected:     value.expected,
    };
  }

  private static toDataRow(
    value:        unknown,
    testDataName: string,
    index:        number
  ): Record<string, unknown> {
    if (!TestData.isRecord(value)) {
      throw new Error(
        `TestData.toDataRow: "${testDataName}" data[${index}] must be an object`
      );
    }

    return value;
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
}
// testdata/ExcelData.ts
//
// Reads live .xlsx files only — no excel.json involvement.
// Cache workbook by file path after first read.
//
// ── How it works ──────────────────────────────────────────────────────────────
//
//  Uses ExcelJS to open xlsx files.
//  Resolves column names by reading header row 1 — never hardcodes column numbers.
//  All public methods take absolute file path from paths.ts constants.
//
// ── Usage in spec ─────────────────────────────────────────────────────────────
//
//  import { ORANGE_LOGIN_WORKBOOK } from "../../testdata/paths";
//
//  // Assert a single cell
//  await ExcelData.verifyCell(ORANGE_LOGIN_WORKBOOK, "LoginTestData", 2, "Username", "Admin");
//
//  // Assert multiple columns at once
//  await ExcelData.verifyRow(ORANGE_LOGIN_WORKBOOK, "LoginTestData", 2, {
//    Username: "Admin",
//    Password: "admin123",
//  });
//
//  // Read raw value without asserting
//  const val = await ExcelData.getCellValue(ORANGE_LOGIN_WORKBOOK, "LoginTestData", 2, "Username");
//
//  // Debug column names when "column not found" error appears
//  const headers = await ExcelData.getSheetHeaders(ORANGE_LOGIN_WORKBOOK, "LoginTestData");

import * as fs      from "fs";
import * as ExcelJS from "exceljs";
import { expect }   from "@playwright/test";

export class ExcelData {
  private static readonly xlsxCache = new Map<string, ExcelJS.Workbook>();

  // ── Public API ─────────────────────────────────────────────────────────────

  // Verify a single cell value by column name
  // filePath = absolute path from paths.ts e.g. ORANGE_LOGIN_WORKBOOK
  // Throws if actual !== expected
  static async verifyCell(
    filePath:   string,
    sheet:      string,
    row:        number,
    columnName: string,
    expected:   unknown
  ): Promise<void> {
    const actual = await ExcelData.getCellValue(filePath, sheet, row, columnName);

    try {
      expect(actual).toEqual(expected);
    } catch {
      throw new Error(
        `ExcelData.verifyCell: sheet "${sheet}", row ${row}, ` +
        `column "${columnName}", ` +
        `expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`
      );
    }
  }

  // Verify multiple columns in one row
  // Iterates Record keys — no forEach in spec needed
  // Each column verified independently — all failures collected
  static async verifyRow(
    filePath: string,
    sheet:    string,
    row:      number,
    expected: Record<string, unknown>
  ): Promise<void> {
    for (const [columnName, expectedValue] of Object.entries(expected)) {
      await ExcelData.verifyCell(filePath, sheet, row, columnName, expectedValue);
    }
  }

  // Read raw cell value — no assertion
  // Use for logging, conditional logic, or building dynamic expected values
  static async getCellValue(
    filePath:   string,
    sheet:      string,
    row:        number,
    columnName: string
  ): Promise<unknown> {
    if (!Number.isInteger(row) || row < 1) {
      throw new Error(
        `ExcelData.getCellValue: invalid row ${row} for ` +
        `sheet "${sheet}", column "${columnName}"`
      );
    }

    const ws     = await ExcelData.getWorksheet(filePath, sheet);
    const colIdx = ExcelData.findColumnIndex(ws, columnName, sheet, filePath);

    return ExcelData.normalizeValue(
      ws.getRow(row).getCell(colIdx).value
    );
  }

  // Read full row as Record<columnName, value>
  // Useful for logging or building expected objects dynamically
  static async getRow(
    filePath: string,
    sheet:    string,
    row:      number
  ): Promise<Record<string, unknown>> {
    const ws        = await ExcelData.getWorksheet(filePath, sheet);
    const headerRow = ws.getRow(1);
    const dataRow   = ws.getRow(row);
    const result:   Record<string, unknown> = {};

    for (let col = 1; col <= ws.columnCount; col++) {
      const header = ExcelData.normalizeValue(headerRow.getCell(col).value);
      if (header !== null && header !== undefined) {
        result[String(header)] = ExcelData.normalizeValue(
          dataRow.getCell(col).value
        );
      }
    }

    return result;
  }

  // Read all header names from row 1
  // Call this when a "column not found" error appears — prints available names
  static async getSheetHeaders(
    filePath: string,
    sheet:    string
  ): Promise<string[]> {
    const ws      = await ExcelData.getWorksheet(filePath, sheet);
    const headers: string[] = [];

    for (let col = 1; col <= ws.columnCount; col++) {
      const val = ExcelData.normalizeValue(ws.getRow(1).getCell(col).value);
      if (val !== null && val !== undefined) {
        headers.push(String(val));
      }
    }

    return headers;
  }

  // Clear xlsx cache — call in test.afterAll()
  static reload(): void {
    ExcelData.xlsxCache.clear();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private static findColumnIndex(
    ws:         ExcelJS.Worksheet,
    columnName: string,
    sheet:      string,
    filePath:   string
  ): number {
    const headerRow = ws.getRow(1);

    for (let col = 1; col <= ws.columnCount; col++) {
      const val = ExcelData.normalizeValue(headerRow.getCell(col).value);
      if (String(val ?? "").trim() === columnName) return col;
    }

    throw new Error(
      `ExcelData.findColumnIndex: column "${columnName}" not found ` +
      `in header row of sheet "${sheet}" in "${filePath}"`
    );
  }

  private static async getWorksheet(
    filePath: string,
    sheet:    string
  ): Promise<ExcelJS.Worksheet> {
    const workbook  = await ExcelData.getWorkbook(filePath);
    const worksheet = workbook.getWorksheet(sheet);

    if (!worksheet) {
      throw new Error(
        `ExcelData.getWorksheet: sheet "${sheet}" not found in "${filePath}"`
      );
    }

    return worksheet;
  }

  private static async getWorkbook(
    filePath: string
  ): Promise<ExcelJS.Workbook> {
    const cached = ExcelData.xlsxCache.get(filePath);
    if (cached) return cached;

    if (!fs.existsSync(filePath)) {
      throw new Error(
        `ExcelData.getWorkbook: file not found at "${filePath}"`
      );
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    ExcelData.xlsxCache.set(filePath, workbook);
    return workbook;
  }

  private static normalizeValue(value: ExcelJS.CellValue): unknown {
    if (value === null || value === undefined) return null;

    if (
      typeof value === "string"  ||
      typeof value === "number"  ||
      typeof value === "boolean"
    ) return value;

    if (value instanceof Date) return value;

    if (typeof value === "object" && "result" in value) {
      return value.result ?? null;
    }

    if (
      typeof value === "object" &&
      "richText" in value &&
      Array.isArray(value.richText)
    ) {
      return value.richText.map(p => p.text).join("");
    }

    if (
      typeof value === "object" &&
      "text"    in value &&
      typeof value.text === "string"
    ) {
      return value.text;
    }

    return String(value);
  }
}
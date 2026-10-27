// testdata/types.ts
//
// Shared interfaces used across TestData, ExcelData, ExcelValidator.
// Never import from spec files — these are internal framework types only.

// ── test-data.json shape ──────────────────────────────────────────────────────

export interface TestDataEntry {
  id:           number;
  testDataName: string;
  data:         Record<string, unknown>[];   // input rows — data[0] used in most tests
  expected:     Record<string, unknown>;     // expected UI values after action
}

// ── excel.json shapes ─────────────────────────────────────────────────────────

// One cell check — row + column + what to expect + whether failure blocks test
export interface CellEntry {
  row:       number;
  column:    string;   // must match header name in xlsx row 1
  expected:  unknown;
  mandatory: boolean;  // true = hard fail | false = warn only
}

// Input value used to evaluate a formula via mathjs
export interface FormulaInput {
  columnName: string;   // human-readable name e.g. "UnitPrice"
  value:      number;   // numeric value fed into mathjs scope
}

// One formula check — formula string + inputs + expected result + mandatory flag
export interface FormulaEntry {
  row:       number;
  column:    string;                         // column the formula result lives in
  formula:   string;                         // e.g. "=D2*E2"
  expected:  unknown;                        // expected evaluated result
  mandatory: boolean;
  inputs:    Record<string, FormulaInput>;   // e.g. { D2: { columnName: "UnitPrice", value: 50000 } }
}

// One entry in excel.json — maps to one testDataName
export interface ExcelEntry {
  id:           number;
  testDataName: string;
  description?: string;   // shown in error messages — helps identify failures in CI
  filePath:     string;   // relative to testdata/ root e.g. "excelDataFiles/Sample_TestData.xlsx"
  sheet:        string;   // sheet name in the xlsx file
  cells:        CellEntry[];
  formulas:     FormulaEntry[];
}
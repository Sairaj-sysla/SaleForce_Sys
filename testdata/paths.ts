// testdata/paths.ts
//
// Single source of truth for all xlsx file paths.
// Add new workbook constants here as you add xlsx files.
//
// These are resolved at import time — if the file doesn't exist,
// you get a clear error immediately rather than mid-test.
//
// Usage in spec:
//   import { ORANGE_LOGIN_WORKBOOK } from "../../testdata/paths";
//   await ExcelData.verifyCell(ORANGE_LOGIN_WORKBOOK, "LoginTestData", 2, "Username", "Admin");

import { configManager } from "../src/config/env.index";

// Resolves relative path from testdata/ root to absolute path
// Throws with a clear message if file not found — caught at startup
function resolveWorkbook(relativePath: string): string {
  try {
    return configManager.getExcelFilePath(relativePath);
  } catch {
    throw new Error(
      `paths.ts: workbook not found — "${relativePath}"\n` +
      `Make sure the file exists at: testdata/${relativePath}`
    );
  }
}

// Add your xlsx files here — one constant per file
export const ORANGE_LOGIN_WORKBOOK: string =
  resolveWorkbook("excelDataFiles/Sample_TestData.xlsx");

// Uncomment when PurchaseOrder.xlsx is added to testdata/excelDataFiles/
// export const PURCHASE_ORDER_WORKBOOK: string =
//   resolveWorkbook("excelDataFiles/PurchaseOrder.xlsx");
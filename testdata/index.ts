// testdata/index.ts
//
// Single import point for all testdata classes.
// Import everything from here in spec files — never import directly from individual files.
//
// ── What each export does ─────────────────────────────────────────────────────
//
//  TestData          → reads test-data.json
//                      getData<T>(name)      — input data, fully typed
//                      getExpected<T>(name)  — expected values, fully typed
//                      getDataRow<T>(name,i) — specific data row
//                      getAll()              — all entries, useful in beforeAll
//                      validate(name)        — delegates to ExcelValidator.verifyEntry()
//                      reload()              — clear cache in afterAll
//
//  ExcelData         → reads live .xlsx files only, no excel.json involvement
//                      verifyCell(file,sheet,row,col,expected)  — assert single cell
//                      verifyRow(file,sheet,row,expected)       — assert multiple columns
//                      getCellValue(file,sheet,row,col)         — raw read, no assertion
//                      getRow(file,sheet,row)                   — full row as Record
//                      getSheetHeaders(file,sheet)              — all column names (debug)
//                      reload()                                 — clear cache in afterAll
//
//  ExcelValidator    → reads excel.json + delegates xlsx reads to ExcelData
//                      verifyEntry(name,opts?)        — cells[] + formulas[] for one entry
//                      verifyAllEntries(opts?)         — every entry in excel.json at once
//                      verifyFormula(name,row,col,exp) — single formula via mathjs
//                      verifyUiFields(page,name,map,opts?) — UI vs data + expected + xlsx
//                      getEntry(name)                 — entry metadata (description, sheet)
//                      reload()                       — clear cache in afterAll
//
//  LocatorMap        → type for verifyUiFields field → locator mapping
//                      e.g. { Username: el.username, Password: el.password }
//
//  ValidatorOptions  → type for overrideMandatory option
//                      { overrideMandatory: true }   — all hard fail
//                      { overrideMandatory: false }  — all soft warn
//                      undefined                     — use excel.json flag per field
//
//  ORANGE_LOGIN_WORKBOOK → resolved absolute path to Sample_TestData.xlsx
//                          pass to ExcelData methods as filePath argument
//
// ── Usage in spec ─────────────────────────────────────────────────────────────
//
//  import {
//    TestData,
//    ExcelData,
//    ExcelValidator,
//    ORANGE_LOGIN_WORKBOOK,
//  } from "../../testdata";
//  import type { LocatorMap, ValidatorOptions } from "../../testdata";
//
//  // test-data.json — input + expected
//  const data     = TestData.getData<LoginData>("Orange_Login_Data");
//  const expected = TestData.getExpected<LoginExpected>("Orange_Login_Data");
//
//  // excel.json + xlsx — full validation
//  await TestData.validate("Orange_Login_Data");
//  await TestData.validate("Orange_Login_Data", { overrideMandatory: true });
//
//  // xlsx direct — no excel.json
//  await ExcelData.verifyCell(ORANGE_LOGIN_WORKBOOK, "LoginTestData", 2, "Username", "Admin");
//  await ExcelData.verifyRow(ORANGE_LOGIN_WORKBOOK, "LoginTestData", 2, { Username: "Admin" });
//  const val = await ExcelData.getCellValue(ORANGE_LOGIN_WORKBOOK, "LoginTestData", 2, "Username");
//  const headers = await ExcelData.getSheetHeaders(ORANGE_LOGIN_WORKBOOK, "LoginTestData");
//
//  // excel.json — one entry
//  await ExcelValidator.verifyEntry("Orange_Login_Data");
//  await ExcelValidator.verifyEntry("Orange_Login_Data", { overrideMandatory: false });
//
//  // excel.json — all entries at once
//  await ExcelValidator.verifyAllEntries();
//
//  // excel.json — single formula via mathjs
//  await ExcelValidator.verifyFormula("Orange_Login_Data", 2, "TotalPrice", 100000);
//
//  // UI cross-check — reads UI + compares against data + expected + xlsx
//  await ExcelValidator.verifyUiFields(page, "Orange_Login_Data", {
//    Username: el.username,
//    Password: el.password,
//  });
//  await ExcelValidator.verifyUiFields(page, "Orange_Login_Data", {
//    Username: el.username,
//  }, { overrideMandatory: true });
//
//  // afterAll — clear all caches
//  test.afterAll(() => {
//    TestData.reload();
//    ExcelData.reload();
//    ExcelValidator.reload();
//  });
//
// ─────────────────────────────────────────────────────────────────────────────

export { TestData }                          from "./TestData";
export { ExcelData }                         from "./ExcelData";
export { ExcelValidator }                    from "./excelValidator";
export type { LocatorMap, ValidatorOptions } from "./excelValidator";
export { ORANGE_LOGIN_WORKBOOK }             from "./paths";
// ============================================================================
// FILE UTILS - ENTERPRISE VERSION v2
// ----------------------------------------------------------------------------
// METHODS:
//   1.  clickAndVerifyDownload — click + download + verify (one call)
//   2.  verifyExcel            — verify Excel file on disk
//   3.  verifyPdf              — verify PDF keywords
//   4.  verifyDocx             — verify Word document
//   5.  verifyCsv              — verify CSV rows + schema
//   6.  verifyTxt              — verify text file
//   7.  verifyPdfContent       — verify Indian language bill/invoice PDF
//   8.  verifyDownloadInFolder — check OS downloads folder
//   9.  readExcel              — read rows from Excel
//   10. readCSV                — read rows from CSV
//   11. readJSON               — read JSON file
//   12. readText               — read text file
//   13. writeExcel             — write data to Excel
//   14. writeExcelAuto         — auto-named Excel per test
//   15. writeCSV               — write data to CSV
//   16. writeText              — write string to file
//   17. getLatestFile          — get newest file in folder
//   18. fileExists             — check file exists
// ============================================================================

import * as fs    from "fs";
import * as path  from "path";
import ExcelJS    from "exceljs";
import { parse }  from "csv-parse/sync";
import * as fse   from "fs-extra";
import { Locator } from "@playwright/test";
import { logger }  from "./logger";

export type ColumnType = "string" | "number" | "date" | "email" | "boolean";
export interface ColumnSchema  { name: string; type: ColumnType; required?: boolean; }
export type MatchType          = "exact" | "contains" | "regex";
export type LocationType       = "near-label" | "anywhere" | "auto";

export interface BillField {
  label:     string;
  amount?:   string;
  text?:     string;
  match?:    MatchType;
  location?: LocationType;
  currency?: string;
}

export interface BillFieldResult extends BillField {
  found:        boolean;
  matchedValue: string;
  matchedLine:  string;
  lineNumber:   number;
  strategy:     string;
  confidence:   "high" | "medium" | "low";
  fieldType:    "amount" | "text";
  reason?:      string;
}

export interface PdfBillResult {
  fileName: string; filePath: string; fileSize: string;
  valid: boolean; pageCount: number; language: string;
  text: string; lines: string[];
  allFieldsFound: boolean; fields: BillFieldResult[]; reason?: string;
}

export interface VerifyResult {
  fileName: string; filePath: string; fileSize: string; extension: string;
  valid: boolean; downloaded: boolean;
  rowCount?: number; pageCount?: number; content?: any[]; text?: string;
  containsAll: boolean; missingWords: string[];
  columnErrors: ColumnError[]; columnValid: boolean;
  reason?: string; testName?: string; timestamp?: string;
}

export interface ColumnError {
  row: number; column: string; value: any; expected: ColumnType; reason: string;
}

const MASTER_REPORT_DIR  = path.join(process.cwd(), "test-results", "download-reports");
const MASTER_REPORT_FILE = path.join(MASTER_REPORT_DIR, "master-download-report.xlsx");
const SEPARATORS         = [":", "₹", "Rs.", "Rs ", "INR", "/-", "=", "–", "-"];
const PROXIMITY          = 3;
const MONEY_PATTERN      = /(?:₹|Rs\.?|INR)?\s*[\d,]+(?:\.\d{1,2})?/g;
const SEP                = "─".repeat(80);

// ── Shared log header ─────────────────────────────────────────────────────────
function logHeader(title: string, fileName: string) {
  logger.info("");
  logger.info(SEP);
  logger.info(`${title} | ${fileName}`);
  logger.info(SEP);
}

function logFooterPass(label: string) {
  logger.pass(label);
  logger.info(SEP);
  logger.info("");
}

function logFooterFail(label: string) {
  logger.warn(label);
  logger.info(SEP);
  logger.info("");
}

// ============================================================================
export class FileUtils {

  // ==========================================================================
  // 1. clickAndVerifyDownload
  // ==========================================================================
  static async clickAndVerifyDownload(
    element: Locator,
    expectedExtension: string,
    options?: {
      keywords?: string[]; schema?: ColumnSchema[];
      saveFolder?: string; timeout?: number;
      testInfo?: any; writeReport?: boolean;
    }
  ): Promise<VerifyResult> {
    const saveFolder = options?.saveFolder ?? path.join(process.cwd(), "test-results", "downloads");
    const timeout    = options?.timeout ?? 30_000;
    const ext        = expectedExtension.startsWith(".") ? expectedExtension.toLowerCase() : `.${expectedExtension.toLowerCase()}`;

    if (!fs.existsSync(saveFolder)) fs.mkdirSync(saveFolder, { recursive: true });
    logger.step(`Click + download + verify → expected: ${ext}`);

    const page = element.page();
    let filePath = "", fileName = "", fileSize = "0 B", actualExt = "";

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: attempt === 1 ? timeout : timeout / 2 }),
          element.click(),
        ]);
        fileName  = download.suggestedFilename();
        actualExt = path.extname(fileName).toLowerCase();
        filePath  = path.join(saveFolder, fileName);
        await download.saveAs(filePath);
        if (!fs.existsSync(filePath)) throw new Error(`File not found after save`);
        const bytes = fs.statSync(filePath).size;
        if (bytes === 0) throw new Error(`Downloaded file is empty`);
        fileSize = this.formatSize(bytes);
        logger.pass(`Downloaded → ${fileName} | ${fileSize} | ${actualExt}`);
        break;
      } catch (error: any) {
        if (attempt === 1) { logger.warn(`Download attempt 1 failed — retrying click once...`); continue; }
        logger.error(`Download failed after retry → ${error.message}`);
        const failed = this.fail("", `Download failed: ${error.message}`, options?.testInfo);
        await this.appendMasterReport(failed, options?.testInfo);
        return failed;
      }
    }

    if (actualExt !== ext) {
      const failed = this.fail(filePath, `Extension mismatch — expected: ${ext} | got: ${actualExt}`, options?.testInfo);
      await this.appendMasterReport(failed, options?.testInfo);
      return failed;
    }

    let result: VerifyResult;
    switch (ext) {
      case ".xlsx": case ".xls": result = await this.verifyExcel(filePath, options); break;
      case ".pdf":               result = await this.verifyPdf(filePath, options);   break;
      case ".docx":              result = await this.verifyDocx(filePath, options);  break;
      case ".csv":               result = await this.verifyCsv(filePath, options);   break;
      case ".txt":               result = await this.verifyTxt(filePath, options);   break;
      default: result = this.buildResult(filePath, ext, true, [], [], options?.testInfo);
    }

    result.downloaded = true;
    if (options?.writeReport && options?.testInfo && result.content?.length) {
      await this.writeExcelAuto(options.testInfo, result.content);
    }
    await this.appendMasterReport(result, options?.testInfo);
    return result;
  }

  // ==========================================================================
  // 2. verifyExcel
  // --------------------------------------------------------------------------
  // EXAMPLE:
  //   const result = await FileUtils.verifyExcel("report.xlsx", {
  //     keywords: ["Invoice", "Total"],
  //     schema:   [{ name: "Amount", type: "number" }],
  //     testInfo, writeReport: true,
  //   });
  //   expect(result.valid).toBe(true);
  //   expect(result.columnErrors).toHaveLength(0);
  // ==========================================================================
  static async verifyExcel(
    filePath: string,
    options?: { keywords?: string[]; schema?: ColumnSchema[]; sheetName?: string; testInfo?: any; writeReport?: boolean; }
  ): Promise<VerifyResult> {
    const base = this.baseVerify(filePath, [".xlsx", ".xls"]);
    if (!base.valid) return base;

    logger.step(`Verify Excel → ${path.basename(filePath)}`);

    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const sheet = options?.sheetName ? workbook.getWorksheet(options.sheetName) : workbook.worksheets[0];
      if (!sheet) return this.fail(filePath, `Sheet not found: ${options?.sheetName}`);

      const headers: string[] = [];
      const rows: any[]       = [];

      sheet.eachRow((row, rowIndex) => {
        if (rowIndex === 1) {
          row.eachCell((cell, colIndex) => { headers[colIndex] = String(cell.value ?? `col${colIndex}`); });
          return;
        }
        const rowData: Record<string, any> = {};
        row.eachCell((cell, colIndex) => { rowData[headers[colIndex]] = this.getCellValue(cell); });
        rows.push(rowData);
      });

      const allText      = [...headers, ...rows.flatMap(r => Object.values(r).map(v => String(v ?? "")))].join(" ");
      const missingWords = this.findMissing(options?.keywords, allText);
      const columnErrors = this.validateSchema(rows, options?.schema);
      const result       = this.buildResult(filePath, ".xlsx", true, missingWords, columnErrors, options?.testInfo);
      result.rowCount    = rows.length;
      result.content     = rows;

      // ── Rich logger ───────────────────────────────────────────────────────
      logHeader("EXCEL VERIFICATION", path.basename(filePath));
      logger.info(`File Name  : ${result.fileName}`);
      logger.info(`File Size  : ${result.fileSize}`);
      logger.info(`Sheet      : ${sheet.name}`);
      logger.info(`Rows       : ${rows.length}`);
      logger.info(`Columns    : ${headers.filter(Boolean).join(", ")}`);
      logger.info(SEP);

      // Keywords
      const keywords = options?.keywords ?? [];
      if (keywords.length > 0) {
        keywords.forEach((kw, idx) => {
          const found = allText.toLowerCase().includes(kw.toLowerCase());
          logger.info(`${String(idx + 1).padStart(2, "0")}. Keyword Check`);
          logger.info(`    Expected : "${kw}"`);
          logger.info(`    Actual   : ${found ? `"${kw}"` : "NOT FOUND"}`);
          found ? logger.pass(`    Result   : PASS`) : logger.error(`    Result   : FAIL`);
          logger.info("");
        });
      }

      // Column schema
      if (options?.schema && options.schema.length > 0) {
        logger.info(SEP);
        logger.info("COLUMN TYPE VALIDATION");
        logger.info(SEP);
        options.schema.forEach((col, idx) => {
          const colErrors = columnErrors.filter(e => e.column === col.name);
          logger.info(`${String(idx + 1).padStart(2, "0")}. Column : "${col.name}"`);
          logger.info(`    Expected Type : ${col.type}`);
          if (colErrors.length === 0) {
            logger.pass(`    Result        : PASS — all ${rows.length} rows valid`);
          } else {
            logger.error(`    Result        : FAIL — ${colErrors.length} invalid value(s)`);
            colErrors.slice(0, 3).forEach(e => logger.warn(`    Row ${e.row}: "${e.value}" — ${e.reason}`));
          }
          logger.info("");
        });
      }

      // Summary
      logger.info(SEP);
      const kwPass = missingWords.length === 0;
      const colPass = columnErrors.length === 0;
      if (kwPass && colPass) {
        logFooterPass(
          `RESULT : PASS ✅  |  Rows: ${rows.length}  |  Keywords: ${keywords.length}/${keywords.length}  |  Columns: valid`
        );
      } else {
        logFooterFail(
          `RESULT : FAIL ❌  |  ` +
          (!kwPass ? `Missing keywords: ${missingWords.join(", ")}  |  ` : "") +
          (!colPass ? `Column errors: ${columnErrors.length}` : "")
        );
      }

      if (options?.writeReport && options?.testInfo) await this.writeExcelAuto(options.testInfo, rows);
      return result;

    } catch (error: any) {
      return this.fail(filePath, error.message);
    }
  }

  // ==========================================================================
  // 3. verifyPdf
  // --------------------------------------------------------------------------
  // EXAMPLE:
  //   const result = await FileUtils.verifyPdf("invoice.pdf", {
  //     keywords: ["Invoice No", "Total Amount"],
  //     testInfo, writeReport: true,
  //   });
  //   expect(result.pageCount).toBeGreaterThan(0);
  //   expect(result.containsAll).toBe(true);
  // ==========================================================================
  static async verifyPdf(
    filePath: string,
    options?: { keywords?: string[]; testInfo?: any; writeReport?: boolean; }
  ): Promise<VerifyResult> {
    const base = this.baseVerify(filePath, [".pdf"]);
    if (!base.valid) return base;

    logger.step(`Verify PDF → ${path.basename(filePath)}`);

    try {
      const pdfParse = require("pdf-parse");
      const data     = await pdfParse(fs.readFileSync(filePath));
      const text     = data.text?.trim() ?? "";
      const pageCount = data.numpages ?? 0;

      const missingWords = this.findMissing(options?.keywords, text);
      const result       = this.buildResult(filePath, ".pdf", true, missingWords, [], options?.testInfo);
      result.pageCount   = pageCount;
      result.text        = text;

      // ── Rich logger ───────────────────────────────────────────────────────
      const keywords = options?.keywords ?? [];
      logHeader("PDF VERIFICATION", path.basename(filePath));
      logger.info(`File Name  : ${result.fileName}`);
      logger.info(`File Size  : ${result.fileSize}`);
      logger.info(`Pages      : ${pageCount}`);
      logger.info(`Characters : ${text.length}`);
      logger.info(SEP);

      let passed = 0, failed = 0;
      keywords.forEach((kw, idx) => {
        const found = text.toLowerCase().includes(kw.toLowerCase());
        const kwIdx = found ? text.toLowerCase().indexOf(kw.toLowerCase()) : -1;
        const preview = found
          ? text.substring(Math.max(0, kwIdx - 30), Math.min(text.length, kwIdx + kw.length + 30)).replace(/\n/g, " ")
          : "";
        logger.info(`${String(idx + 1).padStart(2, "0")}. Keyword Check`);
        logger.info(`    Expected : "${kw}"`);
        logger.info(`    Actual   : ${found ? `"${kw}"` : "NOT FOUND"}`);
        if (found) logger.info(`    Context  : "...${preview}..."`);
        found ? logger.pass(`    Result   : PASS`) : logger.error(`    Result   : FAIL`);
        logger.info("");
        found ? passed++ : failed++;
      });

      logger.info(SEP);
      if (failed === 0) {
        logFooterPass(`RESULT : ${passed}/${keywords.length} KEYWORDS PASSED ✅`);
      } else {
        logFooterFail(`RESULT : ${passed} PASSED | ${failed} FAILED ❌  |  Missing: ${missingWords.join(", ")}`);
      }

      if (options?.writeReport && options?.testInfo) {
        await this.writeExcelAuto(options.testInfo,
          keywords.map(kw => ({
            Keyword: kw,
            Expected: kw,
            Actual: text.toLowerCase().includes(kw.toLowerCase()) ? kw : "NOT FOUND",
            Result: text.toLowerCase().includes(kw.toLowerCase()) ? "PASS" : "FAIL",
          }))
        );
      }

      return result;

    } catch (error: any) {
      if (error.code === "MODULE_NOT_FOUND") throw new Error("Run: npm install pdf-parse");
      return this.fail(filePath, error.message);
    }
  }

  // ==========================================================================
  // 4. verifyDocx
  // --------------------------------------------------------------------------
  // EXAMPLE:
  //   const result = await FileUtils.verifyDocx("contract.docx", {
  //     keywords: ["Agreement", "Signed By"],
  //     testInfo, writeReport: true,
  //   });
  //   expect(result.containsAll).toBe(true);
  // ==========================================================================
  static async verifyDocx(
    filePath: string,
    options?: { keywords?: string[]; testInfo?: any; writeReport?: boolean; }
  ): Promise<VerifyResult> {
    const base = this.baseVerify(filePath, [".docx"]);
    if (!base.valid) return base;

    logger.step(`Verify DOCX → ${path.basename(filePath)}`);

    try {
      const mammoth      = require("mammoth");
      const res          = await mammoth.extractRawText({ path: filePath });
      const text         = res.value?.trim() ?? "";
      const missingWords = this.findMissing(options?.keywords, text);
      const result       = this.buildResult(filePath, ".docx", true, missingWords, [], options?.testInfo);
      result.text        = text;

      // ── Rich logger ───────────────────────────────────────────────────────
      const keywords = options?.keywords ?? [];
      logHeader("DOCX VERIFICATION", path.basename(filePath));
      logger.info(`File Name  : ${result.fileName}`);
      logger.info(`File Size  : ${result.fileSize}`);
      logger.info(`Characters : ${text.length}`);
      logger.info(`Words      : ${text.split(/\s+/).filter(Boolean).length}`);
      logger.info(SEP);

      let passed = 0, failed = 0;
      keywords.forEach((kw, idx) => {
        const found = text.toLowerCase().includes(kw.toLowerCase());
        const kwIdx = found ? text.toLowerCase().indexOf(kw.toLowerCase()) : -1;
        const preview = found
          ? text.substring(Math.max(0, kwIdx - 30), Math.min(text.length, kwIdx + kw.length + 30)).replace(/\n/g, " ")
          : "";
        logger.info(`${String(idx + 1).padStart(2, "0")}. Keyword Check`);
        logger.info(`    Expected : "${kw}"`);
        logger.info(`    Actual   : ${found ? `"${kw}"` : "NOT FOUND"}`);
        if (found) logger.info(`    Context  : "...${preview}..."`);
        found ? logger.pass(`    Result   : PASS`) : logger.error(`    Result   : FAIL`);
        logger.info("");
        found ? passed++ : failed++;
      });

      logger.info(SEP);
      if (failed === 0) {
        logFooterPass(`RESULT : ${passed}/${keywords.length} KEYWORDS PASSED ✅`);
      } else {
        logFooterFail(`RESULT : ${passed} PASSED | ${failed} FAILED ❌  |  Missing: ${missingWords.join(", ")}`);
      }

      if (options?.writeReport && options?.testInfo) {
        await this.writeExcelAuto(options.testInfo,
          keywords.map(kw => ({
            Keyword: kw,
            Expected: kw,
            Actual: text.toLowerCase().includes(kw.toLowerCase()) ? kw : "NOT FOUND",
            Result: text.toLowerCase().includes(kw.toLowerCase()) ? "PASS" : "FAIL",
          }))
        );
      }

      return result;

    } catch (error: any) {
      if (error.code === "MODULE_NOT_FOUND") throw new Error("Run: npm install mammoth");
      return this.fail(filePath, error.message);
    }
  }

  // ==========================================================================
  // 5. verifyCsv
  // --------------------------------------------------------------------------
  // EXAMPLE:
  //   const result = await FileUtils.verifyCsv("users.csv", {
  //     keywords: ["admin@test.com"],
  //     schema:   [{ name: "email", type: "email" }, { name: "age", type: "number" }],
  //     testInfo, writeReport: true,
  //   });
  //   expect(result.rowCount).toBeGreaterThan(0);
  //   expect(result.columnValid).toBe(true);
  // ==========================================================================
  static async verifyCsv(
    filePath: string,
    options?: { keywords?: string[]; schema?: ColumnSchema[]; testInfo?: any; writeReport?: boolean; }
  ): Promise<VerifyResult> {
    const base = this.baseVerify(filePath, [".csv"]);
    if (!base.valid) return base;

    logger.step(`Verify CSV → ${path.basename(filePath)}`);

    try {
      const rows         = parse(fs.readFileSync(filePath, "utf-8"), { columns: true, skip_empty_lines: true, trim: true }) as any[];
      const allText      = rows.flatMap(r => Object.values(r).map(v => String(v ?? ""))).join(" ");
      const missingWords = this.findMissing(options?.keywords, allText);
      const columnErrors = this.validateSchema(rows, options?.schema);
      const result       = this.buildResult(filePath, ".csv", true, missingWords, columnErrors, options?.testInfo);
      result.rowCount    = rows.length;
      result.content     = rows;

      // ── Rich logger ───────────────────────────────────────────────────────
      const keywords = options?.keywords ?? [];
      const headers  = rows.length > 0 ? Object.keys(rows[0]) : [];
      logHeader("CSV VERIFICATION", path.basename(filePath));
      logger.info(`File Name  : ${result.fileName}`);
      logger.info(`File Size  : ${result.fileSize}`);
      logger.info(`Rows       : ${rows.length}`);
      logger.info(`Columns    : ${headers.join(", ")}`);
      logger.info(SEP);

      // Keywords
      let kwPassed = 0, kwFailed = 0;
      keywords.forEach((kw, idx) => {
        const found = allText.toLowerCase().includes(kw.toLowerCase());
        logger.info(`${String(idx + 1).padStart(2, "0")}. Keyword Check`);
        logger.info(`    Expected : "${kw}"`);
        logger.info(`    Actual   : ${found ? `"${kw}"` : "NOT FOUND"}`);
        found ? logger.pass(`    Result   : PASS`) : logger.error(`    Result   : FAIL`);
        logger.info("");
        found ? kwPassed++ : kwFailed++;
      });

      // Column schema
      if (options?.schema && options.schema.length > 0) {
        logger.info(SEP);
        logger.info("COLUMN TYPE VALIDATION");
        logger.info(SEP);
        options.schema.forEach((col, idx) => {
          const colErrors = columnErrors.filter(e => e.column === col.name);
          // sample actual value from first row
          const sampleVal = rows.length > 0 ? String(rows[0][col.name] ?? "(empty)") : "(no rows)";
          logger.info(`${String(idx + 1).padStart(2, "0")}. Column : "${col.name}"`);
          logger.info(`    Expected Type : ${col.type}`);
          logger.info(`    Sample Value  : "${sampleVal}"`);
          if (colErrors.length === 0) {
            logger.pass(`    Result        : PASS — all ${rows.length} rows valid`);
          } else {
            logger.error(`    Result        : FAIL — ${colErrors.length} invalid value(s)`);
            colErrors.slice(0, 3).forEach(e => logger.warn(`    Row ${e.row}: "${e.value}" — ${e.reason}`));
          }
          logger.info("");
        });
      }

      logger.info(SEP);
      const allOk = kwFailed === 0 && columnErrors.length === 0;
      if (allOk) {
        logFooterPass(`RESULT : PASS ✅  |  Rows: ${rows.length}  |  Keywords: ${kwPassed}/${keywords.length}  |  Columns: valid`);
      } else {
        logFooterFail(
          `RESULT : FAIL ❌  |  ` +
          (kwFailed > 0 ? `Missing keywords: ${missingWords.join(", ")}  |  ` : "") +
          (columnErrors.length > 0 ? `Column errors: ${columnErrors.length}` : "")
        );
      }

      if (options?.writeReport && options?.testInfo) await this.writeExcelAuto(options.testInfo, rows);
      return result;

    } catch (error: any) {
      return this.fail(filePath, error.message);
    }
  }

  // ==========================================================================
  // 6. verifyTxt
  // --------------------------------------------------------------------------
  // EXAMPLE:
  //   const result = await FileUtils.verifyTxt("output.txt", {
  //     keywords: ["SUCCESS", "Order processed"],
  //     testInfo,
  //   });
  //   expect(result.containsAll).toBe(true);
  // ==========================================================================
  static async verifyTxt(
    filePath: string,
    options?: { keywords?: string[]; testInfo?: any; writeReport?: boolean; }
  ): Promise<VerifyResult> {
    const base = this.baseVerify(filePath, [".txt"]);
    if (!base.valid) return base;

    logger.step(`Verify TXT → ${path.basename(filePath)}`);

    try {
      const text         = fs.readFileSync(filePath, "utf-8").trim();
      const missingWords = this.findMissing(options?.keywords, text);
      const result       = this.buildResult(filePath, ".txt", true, missingWords, [], options?.testInfo);
      result.text        = text;

      // ── Rich logger ───────────────────────────────────────────────────────
      const keywords = options?.keywords ?? [];
      const lines    = text.split("\n").filter(Boolean);
      logHeader("TXT VERIFICATION", path.basename(filePath));
      logger.info(`File Name  : ${result.fileName}`);
      logger.info(`File Size  : ${result.fileSize}`);
      logger.info(`Lines      : ${lines.length}`);
      logger.info(`Characters : ${text.length}`);
      logger.info(SEP);

      let passed = 0, failed = 0;
      keywords.forEach((kw, idx) => {
        const found  = text.toLowerCase().includes(kw.toLowerCase());
        const lineNo = found
          ? lines.findIndex(l => l.toLowerCase().includes(kw.toLowerCase())) + 1
          : -1;
        const matchedLine = lineNo > 0 ? lines[lineNo - 1].trim() : "";
        logger.info(`${String(idx + 1).padStart(2, "0")}. Keyword Check`);
        logger.info(`    Expected : "${kw}"`);
        logger.info(`    Actual   : ${found ? `"${kw}"` : "NOT FOUND"}`);
        if (found) {
          logger.info(`    Found on : Line ${lineNo}`);
          logger.info(`    Full line: "${matchedLine.substring(0, 80)}${matchedLine.length > 80 ? "…" : ""}"`);
        }
        found ? logger.pass(`    Result   : PASS`) : logger.error(`    Result   : FAIL`);
        logger.info("");
        found ? passed++ : failed++;
      });

      logger.info(SEP);
      if (failed === 0) {
        logFooterPass(`RESULT : ${passed}/${keywords.length} KEYWORDS PASSED ✅`);
      } else {
        logFooterFail(`RESULT : ${passed} PASSED | ${failed} FAILED ❌  |  Missing: ${missingWords.join(", ")}`);
      }

      if (options?.writeReport && options?.testInfo) {
        await this.writeExcelAuto(options.testInfo,
          keywords.map(kw => ({
            Keyword: kw,
            Expected: kw,
            Actual: text.toLowerCase().includes(kw.toLowerCase()) ? kw : "NOT FOUND",
            Result: text.toLowerCase().includes(kw.toLowerCase()) ? "PASS" : "FAIL",
          }))
        );
      }

      return result;

    } catch (error: any) {
      return this.fail(filePath, error.message);
    }
  }

  // ==========================================================================
  // 7. verifyPdfContent — Indian language bill/invoice PDF verification
  // --------------------------------------------------------------------------
  // EXAMPLE:
  //   const result = await FileUtils.verifyPdfContent(dl.filePath, {
  //     fields: [
  //       { label: "Total Amount",  amount: "2400.00", currency: "₹" },
  //       { label: "Status",        text: "PAID",      match: "exact"    },
  //       { label: "Customer Name", text: "Raj",       match: "contains" },
  //       { label: "Invoice No",    text: "INV-\\d+",  match: "regex"    },
  //     ],
  //     testInfo, writeReport: true,
  //   });
  //   expect(result.allFieldsFound).toBe(true);
  // ==========================================================================
  static async verifyPdfContent(
    filePath: string,
    options: { fields: BillField[]; testInfo?: any; writeReport?: boolean; }
  ): Promise<PdfBillResult> {

    if (!fs.existsSync(filePath)) {
      logger.error(`PDF not found → ${filePath}`);
      return this.buildBillFail(filePath, `File not found: ${path.basename(filePath)}`);
    }

    logger.step(`Verify PDF bill → ${path.basename(filePath)}`);

    let text = "", pageCount = 0;
    try {
      const pdfParse = require("pdf-parse");
      const data     = await pdfParse(fs.readFileSync(filePath));
      text           = data.text ?? "";
      pageCount      = data.numpages ?? 0;
    } catch (err: any) {
      if (err.code === "MODULE_NOT_FOUND") throw new Error("Run: npm install pdf-parse");
      return this.buildBillFail(filePath, `PDF read failed: ${err.message}`);
    }

    const lines    = text.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);
    const language = this.detectScript(text);
    const fileSize = this.formatSize(fs.statSync(filePath).size);

    // ── Verify each field ─────────────────────────────────────────────────────
    const fieldResults: BillFieldResult[] = options.fields.map(field => {
      if (field.amount !== undefined) return this.verifyBillAmount(field, lines, text);
      if (field.text   !== undefined) return this.verifyBillText(field, lines);
      logger.warn(`Field "${field.label}" has neither amount nor text — skipping`);
      return this.buildBillFieldFail(field, "no amount or text specified");
    });

    const allFieldsFound = fieldResults.every(f => f.found);

    // ── Rich logger ───────────────────────────────────────────────────────────
    const pad = (s: string, n: number) => s.padEnd(n).substring(0, n);

    logHeader("PDF BILL VERIFICATION", path.basename(filePath));
    logger.info(`File Name  : ${path.basename(filePath)}`);
    logger.info(`File Size  : ${fileSize}`);
    logger.info(`Pages      : ${pageCount}`);
    logger.info(`Script     : ${language}`);
    logger.info(`Lines      : ${lines.length}`);
    logger.info(SEP);

    fieldResults.forEach((f, idx) => {
      const expected = f.amount ?? f.text ?? "";
      const actual   = f.matchedValue || "NOT FOUND";
      const matchHow = f.fieldType === "amount" ? "amount" : `${f.match ?? "contains"}`;

      logger.info(`${String(idx + 1).padStart(2, "0")}. ${pad(f.label, 20)}  ${f.found ? "✅ PASS" : "❌ FAIL"}`);
      logger.info(`    Expected  : "${expected}"  [${matchHow}]`);
      logger.info(`    Actual    : "${actual}"`);
      if (f.found) {
        logger.info(`    Line No   : ${f.lineNumber}  |  strategy: ${f.strategy}  |  confidence: ${f.confidence}`);
        logger.info(`    Full line : "${f.matchedLine.substring(0, 80)}${f.matchedLine.length > 80 ? "…" : ""}"`);
        logger.pass(`    Result    : PASS`);
      } else {
        logger.error(`    Result    : FAIL`);
        logger.warn(`    ⚠ Not found in PDF — verify the expected value matches PDF content exactly`);
      }
      logger.info("");
    });

    logger.info(SEP);
    if (allFieldsFound) {
      const hi  = fieldResults.filter(f => f.confidence === "high").length;
      const med = fieldResults.filter(f => f.confidence === "medium").length;
      const low = fieldResults.filter(f => f.confidence === "low").length;
      logFooterPass(
        `RESULT : ALL ${fieldResults.length} FIELD(S) PASSED ✅  |  high: ${hi}  medium: ${med}  low: ${low}`
      );
    } else {
      const passed  = fieldResults.filter(f => f.found).length;
      const failed  = fieldResults.filter(f => !f.found).length;
      const missing = fieldResults.filter(f => !f.found).map(f => `"${f.label}"`);
      logFooterFail(
        `RESULT : ${passed} PASSED / ${failed} FAILED ❌  |  Missing: ${missing.join(", ")}`
      );
    }

    const result: PdfBillResult = {
      fileName: path.basename(filePath), filePath, fileSize,
      valid: true, pageCount, language, text, lines,
      allFieldsFound, fields: fieldResults,
    };

    if (options.writeReport && options.testInfo) {
      await this.writeBillReport(options.testInfo, fieldResults);
    }

    return result;
  }

  // ==========================================================================
  // 8. verifyDownloadInFolder
  // --------------------------------------------------------------------------
  // EXAMPLE:
  //   const result = await FileUtils.verifyDownloadInFolder(
  //     "C:/Users/user/Downloads", ".xlsx",
  //     { waitMs: 8000, fileNameContains: "report" }
  //   );
  //   expect(result.downloaded).toBe(true);
  // ==========================================================================
  static async verifyDownloadInFolder(
    folderPath: string, expectedExtension: string,
    options?: { waitMs?: number; fileNameContains?: string }
  ): Promise<{ fileName: string; filePath: string; fileSize: string; downloaded: boolean }> {
    const waitMs   = options?.waitMs ?? 5000;
    const deadline = Date.now() + waitMs;
    logger.step(`Check folder → ${expectedExtension}`);

    while (Date.now() < deadline) {
      if (!fs.existsSync(folderPath)) { await this.sleep(500); continue; }
      const files = fs.readdirSync(folderPath)
        .filter(f => path.extname(f).toLowerCase() === expectedExtension.toLowerCase()
          && (!options?.fileNameContains || f.toLowerCase().includes(options.fileNameContains.toLowerCase())))
        .map(f => ({ name: f, time: fs.statSync(path.join(folderPath, f)).mtime.getTime() }))
        .sort((a, b) => b.time - a.time);

      if (files.length > 0) {
        const fp   = path.join(folderPath, files[0].name);
        const size = this.formatSize(fs.statSync(fp).size);
        logger.pass(`Found → ${files[0].name} | ${size}`);
        return { fileName: files[0].name, filePath: fp, fileSize: size, downloaded: true };
      }
      await this.sleep(500);
    }

    logger.error(`No ${expectedExtension} found after ${waitMs}ms`);
    return { fileName: "", filePath: "", fileSize: "0 B", downloaded: false };
  }

  // ==========================================================================
  // 9. readExcel
  // ==========================================================================
  static async readExcel(filePath: string, sheetName?: string): Promise<any[]> {
    if (!fs.existsSync(filePath)) throw new Error(`Excel not found → ${filePath}`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
    if (!sheet) throw new Error(`Sheet not found: ${sheetName}`);
    const headers: string[] = [];
    const rows: any[]       = [];
    sheet.eachRow((row, rowIndex) => {
      if (rowIndex === 1) {
        row.eachCell((cell, colIndex) => { headers[colIndex] = String(cell.value ?? `col${colIndex}`); });
        return;
      }
      const rowData: Record<string, any> = {};
      row.eachCell((cell, colIndex) => { rowData[headers[colIndex]] = this.getCellValue(cell); });
      rows.push(rowData);
    });
    return rows;
  }

  // ==========================================================================
  // 10. readCSV
  // ==========================================================================
  static readCSV(filePath: string): any[] {
    if (!fs.existsSync(filePath)) throw new Error(`CSV not found → ${filePath}`);
    return parse(fs.readFileSync(filePath, "utf-8"), { columns: true, skip_empty_lines: true, trim: true });
  }

  // ==========================================================================
  // 11. readJSON
  // ==========================================================================
  static readJSON(filePath: string): any {
    if (!fs.existsSync(filePath)) throw new Error(`JSON not found → ${filePath}`);
    return fse.readJSONSync(filePath);
  }

  // ==========================================================================
  // 12. readText
  // ==========================================================================
  static readText(filePath: string): string {
    if (!fs.existsSync(filePath)) throw new Error(`File not found → ${filePath}`);
    return fs.readFileSync(filePath, "utf-8");
  }

  // ==========================================================================
  // 13. writeExcel
  // ==========================================================================
  static async writeExcel(filePath: string, data: any[], sheetName = "Sheet1"): Promise<void> {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const workbook = new ExcelJS.Workbook();
    const sheet    = workbook.addWorksheet(sheetName);
    if (data.length === 0) { await workbook.xlsx.writeFile(filePath); return; }
    sheet.columns = Object.keys(data[0]).map(key => ({ header: key, key, width: 20 }));
    sheet.getRow(1).font      = { bold: true };
    sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
    data.forEach(row => sheet.addRow(row));
    await workbook.xlsx.writeFile(filePath);
  }

  // ==========================================================================
  // 14. writeExcelAuto
  // ==========================================================================
  static async writeExcelAuto(testInfo: any, data: any[], folder = "test-results/excel"): Promise<string> {
    const testName  = (testInfo?.title ?? "test").replace(/\s+/g, "_");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir       = path.join(process.cwd(), folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const fullPath  = path.join(dir, `Excel_${testName}_${timestamp}.xlsx`);
    await this.writeExcel(fullPath, data);
    logger.pass(`Excel saved → ${fullPath}`);
    return fullPath;
  }

  // ==========================================================================
  // 15. writeCSV
  // ==========================================================================
  static writeCSV(filePath: string, data: any[]): void {
    fs.writeFileSync(filePath,
      Object.keys(data[0]).join(",") + "\n" +
      data.map(r => Object.values(r).join(",")).join("\n")
    );
  }

  // ==========================================================================
  // 16. writeText
  // ==========================================================================
  static writeText(filePath: string, content: string): void {
    fs.writeFileSync(filePath, content, "utf-8");
  }

  // ==========================================================================
  // 17. getLatestFile
  // ==========================================================================
  static getLatestFile(directoryPath: string): string {
    const files = fs.readdirSync(directoryPath);
    if (files.length === 0) throw new Error("No files found.");
    return path.join(directoryPath, files
      .map(f => ({ name: f, time: fs.statSync(path.join(directoryPath, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time)[0].name);
  }

  // ==========================================================================
  // 18. fileExists
  // ==========================================================================
  static fileExists(filePath: string): boolean { return fs.existsSync(filePath); }

  // ==========================================================================
  // PRIVATE — bill amount verification
  // ==========================================================================
  private static verifyBillAmount(field: BillField, lines: string[], fullText: string): BillFieldResult {
    const amount = field.amount!;

    for (let i = 0; i < lines.length; i++) {
      if (this.amountInLine(lines[i], amount, field.currency)) {
        if (SEPARATORS.some(s => lines[i].includes(s))) {
          return this.billPass(field, "amount", lines[i], this.extractAmount(lines[i], amount), i + 1, "same-line", "high");
        }
      }
    }

    for (let i = 0; i < lines.length; i++) {
      if (this.amountInLine(lines[i], amount, field.currency)) {
        const above = lines.slice(Math.max(0, i - PROXIMITY), i);
        const hasLabelAbove = above.some(l =>
          SEPARATORS.some(s => l.trimEnd().endsWith(s)) || (!/\d/.test(l) && l.length > 2)
        );
        if (hasLabelAbove) {
          return this.billPass(field, "amount", lines[i], this.extractAmount(lines[i], amount), i + 1, "proximity", "high");
        }
      }
    }

    const allAmounts = [...fullText.matchAll(MONEY_PATTERN)].map(m => m[0].trim());
    const norm       = this.normaliseAmount(amount);
    const matched    = allAmounts.find(a =>
      this.normaliseAmount(a) === norm || this.normaliseAmount(a).includes(norm) || norm.includes(this.normaliseAmount(a))
    );
    if (matched) {
      const li = lines.findIndex(l => l.includes(matched));
      return this.billPass(field, "amount", li >= 0 ? lines[li] : matched, matched, li + 1, "amount-pattern", "medium");
    }

    for (let i = 0; i < lines.length; i++) {
      if (this.amountInLine(lines[i], amount, field.currency)) {
        return this.billPass(field, "amount", lines[i], this.extractAmount(lines[i], amount), i + 1, "anywhere", "low");
      }
    }

    return this.buildBillFieldFail(field, "not found in PDF");
  }

  // ==========================================================================
  // PRIVATE — bill text verification
  // ==========================================================================
  private static verifyBillText(field: BillField, lines: string[]): BillFieldResult {
    const value     = field.text!;
    const matchType = field.match    ?? "contains";
    const location  = field.location ?? "auto";

    if (location === "near-label" || location === "auto") {
      for (let i = 0; i < lines.length; i++) {
        const line        = lines[i];
        const isLabelLine =
          SEPARATORS.some(s => line.includes(s)) ||
          (!/\d/.test(line) && line.length > 2 && line.length < 60);
        if (isLabelLine) {
          const window = lines.slice(i, i + PROXIMITY + 1);
          for (let wi = 0; wi < window.length; wi++) {
            const matched = this.textMatchesLine(window[wi], value, matchType);
            if (matched !== null) {
              return this.billPass(field, "text", window[wi], matched, i + wi + 1, `near-label-${matchType}`, "high");
            }
          }
        }
      }
    }

    if (location === "anywhere" || location === "auto") {
      for (let i = 0; i < lines.length; i++) {
        const matched = this.textMatchesLine(lines[i], value, matchType);
        if (matched !== null) {
          return this.billPass(
            field, "text", lines[i], matched, i + 1,
            `anywhere-${matchType}`,
            location === "anywhere" ? "high" : "low"
          );
        }
      }
    }

    return this.buildBillFieldFail(field, `"${value}" not found (match: ${matchType})`);
  }

  private static textMatchesLine(line: string, value: string, matchType: MatchType): string | null {
    switch (matchType) {
      case "exact": {
        if (line.trim().toLowerCase() === value.trim().toLowerCase()) return line.trim();
        for (const seg of line.split(/[:₹=\-–|,]/)) {
          if (seg.trim().toLowerCase() === value.trim().toLowerCase()) return seg.trim();
        }
        return null;
      }
      case "contains": {
        if (!line.toLowerCase().includes(value.toLowerCase())) return null;
        const idx = line.toLowerCase().indexOf(value.toLowerCase());
        return line.substring(Math.max(0, idx - 2), Math.min(line.length, idx + value.length + 2)).trim();
      }
      case "regex": {
        try {
          const match = line.match(new RegExp(value, "i"));
          return match ? match[0] : null;
        } catch {
          logger.warn(`Invalid regex: "${value}"`);
          return null;
        }
      }
      default: return null;
    }
  }

  private static amountInLine(line: string, amount: string, currency?: string): boolean {
    const l = line.replace(/\s+/g, " "), a = amount.trim();
    if (l.includes(a))                                        return true;
    if (currency && l.includes(`${currency}${a}`))           return true;
    if (currency && l.includes(`${currency} ${a}`))          return true;
    if (l.includes(`${a}.00`))                                return true;
    if (l.includes(`${a}.0`))                                 return true;
    if (l.includes(a.replace(/\B(?=(\d{3})+(?!\d))/g, ","))) return true;
    if (l.includes(a.replace(/,/g, "")))                      return true;
    return false;
  }

  private static extractAmount(line: string, amount: string): string {
    const idx = line.indexOf(amount);
    return idx >= 0 ? line.substring(Math.max(0, idx - 1), idx + amount.length + 4).trim() : amount;
  }

  private static normaliseAmount(val: string): string {
    return val.replace(/[₹Rs.\s]/g, "").replace(/,/g, "").replace(/\.00$/, "").trim();
  }

  private static detectScript(text: string): string {
    const scripts: Record<string, RegExp> = {
      devanagari: /[\u0900-\u097F]/, tamil:     /[\u0B80-\u0BFF]/,
      telugu:     /[\u0C00-\u0C7F]/, kannada:   /[\u0C80-\u0CFF]/,
      malayalam:  /[\u0D00-\u0D7F]/, bengali:   /[\u0980-\u09FF]/,
      gujarati:   /[\u0A80-\u0AFF]/, punjabi:   /[\u0A00-\u0A7F]/,
      odia:       /[\u0B00-\u0B7F]/,
    };
    const counts = Object.entries(scripts)
      .map(([name, re]) => ({ name, count: (text.match(new RegExp(re.source, "g")) ?? []).length }))
      .sort((a, b) => b.count - a.count);
    return counts[0]?.count > 0 ? counts[0].name : "latin";
  }

  private static billPass(
    field: BillField, fieldType: "amount" | "text",
    matchedLine: string, matchedValue: string,
    lineNumber: number, strategy: string, confidence: "high" | "medium" | "low"
  ): BillFieldResult {
    return { ...field, found: true, fieldType, matchedLine, matchedValue, lineNumber, strategy, confidence };
  }

  private static buildBillFieldFail(field: BillField, reason: string): BillFieldResult {
    return {
      ...field, found: false,
      fieldType:    field.amount !== undefined ? "amount" : "text",
      matchedLine:  "", matchedValue: "", lineNumber: 0,
      strategy: "not-found", confidence: "low", reason,
    };
  }

  private static buildBillFail(filePath: string, reason: string): PdfBillResult {
    logger.error(`PDF bill verify failed → ${reason}`);
    return {
      fileName: path.basename(filePath), filePath,
      fileSize: "0 B", valid: false, pageCount: 0, language: "unknown",
      text: "", lines: [], allFieldsFound: false, fields: [], reason,
    };
  }

  private static async writeBillReport(testInfo: any, fields: BillFieldResult[]): Promise<void> {
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet    = workbook.addWorksheet("PDF Bill Verify");
      const dir      = path.join(process.cwd(), "test-results", "excel");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      sheet.columns = [
        { header: "Label",        key: "label",        width: 20 },
        { header: "Type",         key: "fieldType",    width: 10 },
        { header: "Expected",     key: "expected",     width: 20 },
        { header: "Match",        key: "match",        width: 12 },
        { header: "Result",       key: "result",       width: 12 },
        { header: "Matched",      key: "matchedValue", width: 25 },
        { header: "Matched Line", key: "matchedLine",  width: 50 },
        { header: "Line No",      key: "lineNumber",   width: 10 },
        { header: "Strategy",     key: "strategy",     width: 22 },
        { header: "Confidence",   key: "confidence",   width: 12 },
      ];
      sheet.getRow(1).font      = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
      sheet.getRow(1).fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };

      fields.forEach(f => {
        const row = sheet.addRow({
          label: f.label, fieldType: f.fieldType,
          expected: f.amount ?? f.text ?? "",
          match: f.match ?? (f.fieldType === "amount" ? "amount" : "contains"),
          result: f.found ? "✅ PASS" : "❌ FAIL",
          matchedValue: f.matchedValue || "—", matchedLine: f.matchedLine || "—",
          lineNumber: f.lineNumber || "—", strategy: f.strategy, confidence: f.confidence,
        });
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: f.found ? "FFE2EFDA" : "FFFFC7CE" } };
      });

      const name = (testInfo?.title ?? "test").replace(/\s+/g, "_");
      const file = `PDF_Bill_${name}_${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx`;
      await workbook.xlsx.writeFile(path.join(dir, file));
      logger.pass(`PDF bill report → test-results/excel/${file}`);
    } catch { /* non-fatal */ }
  }

  private static validateSchema(rows: any[], schema?: ColumnSchema[]): ColumnError[] {
    if (!schema || schema.length === 0) return [];
    const errors: ColumnError[] = [];
    rows.forEach((row, rowIndex) => {
      schema.forEach(col => {
        const value    = row[col.name];
        const required = col.required !== false;
        if (required && (value === undefined || value === null || value === "")) {
          errors.push({ row: rowIndex + 2, column: col.name, value, expected: col.type, reason: "Required value is empty" });
          return;
        }
        if (value === undefined || value === null || value === "") return;
        if (!this.checkType(value, col.type)) {
          errors.push({ row: rowIndex + 2, column: col.name, value, expected: col.type, reason: `Expected ${col.type} but got "${value}"` });
        }
      });
    });
    return errors;
  }

  private static checkType(value: any, type: ColumnType): boolean {
    const str = String(value).trim();
    switch (type) {
      case "number":  return !isNaN(Number(str)) && str !== "";
      case "date":    return !isNaN(Date.parse(str)) || value instanceof Date;
      case "email":   return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
      case "boolean": return ["true","false","yes","no","1","0"].includes(str.toLowerCase());
      case "string":  return typeof value === "string" || typeof value === "number";
      default:        return true;
    }
  }

  private static async appendMasterReport(result: VerifyResult, testInfo?: any): Promise<void> {
    try {
      if (!fs.existsSync(MASTER_REPORT_DIR)) fs.mkdirSync(MASTER_REPORT_DIR, { recursive: true });
      const workbook  = new ExcelJS.Workbook();
      const sheetName = "Download Summary";
      if (fs.existsSync(MASTER_REPORT_FILE)) await workbook.xlsx.readFile(MASTER_REPORT_FILE);
      let sheet = workbook.getWorksheet(sheetName);
      if (!sheet) {
        sheet = workbook.addWorksheet(sheetName);
        sheet.columns = [
          { header: "Timestamp",     key: "timestamp",    width: 22 },
          { header: "Test Name",     key: "testName",     width: 40 },
          { header: "File Name",     key: "fileName",     width: 35 },
          { header: "Extension",     key: "extension",    width: 12 },
          { header: "File Size",     key: "fileSize",     width: 12 },
          { header: "Downloaded",    key: "downloaded",   width: 12 },
          { header: "File Valid",    key: "valid",        width: 12 },
          { header: "Keywords",      key: "containsAll",  width: 14 },
          { header: "Columns Valid", key: "columnValid",  width: 14 },
          { header: "Missing Words", key: "missingWords", width: 30 },
          { header: "Col Errors",    key: "columnErrors", width: 12 },
          { header: "Rows",          key: "rowCount",     width: 10 },
          { header: "Pages",         key: "pageCount",    width: 10 },
          { header: "Reason",        key: "reason",       width: 40 },
        ];
        sheet.getRow(1).font      = { bold: true, color: { argb: "FFFFFFFF" } };
        sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
        sheet.getRow(1).fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
      }
      const pass = result.downloaded && result.valid && result.containsAll && result.columnValid;
      const newRow = sheet.addRow({
        timestamp:    new Date().toISOString().replace("T", " ").substring(0, 19),
        testName:     testInfo?.title ?? result.testName ?? "—",
        fileName:     result.fileName  || "—",
        extension:    result.extension || "—",
        fileSize:     result.fileSize,
        downloaded:   result.downloaded ? "✅ Yes"  : "❌ No",
        valid:        result.valid       ? "✅ Pass" : "❌ Fail",
        containsAll:  result.containsAll ? "✅ Pass" : "❌ Fail",
        columnValid:  result.columnValid ? "✅ Pass" : "❌ Fail",
        missingWords: result.missingWords.join(", ") || "—",
        columnErrors: result.columnErrors.length > 0 ? result.columnErrors.length : "—",
        rowCount:     result.rowCount  ?? "—",
        pageCount:    result.pageCount ?? "—",
        reason:       result.reason    ?? "—",
      });
      newRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: pass ? "FFE2EFDA" : "FFFFC7CE" } };
      await workbook.xlsx.writeFile(MASTER_REPORT_FILE);
    } catch { /* non-fatal */ }
  }

  private static baseVerify(filePath: string, extensions: string[]): VerifyResult {
    if (!fs.existsSync(filePath)) return this.fail(filePath, `File not found: ${path.basename(filePath)}`);
    const ext = path.extname(filePath).toLowerCase();
    if (!extensions.includes(ext)) return this.fail(filePath, `Expected ${extensions.join("/")} | got ${ext}`);
    if (fs.statSync(filePath).size === 0) return this.fail(filePath, `File is empty`);
    return this.buildResult(filePath, ext, true, [], []);
  }

  private static buildResult(
    filePath: string, extension: string, valid: boolean,
    missingWords: string[], columnErrors: ColumnError[], testInfo?: any
  ): VerifyResult {
    return {
      fileName:    path.basename(filePath), filePath,
      fileSize:    filePath && fs.existsSync(filePath) ? this.formatSize(fs.statSync(filePath).size) : "0 B",
      extension, valid, downloaded: false,
      containsAll: missingWords.length === 0, missingWords,
      columnErrors, columnValid: columnErrors.length === 0,
      testName: testInfo?.title, timestamp: new Date().toISOString(),
    };
  }

  private static fail(filePath: string, reason: string, testInfo?: any): VerifyResult {
    logger.error(`Verify failed → ${reason}`);
    return {
      fileName: filePath ? path.basename(filePath) : "",
      filePath: filePath ?? "", fileSize: "0 B",
      extension: filePath ? path.extname(filePath) : "",
      valid: false, downloaded: false,
      containsAll: false, missingWords: [],
      columnErrors: [], columnValid: false,
      reason, testName: testInfo?.title, timestamp: new Date().toISOString(),
    };
  }

  private static findMissing(keywords: string[] | undefined, text: string): string[] {
    if (!keywords || keywords.length === 0) return [];
    return keywords.filter(w => !text.toLowerCase().includes(w.toLowerCase()));
  }

  private static getCellValue(cell: ExcelJS.Cell): any {
    const val = cell.value;
    if (val === null || val === undefined)          return "";
    if (val instanceof Date)                        return val.toISOString().split("T")[0];
    if (typeof val === "object" && "result" in val) return (val as any).result;
    if (typeof val === "object" && "text"   in val) return (val as any).text;
    return val;
  }

  private static formatSize(bytes: number): string {
    if (bytes < 1024)        return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // removed unused helper to satisfy strict TypeScript no-unused rule
}
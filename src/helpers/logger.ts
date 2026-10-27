// ============================================================================
// LOGGER (Enterprise Edition v3) — with step indentation & visual grouping
// ============================================================================

import * as fs   from "fs";
import * as path from "path";

export enum LogLevel {
  DEBUG = "DEBUG",
  INFO  = "INFO",
  WARN  = "WARN",
  ERROR = "ERROR",
  PASS  = "PASS",
  FAIL  = "FAIL",
  STEP  = "STEP",
}

// ── Color scheme ─────────────────────────────────────────────────────────────
const C: Record<string, string> = {
  STEP:   "\x1b[1m\x1b[97m",         // Bold bright white
  PASS:   "\x1b[1m\x1b[92m",         // Bold bright green
  ERROR:  "\x1b[1m\x1b[91m",         // Bold bright red
  WARN:   "\x1b[1m\x1b[93m",         // Bold bright yellow
  INFO:   "\x1b[96m",                // Bright cyan
  DEBUG:  "\x1b[2m\x1b[37m",         // Dim gray
  FAIL:   "\x1b[1m\x1b[97m\x1b[41m", // Bold white on red background
  HEADER: "\x1b[1m\x1b[94m",         // Bold bright blue
  HEAL:   "\x1b[1m\x1b[95m",         // Bold bright magenta
  RESET:  "\x1b[0m",
};

const PREFIX: Record<string, string> = {
  STEP:  "[STEP] ",
  PASS:  "[PASS] ",
  ERROR: "[ERROR]",
  WARN:  "[WARN] ",
  INFO:  "[INFO] ",
  DEBUG: "[DEBUG]",
  FAIL:  "[FAIL] ",
};

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevel.ERROR]: 0,
  [LogLevel.FAIL]:  1,
  [LogLevel.WARN]:  2,
  [LogLevel.STEP]:  3,
  [LogLevel.INFO]:  3,
  [LogLevel.PASS]:  3,
  [LogLevel.DEBUG]: 5,
};

export interface TestContext {
  testName:    string;
  testFile:    string;
  environment: string;
  suiteName?:  string;
  dataSet?:    string;
  browser?:    string;
  startTime:   number;
}

export class Logger {
  private static instance: Logger;

  private readonly logDir:  string;
  private readonly logFile: string;
  private readonly currentLevel: LogLevel;

  private ctx:        TestContext | null = null;
  private stepCount   = 0;
  private stepStart   = Date.now();
  private testActive  = false;

  private buffer:       string[] = [];
  private bufferActive: boolean  = false;

  private stepBuffer:       string[] = [];
  private stepBufferActive: boolean  = false;

  // ── Trackers ──────────────────────────────────────────────────────────────
  private stepActions:  string[] = [];
  private autoHealLogs: string[] = [];

  // ── NEW: Indentation for step grouping ──────────────────────────────────
  private indentLevel = 0;
  private readonly INDENT = "  ";   // two spaces per level

  private constructor() {
    this.logDir = "logs";
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    const today  = this.getIST().split("T")[0];
    this.logFile = path.join(this.logDir, `test-run-${today}.log`);

    const envLevel     = process.env.LOG_LEVEL?.toUpperCase() as LogLevel;
    this.currentLevel = LogLevel[envLevel] ? envLevel : LogLevel.INFO;
  }

  static getInstance(): Logger {
    if (!Logger.instance) Logger.instance = new Logger();
    return Logger.instance;
  }

  // ── Timestamp helpers ────────────────────────────────────────────────────
  private getIST(): string {
    const now   = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const istMs = utcMs + 5.5 * 3600000;
    const ist   = new Date(istMs);
    const pad   = (n: number, w = 2) => String(n).padStart(w, "0");
    return (
      `${ist.getFullYear()}-${pad(ist.getMonth() + 1)}-${pad(ist.getDate())}` +
      `T${pad(ist.getHours())}:${pad(ist.getMinutes())}:${pad(ist.getSeconds())}.` +
      `${pad(ist.getMilliseconds(), 3)}Z`
    );
  }

  // ── Buffer management ────────────────────────────────────────────────────
  startBuffer(): void {
    this.buffer       = [];
    this.bufferActive = true;
  }

  flushBuffer(): string {
    this.bufferActive = false;
    const content     = this.buffer.join("\n");
    this.buffer       = [];
    return content;
  }

  startStepBuffer(): void {
    this.stepBuffer       = [];
    this.stepActions      = [];
    this.autoHealLogs     = [];
    this.stepBufferActive = true;
  }

  flushStepBuffer(): string {
    this.stepBufferActive = false;
    const content         = this.stepBuffer.join("\n");
    this.stepBuffer       = [];
    return content;
  }

  getStepBufferSnapshot(): string[] {
    return [...this.stepBuffer];
  }

  // ── Parsers ───────────────────────────────────────────────────────────────
  parseStepBufferContext(lines: string[]): {
    expected:  string | null;
    actual:    string | null;
    element:   string | null;
    locator:   string | null;
    autoHeal:  string[];
    errorLine: string | null;
    actions:   string[];
  } {
    let expected:  string | null = null;
    let actual:    string | null = null;
    let element:   string | null = null;
    let locator:   string | null = null;
    let errorLine: string | null = null;
    const autoHeal: string[] = [];
    const actions:  string[] = [];

    for (const line of lines) {
      if (!expected) {
        const qm = line.match(/expected:\s*"([^"]*)"/i);
        if (qm) { expected = qm[1]; } else {
          const uqm = line.match(/expected:\s*([^|\n]+?)(?:\s*\||\s*$)/i);
          if (uqm) expected = uqm[1].trim();
        }
      }

      if (!actual) {
        const qm = line.match(/actual:\s*"([^"]*)"/i);
        if (qm) { actual = qm[1]; } else {
          const uqm = line.match(/actual:\s*([^|\n]+?)(?:\s*\||\s*$)/i);
          if (uqm) actual = uqm[1].trim();
        }
      }

      if (!element) {
        const m = line.match(/element:\s*"([^+]+)"/i) || line.match(/element:\s*"([^"]+)"/i);
        if (m) element = m[1];
      }

      if (!locator) {
        const m = line.match(/locator:\s*([^|\n]+)/i);
        if (m) {
          const raw = m[1].trim();
          if (raw.length < 200) locator = raw;
        }
      }

      if (line.includes("[AutoHeal]")) {
        const miss = line.match(/✗\s+([\w-]+)\s+(.+)/);
        if (miss) autoHeal.push(`✗ ${miss[1].trim()}(${miss[2].trim().substring(0, 50)})`);
        const hit = line.match(/✅ Healed via \[([^\]]+)\]/);
        if (hit)  autoHeal.push(`✅ [${hit[1]}]`);
      }
      
      if (line.includes("[AUTOHEAL]")) {
        autoHeal.push(line.substring(line.indexOf("[AUTOHEAL]") + 10).trim());
      }

      if (line.includes("[ACTION]")) {
        actions.push(line.substring(line.indexOf("[ACTION]") + 8).trim());
      }

      if (!errorLine && line.includes("[ERROR]")) {
        const clean = line
          .replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+/, "")
          .replace(/\[ERROR\]/g, "")
          .trim();
        if (clean) errorLine = clean;
      }
    }

    return { expected, actual, element, locator, autoHeal, errorLine, actions };
  }

  // ── Actions & AutoHeal Tracking ───────────────────────────────────────────
  action(msg: string): void {
    const line = `[ACTION] ${msg}`;
    this.stepActions.push(msg);
    const formatted = this.format("INFO", line);
    console.log(`${C.INFO}${formatted}${C.RESET}`);
    this.writeFile(formatted);
    if (this.bufferActive) this.buffer.push(formatted);
    if (this.stepBufferActive) this.stepBuffer.push(formatted);
  }

  autoHealAction(msg: string): void {
    const line = `[AUTOHEAL] ${msg}`;
    this.autoHealLogs.push(msg);
    const formatted = this.format("INFO", line);
    console.log(`${C.HEAL}${formatted}${C.RESET}`);
    this.writeFile(formatted);
    if (this.bufferActive) this.buffer.push(formatted);
    if (this.stepBufferActive) this.stepBuffer.push(formatted);
  }

  getStepActions(): string[] { return [...this.stepActions]; }
  getAutoHealActions(): string[] { return [...this.autoHealLogs]; }

  getStepMetadata(): { actions: string[]; autoHeal: string[] } {
    return {
      actions: this.getStepActions(),
      autoHeal: this.getAutoHealActions(),
    };
  }

  attachMetadata(testInfo: any): void {
    const meta = this.getStepMetadata();
    if (meta.actions.length || meta.autoHeal.length) {
      testInfo.attachments.push({
        name: "Step Metadata",
        contentType: "application/json",
        body: Buffer.from(JSON.stringify(meta), "utf8"),
      });
    }
  }

  clearMetadata(): void {
    this.stepActions = [];
    this.autoHealLogs = [];
  }

  getStepCount(): number {
    return this.stepCount;
  }

  // ── Step Lifecycle ────────────────────────────────────────────────────────
  stepResult(status: "PASS" | "FAIL", errorMsg?: string): void {
    // Decrease indent level
    if (this.indentLevel > 0) this.indentLevel--;

    const suffix = status === "PASS" ? " ✅ PASS" : ` ❌ FAIL — ${errorMsg ?? "unknown error"}`;
    if (this.stepBuffer.length > 0) this.stepBuffer[0] = this.stepBuffer[0] + suffix;
    if (this.buffer.length > 0) {
      for (let i = this.buffer.length - 1; i >= 0; i--) {
        if (this.buffer[i].includes("[STEP]")) {
          this.buffer[i] = this.buffer[i] + suffix;
          break;
        }
      }
    }
    const resultLine = status === "PASS"
      ? this.format("PASS", `Step result → ✅ PASS`)
      : this.format("FAIL", `Step result → ❌ FAIL — ${errorMsg ?? "unknown error"}`);
    this.writeFile(resultLine);
  }

  testStart(ctx: Omit<TestContext, "startTime">): void {
    const now       = Date.now();
    this.ctx        = { ...ctx, startTime: now };
    this.stepCount  = 0;
    this.stepStart  = now;
    this.testActive = true;
    this.indentLevel = 0;  // reset indentation

    const fileBase = path.basename(ctx.testFile);
    const suite    = ctx.suiteName && ctx.suiteName !== fileBase ? ctx.suiteName : undefined;
    const line = "═".repeat(60);
    const rows = [``, line, `   TEST    : ${ctx.testName}`, `   FILE    : ${fileBase}`, suite ? `   SUITE   : ${suite}` : null, `   ENV     : ${ctx.environment.toUpperCase()}`, ctx.browser ? `   BROWSER : ${ctx.browser}` : null, ctx.dataSet ? `   DATASET : ${ctx.dataSet}` : null, line, ].filter(Boolean).join("\n");
    this.print("HEADER", rows);
  }

  testEnd(status: "passed" | "failed" | "skipped"): void {
    if (!this.ctx) return;
    const duration = ((Date.now() - this.ctx.startTime) / 1000).toFixed(2);
    const icon     = status === "passed"  ? "✅ PASSED" : status === "skipped" ? "⚠️  SKIPPED" : "❌ FAILED";
    const line     = "═".repeat(60);
    const colorKey = status === "passed"  ? "PASS" : status === "skipped" ? "WARN" : "ERROR";
    const msg = [line, `   ${icon} — ${this.ctx.testName}`, `   Duration : ${duration}s  |  Steps completed : ${this.stepCount}`, line, ``].join("\n");
    this.print(colorKey, msg);
    this.ctx        = null;
    this.stepCount  = 0;
    this.stepStart  = Date.now();
    this.testActive = false;
  }

  tcStart(id: string, title: string): void {
    const env = process.env.ENVIRONMENT || process.env.NODE_ENV || "local";
    this.testStart({ testName: `${id} - ${title}`, testFile: id, environment: env });
  }

  tcEnd(status: string): void {
    const s      = String(status).toLowerCase();
    const mapped = s === "pass" || s === "passed" ? "passed" : s === "fail" || s === "failed" ? "failed" : "skipped";
    this.testEnd(mapped as "passed" | "failed" | "skipped");
  }

  step(msg: string, data?: any): void {
    if (!this.testActive) { this.stepStart = this.stepStart || Date.now(); this.testActive = true; }
    this.stepCount++;
    const now     = Date.now();
    const elapsed = ((now - this.stepStart) / 1000).toFixed(2);
    this.stepStart = now;
    let title  = msg;
    let lineNo = 0;
    if (msg.includes("|L")) { const parts = msg.split("|L"); title = parts[0]; lineNo = Number(parts[1]); }
    const stepId = String(this.stepCount).padStart(3, "0");

    // ── Visual separator before each new step (if not already indented) ───
    if (this.indentLevel === 0 && this.stepCount > 1) {
      console.log(`\n${C.HEADER}${"─".repeat(48)}${C.RESET}`);
    }

    // Increase indent for logs inside this step
    this.indentLevel++;

    this.output(LogLevel.STEP, `[STEP-${stepId}][L${lineNo}] ${title} | +${elapsed}s`, data);
  }

  heal(elementName: string, originalLocator: string, healedLocator: string, strategy: string): void {
    const testName = this.ctx?.testName ?? "unknown test";
    const stepNo   = this.stepCount > 0 ? `Step ${this.stepCount}` : "before steps";
    const msg = [`[AutoHeal] ⚠️  Locator healed`, `   Test     : ${testName}`, `   At step  : ${stepNo}`, `   Element  : ${elementName}`, `   Original : ${originalLocator}`, `   Healed   : ${healedLocator}`, `   Strategy : ${strategy}`, `   Fix      : Update this locator in your POM file`,].join("\n");
    this.print("HEAL", msg);
    this.writeFile(`[WARN] ${msg}`);
  }

  // ── Core logging methods ──────────────────────────────────────────────────
  debug(msg: string, data?: any) { this.output(LogLevel.DEBUG, msg, data); }
  info (msg: string, data?: any) { this.output(LogLevel.INFO,  msg, data); }
  warn (msg: string, data?: any) { this.output(LogLevel.WARN,  msg, data); }
  error(msg: string, data?: any) { this.output(LogLevel.ERROR, msg, data); }
  pass (msg: string, data?: any) { this.output(LogLevel.PASS,  msg, data); }
  fail (msg: string, data?: any) { this.output(LogLevel.FAIL,  msg, data); }

  getLogFile(): string { return this.logFile; }

  // ── Private helpers ──────────────────────────────────────────────────────
  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[this.currentLevel];
  }

  private format(level: string, message: string, data?: any): string {
    const ts      = this.getIST();
    const prefix  = PREFIX[level] ?? `[${level}]`;
    const indent  = this.INDENT.repeat(Math.max(0, this.indentLevel));
    const details = data ? `\n${JSON.stringify(data, null, 2)}` : "";
    return `${ts} ${prefix} ${indent}${message}${details}`;
  }

  private output(level: LogLevel, message: string, data?: any): void {
    if (!this.shouldLog(level)) return;
    const formatted = this.format(level, message, data);
    // For indentation, we keep the timestamp and prefix, but indent the message part
    console.log((C[level] ?? "") + formatted + C.RESET);
    this.writeFile(formatted);
    if (this.bufferActive)     this.buffer.push(formatted);
    if (this.stepBufferActive) this.stepBuffer.push(formatted);
  }

  private print(colorKey: string, message: string): void {
    // print without indentation (used for headers)
    console.log((C[colorKey] ?? "") + message + C.RESET);
    this.writeFile(message);
    if (this.bufferActive)     this.buffer.push(message);
    if (this.stepBufferActive) this.stepBuffer.push(message);
  }

  private writeFile(text: string): void {
    fs.appendFile(this.logFile, text + "\n", () => {});
  }
}

export const logger = Logger.getInstance();
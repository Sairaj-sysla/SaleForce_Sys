// src/fixtures/baseFixture.ts
// ============================================================================
//  BASE FIXTURE — Auto logger injection + inline per-step log attachment
//  Updated: Added basePage fixture to inject BasePage with test & testInfo
// ============================================================================
import { test as base, TestInfo } from "@playwright/test";
import { logger }                  from "../helpers/logger";
import { BasePage }                from "../pages/basePage";
import * as path                   from "path";

// ── Fixture types ─────────────────────────────────────────────────────────────
type BaseFixtures = {
  autoLogger: void;
  step:       (name: string, fn: () => Promise<void>) => Promise<void>;
  basePage:   BasePage;            // <-- new fixture
};

// ── Extracts spec file line number from call stack ────────────────────────────
function getSpecLineNumber(): number {
  const stack = new Error().stack ?? "";
  for (const line of stack.split("\n")) {
    const match = line.match(/\.spec\.ts:(\d+):\d+/);
    if (match) return Number(match[1]);
  }
  return 0;
}

// ── Extracts spec file name from call stack ───────────────────────────────────
function getSpecFileName(): string {
  const stack = new Error().stack ?? "";
  for (const line of stack.split("\n")) {
    const match = line.match(/([^/\\]+\.spec\.ts):\d+:\d+/);
    if (match) return match[1];
  }
  return "spec.ts";
}

// ── Helper to strip ANSI terminal colors for a clean HTML report presentation ──
function stripAnsiColors(text: string): string {
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

export const test = base.extend<BaseFixtures>({

  // =========================================================================
  //  autoLogger — runs automatically for every test (auto: true)
  // =========================================================================
  autoLogger: [async ({ page }, use, testInfo: TestInfo) => {

    const suiteName = testInfo.titlePath
      .slice(0, -1)
      .filter(Boolean)
      .join(" › ") || undefined;

    const dataSet = extractDataSet(testInfo.title) || undefined;
    const fileBase   = path.basename(testInfo.file);
    const cleanSuite = suiteName && suiteName !== fileBase ? suiteName : undefined;

    logger.testStart({
      testName:    testInfo.title,
      testFile:    testInfo.file,
      suiteName:   cleanSuite,
      environment: process.env.ENVIRONMENT ?? "qa",
      browser:     testInfo.project?.name  ?? process.env.BROWSER ?? "chromium",
      dataSet,
    });

    logger.startBuffer();

    try {
      page.on("console", msg => {
        if (msg.type() === "error") {
          const text = msg.text();
          if (
            text.includes("Failed to load resource") ||
            text.includes("ERR_BLOCKED_BY_CLIENT")   ||
            text.includes("ERR_ABORTED")             ||
            text.includes("Content Security Policy") ||
            text.includes("frame-ancestors")
          ) return;
          logger.warn(`[Browser Console Error] ${text}`);
        }
      });

      page.on("crash", () => {
        logger.error(`[Page Crashed] during: ${testInfo.title}`);
      });
    } catch { }

    await use();

    const status = (testInfo.status ?? "failed") as "passed" | "failed" | "skipped";

    if (status === "failed") {
      try {
        const screenshot = await page.screenshot({ fullPage: true });
        await testInfo.attach("failure-screenshot", {
          body:        screenshot,
          contentType: "image/png",
        });
        logger.fail("Screenshot captured → attached to report");
      } catch { }
    }

    const tcLogs = logger.flushBuffer();
    if (tcLogs) {
      await testInfo.attach("tc-logs", {
        body:        stripAnsiColors(tcLogs),
        contentType: "text/plain",
      });
    }

    logger.testEnd(status);

  }, { auto: true }],

  // =========================================================================
  //  step — fixture-provided per-step wrapper with per-step logs
  // =========================================================================
  step: async ({}, use, testInfo: TestInfo) => {

    // ── Collection for all step logs ─────────────────────────────────────
    const allStepLogs: Array<{
      title:    string;
      logs:     string;
      duration: number;
      status:   string;
    }> = [];

    const stepFn = async (name: string, fn: () => Promise<void>): Promise<void> => {

      const lineNo     = getSpecLineNumber();
      const specFile   = getSpecFileName();
      const nextStepNo = String(logger.getStepCount() + 1).padStart(3, "0");
      const stepTitle  = `[STEP-${nextStepNo}][L${lineNo}] ${name}`;

      logger.startStepBuffer();
      logger.step(`${name}|L${lineNo}`);
      const stepStartTime = Date.now();

      let stepError: unknown = undefined;
      let stepLogs           = "";

      try {
        await base.step(stepTitle, async () => {
          try {
            await fn();
            logger.stepResult("PASS");
          } catch (err) {
            stepError = err;
            const errMsg = err instanceof Error ? err.message.split("\n")[0] : String(err);
            logger.stepResult("FAIL", errMsg);
            throw err;
          } finally {
            stepLogs = logger.flushStepBuffer();
            const stepActions = logger.getStepActions();
            const autoHealActions = logger.getAutoHealActions();

            // ── Store the logs for this step ────────────────────────────
            allStepLogs.push({
              title:    name,
              logs:     stepLogs,
              duration: Date.now() - stepStartTime,
              status:   stepError ? "failed" : "passed",
            });

            // ── Attach individual step metadata with logs ──────────────
            await testInfo.attach(`Step Metadata - ${name}`, {
              body: JSON.stringify({
                status: stepError ? "FAILED" : "PASSED",
                stepTitle,
                duration: ((Date.now() - stepStartTime) / 1000).toFixed(2),
                actions: stepActions,
                autoHeal: autoHealActions,
                logs: stepLogs,
              }, null, 2),
              contentType: "application/json",
            });

            // ── Also attach raw execution logs if present (optional) ───
            if (stepLogs) {
              await testInfo.attach(`Step Logs - ${name}`, {
                body:        stripAnsiColors(stepLogs),
                contentType: "text/plain",
              });
            }
          }
        }, { box: true });

      } catch { }

      // ── on failure: compile rich error dashboard diagnostics ───────────
      if (stepError !== undefined) {
        const stepActions = logger.getStepActions();
        const autoHealActions = logger.getAutoHealActions();
        const ctx    = logger.parseStepBufferContext(stepLogs.split("\n"));
        const rawMsg   = (stepError as Error).message?.split("\n")[0] ?? String(stepError);
        const duration = ((Date.now() - stepStartTime) / 1000).toFixed(1);

        const annoLines: string[] = [
          `❌ FAILED STEP`,
          `${"─".repeat(55)}`,
          `   Step      : ${name}`,
          `   Test Case : ${testInfo.title}`,
          `   Source    : ${specFile}:${lineNo}`,
          `   Duration  : ${duration}s`,
          `${"─".repeat(55)}`,
        ];
        if (ctx.element)                                        annoLines.push(`   Element   : ${ctx.element}`);
        if (ctx.expected !== null && ctx.expected !== undefined) annoLines.push(`   Expected  : ${ctx.expected}`);
        if (ctx.actual   !== null && ctx.actual   !== undefined) annoLines.push(`   Actual    : ${ctx.actual}`);
        if (ctx.locator)                                        annoLines.push(`   Locator   : ${ctx.locator}`);
        if (ctx.autoHeal.length > 0)                            annoLines.push(`   AutoHeal  : ${ctx.autoHeal.join(" | ")}`);
        
        if (stepActions.length > 0) {
          annoLines.push("", "   Actions Executed:", ...stepActions.map(a => `     ✓ ${a}`));
        }
        if (autoHealActions.length > 0) {
          annoLines.push("", "   Auto Heal:", ...autoHealActions.map(a => `     ✓ ${a}`));
        }
        
        annoLines.push(`${"─".repeat(55)}`, `   Error     : ${rawMsg}`);

        testInfo.annotations.push({
          type:        "tc-step-failed",
          description: annoLines.join("\n"),
        });

        const errLines: string[] = [
          `${name}`,
          `${"─".repeat(55)}`,
        ];
        if (ctx.element)                                        errLines.push(`   Element   : ${ctx.element}`);
        if (ctx.expected !== null && ctx.expected !== undefined) errLines.push(`   Expected  : ${ctx.expected}`);
        if (ctx.actual   !== null && ctx.actual   !== undefined) errLines.push(`   Actual    : ${ctx.actual}`);
        if (ctx.locator)                                        errLines.push(`   Locator   : ${ctx.locator}`);
        if (ctx.autoHeal.length > 0)                            errLines.push(`   AutoHeal  : ${ctx.autoHeal.join(" | ")}`);

        if (stepActions.length > 0) {
          errLines.push("", "Actions Executed:", ...stepActions.map(a => `  ✓ ${a}`));
        }
        if (autoHealActions.length > 0) {
          errLines.push("", "Auto Heal:", ...autoHealActions.map(a => `  ✓ ${a}`));
        }

        errLines.push(`${"─".repeat(55)}`, `   Error     : ${rawMsg}`);

        const richError = new Error(errLines.join("\n"));
        richError.stack = `Error: ${errLines.join("\n")}\n    at ${specFile}:${lineNo}:5`;
        throw richError;
      }
    };

    await use(stepFn);
  },

  // =========================================================================
  //  basePage — inject BasePage with page, test, and testInfo
  // =========================================================================
  basePage: async ({ page }, use, testInfo: TestInfo) => {
    const basePage = new BasePage(page, test, testInfo);
    await use(basePage);
  },

});

export { expect } from "@playwright/test";

function extractDataSet(title: string): string | null {
  const setMatch = title.match(/Set\s+\d+(?:\s*\([^)]+\))?/i);
  if (setMatch) return setMatch[0].trim();
  const parenMatch = title.match(/\(([^)]+)\)/);
  if (parenMatch) return parenMatch[1].trim();
  return null;
}
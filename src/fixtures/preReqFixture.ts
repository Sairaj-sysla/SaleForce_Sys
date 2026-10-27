// src/fixtures/preReqFixture.ts
// ============================================================================
//  PRE-REQUISITE FIXTURE
// ----------------------------------------------------------------------------
//  Extends baseFixture — autoLogger runs for ALL tests automatically.
//  No manual logger calls needed anywhere.
//
//  USAGE IN TEST FILES:
//    import { test, preReqTest, expect } from "../fixtures/preReqFixture";
//
//    test("normal test", async ({ page }) => { ... });
//
//    preReqTest("test with pre-req",
//      { annotation: [{ type: "preRequisite", description: "normal test" }] },
//      async ({ page }) => { ... }
//    );
// ============================================================================

import { test as baseTest, expect } from "./basefixtures";  
import { TestInfo }                  from "@playwright/test";
import { PreReqRegistry }            from "./PreReqRegistry";

// ── Fixture type ──────────────────────────────────────────────────────────────

type PreReqFixtures = {
  preRequisite: void;
};

// ── preReqTest — has pre-req check built in ───────────────────────────────────

export const preReqTest = baseTest.extend<PreReqFixtures>({

  preRequisite: [async ({}, use: (value?: void) => Promise<void>, testInfo: TestInfo) => {

    const testName   = testInfo.title;
    const preReqName = getPreReqAnnotation(testInfo);
    const startTime  = Date.now();

    PreReqRegistry.register({
      testName,
      preRequisite: preReqName,
      testFile:     testInfo.file,
    });

    if (!preReqName) {
      PreReqRegistry.markRunning(testName);
      await use();
      recordResult(testName, testInfo, startTime);
      return;
    }

    console.log(
      `\n[PreReq] "${testName}"\n` +
      `         requires → "${preReqName}"`
    );

    const preReqStatus = await PreReqRegistry.waitForPreReq(preReqName);

    if (preReqStatus === "passed") {
      console.log(`[PreReq] ✅  Pre-req "${preReqName}" passed → running "${testName}"`);
      PreReqRegistry.markRunning(testName);
      await use();
      recordResult(testName, testInfo, startTime);
    } else {
      const reason = buildSkipReason(preReqName, preReqStatus);
      console.warn(`[PreReq] ⚠️   ${reason}`);
      PreReqRegistry.markSkipped(testName, reason);
      testInfo.skip(true, reason);
      await use();
    }

  }, { auto: true, timeout: 120_000 }],

});

// ============================================================================
//  EXPORTS
// ----------------------------------------------------------------------------
//  test        → baseFixture test (autoLogger runs + VS Code ▶ buttons show)
//  preReqTest  → pre-req version  (autoLogger runs + pre-req check runs)
//  expect      → from @playwright/test
// ============================================================================

export { baseTest as test };   // ← baseFixture test, NOT raw @playwright/test
export { expect };

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPreReqAnnotation(testInfo: TestInfo): string | null {
  const annotation = testInfo.annotations?.find(a => a.type === "preRequisite");
  if (annotation?.description) return annotation.description.trim();
  const tagMatch = testInfo.title.match(/@preReq:(.+?)(?:\s@|$)/);
  if (tagMatch?.[1]) return tagMatch[1].trim();
  return null;
}

function recordResult(testName: string, testInfo: TestInfo, startTime: number): void {
  const status   = testInfo.status === "passed" ? "passed" : "failed";
  const duration = Date.now() - startTime;
  const error    = testInfo.errors?.[0]?.message;
  PreReqRegistry.markComplete(testName, status, duration, error);
}

function buildSkipReason(preReqName: string, status: string): string {
  switch (status) {
    case "failed":  return `Pre-requisite "${preReqName}" FAILED — skipping this test`;
    case "skipped": return `Pre-requisite "${preReqName}" was SKIPPED — skipping this test`;
    default:        return `Pre-requisite "${preReqName}" did not complete (timeout) — skipping this test`;
  }
}
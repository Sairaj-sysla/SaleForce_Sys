// src/fixtures/PreReqRegistry.ts
// ============================================================================
//  PRE-REQUISITE REGISTRY
// ----------------------------------------------------------------------------
//  Shared state across parallel Playwright workers via JSON file.
//  Why a file? Each worker is a separate Node.js process — in-memory state
//  is NOT shared. A JSON file is the simplest reliable cross-worker bridge.
//
//  RESPONSIBILITIES:
//  1. Register each test and its pre-req declaration
//  2. Store pass / fail / skipped results after each test
//  3. Let dependent tests poll and wait for their pre-req to finish
//  4. Detect circular dependency chains before suite starts
//  5. Provide run summary for teardown logging
// ============================================================================

import * as fs   from "fs";
import * as path from "path";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TestStatus = "passed" | "failed" | "skipped" | "running" | "pending";

export interface TestResult {
  testName:    string;
  status:      TestStatus;
  duration?:   number;
  error?:      string;
  startedAt?:  string;
  finishedAt?: string;
  runId:       string;
}

export interface PreReqDeclaration {
  testName:     string;
  preRequisite: string | null;
  testFile?:    string;
}

interface RegistryData {
  runId:        string;
  updatedAt:    string;
  declarations: Record<string, PreReqDeclaration>;
  results:      Record<string, TestResult>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATE_DIR  = path.resolve(process.cwd(), "reports");
const STATE_FILE = path.join(STATE_DIR, "prereq-state.json");
const MAX_CHAIN  = 10;    // max dependency depth — prevents infinite loops
const POLL_MS    = 200;   // how often to check if pre-req finished (ms)
const WAIT_MS    = 60_000; // max time to wait for a pre-req to complete (ms)

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRunId(): string {
  return (
    process.env.CI_RUN_ID     ||
    process.env.GITHUB_RUN_ID ||
    `local-${Date.now()}`
  );
}

function readState(): RegistryData {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as RegistryData;
    }
  } catch {
    // corrupt or missing — return empty
  }
  return {
    runId:        getRunId(),
    updatedAt:    new Date().toISOString(),
    declarations: {},
    results:      {},
  };
}

function writeState(data: RegistryData): void {
  try {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    // Atomic write: write to .tmp then rename — prevents corrupt reads
    const tmp = STATE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, STATE_FILE);
  } catch {
    // non-fatal — test will still run
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Registry Class ────────────────────────────────────────────────────────────

class PreRequisiteRegistryClass {

  // ── Register a test + its pre-req declaration ─────────────────────────────
  // Called by preReqFixture before the test runs
  register(declaration: PreReqDeclaration): void {
    const state = readState();
    state.declarations[declaration.testName] = declaration;
    state.updatedAt = new Date().toISOString();
    writeState(state);
  }

  // ── Mark a test as currently running ─────────────────────────────────────
  markRunning(testName: string): void {
    this.writeResult(testName, {
      testName,
      status:    "running",
      startedAt: new Date().toISOString(),
      runId:     getRunId(),
    });
  }

  // ── Mark a test as completed (pass or fail) ───────────────────────────────
  markComplete(
    testName: string,
    status:   "passed" | "failed",
    duration?: number,
    error?:    string
  ): void {
    const existing = readState().results[testName];
    this.writeResult(testName, {
      testName,
      status,
      duration,
      error,
      startedAt:   existing?.startedAt,
      finishedAt:  new Date().toISOString(),
      runId:       getRunId(),
    });
  }

  // ── Mark a test as skipped ────────────────────────────────────────────────
  markSkipped(testName: string, reason: string): void {
    this.writeResult(testName, {
      testName,
      status:     "skipped",
      error:      reason,
      finishedAt: new Date().toISOString(),
      runId:      getRunId(),
    });
  }

  // ── Get the result of a specific test ─────────────────────────────────────
  getResult(testName: string): TestResult | undefined {
    return readState().results[testName];
  }

  // ── Wait for a pre-req test to finish — handles parallel workers ──────────
  // Polls the shared JSON file every 200ms until the pre-req completes.
  // Returns the final status: passed / failed / skipped / (timeout = failed)
  async waitForPreReq(preReqName: string): Promise<TestStatus> {
    const start = Date.now();

    while (Date.now() - start < WAIT_MS) {
      const result = this.getResult(preReqName);

      if (!result || result.status === "pending") {
        await sleep(POLL_MS);
        continue;
      }

      if (result.status === "running") {
        // Running in another worker — wait for it to finish
        await sleep(POLL_MS);
        continue;
      }

      // Finished: passed / failed / skipped
      return result.status;
    }

    // Timed out waiting for pre-req
    return "failed";
  }

  // ── Detect circular dependency chains ─────────────────────────────────────
  // Called in globalSetup — fails before any test runs if a cycle exists
  validateChains(): void {
    const state        = readState();
    const declarations = state.declarations;

    for (const testName of Object.keys(declarations)) {
      const visited = new Set<string>();
      let   current: string | null = testName;
      let   depth   = 0;

      while (current) {
        if (visited.has(current)) {
          throw new Error(
            `Circular dependency detected!\n` +
            `  Chain : ${[...visited].join(" → ")} → ${current}\n` +
            `  Fix   : remove the circular pre-requisite`
          );
        }
        if (depth > MAX_CHAIN) {
          throw new Error(
            `Pre-req chain too deep (> ${MAX_CHAIN}) for test: "${testName}"\n` +
            `  Reduce the chain depth or split into independent tests`
          );
        }
        visited.add(current);
        current = declarations[current]?.preRequisite ?? null;
        depth++;
      }
    }
  }

  // ── Get summary counts for teardown logging ───────────────────────────────
  getSummary() {
    const results = Object.values(readState().results);
    return {
      total:   results.length,
      passed:  results.filter(r => r.status === "passed").length,
      failed:  results.filter(r => r.status === "failed").length,
      skipped: results.filter(r => r.status === "skipped").length,
    };
  }

  // ── Reset state for a fresh run ───────────────────────────────────────────
  // Called in globalSetup — wipes previous run results
  reset(): void {
    writeState({
      runId:        getRunId(),
      updatedAt:    new Date().toISOString(),
      declarations: {},
      results:      {},
    });
  }

  // ── Private: write a result safely ────────────────────────────────────────
  private writeResult(testName: string, result: TestResult): void {
    const state = readState();
    state.results[testName] = result;
    state.updatedAt         = new Date().toISOString();
    writeState(state);
  }
}

// ── Export singleton ──────────────────────────────────────────────────────────

export const PreReqRegistry = new PreRequisiteRegistryClass();
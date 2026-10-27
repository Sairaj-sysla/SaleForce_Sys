// src/globalSetup.ts
// ============================================================================
//  GLOBAL SETUP — Runs once before entire test suite
// ============================================================================

import { logger }         from "../helpers/logger";
import { configManager }  from "../config/env.index";
import { PreReqRegistry } from "../fixtures/PreReqRegistry";
import * as fs            from "fs";
import * as path          from "path";
import { chromium }       from "@playwright/test";

export async function globalSetup() {

  // ── FIX: use logger.info not logger.step (step counter is for tests only) ──
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.info("  GLOBAL SETUP");
  logger.info(`  Environment : ${configManager.getEnvironment().toUpperCase()}`);
  logger.info(`  Base URL    : ${configManager.getBaseURL()}`);
  logger.info(`  Browser     : ${process.env.BROWSER || "chromium"}`);
  logger.info("  Auto-Heal   : Runtime DOM recovery + Playwright smart healing");
  logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // ==========================================================================
  //  STEP 1 — VALIDATE CONFIG
  // ==========================================================================
  await validateConfig();

  // ==========================================================================
  //  STEP 2 — ENVIRONMENT HEALTH CHECK
  // ==========================================================================
  await checkEnvironmentHealth();

  // ==========================================================================
  //  STEP 3 — RESET PRE-REQ STATE
  // ==========================================================================
  resetPreReqState();

  // ==========================================================================
  //  STEP 4 — SEED AUTH TOKENS  (optional — add credentials to .env to enable)
  //  ADMIN_EMAIL, ADMIN_PASSWORD, USER_EMAIL, USER_PASSWORD
  // ==========================================================================
  await seedAuthTokens();

  // ==========================================================================
  //  STEP 5 — SEED MASTER DATA  (optional — uncomment seeds array to enable)
  // ==========================================================================
  await seedMasterData();

  // ==========================================================================
  //  STEP 6 — VALIDATE PRE-REQ CHAINS
  // ==========================================================================
  validatePreReqChains();

  // ==========================================================================
  //  ADD YOUR CUSTOM SETUP HERE
  // ==========================================================================

  logger.pass("Global Setup complete — tests starting");

  // ==========================================================================
  //  GLOBAL TEARDOWN
  // ==========================================================================
  return async () => {

    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.info("  GLOBAL TEARDOWN");
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    cleanAuthFiles();

    const s = PreReqRegistry.getSummary();
    if (s.total > 0) {
      logger.info(
        `Pre-Req Summary — total: ${s.total} | ` +
        `passed: ${s.passed} | failed: ${s.failed} | skipped: ${s.skipped}`
      );
    }

    // ========================================================================
    //  ADD YOUR CUSTOM TEARDOWN HERE
    // ========================================================================

    logger.pass("Global Teardown complete");
  };
}

// ============================================================================
//  STEP 1 — VALIDATE CONFIG
// ============================================================================

async function validateConfig(): Promise<void> {
  logger.info("Step 1: Validating config...");

  const baseURL = configManager.getBaseURL();

  if (!baseURL) {
    logger.error("Step 1: BASE_URL is missing");
    throw new Error(
      `[GlobalSetup] Config validation failed.\n` +
      `  Missing : BASE_URL\n` +
      `  Check your .env file or environment variables.`
    );
  }

  logger.pass(`Step 1: Config valid — ${baseURL}`);
}

// ============================================================================
//  STEP 2 — ENVIRONMENT HEALTH CHECK
// ============================================================================

async function checkEnvironmentHealth(): Promise<void> {
  logger.info("Step 2: Checking environment health...");

  const baseURL = configManager.getBaseURL();
  if (!baseURL) return;

  const reachable = await pingUrl(baseURL, 5000);

  if (!reachable) {
    throw new Error(
      `[GlobalSetup] Environment unreachable: ${baseURL}\n` +
      `  Check VPN, network, or whether the server is running.\n` +
      `  Aborting suite to save CI minutes.`
    );
  }

  logger.pass(`Step 2: Environment healthy — ${baseURL}`);

  const apiUrl = process.env.API_URL;
  if (apiUrl && apiUrl !== baseURL) {
    const apiReachable = await pingUrl(apiUrl, 3000);
    if (!apiReachable) {
      throw new Error(
        `[GlobalSetup] API unreachable: ${apiUrl}\n` +
        `  Check API_URL in your .env file.`
      );
    }
    logger.pass(`Step 2: API healthy — ${apiUrl}`);
  }
}

// ============================================================================
//  STEP 3 — RESET PRE-REQ STATE
// ============================================================================

function resetPreReqState(): void {
  logger.info("Step 3: Resetting pre-req state...");
  PreReqRegistry.reset();
  logger.pass("Step 3: Pre-req state reset — clean slate for this run");
}

// ============================================================================
//  STEP 4 — SEED AUTH TOKENS (StorageState)
// ============================================================================

interface Role {
  name:     string;
  email:    string;
  password: string;
}

function getRoles(): Role[] {
  return [
    {
      name:     "admin",
      email:    process.env.ADMIN_EMAIL    ?? "",
      password: process.env.ADMIN_PASSWORD ?? "",
    },
    {
      name:     "user",
      email:    process.env.USER_EMAIL     ?? "",
      password: process.env.USER_PASSWORD  ?? "",
    },
  ].filter(r => r.email && r.password);
}

async function seedAuthTokens(): Promise<void> {
  const roles = getRoles();

  if (roles.length === 0) {
    // ── FIX: debug level — not a warning, just informational ─────────────
    logger.debug("Step 4: No role credentials in ENV — skipping auth token seeding");
    return;
  }

  logger.info(`Step 4: Seeding auth tokens for ${roles.length} role(s)...`);

  const baseURL = configManager.getBaseURL();
  if (!baseURL) {
    logger.debug("Step 4: No BASE_URL — skipping auth token seeding");
    return;
  }

  const authDir = path.resolve(process.cwd(), "auth");
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  for (const role of roles) {
    const stateFile = path.join(authDir, `${role.name}.json`);
    try {
      const context = await browser.newContext();
      const page    = await context.newPage();

      await page.goto(`${baseURL}/login`, { waitUntil: "networkidle", timeout: 20_000 });
      await page.getByLabel(/email/i).fill(role.email);
      await page.getByLabel(/password/i).fill(role.password);
      await page.getByRole("button", { name: /login|sign in/i }).click();
      await page.waitForURL(url => !url.toString().includes("/login"), { timeout: 15_000 });
      await context.storageState({ path: stateFile });
      await context.close();

      logger.pass(`Step 4: Token saved — role "${role.name}" → ${stateFile}`);
    } catch (err) {
      logger.warn(`Step 4: Could not seed auth for "${role.name}": ${err}`);
    }
  }

  await browser.close();
}

// ============================================================================
//  STEP 5 — SEED MASTER DATA
// ============================================================================

async function seedMasterData(): Promise<void> {
  const apiUrl = process.env.API_URL ?? configManager.getBaseURL();

  // ── Add your seed operations here ─────────────────────────────────────────
  const seeds: Array<{ name: string; fn: () => Promise<void> }> = [

    // Uncomment and adapt to your application:
    //
    // {
    //   name: "test-admin-user",
    //   fn: async () => {
    //     const res = await fetch(`${apiUrl}/api/users`, {
    //       method:  "POST",
    //       headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    //       body:    JSON.stringify({ email: process.env.ADMIN_EMAIL, role: "admin" }),
    //       signal:  AbortSignal.timeout(5000),
    //     });
    //     if (!res.ok && res.status !== 409) throw new Error(`HTTP ${res.status}`);
    //   },
    // },

  ];

  // ── FIX: skip silently at debug level when no seeds defined ──────────────
  if (seeds.length === 0) {
    logger.debug("Step 5: No seeds defined — skipping");
    return;
  }

  logger.info("Step 5: Seeding master data...");

  const token = await getApiToken(apiUrl ?? "");
  if (!token) {
    logger.warn("Step 5: Could not get API token — skipping master data seeding");
    return;
  }

  for (const seed of seeds) {
    try {
      await seed.fn();
      logger.pass(`Step 5: Seeded "${seed.name}"`);
    } catch (err) {
      logger.warn(`Step 5: Could not seed "${seed.name}": ${err}`);
    }
  }
}

// ============================================================================
//  STEP 6 — VALIDATE PRE-REQ CHAINS
// ============================================================================

function validatePreReqChains(): void {
  logger.info("Step 6: Validating pre-req dependency chains...");

  try {
    PreReqRegistry.validateChains();
    logger.pass("Step 6: All pre-req chains valid — no circular dependencies");
  } catch (err) {
    throw new Error(`[GlobalSetup] Pre-req chain validation failed:\n  ${err}`);
  }
}

// ============================================================================
//  TEARDOWN HELPERS
// ============================================================================

function cleanAuthFiles(): void {
  const authDir = path.resolve(process.cwd(), "auth");
  if (!fs.existsSync(authDir)) return;

  fs.readdirSync(authDir)
    .filter(f => f.endsWith(".json"))
    .forEach(f => {
      try { fs.unlinkSync(path.join(authDir, f)); } catch { /* non-fatal */ }
    });

  logger.debug("Teardown: Auth state files cleaned");
}

// ============================================================================
//  UTILITIES
// ============================================================================

async function pingUrl(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function getApiToken(apiUrl: string): Promise<string | null> {
  const email    = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return null;

  try {
    const res = await fetch(`${apiUrl}/api/auth/login`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email, password }),
      signal:  AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { token?: string; accessToken?: string };
    return data.token ?? data.accessToken ?? null;
  } catch {
    return null;
  }
}

export default globalSetup;

// ── REMOVED the incorrect export line ───────────────────────────────────────
// export { test, expect } from './fixtures';   // <-- THIS WAS THE ERROR
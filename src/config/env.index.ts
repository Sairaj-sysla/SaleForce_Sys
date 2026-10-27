// src/config/env.index.ts

import * as fs   from "fs";
import * as path from "path";
import * as util from "util";
import { devConfig }       from "./env.dev";
import { qaConfig }        from "./env.qa";
import { AppConfigSchema } from "./env.schema";
import type { AppConfig, Environment, TimeoutKeys, FrameworkSettings, GmailOtpConfig } from "./types";

const configs: Record<Environment, AppConfig> = {
  dev: devConfig,
  qa:  qaConfig,
};

// Loads KEY=VALUE pairs from a local, git-ignored .env / .env.<env> file.
// Variables that are already set (shell, CI secrets) always win over the file.
function loadDotEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  const parsed = util.parseEnv(fs.readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
  }
}

// ENVIRONMENT must be a known value — never silently fall back to QA.
// Unset locally → "qa" (previous default); unset on CI → error.
function resolveEnvironment(): Environment {
  const explicit = process.env.ENVIRONMENT?.trim().toLowerCase();
  if (explicit) {
    if (explicit === "dev" || explicit === "qa") return explicit;
    throw new Error(`Unknown ENVIRONMENT "${process.env.ENVIRONMENT}". Expected "dev" or "qa".`);
  }
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === "dev" || nodeEnv === "qa") return nodeEnv;
  if (process.env.CI) {
    throw new Error(`ENVIRONMENT is not set on CI. Set ENVIRONMENT to "dev" or "qa" explicitly.`);
  }
  return "qa";
}

class ConfigManager {
  private env:    Environment;
  private config: AppConfig;

  // ── Framework Settings — single place to enable/disable framework features ─
  //
  // Rules:
  // - This is the ONLY place these flags are defined/mutated.
  // - No other class (BasePage, ElementUtils, AutoHeal, etc.) should ever
  //   need to change to add, remove, or flip a feature.
  // - Consumers read via configManager.getFrameworkSettings().<flag>.
  // - To add a new flag: add one line below. That's it.
  private frameworkSettings: FrameworkSettings = {
    autoHeal: true,  // enable/disable auto-healing of locators
    // aiLocator: true,
    // smartWait: true,
    // retryFailedAction: true,
    // screenshotOnFailure: true,
    // trace: true,
    // video: false,
    // visualTesting: false,
    // accessibility: false,
    // networkCapture: true,
  };

  constructor() {
    loadDotEnv(path.join(process.cwd(), ".env"));
    this.env = resolveEnvironment();
    loadDotEnv(path.join(process.cwd(), `.env.${this.env}`));  // env-specific secrets

    const baseConfig = configs[this.env];

    const merged: AppConfig = {
      ...baseConfig,
      baseURL: process.env.BASE_URL || baseConfig.baseURL,
      testDataPath: process.env.TEST_DATA_PATH || baseConfig.testDataPath,
      credentials: {
        username: process.env.PLAYWRIGHT_USERNAME || baseConfig.credentials.username,
        password: process.env.PLAYWRIGHT_PASSWORD || baseConfig.credentials.password,
      },
      timeouts: {
        action:     Number(process.env.TIMEOUT_ACTION)     || baseConfig.timeouts.action,
        wait:       Number(process.env.TIMEOUT_WAIT)       || baseConfig.timeouts.wait,
        navigation: Number(process.env.TIMEOUT_NAVIGATION) || baseConfig.timeouts.navigation,
      },
      gmailOtp: {
        ...baseConfig.gmailOtp,
        sender:          process.env.GMAIL_OTP_SENDER?.trim()     || baseConfig.gmailOtp?.sender,
        subject:         process.env.GMAIL_OTP_SUBJECT?.trim()    || baseConfig.gmailOtp?.subject,
        otpPattern:      process.env.GMAIL_OTP_PATTERN?.trim()    || baseConfig.gmailOtp?.otpPattern,
        timeoutMs:       Number(process.env.GMAIL_OTP_TIMEOUT_MS)       || baseConfig.gmailOtp?.timeoutMs,
        pollIntervalMs:  Number(process.env.GMAIL_OTP_POLL_INTERVAL_MS) || baseConfig.gmailOtp?.pollIntervalMs,
        clockSkewMs:     Number(process.env.GMAIL_OTP_CLOCK_SKEW_MS)    || baseConfig.gmailOtp?.clockSkewMs,
        credentialsPath: process.env.GMAIL_CREDENTIALS_PATH?.trim() || baseConfig.gmailOtp?.credentialsPath,
        tokenPath:       process.env.GMAIL_TOKEN_PATH?.trim()       || baseConfig.gmailOtp?.tokenPath,
      },
    };

    // Credentials for some envs come only from env vars / .env / CI secrets.
    const missing = [
      !merged.credentials.username && "PLAYWRIGHT_USERNAME",
      !merged.credentials.password && "PLAYWRIGHT_PASSWORD",
    ].filter(Boolean);
    if (missing.length) {
      throw new Error(
        `Missing ${missing.join(", ")} for ENVIRONMENT="${this.env}". ` +
        `Set them in .env.${this.env} (local) or as GitHub Actions secrets (CI).`
      );
    }

    const parsed = AppConfigSchema.safeParse(merged);
    if (!parsed.success) {
      console.error("Invalid environment configuration:", parsed.error.format());
      throw new Error(`Environment config validation failed for "${this.env}"`);
    }

    this.config = parsed.data;

    console.log(`\n▶ Running on ENV: ${this.env.toUpperCase()} | BASE URL: ${this.config.baseURL}\n`);
  }

  // ── Existing methods — untouched ───────────────────────────────────────────

  getEnvironment(): Environment       { return this.env; }
  getBaseURL(): string                { return this.config.baseURL; }
  getEasyURL(): string | undefined    { return this.config.easyURL; }
  getAPIBaseURL(): string | undefined { return this.config.apiBaseURL; }
  getTestDataPath(): string           { return this.config.testDataPath; }
  getCredentials()                    { return this.config.credentials; }
  getBrowserConfig()                  { return this.config.browser; }
  getLoggingConfig()                  { return this.config.logging; }
  getRequestOptions()                 { return this.config.requestOptions; }
  getRawConfig(): AppConfig           { return this.config; }

  getTimeout(type: TimeoutKeys): number {
    return this.config.timeouts[type];
  }

  // Gmail OTP settings with defaults applied. Sender/subject/pattern stay
  // optional — gmailOtp.ts falls back to its built-in OTP pattern.
  getGmailOtpConfig(): GmailOtpConfig {
    const g = this.config.gmailOtp ?? {};
    return {
      sender:          g.sender,
      subject:         g.subject,
      otpPattern:      g.otpPattern,
      timeoutMs:       g.timeoutMs      ?? 90_000,
      pollIntervalMs:  g.pollIntervalMs ?? 5_000,
      clockSkewMs:     g.clockSkewMs    ?? 5_000,
      credentialsPath: path.resolve(process.cwd(), g.credentialsPath ?? "credentials.json"),
      tokenPath:       path.resolve(process.cwd(), g.tokenPath       ?? "token.json"),
    };
  }

  // ── New path methods — single source of truth for all file paths ───────────
  //
  // testDataPath = "testdata/JSON Files"
  // so JSON files resolve directly under testDataPath
  // xlsx files are one level up: "testdata/excelDataFiles/..."

  // → testdata/JSON Files/test-data.json
  getTestDataJsonPath(): string {
    return path.join(
      process.cwd(),
      this.config.testDataPath,
      "test-data.json"
    );
  }

  // → testdata/JSON Files/excel.json
  getExcelJsonPath(): string {
    return path.join(
      process.cwd(),
      this.config.testDataPath,
      "excel.json"
    );
  }

  // filePath is relative to testdata/ root
  // e.g. "excelDataFiles/Sample_TestData.xlsx"
  // → testdata/excelDataFiles/Sample_TestData.xlsx
  getExcelFilePath(filePath: string): string {
    if (!filePath || filePath.trim() === "") {
      throw new Error(
        `ConfigManager.getExcelFilePath: filePath is required`
      );
    }

    // testDataPath = "testdata/JSON Files"
    // go one level up to get testdata/ root
    const testdataRoot = path.join(
      process.cwd(),
      this.config.testDataPath,
      ".."
    );

    const fullPath = path.normalize(
      path.join(testdataRoot, filePath)
    );

    if (!fs.existsSync(fullPath)) {
      throw new Error(
        `ConfigManager.getExcelFilePath: file not found at "${fullPath}"\n` +
        `Received filePath: "${filePath}"\n` +
        `Resolved testdata root: "${testdataRoot}"`
      );
    }

    return fullPath;
  }

  // ── Framework Settings getter ───────────────────────────────────────────────
  //
  // Returns the full feature-flag map. Consumers pick the flag they care
  // about, e.g.:
  //
  //   if (configManager.getFrameworkSettings().autoHeal) {
  //       // Execute auto healing
  //   } else {
  //       // Existing locator logic
  //   }
  //
  // Returning the live object (not a clone) keeps this cheap and read-mostly;
  // ConfigManager remains the only writer by convention/design — no setter
  // is exposed, so external code can only read flags, never mutate them
  // through this API.
  getFrameworkSettings(): Readonly<FrameworkSettings> {
    return this.frameworkSettings;
  }
}

export const configManager = new ConfigManager();
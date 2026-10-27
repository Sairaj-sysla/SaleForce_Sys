// playwright.config.ts
import { defineConfig } from "@playwright/test";
import { configManager } from "./src/config/env.index";
import "./src/utils/runtimeGlobal";


// ============================================================================
// Runtime Config
// ============================================================================
const baseURL = configManager.getBaseURL();
const browserConf = configManager.getBrowserConfig();
const env = configManager.getEnvironment();
const isCI = !!process.env.CI;
const headlessEnv = process.env.HEADLESS?.trim().toLowerCase();

const headless = isCI
  ? true
  : headlessEnv === "true"
    ? true
    : headlessEnv === "false"
      ? false
      : browserConf.headless;

const actionTimeout = configManager.getTimeout("action");
const navTimeout = configManager.getTimeout("navigation");
const slowMo = isCI ? 0 : (browserConf.slowMo ?? 0);

console.log(
  `\n▶ Running on ENV: ${env.toUpperCase()} | CI: ${isCI} | HEADLESS: ${headless} | BASE URL: ${baseURL}\n`
);

// ============================================================================
// Playwright Config
// ============================================================================
export default defineConfig({
  testDir: ".",

  testMatch: ["test/**/*.spec.ts", "tests/**/*.spec.ts"],

  globalSetup: "./src/fixtures/globalSetup.ts",

  timeout: 900_000,

  expect: {
    timeout: 25_000,
  },

  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : 4,
  maxFailures: isCI ? 20 : undefined,

  use: {
    baseURL,
    headless,
    viewport: null,

    launchOptions: isCI
      ? { args: ["--no-sandbox", "--disable-setuid-sandbox"], slowMo }
      : { args: ["--start-maximized", "--window-size=1920,1080"], slowMo },

    actionTimeout,
    navigationTimeout: navTimeout,

    screenshot: "only-on-failure",

    // Local: disable video to reduce unnecessary artifacts.
    // CI: retain video when a test fails.
    video: isCI ? "retain-on-failure" : "off",
    trace: isCI ? "retain-on-failure" : "off",

    locale: "en-US",
    timezoneId: "Asia/Kolkata",

    ignoreHTTPSErrors: env !== "qa",
  },

  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        launchOptions: isCI
          ? { args: ["--no-sandbox", "--disable-setuid-sandbox"], slowMo }
          : { args: ["--start-maximized", "--window-size=1920,1080"], slowMo },
      },
    },

    // { name: "firefox", use: { browserName: "firefox" } },
    // { name: "webkit", use: { browserName: "webkit" } },
  ],

  outputDir: "./test-results",

  // ==========================================================================
  // Reporters
  // ==========================================================================
  reporter: isCI
    ? [
        ["list"],
        [
          "./reports/enterprise-reporter.js",
          { outputFolder: "enterprise-report" },
        ],
        ["junit", { outputFile: "reports/results.xml" }],
        ["html", { outputFolder: "playwright-report", open: "never" }],
        ["allure-playwright", { outputFolder: "allure-results" }],
        //["reporting-labs", reportingLabs],
      ]
    : [
        ["list"],
        [
          "./reports/enterprise-reporter.js",
          { outputFolder: "enterprise-report" },
        ],
        ["html", { outputFolder: "playwright-report", open: "never" }],
        ["junit", { outputFile: "reports/results.xml" }],
        ["allure-playwright", { outputFolder: "allure-results" }],
        //["reporting-labs", reportingLabs],
      ],
});
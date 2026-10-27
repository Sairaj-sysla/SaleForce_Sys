// ============================================================================
// WAIT UTILS - ENTERPRISE VERSION
// ----------------------------------------------------------------------------
// PURPOSE:
//   Unified wait handlers for Playwright tests.
//   Provides clean log output with smart element names (auto-labeling).
//   Designed for highly dynamic UIs (React,  Canvas, SPA redirects).
//
// FEATURES:
//   ✔ Smart label extractor (clean logs like "Wait → Apply Button")
//   ✔ Wait for visible / hidden
//   ✔ Wait for load states (domcontentloaded / networkidle)
//   ✔ Wait for URL match or substring
//   ✔ Wait for text inside element
//   ✔ Built-in time tracking + color-coded logger output
//
// USED BY:
//   - BasePage
//   - ElementUtils
//   - Any direct waits inside workflows
//
// WHEN TO USE:
//   - Before interacting with dynamic elements
//   - Waiting for spinners / toast messages to disappear
//   - Waiting for navigation or data refresh
//   - Polling text in a table or notification message
// ============================================================================

import { Locator, Page, expect } from "@playwright/test";
import { logger } from "../helpers/logger";
import { Global_Timeout } from "../config/globalTimeout";

export class WaitUtils {

  // ============================================================================
  // SMART LABEL EXTRACTOR
  // ----------------------------------------------------------------------------
  /**
   * Extracts readable element names from locators for clean logging.
   *
   * HOW IT WORKS:
   * - Parses text(), normalize-space(), aria-label, getByRole, etc.
   * - Fallback: returns simplified locator string
   *
   * @example
   * locator → //button[normalize-space()="Apply"]
   * label   → "Apply"
   */
  private static resolveLabel(locator: Locator, given?: string): string {
    if (given) return given;

    const raw = locator.toString();

    const patterns = [
      /normalize-space\(\)="([^"]+)"/,
      /normalize-space\(\)='([^']+)'/,
      /text\(\)="([^"]+)"/,
      /text\(\)='([^']+)'/,
      /contains\([^,]+,\s*["']([^"']+)["']\)/,
      /@aria-label="([^"]+)"/,
      /@placeholder="([^"]+)"/,
      /@title="([^"]+)"/,
      /getByRole\('([^']+)'/,
      /getByText\('([^']+)'/,
      /getByLabel\('([^']+)'/,
    ];

    for (const p of patterns) {
      const m = raw.match(p);
      if (m?.[1]) return m[1].trim();
    }

    const fallback = [
      /#(\w+)/,
      /\.([a-zA-Z][\w-]*)/,
      /data-testid="([^"]+)"/,
    ];

    for (const p of fallback) {
      const m = raw.match(p);
      if (m?.[1]) return m[1].trim();
    }

    return raw.split("@")[1]?.substring(0, 40) || "<element>";
  }

  // ============================================================================
  // WAIT FOR ELEMENT TO BE VISIBLE
  // ----------------------------------------------------------------------------
  /**
   * Waits until an element becomes visible on the page.
   *
   * HOW IT WORKS:
   * - Polls visibility every ~100ms (Playwright internal)
   * - Logs start + end time
   *
   * WHEN TO USE:
   * - Before clicking/modifying an element
   * - Waiting for modal, dropdown, or button to appear
   * - After navigation where content loads dynamically
   *
   * @example:
   * await WaitUtils.waitForElementIsVisible(this.saveButton);
   */
  static async waitForElementIsVisible(
    locator: Locator,
    timeout: number = Global_Timeout.wait,
    label?: string
  ): Promise<void> {
    const name = this.resolveLabel(locator, label);
    logger.debug(`Wait: visible → ${name} | timeout: ${timeout}ms`);

    const start = Date.now();

    try {
      await locator.waitFor({ state: "visible", timeout });
      logger.debug(`Visible in ${Date.now() - start}ms → ${name}`);
    } catch (err) {
      logger.error(`Timeout after ${Date.now() - start}ms → ${name}`);
      throw err;
    }
  }

  // ============================================================================
  // WAIT FOR ELEMENT TO DISAPPEAR
  // ----------------------------------------------------------------------------
  /**
   * Waits until an element becomes hidden or removed.
   *
   * WHEN TO USE:
   * - spinners / loaders
   * - Toast notifications that auto-hide
   * - Waiting for transitions (modals closing)
   *
   * @example:
   * await WaitUtils.waitForElementToDisappear(this.spinner);
   */
  static async waitForElementToDisappear(
    locator: Locator,
    timeout: number = Global_Timeout.wait,
    label?: string
  ): Promise<void> {
    const name = this.resolveLabel(locator, label);
    logger.debug(`Wait: hidden → ${name} | timeout: ${timeout}ms`);

    const start = Date.now();

    try {
      await locator.waitFor({ state: "hidden", timeout });
      logger.debug(`Hidden in ${Date.now() - start}ms → ${name}`);
    } catch (err) {
      logger.error(`Timeout after ${Date.now() - start}ms → ${name}`);
      throw err;
    }
  }

  // ============================================================================
  // WAIT FOR PAGE LOADSTATE
  // ----------------------------------------------------------------------------
  /**
   * Waits for load / domcontentloaded / networkidle states.
   *
   * WHEN TO USE:
   * - After page.goto()
   * - After submitting forms that reload the page
   *
   * @example:
   * await WaitUtils.waitForLoadState(page, "networkidle");
   */
  static async waitForLoadState(
    page: Page,
    state: "load" | "domcontentloaded" | "networkidle" = "networkidle",
    timeout: number = Global_Timeout.wait
  ): Promise<void> {
    logger.debug(`Wait: loadState → ${state}`);

    const start = Date.now();

    try {
      await page.waitForLoadState(state, { timeout });
      logger.debug(`LoadState reached (${state}) in ${Date.now() - start}ms`);
    } catch (err) {
      logger.error(`LoadState timeout (${state}) after ${Date.now() - start}ms`);
      throw err;
    }
  }

  // ============================================================================
  // WAIT FOR URL CONTAINS / MATCH
  // ----------------------------------------------------------------------------
  /**
   * Waits for page URL to contain a substring (regex supported).
   *
   * WHEN TO USE:
   * - After login redirect
   * - After clicking navigation links
   *
   * @example:
   * await WaitUtils.waitForURLContains(page, "dashboard");
   */
  static async waitForURLContains(
    page: Page,
    substring: string,
    timeout: number = Global_Timeout.wait
  ): Promise<void> {
    logger.debug(`Wait: URL contains → "${substring}"`);

    const start = Date.now();

    try {
      await expect(page).toHaveURL(new RegExp(substring), { timeout });
      logger.debug(`URL matched "${substring}" in ${Date.now() - start}ms`);
    } catch (err) {
      logger.error(
        `URL did not contain "${substring}" | current: ${page.url()}`
      );
      throw err;
    }
  }

  // ============================================================================
  // WAIT FOR TEXT INSIDE ELEMENT
  // ----------------------------------------------------------------------------
  /**
   * Polls an element until it contains expected text.
   *
   * WHEN TO USE:
   * - Waiting for toast: "Workflow saved"
   * - Waiting for table values to update
   * - Poll dynamic values without requerying DOM
   *
   * @example:
   * await WaitUtils.waitForText(this.successMsg, "Saved");
   */
  static async waitForText(
    locator: Locator,
    expected: string,
    timeout: number = Global_Timeout.wait,
    interval: number = 250,
    label?: string
  ): Promise<void> {
    const name = this.resolveLabel(locator, label);
    logger.debug(`Wait: text "${expected}" → ${name}`);

    const start = Date.now();

    while (Date.now() - start < timeout) {
      const text = await locator.textContent().catch(() => null);

      if (text?.includes(expected)) {
        logger.debug(`Text found in ${Date.now() - start}ms → "${expected}"`);
        return;
      }

      await this.sleep(interval);
    }

    logger.error(
      `Text "${expected}" NOT found after ${Date.now() - start}ms → ${name}`
    );
    throw new Error(`Timeout waiting for text "${expected}" in → ${name}`);
  }

  // ============================================================================
  // INTERNAL SLEEP
  // ----------------------------------------------------------------------------
  private static sleep(ms: number): Promise<void> {
    return new Promise((res) => setTimeout(res, ms));
  }
}
// ============================================================================
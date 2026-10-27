// ============================================================================
// VALIDATION UTILS - WITH SMART LABEL EXTRACTION
// ----------------------------------------------------------------------------
// PURPOSE:
//   Non-throwing validation helpers for conditional checks in tests.
//   Returns true/false instead of throwing — use in if() conditions.
//
// DIFFERENCE FROM ASSERTIONS:
//   BasePage.assertElementVisible() → throws if fails (hard assertion)
//   ValidationUtils.isElementVisible() → returns false (soft check)
//
// WHEN TO USE:
//   if (await ValidationUtils.isElementVisible(this.errorMsg)) {
//     const text = await ValidationUtils.getElementText(this.errorMsg);
//     logger.warn(`Error shown: ${text}`);
//   }
//
// USED BY:
//   - Page Objects for conditional logic
//   - Tests for soft assertions
//   - Never used directly in BasePage (BasePage uses expect() directly)
// ============================================================================

import { Locator } from "@playwright/test";
import { logger } from "./logger";

export class ValidationUtils {

  // --------------------------------------------------------------------------
  // SMART LABEL EXTRACTOR
  // --------------------------------------------------------------------------
  private static label(locator: Locator): string {
    const raw = locator.toString();

    const patterns = [
      /normalize-space\(\)="([^"]+)"/,
      /normalize-space\(\)='([^']+)'/,
      /text\(\)="([^"]+)"/,
      /text\(\)='([^']+)'/,
      /contains\([^,]+,\s*["']([^"']+)["']\)/,
      /@aria-label="([^"]+)"/,
      /getByRole\('([^']+)'/,
      /getByText\('([^']+)'/,
      /getByLabel\('([^']+)'/,
    ];

    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (match?.[1]) return match[1].trim();
    }

    const fallback = [
      /#(\w+)/,
      /\.([a-zA-Z][\w-]*)/,
      /data-testid="([^"]+)"/,
    ];

    for (const pattern of fallback) {
      const match = raw.match(pattern);
      if (match?.[1]) return match[1].trim();
    }

    return raw.split("@")[1]?.substring(0, 50) || "<element>";
  }

  // --------------------------------------------------------------------------
  // IS VISIBLE
  // --------------------------------------------------------------------------
  /**
   * Returns true if element becomes visible within timeout.
   * Returns false silently if not — never throws.
   *
   * @example
   * const shown = await ValidationUtils.isElementVisible(this.errorBanner);
   * if (shown) { ... }
   *
   * @param locator - Playwright Locator
   * @param timeout - ms to wait (default: 5000)
   */
  static async isElementVisible(
    locator: Locator,
    timeout: number = 5000
  ): Promise<boolean> {
    const label = this.label(locator);
    try {
      logger.debug(`Check visible → ${label}`);
      await locator.waitFor({ state: "visible", timeout });
      return await locator.isVisible();
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // IS ENABLED
  // --------------------------------------------------------------------------
  /**
   * Returns true if element is currently enabled.
   *
   * @example
   * const ready = await ValidationUtils.isElementEnabled(this.submitBtn);
   */
  static async isElementEnabled(locator: Locator): Promise<boolean> {
    const label = this.label(locator);
    try {
      logger.debug(`Check enabled → ${label}`);
      return await locator.isEnabled();
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // IS CHECKED
  // --------------------------------------------------------------------------
  /**
   * Returns true if checkbox or radio is checked.
   *
   * @example
   * const agreed = await ValidationUtils.isElementChecked(this.termsBox);
   */
  static async isElementChecked(locator: Locator): Promise<boolean> {
    const label = this.label(locator);
    try {
      logger.debug(`Check checked → ${label}`);
      return await locator.isChecked();
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // GET TEXT
  // --------------------------------------------------------------------------
  /**
   * Returns trimmed text content of element, or "" if unavailable.
   *
   * @example
   * const msg = await ValidationUtils.getElementText(this.statusLabel);
   */
  static async getElementText(locator: Locator): Promise<string> {
    const label = this.label(locator);
    logger.debug(`GetText → ${label}`);
    return (await locator.textContent())?.trim() || "";
  }

  // --------------------------------------------------------------------------
  // GET INPUT VALUE
  // --------------------------------------------------------------------------
  /**
   * Returns current value of an input or textarea.
   *
   * @example
   * const city = await ValidationUtils.getInputValue(this.cityInput);
   */
  static async getInputValue(locator: Locator): Promise<string> {
    const label = this.label(locator);
    logger.debug(`GetInputValue → ${label}`);
    return await locator.inputValue();
  }

  // --------------------------------------------------------------------------
  // GET ATTRIBUTE
  // --------------------------------------------------------------------------
  /**
   * Returns value of a specific attribute, or null if not present.
   *
   * @example
   * const href = await ValidationUtils.getElementAttribute(this.link, "href");
   */
  static async getElementAttribute(
    locator: Locator,
    attribute: string
  ): Promise<string | null> {
    const label = this.label(locator);
    logger.debug(`Attribute "${attribute}" → ${label}`);
    return await locator.getAttribute(attribute);
  }

  // --------------------------------------------------------------------------
  // COUNT ELEMENTS
  // --------------------------------------------------------------------------
  /**
   * Returns number of elements matching the locator.
   *
   * @example
   * const count = await ValidationUtils.countElements(this.hotelCards);
   */
  static async countElements(locator: Locator): Promise<number> {
    const label = this.label(locator);
    logger.debug(`Count elements → ${label}`);
    return await locator.count();
  }

  // --------------------------------------------------------------------------
  // TEXT CONTAINS (partial match)
  // --------------------------------------------------------------------------
  /**
   * Returns true if element's text includes the given string or matches regex.
   * Waits up to timeout for element to be visible before reading text.
   *
   * @example
   * const hasError = await ValidationUtils.isElementContainsText(
   *   this.msgBox, "invalid", 3000
   * );
   *
   * @param locator  - element to check
   * @param text     - string (partial match) or RegExp
   * @param timeout  - ms to wait for element (default: 5000)
   */
  static async isElementContainsText(
    locator: Locator,
    text: string | RegExp,
    timeout: number = 5000
  ): Promise<boolean> {
    const label = this.label(locator);
    try {
      logger.debug(`Check text contains "${text}" → ${label}`);
      await locator.waitFor({ state: "visible", timeout });
      const content = await locator.textContent();
      if (!content) return false;
      return typeof text === "string" ? content.includes(text) : text.test(content);
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // HAS TEXT (exact match)
  // --------------------------------------------------------------------------
  /**
   * Returns true if element's trimmed text exactly equals the given string
   * or matches the given regex.
   * Waits up to timeout for element to be visible before reading text.
   *
   * @example
   * const confirmed = await ValidationUtils.hasText(
   *   this.statusLabel, "Booking Confirmed", 5000
   * );
   *
   * @param locator  - element to check
   * @param text     - string (exact match) or RegExp
   * @param timeout  - ms to wait for element (default: 5000)
   */
  static async hasText(
    locator: Locator,
    text: string | RegExp,
    timeout: number = 5000
  ): Promise<boolean> {
    const label = this.label(locator);
    try {
      logger.debug(`Check has text "${text}" → ${label}`);
      await locator.waitFor({ state: "visible", timeout });
      const content = await locator.textContent();
      if (!content) return false;
      return typeof text === "string"
        ? content.trim() === text
        : text.test(content);
    } catch {
      return false;
    }
  }
}
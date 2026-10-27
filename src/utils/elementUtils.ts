// ============================================================================
// ELEMENT UTILS - ENTERPRISE VERSION WITH PLAYWRIGHT SMART HEALING
// ----------------------------------------------------------------------------
// FEATURES:
// ✔ Smart label extraction for clean logs
// ✔ Advanced retry with backoff (via RetryUtils)
// ✔ AUTO-HEAL — lightweight runtime DOM recovery on locator failure
//   (toggle-controlled via ConfigManager.getFrameworkSettings().autoHeal)
// ✔ Scroll-into-view safety
// ✔ Unified behavior for all PageObject actions
// ✔ Clean console + file logging
//
// PURPOSE:
// Central place for ALL element-level interactions.
// BasePage delegates EVERYTHING here.
//
// HOW AUTO-HEAL WORKS:
// --------------------------------
// Original locator is checked first. If it is not visible, the framework tries
// Playwright-native recovery strategies in order: role, label, placeholder,
// text, CSS, XPath. The recovery layer is stateless.
//
// FEATURE TOGGLE:
// --------------------------------
// AutoHeal execution is now gated centrally by ConfigManager, NOT by editing
// this file. See resolveHealedLocator() below — it is the ONLY place that
// reads configManager.getFrameworkSettings().autoHeal. Turning the feature
// on/off is done exclusively from src/config/env.index.ts.
//
// ZERO CHANGES NEEDED IN:
// ✔ BasePage.ts   — unchanged
// ✔ Page Objects  — unchanged
// ✔ Test files    — unchanged
//
// HOW TO USE IN PAGE OBJECT (same as before — nothing changes):
// --------------------------------
// class LoginPage extends BasePage {
//   username = this.page.locator('#username');
//   password = this.page.locator('#password');
//   loginBtn = this.page.locator('button:text("Login")');
//
//   async login() {
//     await this.click(this.username);
//     await this.fill(this.username, "admin");
//     await this.fill(this.password, "pass123");
//     await this.click(this.loginBtn);
//   }
// }
//
// NOTE: All BasePage methods internally call ElementUtils.* methods.
// You NEVER use ElementUtils directly in test files.
// ============================================================================

import { Locator } from "@playwright/test";
import { RetryUtils, RetryOptions } from "./retryUtils";
import { Global_Timeout } from "../config/globalTimeout";
import { logger } from "../helpers/logger";
import { autoHeal } from "./autoHeal";
import { configManager } from "../config/env.index";

export class ElementUtils {

  // ============================================================================
  // AUTO-HEAL GATEWAY (Feature-Toggle Aware)
  // ----------------------------------------------------------------------------
  /**
   * Single choke point for the autoHeal feature flag.
   *
   * HOW IT WORKS:
   * - Reads configManager.getFrameworkSettings().autoHeal
   *     • true  → delegates to the real autoHeal() recovery engine
   *     • false → skips healing entirely and returns the ORIGINAL locator,
   *               falling back to normal Playwright locator behavior
   *
   * WHY THIS EXISTS (SOLID):
   * - Single Responsibility: this method's only job is to decide WHETHER to
   *   heal; it does not know HOW to click/fill/type.
   * - Open/Closed: click(), fill(), type() etc. never change when the toggle
   *   logic changes — they just call this gateway.
   * - No other class (BasePage, AutoHeal, ConfigManager) needs to be touched
   *   to flip this feature on/off — only env.index.ts owns that switch.
   *
   * @param locator Original Playwright Locator
   * @param timeout Max time budget for the healing attempt
   * @returns { locator, healed, strategy } — same shape as autoHeal()
   */
  private static async resolveHealedLocator(
    locator: Locator,
    timeout: number
  ): Promise<{ locator: Locator; healed: boolean; strategy?: string }> {

    if (configManager.getFrameworkSettings().autoHeal) {
      // Execute auto healing
      return autoHeal(locator, undefined, Math.min(timeout, 4000));
    }

    // Existing / normal locator logic — feature disabled, no healing attempted
    return { locator, healed: false, strategy: undefined };
  }

  // ============================================================================
  // LABEL RESOLUTION FOR CLEAN LOGGING
  // ----------------------------------------------------------------------------
  /**
   * Extracts a human-friendly label from a Playwright Locator.
   *
   * HOW IT WORKS:
   * - Extracts meaningful text from xpath/text()/normalize-space()
   * - Falls back to getByText/getByRole/aria-label/title/placeholder
   * - If nothing found → returns trimmed locator string
   *
   * @param locator Playwright Locator
   * @param custom Optional custom label override
   * @returns readable name like "Login", "Save", "Workflow Name"
   */
  public static resolveLabel(locator: Locator, custom?: string): string {
    if (custom) return custom;

    const raw = locator.toString();

    const patterns = [
      /normalize-space\(\)="([^"]+)"/,
      /text\(\)="([^"]+)"/,
      /text\(\)='([^']+)'/,
      /getByRole\('([^']+)'/,
      /getByText\('([^']+)'/,
      /@aria-label="([^"]+)"/,
      /@placeholder="([^"]+)"/,
      /@title="([^"]+)"/,
    ];

    for (const p of patterns) {
      const m = raw.match(p);
      if (m && m[1]) return m[1];
    }

    const fallback = raw.split("@")[1];
    return fallback ? fallback.substring(0, 50) : "<element>";
  }

  // ============================================================================
  // CLICK (WITH AUTO-HEAL +  CANVAS FIX)
  // ----------------------------------------------------------------------------
  /**
   * Clicks the element, safely + reliably.
   *
   * HOW IT WORKS:
   * 1) resolveHealedLocator() — heals ONLY if configManager.getFrameworkSettings().autoHeal
   *    is true; otherwise the original locator passes straight through
   * 2) Waits for visible on (healed or original) locator
   * 3) Scrolls into view
   * 4) Attempts normal locator.click()
   * 5) If blocked by Svelte Canvas edges → performs boundingBox() click
   *
   * WHEN TO USE:
   * - For ANY click operation in any page object
   * - Auto-heals if locator fails due to UI change (when feature is ON)
   * - Automatically fixes Bluecopa canvas click failures
   *
   * @example
   * await this.click(this.saveButton);
   */
  static async click(
    locator: Locator,
    options?: {
      timeout?: number;
      force?: boolean;
      label?: string;
      retryOptions?: RetryOptions;
    }
  ) {
    const label   = options?.label || this.resolveLabel(locator);
    const timeout = options?.timeout || Global_Timeout.action;

    await RetryUtils.retry(async () => {

      if (configManager.getFrameworkSettings().autoHeal) {
        // Execute auto healing
        const { locator: healed, healed: wasHealed, strategy } =
          await this.resolveHealedLocator(locator, timeout);

        if (wasHealed) {
          logger.warn(`[AutoHeal] click healed via [${strategy}] → ${label}`);
        }

        logger.debug(`Click → ${label}`);

        await healed.waitFor({ state: "visible", timeout });

        try { await healed.scrollIntoViewIfNeeded({ timeout: 4000 }); } catch {}

        // ── Try normal click first ───────────────────────────────────────
        try {
          await healed.click({ timeout, force: options?.force || false });
          return;
        } catch {
          logger.warn(`Normal click failed for → ${label}`);
          logger.warn(`Trying bounding-box fallback click...`);
        }

        // ── Bluecopa canvas fallback ─────────────────────────────────────
        const box = await healed.boundingBox();
        if (!box) throw new Error(`Bounding box not found → ${label}`);

        logger.debug(`BoundingBoxClick → ${label}`);
        await healed.page().mouse.click(
          box.x + box.width / 2,
          box.y + box.height / 2
        );

      } else {
        // Existing locator logic (AutoHeal disabled — plain Playwright flow)
        logger.debug(`Click → ${label}`);

        await locator.waitFor({ state: "visible", timeout });

        try { await locator.scrollIntoViewIfNeeded({ timeout: 4000 }); } catch {}

        try {
          await locator.click({ timeout, force: options?.force || false });
          return;
        } catch {
          logger.warn(`Normal click failed for → ${label}`);
          logger.warn(`Trying bounding-box fallback click...`);
        }

        const box = await locator.boundingBox();
        if (!box) throw new Error(`Bounding box not found → ${label}`);

        logger.debug(`BoundingBoxClick → ${label}`);
        await locator.page().mouse.click(
          box.x + box.width / 2,
          box.y + box.height / 2
        );
      }
    }, options?.retryOptions);
  }

  // ============================================================================
  // DOUBLE CLICK
  // ----------------------------------------------------------------------------
  /**
   * Performs a double-click.
   *
   * WHEN TO USE:
   * - Table open actions
   * - Blueprint / Canvas items needing double click
   */
  static async doubleClick(
    locator: Locator,
    options?: { timeout?: number; label?: string; retryOptions?: RetryOptions }
  ) {
    const label   = options?.label || this.resolveLabel(locator);
    const timeout = options?.timeout || Global_Timeout.action;

    await RetryUtils.retry(async () => {
      logger.debug(`DoubleClick → ${label}`);
      try { await locator.scrollIntoViewIfNeeded(); } catch {}
      await locator.waitFor({ state: "visible", timeout });
      await locator.dblclick({ timeout });
    }, options?.retryOptions);
  }

  // ============================================================================
  // RIGHT CLICK
  // ----------------------------------------------------------------------------
  /**
   * Right-click on element (context menu).
   */
  static async rightClick(
    locator: Locator,
    options?: { timeout?: number; label?: string; retryOptions?: RetryOptions }
  ) {
    const label = options?.label || this.resolveLabel(locator);
    await RetryUtils.retry(async () => {
      logger.debug(`RightClick → ${label}`);
      try { await locator.scrollIntoViewIfNeeded(); } catch {}
      await locator.click({ button: "right" });
    }, options?.retryOptions);
  }

  // ============================================================================
  // FILL (Instant fill) — WITH AUTO-HEAL
  // ----------------------------------------------------------------------------
  /**
   * Fills input instantly.
   *
   * HOW IT WORKS:
   * 1) resolveHealedLocator() — heals ONLY if configManager.getFrameworkSettings().autoHeal
   *    is true; otherwise the original locator is used as-is
   * 2) Scrolls into view
   * 3) Waits for visible
   * 4) locator.fill(text)
   *
   * WHEN TO USE:
   * - Normal inputs, name fields, etc.
   * - When key-by-key typing is not required
   *
   * @example
   * await this.fill(this.emailInput, "user@example.com");
   */
  static async fill(
    locator: Locator,
    text: string,
    options?: { timeout?: number; label?: string; retryOptions?: RetryOptions }
  ) {
    const label   = options?.label || this.resolveLabel(locator);
    const timeout = options?.timeout || Global_Timeout.action;

    await RetryUtils.retry(async () => {

      if (configManager.getFrameworkSettings().autoHeal) {
        // Execute auto healing
        const { locator: healed, healed: wasHealed, strategy } =
          await this.resolveHealedLocator(locator, timeout);

        if (wasHealed) {
          logger.warn(`[AutoHeal] fill healed via [${strategy}] → ${label}`);
        }

        logger.debug(`Fill → ${label} | ${text}`);
        try { await healed.scrollIntoViewIfNeeded(); } catch {}
        await healed.waitFor({ state: "visible", timeout });
        await healed.fill(text, { timeout });

      } else {
        // Existing locator logic (AutoHeal disabled — plain Playwright flow)
        logger.debug(`Fill → ${label} | ${text}`);
        try { await locator.scrollIntoViewIfNeeded(); } catch {}
        await locator.waitFor({ state: "visible", timeout });
        await locator.fill(text, { timeout });
      }
    }, options?.retryOptions);
  }

  // ============================================================================
  // TYPE (slow typing, key-by-key) — WITH AUTO-HEAL
  // ----------------------------------------------------------------------------
  /**
   * Types text key-by-key (fires keydown/keyup/input events).
   *
   * HOW IT WORKS:
   * 1) resolveHealedLocator() — heals ONLY if configManager.getFrameworkSettings().autoHeal
   *    is true; otherwise the original locator is used as-is
   * 2) Scrolls into view
   * 3) Waits for visible
   * 4) locator.pressSequentially(text, { delay })
   *
   * WHEN TO USE:
   * - Autocomplete inputs
   * - Search bars
   * - Inputs requiring typing events
   *
   * @example
   * await this.type(this.citySearch, "Bangalore", { delay: 50 });
   */
  static async type(
    locator: Locator,
    text: string,
    options?: {
      timeout?: number;
      delay?: number;
      label?: string;
      retryOptions?: RetryOptions;
    }
  ) {
    const label   = options?.label || this.resolveLabel(locator);
    const timeout = options?.timeout || Global_Timeout.action;
    const delay   = options?.delay ?? 50;

    await RetryUtils.retry(async () => {

      if (configManager.getFrameworkSettings().autoHeal) {
        // Execute auto healing
        const { locator: healed, healed: wasHealed, strategy } =
          await this.resolveHealedLocator(locator, timeout);

        if (wasHealed) {
          logger.warn(`[AutoHeal] type healed via [${strategy}] → ${label}`);
        }

        logger.debug(`Type → ${label} | value="${text}"`);
        try { await healed.scrollIntoViewIfNeeded(); } catch {}
        await healed.waitFor({ state: "visible", timeout });
        await healed.pressSequentially(text, { delay });

      } else {
        // Existing locator logic (AutoHeal disabled — plain Playwright flow)
        logger.debug(`Type → ${label} | value="${text}"`);
        try { await locator.scrollIntoViewIfNeeded(); } catch {}
        await locator.waitFor({ state: "visible", timeout });
        await locator.pressSequentially(text, { delay });
      }
    }, options?.retryOptions);
  }

  // ============================================================================
  // CLEAR
  // ----------------------------------------------------------------------------
  /**
   * Clears the input value.
   *
   * WHEN TO USE:
   * - Search reset
   * - Clearing previous filters
   */
  static async clear(locator: Locator, options?: { label?: string }) {
    const label = options?.label || this.resolveLabel(locator);

    await RetryUtils.retry(async () => {
      logger.debug(`Clear → ${label}`);
      try { await locator.scrollIntoViewIfNeeded(); } catch {}
      await locator.waitFor({ state: "visible" });
      await locator.clear();
    });
  }

  // ============================================================================
  // HOVER
  // ----------------------------------------------------------------------------
  static async hover(locator: Locator, options?: { label?: string }) {
    const label = options?.label || this.resolveLabel(locator);

    await RetryUtils.retry(async () => {
      logger.debug(`Hover → ${label}`);
      try { await locator.scrollIntoViewIfNeeded(); } catch {}
      await locator.hover();
    });
  }

  // ============================================================================
  // FOCUS
  // ----------------------------------------------------------------------------
  static async focus(locator: Locator, options?: { label?: string }) {
    const label = options?.label || this.resolveLabel(locator);

    await RetryUtils.retry(async () => {
      logger.debug(`Focus → ${label}`);
      await locator.focus();
    });
  }

  // ============================================================================
  // SELECT OPTION
  // ----------------------------------------------------------------------------
  static async selectOption(
    locator: Locator,
    value: string | string[],
    options?: { label?: string }
  ) {
    const label = options?.label || this.resolveLabel(locator);
    await RetryUtils.retry(async () => {
      logger.debug(`SelectOption → ${label}`);
      await locator.selectOption(value);
    });
  }

  // ============================================================================
  // CHECK & UNCHECK
  // ----------------------------------------------------------------------------
  static async check(locator: Locator, options?: { label?: string }) {
    const label = options?.label || this.resolveLabel(locator);
    await RetryUtils.retry(async () => {
      logger.debug(`Check → ${label}`);
      await locator.check();
    });
  }

  static async uncheck(locator: Locator, options?: { label?: string }) {
    const label = options?.label || this.resolveLabel(locator);
    await RetryUtils.retry(async () => {
      logger.debug(`Uncheck → ${label}`);
      await locator.uncheck();
    });
  }

  // ============================================================================
  // PRESS (Keyboard)
  // ----------------------------------------------------------------------------
  static async press(locator: Locator, key: string, options?: { label?: string }) {
    const label = options?.label || this.resolveLabel(locator);
    await RetryUtils.retry(async () => {
      logger.debug(`Press "${key}" → ${label}`);
      await locator.press(key);
    });
  }
}
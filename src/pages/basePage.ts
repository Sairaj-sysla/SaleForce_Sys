// ============================================================================
//  BASE PAGE - ENTERPRISE LEVEL v2 (FINAL - CLEAN LOGGING)
//  ── ErrorHandler.handle() on every method
//  ── try/catch inside every method body — logs expected/actual/element/locator
//  ── logger.info() for actions, logger.debug() for locators
//  ── AUTOMATIC test.step() wrapping — no explicit step calls in tests
//  ── Per-step log capture & attachment (JSON metadata for reporter)
//  ── Plain delay() instead of page.waitForTimeout()
//  ── Clean console logs (no emojis)
//  ── AutoHeal now toggle-controlled via ConfigManager.getFrameworkSettings().autoHeal
// ============================================================================

import { Page, Locator, FrameLocator, test as baseTest, TestInfo } from "@playwright/test";
import { WaitUtils }      from "../utils/waitUtils";
import { ErrorHandler }   from "../utils/errorHandler";
import { configManager }  from "../config/env.index";
import { Runtime }        from "../utils/runtimeStore";
import { logger }         from "../helpers/logger";
import { autoHeal }       from "../utils/autoHeal";

// ── Plain delay — creates NO Playwright internal step ────────────────────────
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

type CompareOp = "==" | "!=" | "contains" | "!contains" | ">" | ">=" | "<" | "<=";

export class BasePage {
  protected page: Page;
  private test: typeof baseTest;
  private testInfo: TestInfo;
  private _currentFrame: FrameLocator | null = null;
  private _softErrors:   string[]            = [];

  constructor(page: Page, test: typeof baseTest, testInfo: TestInfo) {
    this.page = page;
    this.test = test;
    this.testInfo = testInfo;
  }

  // ==========================================================================
  //  HELPERS
  // ==========================================================================

  private getLocatorStr(selector: string | Locator): string {
    if (typeof selector === "string") return selector;
    try { return selector.toString(); } catch { return "unknown-locator"; }
  }

  // ==========================================================================
  //  CORE: resolveLocator — auto-wait + auto-heal (feature-toggle aware)
  // ==========================================================================
  //
  // AutoHeal execution is gated centrally here — ONLY here — by reading
  // configManager.getFrameworkSettings().autoHeal.
  //
  //   autoHeal = true  → Execute auto healing (original behavior, unchanged)
  //   autoHeal = false → Existing locator logic: skip healing entirely,
  //                       rely purely on normal Playwright wait/visibility.
  //                       If the element truly isn't visible, this throws
  //                       the same "Element not found" error as before, so
  //                       callers up the chain (ErrorHandler, _wrapWithStep,
  //                       etc.) behave identically either way.
  //
  // To flip this feature, edit ONLY src/config/env.index.ts. This method,
  // and every public BasePage method that calls it, never needs to change.
  // ==========================================================================

  private async resolveLocator(selector: string | Locator, name: string): Promise<Locator> {
    const locator    = this.getLocator(selector);
    const locatorStr = this.getLocatorStr(selector);
    const timeout    = configManager.getTimeout("action");

    const visible = await locator.first()
      .waitFor({ state: "visible", timeout })
      .then(() => true).catch(() => false);

    if (visible) return locator.first();

    if (configManager.getFrameworkSettings().autoHeal) {
      // Execute auto healing
      logger.debug(`[AutoHeal] "${name}" not visible — attempting heal | locator: ${locatorStr}`);
      const { locator: healed, healed: wasHealed, strategy } =
        await autoHeal(locator, undefined, timeout);

      if (!wasHealed) {
        logger.error(`[AutoHeal] Failed → element: "${name}" | locator: ${locatorStr}`);
        throw new Error(`Element not found: "${name}"`);
      }

      logger.info(`[AutoHeal] Healed via [${strategy}] → element: "${name}"`);
      logger.debug(`[AutoHeal] healed locator: ${locatorStr}`);
      return healed.first();
    } else {
      // Existing locator logic — AutoHeal disabled, no recovery attempted
      logger.error(`Element not found | element: "${name}" | locator: ${locatorStr} (autoHeal disabled)`);
      throw new Error(`Element not found: "${name}"`);
    }
  }

  // ==========================================================================
  //  SELECTOR + NAME
  // ==========================================================================

  protected getLocator(selector: string | Locator): Locator {
    try {
      if (typeof selector !== "string") return selector;
      if (selector.startsWith("xpath=")) return this.page.locator(selector);
      if (selector.startsWith("//") || selector.startsWith("(//"))
        return this.page.locator(`xpath=${selector}`);
      return this.page.locator(selector);
    } catch (e: any) {
      throw new Error(`getLocator failed → ${selector} → ${e.message}`);
    }
  }

  protected getElementName(selector: string | Locator, explicitLabel?: string): string {
    if (explicitLabel) return explicitLabel;
    if (typeof selector !== "string") {
      const n = (selector as any).__name;
      if (n) return n;
    }
    try {
      if (typeof selector !== "string") {
        for (const k of Object.getOwnPropertyNames(this))
          if ((this as any)[k] === selector) return k;
        try {
          const s = selector.toString();
          const r = s.match(/getByRole\((.*?)\)/);   if (r) return r[1].replace(/["{}]/g,"").trim();
          const t = s.match(/getByText\((.*?)\)/);   if (t) return `text=${t[1].replace(/["]/g,"")}`;
          const d = s.match(/getByTestId\((.*?)\)/); if (d) return `testId=${d[1].replace(/["]/g,"")}`;
          const c = s.match(/locator\("([^"]+)"\)/); if (c) return this.extractLabel(c[1]);
          const x = s.match(/locator\('xpath=(.*?)'\)/); if (x) return this.extractLabel(x[1]);
        } catch { /**/ }
        return "element";
      }
      return this.extractLabel(selector);
    } catch { return "element"; }
  }

  private extractLabel(sel: string): string {
    if (!sel) return "element";
    try {
      const clean = sel.replace(/^css=|^xpath=/,"").trim();
      if (clean.startsWith("#")) return clean.slice(1);
      if (clean.startsWith(".")) return clean.replace(/\./g,"-").replace(/^-/,"");
      const t = clean.match(/(?:text\(\)|normalize-space\(\))\s*=\s*["']([^"']+)["']/) ||
                clean.match(/contains\(text\(\),\s*["']([^"']+)["']\)/);
      if (t?.[1]) return t[1].trim().replace(/\s+/g,"_").substring(0,30);
      const a = clean.match(/@(?:id|name|placeholder|aria-label)=["']([^"']+)["']/);
      if (a?.[1]) return a[1].trim().substring(0,30);
      const td = clean.match(/data-testid=["']([^"']+)["']/);
      if (td?.[1]) return td[1];
      return clean.replace(/[^a-zA-Z0-9\s]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").substring(0,30)||"element";
    } catch { return "element"; }
  }

  private compare(actual: string, op: string, expected: string): boolean {
    const a=actual.trim(), e=expected.trim(), an=parseFloat(a), en=parseFloat(e);
    switch(op){
      case "==":        return a===e;
      case "!=":        return a!==e;
      case "contains":  return a.toLowerCase().includes(e.toLowerCase());
      case "!contains": return !a.toLowerCase().includes(e.toLowerCase());
      case ">":         return !isNaN(an)&&!isNaN(en)&&an>en;
      case ">=":        return !isNaN(an)&&!isNaN(en)&&an>=en;
      case "<":         return !isNaN(an)&&!isNaN(en)&&an<en;
      case "<=":        return !isNaN(an)&&!isNaN(en)&&an<=en;
      default:          return false;
    }
  }

  // ==========================================================================
  //  NAVIGATION
  // ==========================================================================

  async navigateTo(url: string): Promise<this> {
    return this._wrapWithStep(`Navigate to ${url}`, async () => {
      logger.action(`Navigate URL → ${url}`);
      logger.info(`Navigating to: "${url}"`);
      return ErrorHandler.handle<this>(async () => {
        try {
          await this.page.goto(url, { waitUntil:"domcontentloaded", timeout: configManager.getTimeout("navigation") });
          await WaitUtils.waitForLoadState(this.page, "load", configManager.getTimeout("navigation"));
          logger.info(`Navigated to: "${url}"`);
          return this;
        } catch (e: any) {
          logger.error(`Navigation failed | url: "${url}" | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Navigation failed: "${url}"`);
        }
      }, { context: "BasePage.navigateTo" });
    });
  }

  async goto(path = "/"): Promise<this> {
    return this._wrapWithStep(`Navigate to ${path}`, async () => {
      logger.action(`Navigate to ${path}`);
      return this.navigateTo(`${configManager.getBaseURL()}${path}`);
    });
  }

  async reload(): Promise<this> {
    return this._wrapWithStep("Reload page", async () => {
      logger.info(`Reloading page`);
      return ErrorHandler.handle<this>(async () => {
        try {
          await this.page.reload({ waitUntil:"domcontentloaded" });
          logger.info(`Page reloaded`);
          return this;
        } catch (e: any) {
          logger.error(`Reload failed | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Reload failed`);
        }
      }, { context:"BasePage.reload" });
    });
  }

  async goBack(): Promise<this> {
    return this._wrapWithStep("Go back", async () => {
      logger.info(`Going back`);
      return ErrorHandler.handle<this>(async () => {
        try {
          await this.page.goBack({ waitUntil:"domcontentloaded" });
          logger.info(`Back navigation succeeded`);
          return this;
        } catch (e: any) {
          logger.error(`Go back failed | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Go back failed`);
        }
      }, { context:"BasePage.goBack" });
    });
  }

  async goForward(): Promise<this> {
    return this._wrapWithStep("Go forward", async () => {
      logger.info(`Going forward`);
      return ErrorHandler.handle<this>(async () => {
        try {
          await this.page.goForward({ waitUntil:"domcontentloaded" });
          logger.info(`Forward navigation succeeded`);
          return this;
        } catch (e: any) {
          logger.error(`Go forward failed | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Go forward failed`);
        }
      }, { context:"BasePage.goForward" });
    });
  }

  async scrollIntoView(selector: string | Locator): Promise<this> {
    return this.scrollToElement(selector);
  }

  // ==========================================================================
  //  ELEMENT ACTIONS
  // ==========================================================================

  async click(selector: string | Locator, options?: { force?: boolean; label?: string }): Promise<this> {
    const name = this.getElementName(selector, options?.label);
    return this._wrapWithStep(`Click ${name}`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.action(`Click ${name}`);
      logger.info(`Clicking: "${name}"`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const resolved = await this.resolveLocator(selector, name);
          await resolved.click({ timeout: configManager.getTimeout("action"), force: options?.force });
          logger.info(`Clicked: "${name}"`);
          return this;
        } catch (e: any) {
          logger.error(`Click failed | element: "${name}" | locator: ${locatorStr} | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Click failed: "${name}"`);
        }
      }, { context:`BasePage.click (${name})` });
    });
  }

  // options.mask: hide the value in step titles/logs (OTPs, secrets)
  async type(selector: string | Locator, text: string, delayMs?: number, options?: { label?: string; mask?: boolean }): Promise<this> {
    const name = this.getElementName(selector, options?.label);
    const shown = options?.mask ? "******" : text;
    return this._wrapWithStep(`Type ${name} → ${shown}`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.action(`Type ${name} → ${shown}`);
      logger.info(`Typing: "${name}" with value: "${shown}"`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const resolved = await this.resolveLocator(selector, name);
          await resolved.pressSequentially(text, { delay: delayMs ?? 0 });
          logger.info(`Typed: "${name}"`);
          return this;
        } catch (e: any) {
          logger.error(`Type failed | element: "${name}" | value: "${shown}" | locator: ${locatorStr} | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Type failed: "${name}" | value: "${shown}"`);
        }
      }, { context:`BasePage.type (${name})` });
    });
  }

  async fill(selector: string | Locator, text: string, options?: { label?: string }): Promise<this> {
    const name = this.getElementName(selector, options?.label);
    return this._wrapWithStep(`Fill ${name} → ${text}`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.action(`Fill ${name} → ${text}`);
      logger.info(`Filling: "${name}" with value: "${text}"`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const resolved = await this.resolveLocator(selector, name);
          await resolved.fill(text, { timeout: configManager.getTimeout("action") });
          logger.info(`Filled: "${name}"`);
          return this;
        } catch (e: any) {
          logger.error(`Fill failed | element: "${name}" | value: "${text}" | locator: ${locatorStr} | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Fill failed: "${name}" | value: "${text}"`);
        }
      }, { context:`BasePage.fill (${name})` });
    });
  }

  async clear(selector: string | Locator): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Clear ${name}`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.info(`Clearing: "${name}"`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const resolved = await this.resolveLocator(selector, name);
          await resolved.clear({ timeout: configManager.getTimeout("action") });
          logger.info(`Cleared: "${name}"`);
          return this;
        } catch (e: any) {
          logger.error(`Clear failed | element: "${name}" | locator: ${locatorStr} | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Clear failed: "${name}"`);
        }
      }, { context:`BasePage.clear (${name})` });
    });
  }

  async hover(selector: string | Locator): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Hover ${name}`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.action(`Hover ${name}`);
      logger.info(`Hovering over: "${name}"`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const resolved = await this.resolveLocator(selector, name);
          await resolved.hover({ timeout: configManager.getTimeout("action") });
          logger.info(`Hovered over: "${name}"`);
          return this;
        } catch (e: any) {
          logger.error(`Hover failed | element: "${name}" | locator: ${locatorStr} | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Hover failed: "${name}"`);
        }
      }, { context:`BasePage.hover (${name})` });
    });
  }

  async check(selector: string | Locator): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Check ${name}`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.action(`Check ${name}`);
      logger.info(`Checking: "${name}"`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const resolved = await this.resolveLocator(selector, name);
          await resolved.check({ timeout: configManager.getTimeout("action") });
          logger.info(`Checked: "${name}"`);
          return this;
        } catch (e: any) {
          logger.error(`Check failed | element: "${name}" | locator: ${locatorStr} | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Check failed: "${name}"`);
        }
      }, { context:`BasePage.check (${name})` });
    });
  }

  async uncheck(selector: string | Locator): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Uncheck ${name}`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.action(`Uncheck ${name}`);
      logger.info(`Unchecking: "${name}"`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const resolved = await this.resolveLocator(selector, name);
          await resolved.uncheck({ timeout: configManager.getTimeout("action") });
          logger.info(`Unchecked: "${name}"`);
          return this;
        } catch (e: any) {
          logger.error(`Uncheck failed | element: "${name}" | locator: ${locatorStr} | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Uncheck failed: "${name}"`);
        }
      }, { context:`BasePage.uncheck (${name})` });
    });
  }

  async press(selector: string | Locator, key: string): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Press ${name} → ${key}`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.info(`Pressing: "${name}" with key: "${key}"`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const resolved = await this.resolveLocator(selector, name);
          await resolved.press(key, { timeout: configManager.getTimeout("action") });
          logger.info(`Pressed: "${name}" key: "${key}"`);
          return this;
        } catch (e: any) {
          logger.error(`Press failed | element: "${name}" | key: "${key}" | locator: ${locatorStr} | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Press failed: "${name}" | key: "${key}"`);
        }
      }, { context:`BasePage.press (${name})` });
    });
  }

  async focus(selector: string | Locator): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Focus ${name}`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.info(`Focusing: "${name}"`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const resolved = await this.resolveLocator(selector, name);
          await resolved.focus({ timeout: configManager.getTimeout("action") });
          logger.info(`Focused: "${name}"`);
          return this;
        } catch (e: any) {
          logger.error(`Focus failed | element: "${name}" | locator: ${locatorStr} | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Focus failed: "${name}"`);
        }
      }, { context:`BasePage.focus (${name})` });
    });
  }

  async selectOption(selector: string | Locator, value: string | string[]): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Select ${name} → ${JSON.stringify(value)}`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.action(`Select ${name} → ${JSON.stringify(value)}`);
      logger.info(`Selecting: "${name}" with value: ${JSON.stringify(value)}`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const resolved = await this.resolveLocator(selector, name);
          await resolved.selectOption(value, { timeout: configManager.getTimeout("action") });
          logger.info(`Selected: "${name}"`);
          return this;
        } catch (e: any) {
          logger.error(`Select failed | element: "${name}" | value: ${JSON.stringify(value)} | locator: ${locatorStr} | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Select failed: "${name}" | value: ${JSON.stringify(value)}`);
        }
      }, { context:`BasePage.selectOption (${name})` });
    });
  }

  async doubleClick(selector: string | Locator): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Double click ${name}`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.action(`Double Click ${name}`);
      logger.info(`Double clicking: "${name}"`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const resolved = await this.resolveLocator(selector, name);
          await resolved.dblclick({ timeout: configManager.getTimeout("action") });
          logger.info(`Double clicked: "${name}"`);
          return this;
        } catch (e: any) {
          logger.error(`Double click failed | element: "${name}" | locator: ${locatorStr} | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Double click failed: "${name}"`);
        }
      }, { context:`BasePage.doubleClick (${name})` });
    });
  }

  async rightClick(selector: string | Locator): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Right click ${name}`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.action(`Right Click ${name}`);
      logger.info(`Right clicking: "${name}"`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const resolved = await this.resolveLocator(selector, name);
          await resolved.click({ button:"right", timeout: configManager.getTimeout("action") });
          logger.info(`Right clicked: "${name}"`);
          return this;
        } catch (e: any) {
          logger.error(`Right click failed | element: "${name}" | locator: ${locatorStr} | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Right click failed: "${name}"`);
        }
      }, { context:`BasePage.rightClick (${name})` });
    });
  }

  async dragAndDrop(source: string | Locator, target: string | Locator): Promise<this> {
    const sn = this.getElementName(source);
    const tn = this.getElementName(target);
    return this._wrapWithStep(`Drag ${sn} to ${tn}`, async () => {
      const srcStr = this.getLocatorStr(source);
      const tgtStr = this.getLocatorStr(target);
      logger.info(`Dragging: "${sn}" to "${tn}"`);
      logger.debug(`source locator: ${srcStr} | target locator: ${tgtStr}`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const rs = await this.resolveLocator(source, sn);
          const rt = await this.resolveLocator(target, tn);
          await rs.dragTo(rt);
          logger.info(`Dragged: "${sn}" to "${tn}"`);
          return this;
        } catch (e: any) {
          logger.error(`Drag failed | source: "${sn}" | target: "${tn}" | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Drag failed: "${sn}" to "${tn}"`);
        }
      }, { context:`BasePage.dragAndDrop` });
    });
  }

  // ==========================================================================
  //  KEYBOARD & MOUSE (page-level actions)
  // ==========================================================================

  async pressKey(key: string): Promise<this> {
    return this._wrapWithStep(`Press key ${key}`, async () => {
      logger.info(`Pressing key: "${key}"`);
      return ErrorHandler.handle<this>(async () => {
        try {
          await this.page.keyboard.press(key);
          logger.info(`Key pressed: "${key}"`);
          return this;
        } catch (e: any) {
          logger.error(`Press key failed | key: "${key}" | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Press key failed: "${key}"`);
        }
      }, { context:`BasePage.pressKey (${key})` });
    });
  }

  async typeText(text: string): Promise<this> {
    return this._wrapWithStep(`Type text ${text}`, async () => {
      logger.info(`Typing text: "${text}"`);
      return ErrorHandler.handle<this>(async () => {
        try {
          await this.page.keyboard.type(text);
          logger.info(`Text typed: "${text}"`);
          return this;
        } catch (e: any) {
          logger.error(`Type text failed | value: "${text}" | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Type text failed: "${text}"`);
        }
      }, { context:"BasePage.typeText" });
    });
  }

  async mouseClick(x: number, y: number, button: "left"|"right"|"middle" = "left", clickCount = 1): Promise<this> {
    return this._wrapWithStep(`Mouse click at (${x}, ${y})`, async () => {
      logger.info(`Mouse clicking at (${x}, ${y})`);
      return ErrorHandler.handle<this>(async () => {
        try {
          await this.page.mouse.click(x, y, { button, clickCount });
          logger.info(`Mouse clicked at (${x}, ${y})`);
          return this;
        } catch (e: any) {
          logger.error(`Mouse click failed | x:${x}, y:${y} | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Mouse click failed at (${x}, ${y})`);
        }
      }, { context:`BasePage.mouseClick` });
    });
  }

  async mouseMove(x: number, y: number): Promise<this> {
    logger.debug(`Mouse move to (${x}, ${y})`);
    await this.page.mouse.move(x, y);
    return this;
  }

  // ==========================================================================
  //  NEW TAB
  // ==========================================================================

  async clickAndGetNewTab(selector: string | Locator): Promise<Page> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Click and open new tab via ${name}`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.info(`Clicking new tab via: "${name}"`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<Page>(async () => {
        try {
          const resolved = await this.resolveLocator(selector, name);
          const [newPage] = await Promise.all([
            this.page.context().waitForEvent("page"),
            resolved.click(),
          ]);
          await newPage.waitForLoadState("domcontentloaded");
          logger.info(`New tab opened: "${newPage.url()}"`);
          return newPage;
        } catch (e: any) {
          logger.error(`New tab failed | element: "${name}" | locator: ${locatorStr} | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Click new tab failed: "${name}"`);
        }
      }, { context:`BasePage.clickAndGetNewTab` });
    });
  }

  async switchToTab(index: number): Promise<Page> {
    return this._wrapWithStep(`Switch to tab ${index}`, async () => {
      logger.info(`Switching to tab [${index}]`);
      return ErrorHandler.handle<Page>(async () => {
        try {
          const pages = this.page.context().pages();
          if (index >= pages.length) throw new Error(`Tab [${index}] out of range. Found ${pages.length}.`);
          const tab = pages[index];
          await tab.bringToFront();
          logger.info(`Switched to tab [${index}]`);
          return tab;
        } catch (e: any) {
          logger.error(`Switch tab failed | index: ${index} | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Switch tab failed: [${index}]`);
        }
      }, { context:`BasePage.switchToTab` });
    });
  }

  getTabCount(): number { return this.page.context().pages().length; }

  // ==========================================================================
  //  WAIT METHODS
  // ==========================================================================

  async waitForElementIsVisible(selector: string | Locator, timeout?: number): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Wait for ${name} to be visible`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      const waitTime   = timeout || configManager.getTimeout("wait");
      logger.action(`Wait Visible ${name}`);
      logger.info(`Waiting for "${name}" to be visible`);
      logger.debug(`locator: ${locatorStr} | timeout: ${waitTime}ms`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const locator = this.getLocator(selector);
          const visible = await locator.first()
            .waitFor({ state:"visible", timeout: waitTime })
            .then(() => true).catch(() => false);

          if (visible) {
            logger.info(`Element "${name}" is visible`);
            return this;
          }
          logger.error(`Wait visible failed | element: "${name}" | expected: visible | actual: not found`);
          throw new Error(`Element not visible: "${name}"`);
        } catch (e: any) {
          logger.error(`Wait visible failed | element: "${name}" | error: ${e.message?.split("\n")[0]}`);
          throw e;
        }
      }, { context:`BasePage.waitForElementIsVisible (${name})` });
    });
  }

  async waitForElementToDisappear(selector: string | Locator, timeout?: number): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Wait for ${name} to disappear`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      const waitTime   = timeout || configManager.getTimeout("wait");
      logger.action(`Wait Disappear ${name}`);
      logger.info(`Waiting for "${name}" to disappear`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        try {
          await this.getLocator(selector).first().waitFor({ state:"hidden", timeout: waitTime });
          logger.info(`Element "${name}" disappeared`);
          return this;
        } catch (e: any) {
          logger.error(`Wait disappear failed | element: "${name}" | expected: hidden | actual: still visible | locator: ${locatorStr}`);
          throw new Error(`Element still visible: "${name}" | expected: hidden | actual: still visible`);
        }
      }, { context:`BasePage.waitForElementToDisappear (${name})` });
    });
  }

  async waitForElementEnabled(selector: string | Locator): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Wait for ${name} to be enabled`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      const timeout    = configManager.getTimeout("wait");
      logger.info(`Waiting for "${name}" to be enabled`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          if (await this.getLocator(selector).first().isEnabled().catch(() => false)) {
            logger.info(`Element "${name}" is enabled`);
            return this;
          }
          await delay(300);
        }
        logger.error(`Wait enabled failed | element: "${name}" | expected: enabled | actual: disabled`);
        throw new Error(`Element not enabled: "${name}"`);
      }, { context:`BasePage.waitForElementEnabled (${name})` });
    });
  }

  async waitForTextOnPage(text: string, timeout?: number): Promise<this> {
    return this._wrapWithStep(`Wait for text "${text}" on page`, async () => {
      const waitTime = timeout || configManager.getTimeout("wait");
      logger.info(`Waiting for text: "${text}"`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const deadline = Date.now() + waitTime;
          while (Date.now() < deadline) {
            const visible = await this.page.getByText(text).first()
              .waitFor({ state:"visible", timeout:1000 }).then(() => true).catch(() => false);
            if (visible) {
              logger.info(`Text "${text}" is visible`);
              return this;
            }
            await delay(300);
          }
          logger.error(`Wait text failed | expected: "${text}" | actual: text not found`);
          throw new Error(`Text not visible | expected: "${text}" | actual: text not found`);
        } catch (e: any) {
          if (!e.message?.includes("expected:")) {
            logger.error(`Wait text failed | expected: "${text}" | actual: text not found`);
            throw new Error(`Text not visible | expected: "${text}" | actual: text not found`);
          }
          throw e;
        }
      }, { context:`BasePage.waitForTextOnPage` });
    });
  }

  async waitForTextDisappear(text: string | RegExp, timeout?: number): Promise<this> {
    return this._wrapWithStep(`Wait for text "${text}" to disappear`, async () => {
      const waitTime = timeout || configManager.getTimeout("wait");
      logger.info(`Waiting for text "${text}" to disappear`);
      return ErrorHandler.handle<this>(async () => {
        const deadline = Date.now() + waitTime;
        while (Date.now() < deadline) {
          const visible = await this.page.getByText(text).first()
            .waitFor({ state:"visible", timeout:500 }).then(() => true).catch(() => false);
          if (!visible) {
            logger.info(`Text "${text}" disappeared`);
            return this;
          }
          await delay(300);
        }
        logger.error(`Text still visible: "${text}"`);
        throw new Error(`Text still visible: "${text}"`);
      }, { context:`BasePage.waitForTextDisappear` });
    });
  }

  // ==========================================================================
  //  HARD ASSERTIONS
  // ==========================================================================

  async assertElementVisible(selector: string | Locator): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Assert ${name} is visible`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.info(`Asserting "${name}" is visible`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const timeout = configManager.getTimeout("wait");
          const visible = await this.getLocator(selector).first()
            .waitFor({ state:"visible", timeout }).then(() => true).catch(() => false);
          if (!visible) {
            logger.error(`Assert visible failed | element: "${name}" | expected: visible | actual: not found | locator: ${locatorStr}`);
            throw new Error(`Assert visible failed: "${name}" | expected: visible | actual: not found`);
          }
          logger.info(`Assert visible passed: "${name}"`);
          return this;
        } catch (e: any) {
          if (!e.message?.includes("expected:")) {
            logger.error(`Assert visible failed | element: "${name}" | expected: visible | actual: not found | locator: ${locatorStr}`);
            throw new Error(`Assert visible failed: "${name}" | expected: visible | actual: not found`);
          }
          throw e;
        }
      }, { context:`BasePage.assertElementVisible (${name})` });
    });
  }

  async assertElementHidden(selector: string | Locator): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Assert ${name} is hidden`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.info(`Asserting "${name}" is hidden`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const timeout = configManager.getTimeout("wait");
          const hidden = await this.getLocator(selector).first()
            .waitFor({ state:"hidden", timeout }).then(() => true).catch(() => false);
          if (!hidden) {
            logger.error(`Assert hidden failed | element: "${name}" | expected: hidden | actual: still visible | locator: ${locatorStr}`);
            throw new Error(`Assert hidden failed: "${name}" | expected: hidden | actual: still visible`);
          }
          logger.info(`Assert hidden passed: "${name}"`);
          return this;
        } catch (e: any) {
          if (!e.message?.includes("expected:")) {
            logger.error(`Assert hidden failed | element: "${name}" | expected: hidden | actual: still visible | locator: ${locatorStr}`);
            throw new Error(`Assert hidden failed: "${name}" | expected: hidden | actual: still visible`);
          }
          throw e;
        }
      }, { context:`BasePage.assertElementHidden (${name})` });
    });
  }

  async assertElementDisabled(selector: string | Locator): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Assert ${name} is disabled`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.info(`Asserting "${name}" is disabled`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const timeout = configManager.getTimeout("wait");
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            if (await this.getLocator(selector).first().isDisabled().catch(() => false)) {
              logger.info(`Assert disabled passed: "${name}"`);
              return this;
            }
            await delay(500);
          }
          logger.error(`Assert disabled failed | element: "${name}" | expected: disabled | actual: enabled | locator: ${locatorStr}`);
          throw new Error(`Assert disabled failed: "${name}" | expected: disabled | actual: enabled`);
        } catch (e: any) {
          if (!e.message?.includes("expected:")) {
            logger.error(`Assert disabled failed | element: "${name}" | expected: disabled | actual: enabled | locator: ${locatorStr}`);
            throw new Error(`Assert disabled failed: "${name}" | expected: disabled | actual: enabled`);
          }
          throw e;
        }
      }, { context:`BasePage.assertElementDisabled (${name})` });
    });
  }

  async assertText(selector: string | Locator, text: string | RegExp): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Assert text of ${name} equals "${text}"`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.action(`Assert Text ${name} → ${text}`);
      logger.info(`Asserting text: "${name}" expected: "${text}"`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        const timeout = configManager.getTimeout("wait");
        const deadline = Date.now() + timeout;
        let actual = "";
        try {
          while (Date.now() < deadline) {
            try {
              actual = (await this.getLocator(selector).first().textContent({ timeout:1000 }))?.trim() ?? "";
              const matches = text instanceof RegExp ? text.test(actual) : actual === String(text);
              if (matches) {
                logger.info(`Assert text passed: "${name}" expected: "${text}" actual: "${actual}"`);
                return this;
              }
            } catch { /**/ }
            await delay(500);
          }
          logger.error(`Assert text failed | element: "${name}" | expected: "${text}" | actual: "${actual}" | locator: ${locatorStr}`);
          throw new Error(`Assert text failed: "${name}" | expected: "${text}" | actual: "${actual}"`);
        } catch (e: any) {
          if (!e.message?.includes("expected:")) {
            logger.error(`Assert text failed | element: "${name}" | expected: "${text}" | actual: "${actual}" | locator: ${locatorStr}`);
            throw new Error(`Assert text failed: "${name}" | expected: "${text}" | actual: "${actual}"`);
          }
          throw e;
        }
      }, { context:`BasePage.assertText (${name})` });
    });
  }

  async assertContainsText(selector: string | Locator, text: string): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Assert ${name} contains "${text}"`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.action(`Assert Contains ${name} → ${text}`);
      logger.info(`Asserting "${name}" contains "${text}"`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        const timeout = configManager.getTimeout("wait");
        const deadline = Date.now() + timeout;
        let actual = "";
        try {
          while (Date.now() < deadline) {
            try {
              actual = (await this.getLocator(selector).first().textContent({ timeout:1000 }))?.trim() ?? "";
              if (actual.toLowerCase().includes(text.toLowerCase())) {
                logger.info(`Assert contains passed: "${name}" expected: "${text}" actual: "${actual}"`);
                return this;
              }
            } catch { /**/ }
            await delay(500);
          }
          logger.error(`Assert contains failed | element: "${name}" | expected: "${text}" | actual: "${actual}" | locator: ${locatorStr}`);
          throw new Error(`Assert contains failed: "${name}" | expected: "${text}" | actual: "${actual}"`);
        } catch (e: any) {
          if (!e.message?.includes("expected:")) {
            logger.error(`Assert contains failed | element: "${name}" | expected: "${text}" | actual: "${actual}" | locator: ${locatorStr}`);
            throw new Error(`Assert contains failed: "${name}" | expected: "${text}" | actual: "${actual}"`);
          }
          throw e;
        }
      }, { context:`BasePage.assertContainsText (${name})` });
    });
  }

  async assertValue(selector: string | Locator, value: string | RegExp): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Assert value of ${name} equals "${value}"`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.action(`Assert Value ${name} → ${value}`);
      logger.info(`Asserting value: "${name}" expected: "${value}"`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        const timeout = configManager.getTimeout("wait");
        const deadline = Date.now() + timeout;
        let actual = "";
        while (Date.now() < deadline) {
          try {
            actual = await this.getLocator(selector).first().inputValue();
            const matches = value instanceof RegExp ? value.test(actual) : actual === String(value);
            if (matches) {
              logger.info(`Assert value passed: "${name}" expected: "${value}"`);
              return this;
            }
          } catch { /**/ }
          await delay(500);
        }
        logger.error(`Assert value failed | element: "${name}" | expected: "${value}" | actual: "${actual}" | locator: ${locatorStr}`);
        throw new Error(`Assert value failed: "${name}" | expected: "${value}" | actual: "${actual}"`);
      }, { context:`BasePage.assertValue (${name})` });
    });
  }

  async assertAttributeValue(selector: string | Locator, attribute: string, value: string | RegExp): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Assert ${name} attribute "${attribute}" equals "${value}"`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.action(`Assert Attribute ${name} → ${attribute}=${value}`);
      logger.info(`Asserting attribute: "${name}" "${attribute}" expected: "${value}"`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const timeout = configManager.getTimeout("wait");
          const deadline = Date.now() + timeout;
          let actual = "";
          while (Date.now() < deadline) {
            try {
              actual = await this.getLocator(selector).first().getAttribute(attribute) ?? "";
              const matches = value instanceof RegExp ? value.test(actual) : actual === String(value);
              if (matches) {
                logger.info(`Assert attribute passed: "${name}" "${attribute}" = "${value}"`);
                return this;
              }
            } catch { /**/ }
            await delay(500);
          }
          logger.error(`Assert attribute failed | element: "${name}" | attribute: "${attribute}" | expected: "${value}" | actual: "${actual}" | locator: ${locatorStr}`);
          throw new Error(`Assert attr failed: "${name}" | attribute: "${attribute}" | expected: "${value}" | actual: "${actual}"`);
        } catch (e: any) {
          if (!e.message?.includes("expected:")) {
            logger.error(`Assert attribute failed | element: "${name}" | attribute: "${attribute}" | expected: "${value}" | actual: not found | locator: ${locatorStr}`);
            throw new Error(`Assert attr failed: "${name}" | attribute: "${attribute}" | expected: "${value}" | actual: not found`);
          }
          throw e;
        }
      }, { context:`BasePage.assertAttributeValue (${name})` });
    });
  }

  async assertChecked(selector: string | Locator): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Assert ${name} is checked`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.info(`Asserting "${name}" is checked`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        const timeout = configManager.getTimeout("wait");
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          if (await this.getLocator(selector).first().isChecked().catch(() => false)) {
            logger.info(`Assert checked passed: "${name}"`);
            return this;
          }
          await delay(500);
        }
        logger.error(`Assert checked failed | element: "${name}" | expected: checked | actual: unchecked | locator: ${locatorStr}`);
        throw new Error(`Assert checked failed: "${name}"`);
      }, { context:`BasePage.assertChecked (${name})` });
    });
  }

  async assertNotChecked(selector: string | Locator): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Assert ${name} is not checked`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.info(`Asserting "${name}" is not checked`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        const timeout = configManager.getTimeout("wait");
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          if (!(await this.getLocator(selector).first().isChecked().catch(() => true))) {
            logger.info(`Assert not checked passed: "${name}"`);
            return this;
          }
          await delay(500);
        }
        logger.error(`Assert not checked failed | element: "${name}" | expected: unchecked | actual: checked | locator: ${locatorStr}`);
        throw new Error(`Assert not checked failed: "${name}"`);
      }, { context:`BasePage.assertNotChecked (${name})` });
    });
  }

  async assertURL(url: string | RegExp): Promise<this> {
    return this._wrapWithStep(`Assert URL equals "${url}"`, async () => {
      logger.action(`Assert URL → ${url}`);
      logger.info(`Asserting URL: "${url}"`);
      return ErrorHandler.handle<this>(async () => {
        const timeout = configManager.getTimeout("wait");
        const deadline = Date.now() + timeout;
        let actual = "";
        try {
          while (Date.now() < deadline) {
            actual = this.page.url();
            const matches = url instanceof RegExp ? url.test(actual) : actual === String(url);
            if (matches) {
              logger.info(`Assert URL passed: "${url}"`);
              return this;
            }
            await delay(500);
          }
          logger.error(`Assert URL failed | expected: "${url}" | actual: "${actual}"`);
          throw new Error(`Assert URL failed | expected: "${url}" | actual: "${actual}"`);
        } catch (e: any) {
          if (!e.message?.includes("expected:")) {
            logger.error(`Assert URL failed | expected: "${url}" | actual: "${actual}"`);
            throw new Error(`Assert URL failed | expected: "${url}" | actual: "${actual}"`);
          }
          throw e;
        }
      }, { context:`BasePage.assertURL` });
    });
  }

  async assertTitle(title: string | RegExp): Promise<this> {
    return this._wrapWithStep(`Assert title equals "${title}"`, async () => {
      logger.info(`Asserting title: "${title}"`);
      return ErrorHandler.handle<this>(async () => {
        const timeout = configManager.getTimeout("wait");
        const deadline = Date.now() + timeout;
        let actual = "";
        while (Date.now() < deadline) {
          actual = await this.page.title();
          const matches = title instanceof RegExp ? title.test(actual) : actual === String(title);
          if (matches) {
            logger.info(`Assert title passed: "${title}"`);
            return this;
          }
          await delay(500);
        }
        logger.error(`Assert title failed | expected: "${title}" | actual: "${actual}"`);
        throw new Error(`Assert title failed | expected: "${title}" | actual: "${actual}"`);
      }, { context:`BasePage.assertTitle` });
    });
  }

  async assertElementCount(selector: string | Locator, count: number): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Assert ${name} count equals ${count}`, async () => {
      const locatorStr = this.getLocatorStr(selector);
      logger.info(`Asserting count: "${name}" expected: ${count}`);
      logger.debug(`locator: ${locatorStr}`);
      return ErrorHandler.handle<this>(async () => {
        let actual = 0;
        try {
          const timeout = configManager.getTimeout("wait");
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            actual = await this.getLocator(selector).count();
            if (actual === count) {
              logger.info(`Assert count passed: "${name}" count: ${count}`);
              return this;
            }
            await delay(500);
          }
          logger.error(`Assert count failed | element: "${name}" | expected: ${count} | actual: ${actual} | locator: ${locatorStr}`);
          throw new Error(`Assert count failed: "${name}" | expected: ${count} | actual: ${actual}`);
        } catch (e: any) {
          if (!e.message?.includes("expected:")) {
            logger.error(`Assert count failed | element: "${name}" | expected: ${count} | actual: ${actual} | locator: ${locatorStr}`);
            throw new Error(`Assert count failed: "${name}" | expected: ${count} | actual: ${actual}`);
          }
          throw e;
        }
      }, { context:`BasePage.assertElementCount (${name})` });
    });
  }

  // ==========================================================================
  //  SOFT ASSERTIONS (not wrapped – utilities)
  // ==========================================================================

  async softAssertVisible(selector: string | Locator, label?: string): Promise<void> {
    const name = label ?? this.getElementName(selector);
    const locatorStr = this.getLocatorStr(selector);
    logger.info(`[Soft] Assert visible: "${name}"`);
    logger.debug(`locator: ${locatorStr}`);
    try {
      const visible = await this.getLocator(selector).first()
        .waitFor({ state:"visible", timeout: configManager.getTimeout("wait") })
        .then(() => true).catch(() => false);
      if (!visible) {
        const msg = `[Soft FAIL] Not visible: "${name}" | expected: visible | actual: not found`;
        logger.warn(msg);
        this._softErrors.push(msg);
      } else {
        logger.info(`[Soft] Assert visible passed: "${name}"`);
      }
    } catch {
      const msg = `[Soft FAIL] Not visible: "${name}"`;
      logger.warn(msg);
      this._softErrors.push(msg);
    }
  }

  async softAssertText(selector: string | Locator, expected: string, label?: string): Promise<void> {
    const name = label ?? this.getElementName(selector);
    const locatorStr = this.getLocatorStr(selector);
    logger.info(`[Soft] Assert text: "${name}" expected: "${expected}"`);
    logger.debug(`locator: ${locatorStr}`);
    try {
      const actual = (await this.getLocator(selector).first().textContent({ timeout: configManager.getTimeout("wait") }))?.trim() ?? "";
      if (actual !== expected) {
        const msg = `[Soft FAIL] Text mismatch: "${name}" | expected: "${expected}" | actual: "${actual}"`;
        logger.warn(msg);
        this._softErrors.push(msg);
      } else {
        logger.info(`[Soft] Assert text passed: "${name}"`);
      }
    } catch (e: any) {
      const msg = `[Soft FAIL] Text evaluation error: "${name}" | ${e.message}`;
      logger.warn(msg);
      this._softErrors.push(msg);
    }
  }

  getSoftAssertErrors(): string[] { return this._softErrors; }
  clearSoftAssertErrors(): void   { this._softErrors = []; }

  async assertAll(): Promise<void> {
    if (this._softErrors.length > 0) {
      const summary = `Soft assertion failure(s):\n` + this._softErrors.join("\n");
      logger.error(summary);
      this.clearSoftAssertErrors();
      throw new Error(summary);
    }
    logger.info(`All soft assertions passed`);
  }

  // ==========================================================================
  //  GETTERS (no step wrapping – utilities)
  // ==========================================================================

  async getText(selector: string | Locator): Promise<string> {
    const name       = this.getElementName(selector);
    const locatorStr = this.getLocatorStr(selector);
    logger.info(`Getting text from: "${name}"`);
    logger.debug(`locator: ${locatorStr}`);
    return ErrorHandler.handle<string>(async () => {
      try {
        const resolved = await this.resolveLocator(selector, name);
        const text = (await resolved.textContent())?.trim() || "";
        logger.info(`Got text from: "${name}" actual: "${text}"`);
        return text;
      } catch (e: any) {
        logger.error(`Get text failed | element: "${name}" | locator: ${locatorStr} | error: ${e.message?.split("\n")[0]}`);
        throw new Error(`Get text failed: "${name}"`);
      }
    }, { context:`BasePage.getText (${name})` });
  }

  async getInputValue(selector: string | Locator): Promise<string> {
    const name       = this.getElementName(selector);
    const locatorStr = this.getLocatorStr(selector);
    logger.info(`Getting input value from: "${name}"`);
    logger.debug(`locator: ${locatorStr}`);
    return ErrorHandler.handle<string>(async () => {
      try {
        const value = await this.getLocator(selector).first().inputValue();
        logger.info(`Got input value from: "${name}" actual: "${value}"`);
        return value;
      } catch (e: any) {
        logger.error(`Get input value failed | element: "${name}" | locator: ${locatorStr} | error: ${e.message?.split("\n")[0]}`);
        throw new Error(`Get input value failed: "${name}"`);
      }
    }, { context:`BasePage.getInputValue (${name})` });
  }

  async getAttribute(selector: string | Locator, attribute: string): Promise<string | null> {
    const name       = this.getElementName(selector);
    const locatorStr = this.getLocatorStr(selector);
    logger.info(`Getting attribute: "${name}" attribute: "${attribute}"`);
    logger.debug(`locator: ${locatorStr}`);
    return ErrorHandler.handle<string | null>(async () => {
      try {
        const attr = await this.getLocator(selector).first().getAttribute(attribute);
        logger.info(`Got attribute: "${name}" "${attribute}" = "${attr}"`);
        return attr;
      } catch (e: any) {
        logger.error(`Get attribute failed | element: "${name}" | attribute: "${attribute}" | error: ${e.message?.split("\n")[0]}`);
        throw new Error(`Get attribute failed: "${name}" | attribute: "${attribute}"`);
      }
    }, { context:`BasePage.getAttribute (${name})` });
  }

  async getDisabledFieldValue(selector: string | Locator): Promise<string> {
    const name       = this.getElementName(selector);
    const locatorStr = this.getLocatorStr(selector);
    logger.info(`Getting disabled field value from: "${name}"`);
    return ErrorHandler.handle<string>(async () => {
      try {
        const resolved = this.getLocator(selector).first();
        const value = (await resolved.inputValue()) || (await resolved.textContent()) || "";
        logger.info(`Got disabled field value from: "${name}" actual: "${value.trim()}"`);
        return value.trim();
      } catch (e: any) {
        logger.error(`Get disabled field value failed | element: "${name}" | locator: ${locatorStr} | error: ${e.message?.split("\n")[0]}`);
        throw new Error(`Get disabled field value failed: "${name}"`);
      }
    }, { context:`BasePage.getDisabledFieldValue (${name})` });
  }

  // ==========================================================================
  //  RUNTIME STORE HELPERS
  // ==========================================================================

  async storeText(selector: Locator | string, key?: string): Promise<string> {
    const name = this.getElementName(selector);
    const storeKey = key || name;
    logger.info(`Storing text: "${storeKey}"`);
    return ErrorHandler.handle<string>(async () => {
      try {
        const loc = this.getLocator(selector);
        await loc.first().waitFor({ state:"visible", timeout: configManager.getTimeout("wait") });
        const value = (await loc.first().textContent())?.trim() || "";
        Runtime.set(storeKey, value);
        logger.info(`Stored: "${storeKey}" = "${value}"`);
        return value;
      } catch (e: any) {
        logger.error(`Store text failed | key: "${storeKey}" | error: ${e.message?.split("\n")[0]}`);
        throw e;
      }
    }, { context:`BasePage.storeText` });
  }

  // ==========================================================================
  //  CONDITIONAL BLOCKS (IF / WHILE / SWITCH)
  // ==========================================================================

  async ifVisible(selector: string | Locator, thenDo: () => Promise<void>, elseDo?: () => Promise<void>, timeout = 3000): Promise<void> {
    const name = this.getElementName(selector);
    const visible = await this.getLocator(selector).first()
      .waitFor({ state:"visible", timeout }).then(()=>true).catch(()=>false);
    logger.debug(`IF visible → "${name}" : ${visible}`);
    if (visible) {
      await thenDo();
    } else if (elseDo) {
      await elseDo();
    }
  }

  async ifNotVisible(selector: string | Locator, thenDo: () => Promise<void>, elseDo?: () => Promise<void>, timeout = 2000): Promise<void> {
    const name = this.getElementName(selector);
    const visible = await this.getLocator(selector).first()
      .waitFor({ state:"visible", timeout }).then(()=>true).catch(()=>false);
    logger.debug(`IF NOT visible → "${name}" : ${!visible}`);
    if (!visible) {
      await thenDo();
    } else if (elseDo) {
      await elseDo();
    }
  }

  async ifTextContains(selector: string | Locator, expectedText: string, thenDo: () => Promise<void>, elseDo?: () => Promise<void>): Promise<void> {
    const name = this.getElementName(selector);
    const raw = await this.getLocator(selector).first().textContent().catch(()=>"");
    const result = raw?.toLowerCase().includes(expectedText.toLowerCase()) ?? false;
    logger.debug(`IF textContains → "${name}" contains "${expectedText}" : ${result}`);
    if (result) {
      await thenDo();
    } else if (elseDo) {
      await elseDo();
    }
  }

  async ifInputValue(selector: string | Locator, op: CompareOp, expected: string|number, thenDo: () => Promise<void>, elseDo?: () => Promise<void>): Promise<void> {
    const name = this.getElementName(selector);
    const raw = await this.getLocator(selector).first().inputValue().catch(()=>"");
    const result = this.compare(raw.trim(), op, String(expected));
    logger.debug(`IF inputValue → "${name}" "${raw}" ${op} "${expected}" : ${result}`);
    if (result) {
      await thenDo();
    } else if (elseDo) {
      await elseDo();
    }
  }

  async ifPageContainsText(text: string, thenDo: () => Promise<void>, elseDo?: () => Promise<void>, timeout = 5000): Promise<void> {
    const found = await this.page.getByText(text).waitFor({ state:"visible", timeout }).then(()=>true).catch(()=>false);
    logger.debug(`IF page text → "${text}" : ${found}`);
    if (found) {
      await thenDo();
    } else if (elseDo) {
      await elseDo();
    }
  }

  async ifPageNotContainsText(text: string, thenDo: () => Promise<void>, elseDo?: () => Promise<void>, timeout = 5000): Promise<void> {
    const found = await this.page.getByText(text).waitFor({ state:"visible", timeout }).then(()=>true).catch(()=>false);
    logger.debug(`IF page NOT text → "${text}" : ${!found}`);
    if (!found) {
      await thenDo();
    } else if (elseDo) {
      await elseDo();
    }
  }

  async ifCount(selector: string | Locator, op: CompareOp, expected: number, thenDo: () => Promise<void>, elseDo?: () => Promise<void>): Promise<void> {
    const name = this.getElementName(selector);
    const count = await this.getLocator(selector).count().catch(()=>0);
    let result = false;
    switch(op){
      case "==": result = count === expected; break;
      case "!=": result = count !== expected; break;
      case ">":  result = count > expected; break;
      case ">=": result = count >= expected; break;
      case "<":  result = count < expected; break;
      case "<=": result = count <= expected; break;
    }
    logger.debug(`IF count → "${name}" explicit count ${count} ${op} ${expected} : ${result}`);
    if (result) {
      await thenDo();
    } else if (elseDo) {
      await elseDo();
    }
  }

  async whileNotVisible(selector: string | Locator, doAction: () => Promise<void>, maxIterations = 10): Promise<void> {
    const name = this.getElementName(selector);
    let i = 0;
    while (i < maxIterations) {
      const visible = await this.getLocator(selector).waitFor({ state:"visible", timeout:3000 }).then(()=>true).catch(()=>false);
      if (visible) break;
      logger.debug(`WHILE not visible → "${name}" | iteration: ${i+1}`);
      await doAction();
      i++;
    }
  }

  async whileEnabled(selector: string | Locator, doAction: () => Promise<void>, maxIterations = 10): Promise<void> {
    const name = this.getElementName(selector);
    let i = 0;
    while (i < maxIterations) {
      if (!await this.getLocator(selector).first().isEnabled().catch(()=>false)) break;
      logger.debug(`WHILE enabled → "${name}" | iteration: ${i+1}`);
      await doAction();
      i++;
    }
  }

  async whileDisabled(selector: string | Locator, doAction: () => Promise<void>, maxIterations = 10): Promise<void> {
    const name = this.getElementName(selector);
    let i = 0;
    while (i < maxIterations) {
      if (!await this.getLocator(selector).first().isDisabled().catch(()=>true)) break;
      logger.debug(`WHILE disabled → "${name}" | iteration: ${i+1}`);
      await doAction();
      i++;
    }
  }

  async whileVisible(selector: string | Locator, doAction: () => Promise<void>, maxIterations = 10, interval = 500): Promise<void> {
    const name = this.getElementName(selector);
    let i = 0;
    while (i < maxIterations) {
      const visible = await this.getLocator(selector).first().isVisible().catch(() => false);
      if (!visible) break;
      logger.debug(`WHILE visible → "${name}" | iteration: ${i+1}`);
      await doAction();
      i++;
      if (i < maxIterations) await delay(interval);
    }
  }

  async closeUntilVisible(closeSelector: string | Locator, targetSelector: string | Locator, maxAttempts = 5): Promise<void> {
    const name = this.getElementName(targetSelector);
    let attempts = 0;
    while (attempts < maxAttempts) {
      if (await this.getLocator(targetSelector).waitFor({ state:"visible", timeout:2000 }).then(()=>true).catch(()=>false)) {
        logger.debug(`closeUntilVisible ✅ → "${name}"`);
        return;
      }
      if (!await this.getLocator(closeSelector).waitFor({ state:"visible", timeout:1000 }).then(()=>true).catch(()=>false)) break;
      await this.getLocator(closeSelector).first().click().catch(()=>{});
      await delay(500);
      attempts++;
    }
  }

  // ==========================================================================
  //  WAIT FOR LOAD STATE
  // ==========================================================================

  async waitForLoadState(
    state: 'load' | 'domcontentloaded' | 'networkidle' = 'load',
    timeout?: number
  ): Promise<void> {
    await this.page.waitForLoadState(state, { timeout });
  }

  // ==========================================================================
  //  SCROLL
  // ==========================================================================

  async scrollToElement(selector: string | Locator): Promise<this> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Scroll to ${name}`, async () => {
      logger.info(`Scrolling to: "${name}"`);
      return ErrorHandler.handle<this>(async () => {
        const resolved = await this.resolveLocator(selector, name);
        await resolved.scrollIntoViewIfNeeded({ timeout: configManager.getTimeout("action") });
        logger.info(`Scrolled to: "${name}"`);
        return this;
      }, { context: `BasePage.scrollToElement (${name})` });
    });
  }

  // ==========================================================================
  //  TOAST HELPERS (no step wrapping)
  // ==========================================================================

  async waitForSuccessToast(timeout = 10000): Promise<string> {
    logger.info(`Waiting for success toast`);
    const loc = this.page.locator(
      "xpath=//*[contains(@class,'toast') and contains(@class,'success')] | " +
      "xpath=//*[contains(@class,'alert-success')]"
    );
    try {
      await loc.first().waitFor({ state:"visible", timeout });
      const msg = (await loc.first().textContent())?.trim() ?? "";
      logger.info(`Success toast: "${msg}"`);
      return msg;
    } catch {
      return "";
    }
  }

  async waitForErrorToast(timeout = 10000): Promise<string> {
    logger.info(`Waiting for error toast`);
    const loc = this.page.locator(
      "xpath=//*[contains(@class,'toast') and contains(@class,'error')] | " +
      "xpath=//*[contains(@class,'alert-error')]"
    );
    try {
      await loc.first().waitFor({ state:"visible", timeout });
      const msg = (await loc.first().textContent())?.trim() ?? "";
      logger.warn(`Error toast: "${msg}"`);
      return msg;
    } catch {
      return "";
    }
  }

  // ==========================================================================
  //  TABLE HELPERS (no step wrapping)
  // ==========================================================================

  async getTableRowCount(tableSelector: string | Locator): Promise<number> {
    logger.info(`Getting table row count`);
    const count = await this.getLocator(tableSelector).locator("tr").count();
    logger.info(`Table rows: ${count}`);
    return count;
  }

  async getTableCellText(tableSelector: string | Locator, rowIndex: number, colIndex: number): Promise<string> {
    logger.info(`Getting table cell [${rowIndex}][${colIndex}]`);
    const text = (await this.getLocator(tableSelector)
      .locator("tr").nth(rowIndex).locator("td").nth(colIndex).textContent())?.trim() ?? "";
    logger.info(`Table cell [${rowIndex}][${colIndex}] = "${text}"`);
    return text;
  }

  async clickTableRowByText(tableSelector: string | Locator, searchText: string): Promise<void> {
    logger.info(`Clicking table row by text: "${searchText}"`);
    const rows = this.getLocator(tableSelector).locator("tr");
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const rowText = await rows.nth(i).textContent();
      if (rowText?.includes(searchText)) {
        await rows.nth(i).click();
        logger.info(`Clicked row with text: "${searchText}"`);
        return;
      }
    }
    throw new Error(`Table row with text "${searchText}" not found`);
  }

  // ==========================================================================
  //  NETWORK FLOWS
  // ==========================================================================

  async blockRequest(urlPattern: string | RegExp): Promise<this> {
    return this._wrapWithStep(`Block requests matching ${urlPattern}`, async () => {
      logger.info(`Blocking requests: "${urlPattern}"`);
      await this.page.route(urlPattern, route => route.abort());
      logger.info(`Requests blocked`);
      return this;
    });
  }

  // ==========================================================================
  //  DIALOG
  // ==========================================================================

  acceptDialog(promptText?: string): this {
    this.page.once("dialog", d => {
      logger.debug(`Dialog accepted: "${d.message()}"`);
      d.accept(promptText);
    });
    return this;
  }

  dismissDialog(): this {
    this.page.once("dialog", d => {
      logger.debug(`Dialog dismissed: "${d.message()}"`);
      d.dismiss();
    });
    return this;
  }

  // ==========================================================================
  //  IFRAME
  // ==========================================================================

  async switchToFrame(selector: string | Locator): Promise<FrameLocator> {
    const name = this.getElementName(selector);
    return this._wrapWithStep(`Switch to frame ${name}`, async () => {
      logger.info(`Switching to frame: "${name}"`);
      return ErrorHandler.handle<FrameLocator>(async () => {
        try {
          const fl = this.getLocator(selector).contentFrame();
          this._currentFrame = fl;
          logger.info(`Switched to frame: "${name}"`);
          return fl;
        } catch (e: any) {
          logger.error(`Switch frame failed | element: "${name}" | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Switch frame failed: "${name}"`);
        }
      }, { context:`BasePage.switchToFrame` });
    });
  }

  async switchToMainFrame(): Promise<this> {
    this._currentFrame = null;
    logger.debug(`Main frame restored`);
    return this;
  }

  getCurrentFrame(): FrameLocator | null { return this._currentFrame; }
  getFrameCount(): number { return this.page.frames().length - 1; }

  // ==========================================================================
  //  FILE UPLOAD
  // ==========================================================================

  async uploadFile(selector: string | Locator, filePaths: string | string[]): Promise<this> {
    const name = this.getElementName(selector);
    const files = Array.isArray(filePaths) ? filePaths : [filePaths];
    return this._wrapWithStep(`Upload file to ${name}`, async () => {
      logger.info(`Uploading file to: "${name}" (${files.length} files)`);
      return ErrorHandler.handle<this>(async () => {
        try {
          const resolved = await this.resolveLocator(selector, name);
          await resolved.setInputFiles(files);
          logger.info(`File uploaded: "${name}"`);
          return this;
        } catch (e: any) {
          logger.error(`Upload failed | element: "${name}" | error: ${e.message?.split("\n")[0]}`);
          throw new Error(`Upload failed: "${name}"`);
        }
      }, { context:`BasePage.uploadFile` });
    });
  }

  // ==========================================================================
  //  LOCAL STORAGE
  // ==========================================================================

  async getLocalStorageItem(key: string): Promise<string | null> {
    return await this.page.evaluate(k => window.localStorage.getItem(k), key);
  }

  async setLocalStorageItem(key: string, value: string): Promise<this> {
    await this.page.evaluate(({k,v}) => window.localStorage.setItem(k,v), {k:key,v:value});
    return this;
  }

  async clearLocalStorage(): Promise<this> {
    return this._wrapWithStep("Clear local storage", async () => {
      logger.info(`Clearing localStorage`);
      await this.page.evaluate(() => window.localStorage.clear());
      logger.info(`localStorage cleared`);
      return this;
    });
  }

  // ==========================================================================
  //  JAVASCRIPT
  // ==========================================================================

  async executeScript<T = void>(script: string): Promise<T> {
    logger.debug(`Executing script: "${script.substring(0,60)}..."`);
    return ErrorHandler.handle<T>(async () => {
      try {
        const result = await this.page.evaluate(script);
        logger.debug(`Script executed`);
        return result as T;
      } catch (e: any) {
        logger.error(`Execute script failed | error: ${e.message?.split("\n")[0]}`);
        throw new Error(`Execute script failed`);
      }
    }, { context:"BasePage.executeScript" });
  }

  // ==========================================================================
  //  FILL DATE PICKER
  // ==========================================================================

  async fillDatePicker(selector: string | Locator, date: string): Promise<this> {
    const name = this.getElementName(selector);
    logger.action(`Fill date picker ${name} with ${date}`);
    return this._wrapWithStep(`Fill date picker ${name} with ${date}`, async () => {
      const locator = this.getLocator(selector);
      logger.step(`Fill datepicker → ${name} | "${date}"`);
      return ErrorHandler.handle<this>(async () => {
        await locator.first().waitFor({ state: "visible", timeout: configManager.getTimeout("action") });
        await locator.first().click();
        const calendarOpened = await this.page.locator(
          "[class*='react-datepicker__month-container'], [class*='datepicker-dropdown'], [class*='calendar-popup']"
        ).waitFor({ state: "visible", timeout: 3000 })
          .then(() => true)
          .catch(() => false);

        if (calendarOpened) {
          const todayCell = this.page.locator(
            "[class*='react-datepicker__day--today']:not([class*='outside']), [class*='react-datepicker__day--selected']"
          ).first();
          const todayVisible = await todayCell.waitFor({ state: "visible", timeout: 3000 })
            .then(() => true)
            .catch(() => false);
          if (todayVisible) {
            await todayCell.click();
            logger.pass(`Datepicker (calendar): ${name} - today selected`);
          } else {
            await this.page.keyboard.press("Escape");
            await locator.first().click({ clickCount: 3 });
            await locator.first().fill(date);
            await locator.first().press("Enter");
            logger.pass(`Datepicker (fallback): ${name} - "${date}"`);
          }
        } else {
          await locator.first().click({ clickCount: 3 });
          await locator.first().fill(date);
          logger.pass(`Datepicker (text input): ${name} - "${date}"`);
        }
        await this.page.keyboard.press("Tab");
        return this;
      }, { context: `BasePage.fillDatePicker (${name})` });
    });
  }

  // ==========================================================================
  //  MISC
  // ==========================================================================

  getCurrentURL(): string           { return this.page.url(); }
  async getTitle(): Promise<string> { return this.page.title(); }
  getPage(): Page                   { return this.page; }

  async pause(milliseconds = 1000): Promise<this> {
    logger.warn(`Pausing for ${milliseconds}ms`);
    await delay(milliseconds);
    return this;
  }

  async highlight(selector: string | Locator, color = "red"): Promise<void> {
    if (process.env.DEBUG !== "true") return;
    try {
      await this.getLocator(selector).first().evaluate((el, c) => {
        (el as HTMLElement).style.border = `2px solid ${c}`;
      }, color);
    } catch { /**/ }
  }

  // ==========================================================================
  //  PRIVATE: Wrap any action with a Playwright step and attach logs as metadata
  // ==========================================================================

  protected async _wrapWithStep<T>(
    stepName: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.test.step(stepName, async () => {
      // Capture all logs during this step
      const logs: string[] = [];
      const originalInfo = logger.info.bind(logger);
      const originalDebug = logger.debug.bind(logger);
      const originalAction = logger.action.bind(logger);
      const originalError = logger.error.bind(logger);
      const originalWarn = logger.warn.bind(logger);
      const originalPass = logger.pass.bind(logger);
      const originalFail = logger.fail.bind(logger);

      logger.info = (msg) => { logs.push(`[INFO] ${msg}`); originalInfo(msg); };
      logger.debug = (msg) => { logs.push(`[DEBUG] ${msg}`); originalDebug(msg); };
      logger.action = (msg) => { logs.push(`[ACTION] ${msg}`); originalAction(msg); };
      logger.error = (msg) => { logs.push(`[ERROR] ${msg}`); originalError(msg); };
      logger.warn = (msg) => { logs.push(`[WARN] ${msg}`); originalWarn(msg); };
      logger.pass = (msg) => { logs.push(`[PASS] ${msg}`); originalPass(msg); };
      logger.fail = (msg) => { logs.push(`[FAIL] ${msg}`); originalFail(msg); };

      let stepError: unknown = undefined;
      let result: T;

      try {
        result = await fn();
      } catch (err) {
        stepError = err;
        throw err;
      } finally {
        logger.info = originalInfo;
        logger.debug = originalDebug;
        logger.action = originalAction;
        logger.error = originalError;
        logger.warn = originalWarn;
        logger.pass = originalPass;
        logger.fail = originalFail;

        if (logs.length > 0) {
          await this.testInfo.attach(`Step Metadata - ${stepName}`, {
            body: JSON.stringify({
              stepTitle: stepName,
              logs: logs.join('\n'),
              status: stepError ? 'FAILED' : 'PASSED',
              duration: 0,
              actions: [],
              autoHeal: [],
            }),
            contentType: 'application/json',
          });
        }
      }

      return result;
    });
  }
}
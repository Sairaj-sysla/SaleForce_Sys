import { Page } from "@playwright/test";
import { logger } from "../helpers/logger";

export class ErrorHandler {

  static async handle<T>(
    fn: () => Promise<T>,
    options?: { context?: string }
  ): Promise<T> {
    const context = options?.context ?? "";

    try {
      return await fn();
    } catch (error: any) {
      this.logError(error, context);
      throw error;
    }
  }

  static async handleAsync(
    error: any,
    options?: {
      context?: string;
      page?: Page;
      screenshotName?: string;
    }
  ): Promise<void> {
    const context = options?.context ?? "";
    const page = options?.page;
    const screenshotName = options?.screenshotName;

    this.logError(error, context);

    if (page && screenshotName) {
      try {
        const file = `test-results/errors/${screenshotName}.png`;
        await page.screenshot({ path: file, fullPage: true });
        logger.error(`📸 Screenshot captured: ${file}`);
      } catch (ssError) {
        logger.error(`Failed to capture screenshot: ${ssError}`);
      }
    }

    throw error;
  }

  private static logError(error: any, context: string = "") {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack ?? "" : "";

    let cleanMessage = message;

    if (context) {
      cleanMessage = `❌ ${context}\n\nRoot Cause:\n${message.split("\n")[0]}`;
    }

    logger.error(cleanMessage);

    const stackLines = stack.split("\n");
    const specLine = stackLines.find(line => 
      line.includes(".spec.ts") && 
      !line.includes("node_modules")
    );

    if (specLine) {
      const cleaned = specLine.replace(/^.*at\s+/, "").trim();
      logger.error(`Source: ${cleaned}`);
    }
  }

  static isNetworkError(error: any): boolean {
    const msg = error?.message || "";
    return msg.includes("net::") || msg.includes("ERR_") || msg.includes("ECONNRESET") || msg.includes("ECONNREFUSED");
  }

  static isTimeoutError(error: any): boolean {
    return (error?.message || "").toLowerCase().includes("timeout");
  }

  static isElementError(error: any): boolean {
    const msg = error?.message || "";
    return msg.includes("element") || msg.includes("selector") || msg.includes("not visible") || msg.includes("not enabled");
  }

  static isFatalPlaywrightError(error: any): boolean {
    const msg = error?.message || "";
    return (
      msg.includes("Target page") ||
      msg.includes("browser has been closed") ||
      msg.includes("Context has been closed") ||
      msg.includes("Navigation failed") ||
      msg.includes("Invalid selector")
    );
  }
}
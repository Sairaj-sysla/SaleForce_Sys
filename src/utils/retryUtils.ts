// ============================================================================
// RETRY UTILS - ENTERPRISE VERSION
// ----------------------------------------------------------------------------
// PURPOSE:
//   Centralized retry mechanism for stabilizing flaky UI/API operations.
//   Automatically handles:
//     ✔ configurable retry counts
//     ✔ exponential backoff
//     ✔ jitter (random delay)
//     ✔ fatal error detection (skip retry)
//     ✔ per-attempt callback
//
// USED BY:
//   - ElementUtils (click, fill, type, selectOption, etc.)
//   - BasePage advanced actions
//   - Any slow/unstable async function
//
// WHEN TO USE:
//   - Flaky UI interactions (dynamic canvas, React rerenders, overlays)
//   - API retry logic (429 / 503 errors)
//   - Network delays
//   - Database polling
// ============================================================================

import { logger } from "../helpers/logger";

export interface RetryOptions {
  retries?: number;             // Number of retry attempts (default: 2)
  baseDelayMs?: number;         // Base delay for first retry (default: 3000ms)
  maxDelayMs?: number;          // Max delay cap (default: 9000ms)
  exponential?: boolean;        // Enable exponential backoff (default: true)
  jitter?: boolean;             // Add 0–50% random jitter (default: true)
  onRetry?: (attempt: number, error: any) => void | Promise<void>;
}

export class RetryUtils {

  // ============================================================================
  // 🔁 MASTER RETRY FUNCTION
  // ----------------------------------------------------------------------------
  /**
   * Retries an async function according to configured retry policies.
   *
   * HOW IT WORKS:
   *
   * For each attempt:
   *  1️⃣ Try executing fn()
   *  2️⃣ If success → return immediately
   *  3️⃣ If failure → check for fatal errors
   *  4️⃣ If fatal → stop retrying
   *  5️⃣ Log failure + call onRetry()
   *  6️⃣ Compute delay (exponential + jitter)
   *  7️⃣ Wait before next attempt
   *
   * WHEN TO USE:
   * - Flaky Playwright UI interactions (element not ready / overlay issues)
   * - Bluecopa canvas elements blocked by SVG edges
   * - Network/API retry logic
   * - DB polling / async retry tasks
   *
   * @example
   * await RetryUtils.retry(async () => {
   *   await page.click("#save");
   * });
   *
   * @example
   * await RetryUtils.retry(
   *   async () => doApiRequest(),
   *   { retries: 5, baseDelayMs: 1500 }
   * );
   *
   * @example
   * await RetryUtils.retry(
   *   async () => this.click(element),
   *   {
   *     retries: 4,
   *     exponential: true,
   *     jitter: true,
   *     onRetry: (attempt, error) => logger.warn(`Retry ${attempt}: ${error}`)
   *   }
   * );
   */
  static async retry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {

    // Extract + assign defaults
    const {
      retries = 2,
      baseDelayMs = 3000,
      maxDelayMs = 9000,
      exponential = true,
      jitter = true,
      onRetry,
    } = options;

    let lastError: any;

    for (let attempt = 1; attempt <= retries; attempt++) {
      const startTime = Date.now();

      try {
        const result = await fn();

        if (attempt > 1) {
          logger.debug(` Retry succeeded on attempt ${attempt}/${retries}`);
        }

        return result;
      }

      catch (error: any) {
        const duration = Date.now() - startTime;
        const message = error?.message || String(error);
        lastError = error;

        // 1️⃣ FATAL ERROR? → STOP RETRIES
        if (this.isFatal(message)) {
          logger.error(` Fatal error (no retry) → ${message}`);
          throw error;
        }

        // 2️⃣ LOG FAILURE
        logger.warn(
          `Retry attempt ${attempt}/${retries} failed (${duration}ms)\n   → ${message}`
        );

        // 3️⃣ Execute callback
        if (onRetry) {
          try { await onRetry(attempt, error); }
          catch (callbackErr) {
            logger.error(`Retry callback error: ${callbackErr}`);
          }
        }

        // 4️⃣ Perform delay before next attempt
        if (attempt < retries) {
          const delay = this.computeDelay(
            baseDelayMs,
            attempt,
            maxDelayMs,
            exponential,
            jitter
          );

          logger.debug(`⏳ Waiting ${delay}ms before retry ${attempt + 1}...`);
          await this.sleep(delay);
        }
      }
    }

    // 5️⃣ All retries failed
    logger.error(` All ${retries} retry attempts FAILED.`);
    throw lastError;
  }

  // ============================================================================
  // 🔒 CHECK IF ERROR IS FATAL
  // ----------------------------------------------------------------------------
  /**
   * Fatal errors → retrying will not fix the problem.
   * Example: invalid selector, page closed, context killed, navigation failed.
   */
  private static isFatal(message: string): boolean {
    const fatalPatterns = [
      "Invalid selector",
      "Malformed selector",
      "not a function",
      "TypeError",
      "ReferenceError",
      "Cannot read properties",
      "Cannot find module",
      "Environment configuration invalid",
      "browser has been closed",
      "Target page",
      "Context has been closed",
      "Execution context was destroyed",
      "Element not editable",
      "Element detached",
      "Navigation failed",
      "Node is either not visible or not an HTMLElement",
      "net::ERR",
    ];

    return fatalPatterns.some(p => message.includes(p));
  }

  // ============================================================================
  // ⏳ COMPUTE RETRY DELAY
  // ----------------------------------------------------------------------------
  /**
   * Computes delay using:
   * - exponential backoff → base * 2^(attempt-1)
   * - linear fallback → base * attempt
   * - jitter → random +/- variation
   */
  private static computeDelay(
    base: number,
    attempt: number,
    max: number,
    exponential: boolean,
    jitter: boolean
  ): number {

    let delay = exponential
      ? base * Math.pow(2, attempt - 1) // exponential
      : base * attempt;                 // linear

    if (jitter) {
      const jitterAmount = Math.random() * base * 0.5;
      delay += jitterAmount;
    }

    return Math.min(delay, max);
  }

  // ============================================================================
  // 🛑 SLEEP
  // ----------------------------------------------------------------------------
  /**
   * Simple sleep helper.
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

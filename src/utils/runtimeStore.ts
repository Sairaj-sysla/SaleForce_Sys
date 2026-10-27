// ============================================================================
//  RUNTIME STORE — In-memory key-value store for test execution
// ----------------------------------------------------------------------------
//  Use this to share values between test steps within the same test run.
//
//  USAGE:
//  ─────────────────────────────────────────────────────────────────────────
//  Runtime.set("bookingId", "BK-2025-001");   // store
//  $("bookingId")                             // get (shorthand)
//  $$("bookingId")                            // check exists (shorthand)
//  Runtime.getOrDefault("city", "Goa")        // get with fallback
//  Runtime.setIfAbsent("city", "Goa")         // only set if not already set
//  Runtime.has("bookingId")                   // check exists
//  Runtime.remove("bookingId")               // remove one key
//  Runtime.clear()                            // clear all
//  Runtime.dump()                             // print all (debug)
//  Runtime.getAll()                           // get all as object
// ============================================================================

export class Runtime {
  private static store: Record<string, unknown> = {};

  // ── Set a value ────────────────────────────────────────────────────────────
  static set(key: string, value: unknown): void {
    this.store[key] = value;
    console.log(`[RUNTIME] STORED → ${key}:`, value);
  }

  // ── Set only if key does not already exist ────────────────────────────────
  static setIfAbsent(key: string, value: unknown): void {
    if (!(key in this.store)) {
      this.set(key, value);
    }
  }

  // ── Get a value — warns if key not found ──────────────────────────────────
  static get(key: string): any {
    if (!(key in this.store)) {
      console.warn(`[RUNTIME] WARNING → Key "${key}" not found in store`);
      return undefined;
    }
    return this.store[key];
  }

  // ── Get a value with fallback — no warning if key missing ─────────────────
  static getOrDefault(key: string, defaultValue: unknown): any {
    return key in this.store ? this.store[key] : defaultValue;
  }

  // ── Check if key exists ───────────────────────────────────────────────────
  static has(key: string): boolean {
    return key in this.store;
  }

  // ── Remove one key ────────────────────────────────────────────────────────
  static remove(key: string): void {
    if (key in this.store) {
      delete this.store[key];
      console.log(`[RUNTIME] REMOVED → ${key}`);
    }
  }

  // ── Clear all keys ────────────────────────────────────────────────────────
  static clear(): void {
    this.store = {};
    console.log("[RUNTIME] Store cleared");
  }

  // ── Get all stored values as plain object ─────────────────────────────────
  static getAll(): Record<string, unknown> {
    return { ...this.store };
  }

  // ── Print all stored values (for debugging) ───────────────────────────────
  static dump(): void {
    console.log("===== RUNTIME STORE =====");
    console.log(JSON.stringify(this.store, null, 2));
    console.log("=========================");
  }
}
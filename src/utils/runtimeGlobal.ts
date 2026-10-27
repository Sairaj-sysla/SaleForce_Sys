// ============================================================================
//  RUNTIME GLOBAL — Registers global shortcuts for Runtime store
// ----------------------------------------------------------------------------
//  Import this file ONCE in playwright.config.ts:
//  import "./src/utils/runtimeGlobal";
//
//  SHORTCUTS:
//  ─────────────────────────────────────────────────────────────────────────
//  $("key")          → Runtime.get("key")       get value
//  $$("key")         → Runtime.has("key")       check if exists
// ============================================================================

import { Runtime } from "./runtimeStore";

// $("key") → get value
(global as any).$ = (key: string): any => Runtime.get(key);

// $$("key") → check if key exists
(global as any).$$ = (key: string): boolean => Runtime.has(key);
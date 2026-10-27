// src/config/globalTimeout.ts
// ✅ Now reads from configManager instead of hardcoded values
// ✅ Kept for backward compatibility — but basePage.ts should use
//    configManager.getTimeout("action") directly

import { configManager } from "./env.index";

export const Global_Timeout = {
  get action()     { return configManager.getTimeout("action"); },
  get wait()       { return configManager.getTimeout("wait"); },
  get navigation() { return configManager.getTimeout("navigation"); },
};
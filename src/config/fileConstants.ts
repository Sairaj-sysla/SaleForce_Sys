// src/config/fileConstants.ts
// ============================================================================
//  FILE CONSTANTS — all paths and folders used by the framework
// ============================================================================

export const FILE_PATHS = {
  SCREENSHOTS: "test-results/screenshots",
  REPORTS:     "test-results/reports",
  DOWNLOADS:   "test-results/downloads",
  TRACES:      "test-results/traces",
  VIDEOS:      "test-results/videos",
} as const;

export const TEST_DATA = {
  PURCHASE_ORDER: "src/testData/purchaseOrderData.json",
} as const;
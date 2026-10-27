// src/config/appConstants.ts
// ============================================================================
//  APP CONSTANTS — fixed business values, never changes across environments
//  Used in: Purchase.spec.ts, purchaseOrderLocators.ts, stepGroups
// ============================================================================

export const PO_STATUS = {
  DRAFT:     "Draft",
  SUBMITTED: "Submitted",
  APPROVED:  "Approved",
} as const;

export const GRN_STATUS = {
  FULLY_RECEIVED: "Fully received",
  FULLY_INVOICED: "Fully invoiced",
} as const;

export const SUPPLIER = {
  NAME: "Mohamed Supplier",
} as const;

export const WAREHOUSE = {
  BRANCH: "Chennai Branch",
} as const;

export const DELIVERY = {
  ADDRESS: "Chennai",
} as const;

export const PURCHASE_EXECUTIVE = {
  NAME: "Admin",
} as const;

export const ITEM = {
  NAME:     "Item 1",
  QUANTITY: "10",
  RATE:     "100",
  AMOUNT:   1000,
} as const;

export const ORDER = {
  TYPE:   "Purchase Order",
  BRAND:  "Order Brand",
} as const;

export const CLOSE_MAX_ATTEMPTS = 4;
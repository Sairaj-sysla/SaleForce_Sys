import { test , expect } from "@fixtures/basefixtures";
import { SaleForceLogin } from "@modules/saleForceLogin";
import { SaleForceLocators } from "@pages/Element/SaleForce";

test("@smoke SaleForce Login Test", async ({ page, basePage }, testInfo) => {
  
  await SaleForceLogin(basePage, new SaleForceLocators(page));
})
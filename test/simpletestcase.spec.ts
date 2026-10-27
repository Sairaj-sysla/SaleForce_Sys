// ============================================================================
//  Purchase.spec.ts
//  el    = new PurchaseOrderLocators(page)  → locators only
//  base  = provided by fixture (BasePage with auto-step & logs)
//  login = new LoginPage(page, test, testInfo) → login methods
// ============================================================================

import { test , expect } from "@fixtures/basefixtures";
import { LoginPage } from "@modules/loginPage";
import { logger as log } from "@helpers/logger";
import { PurchaseOrderLocators } from "@pages/Element/purchaseOrderLocators";
import {
  stepGroup_HandleSubmitPopups,
  stepGroup_ApproveUntilDone,
} from "@modules/purchaseOrder";
import {
  PO_STATUS,
  GRN_STATUS,
  SUPPLIER,
  // WAREHOUSE,   // unused – remove
  DELIVERY,
  PURCHASE_EXECUTIVE,
  ITEM,
  ORDER,
} from "src/appConstant.ts/appConstants";

const TC_ID = "REG_TS_PO_TC01";
const TC_TITLE = "Create Purchase Order - Full E2E";

test.describe("Purchase Order Module ", () => {
  let el: PurchaseOrderLocators;

  test.beforeEach(async ({ page }) => {
    el = new PurchaseOrderLocators(page);
    // login is created inside the test because we need test & testInfo
  });

  test(`@smoke ${TC_ID} - ${TC_TITLE}`, async ({ page, basePage }, testInfo) => {
    // Instantiate LoginPage inside the test (test and testInfo are available)
    const login = new LoginPage(page, test, testInfo);

    log.info(`${TC_ID} - ${TC_TITLE}`);

    // ── Login ─────────────────────────────────────────────────────────────
    await login.navigateTo();
    await login.login();
    await login.verifyLoginSuccessful();

    // ── Open Purchase Order ───────────────────────────────────────────────
    await basePage.click(el.typeToSearchField);
    await basePage.type(el.searchField, ORDER.TYPE);
    await basePage.click(el.purchaseOrdersDropdown);
    await basePage.click(el.createPurchaseOrderButton);

    // ── Select Warehouse ──────────────────────────────────────────────────
    await basePage.click(el.forStockRadio);
    await basePage.click(el.warehouseDropdown);
    await basePage.click(el.warehouseSelect);
    await basePage.click(el.taxUnit);
    await basePage.click(el.selectBranch);
    await basePage.click(el.doneButton);

    // ── Select Supplier ───────────────────────────────────────────────────
    await basePage.click(el.supplierDropdown);
    await basePage.waitForElementIsVisible(el.supplierDropdown);
    await basePage.pause(300);
    await basePage.type(el.supplierDropdown, SUPPLIER.NAME);
    await basePage.pressKey("Enter");

    // ── Select Delivery Address ───────────────────────────────────────────
    await basePage.scrollIntoView(el.deliveryAddressLabel);
    await basePage.click(el.deliveryAddressDropdown);
    await basePage.pause(300);
    await basePage.type(el.deliveryAddressDropdown, DELIVERY.ADDRESS);
    await basePage.pressKey("Enter");

    // ── Select Purchase Executive ─────────────────────────────────────────
    await basePage.click(el.purchaseExecutiveDropdown);
   
    await basePage.pause(300);
    await basePage.type(el.purchaseExecutiveDropdown, PURCHASE_EXECUTIVE.NAME);
    await basePage.pressKey("Enter");

    // ── Add Item ──────────────────────────────────────────────────────────
    await basePage.click(el.addItemsButton);
    await basePage.waitForElementIsVisible(el.itemTextbox);
    await basePage.click(el.itemTextbox);
    await basePage.pause(300);
    await basePage.type(el.itemTextbox, ITEM.NAME);
    await basePage.click(el.itemOption1(ITEM.NAME));

    // ── Enter Quantity ────────────────────────────────────────────────────
    await basePage.click(el.quantityTextbox);
    await basePage.pause(200);
    await basePage.clear(el.quantityTextbox);
    await basePage.type(el.quantityTextbox, ITEM.QUANTITY);
    await basePage.pressKey("Tab");

    // ── Enter Rate ────────────────────────────────────────────────────────
    await basePage.click(el.rateTextbox);
    await basePage.pause(200);
    await basePage.clear(el.rateTextbox);
    await basePage.type(el.rateTextbox, ITEM.RATE);
    await basePage.pressKey("Tab");

    // ── Verify Amount ─────────────────────────────────────────────────────
    await page.waitForFunction(
      (sel) => {
        const node = document.evaluate(
          sel,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue as HTMLInputElement;
        return node && node.value !== "" && node.value !== "0";
      },
      '(//*[text()="Amount"]/../..//*[@type="number"])[last()]',
      { timeout: 10000 }
    );
    const rawAmount = await el.amountTextbox
      .first()
      .evaluate((e: HTMLInputElement) => e.value);
    expect(Number(rawAmount.replace(/,/g, ""))).toBe(ITEM.AMOUNT);

    // ── Select Order Brand ────────────────────────────────────────────────
    await basePage.click(el.orderBrandDropdown);
    await basePage.pause(200);
    await basePage.click(el.orderBrandOption);
    await basePage.click(el.doneButton);

    // ── Save Order ────────────────────────────────────────────────────────
    await basePage.click(el.actionsButton);
    await basePage.click(el.saveOption);
    await stepGroup_HandleSubmitPopups(basePage, el);

    // ── Submit PO ─────────────────────────────────────────────────────────
    await basePage.pause(1000);
    await basePage.click(el.actionsButton, { force: true });
    await basePage.waitForElementIsVisible(el.submitOption);
    await basePage.click(el.submitOption);
    await stepGroup_HandleSubmitPopups(basePage, el);

    // ── Approve PO ────────────────────────────────────────────────────────
    await stepGroup_ApproveUntilDone(basePage, el, 5);
    await basePage.assertElementVisible(el.approvedStatus);

    // ── Create GRN ────────────────────────────────────────────────────────
    await basePage.click(el.relatedDocs);
    await basePage.click(el.receiptNoteGRNButton);
    await basePage.click(el.selectItemsButtonGRN);
    await basePage.click(el.poNo);
    await basePage.click(el.doneButtonGRN);
    await basePage.click(el.actionsButton);
    await basePage.waitForElementIsVisible(el.submitOption);
    await basePage.click(el.submitOption);
    await stepGroup_HandleSubmitPopups(basePage, el);
    await stepGroup_ApproveUntilDone(basePage, el, 3);

    // ── Create Purchase Invoice ───────────────────────────────────────────
    const todayDate = new Date().toLocaleDateString("en-GB");
    const invoiceNo = String(Math.floor(Math.random() * 9000) + 1000);

    await basePage.click(el.relatedDocs1);
    await basePage.click(el.purchaseInvoiceButton);


    await basePage.fillDatePicker(el.supplierInvoiceDate, todayDate);
    await basePage.fillDatePicker(el.documentDate, todayDate);
    await basePage.fillDatePicker(el.dueDate, todayDate);

    await basePage.type(el.supplierInvoiceNo, invoiceNo);
    await basePage.click(el.selectItemsButtonPI);
    await basePage.click(el.receiptNo);
    await basePage.click(el.doneButton3);
    await basePage.click(el.actionsButton);
    await basePage.waitForElementIsVisible(el.submitOption);
    await basePage.click(el.submitOption);
    await stepGroup_HandleSubmitPopups(basePage, el);
    await stepGroup_ApproveUntilDone(basePage, el, 2);

    // ── Close Panels ──────────────────────────────────────────────────────
    await basePage.whileVisible(el.closeButton, async () => {
      await el.closeButton.click();
      await basePage.ifVisible(el.approved1Status, async () => {});
    });

    // ── Verify Final Statuses ─────────────────────────────────────────────
    await basePage.assertElementVisible(el.approved1Status);
    await basePage.assertElementVisible(el.fullyReceived1Status);
    await basePage.assertElementVisible(el.fullyInvoicedStatus);

    log.pass("All final statuses verified");

  
  });
});
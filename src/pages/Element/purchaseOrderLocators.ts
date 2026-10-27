import { Page, Locator } from "@playwright/test";

export class PurchaseOrderLocators {

    readonly page: Page;

    constructor(page: Page) {
        this.page = page;
    }

    // ── Named helper — attaches display name for logger ───────────────────────
    private named(name: string, locator: Locator): Locator {
        (locator as any).__name = name;
        return locator;
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    get typeToSearchField(): Locator {
        return this.named("Type To Search Field",
            this.page.locator("(//*[contains(@class,'select-control__input')])[last()]"));
    }

    get searchField(): Locator {
        return this.named("Search Field",
            this.page.locator("//div[contains(@class,'main-container')]//input[@type='text']"));
    }

    get purchaseOrdersDropdown(): Locator {
        return this.named("Purchase Orders Dropdown",
            this.page.locator("//div[@role='option']"));
    }

    get createPurchaseOrderButton(): Locator {
        return this.named("Create Purchase Order Button",
            this.page.locator("//span[normalize-space()='Create Purchase Order']"));
    }

    // ── Warehouse ─────────────────────────────────────────────────────────────

    get forStockRadio(): Locator {
        return this.named("For Stock Radio",
            this.page.locator("//label[.//div[normalize-space()='For stock']]//div[contains(@class,'radio-icon-inner-circle')]"));
    }

    get warehouseDropdown(): Locator {
        return this.named("Warehouse Dropdown",
            this.page.locator('//*[text()="Warehouse"]/../..//div[contains(@class,"select-control__input-container css")]'));
    }

    get warehouseSelect(): Locator {
        return this.named("Warehouse Select",
            this.page.locator("//div[@role='listbox']/div[3]"));
    }

    get taxUnit(): Locator {
        return this.named("Tax Unit",
            this.page.locator("(//*[contains(@class,'select-control__input')])[last()]"));
    }

    get selectBranch(): Locator {
        return this.named("Chennai Branch",
            this.page.locator("//div[normalize-space()='Chennai Branch']"));
    }

    get doneButton(): Locator {
        return this.named("Done Button",
            this.page.locator("//span[normalize-space()='Done']"));
    }

    // ── Supplier Details ──────────────────────────────────────────────────────

    get supplierDropdown(): Locator {
        return this.named("Supplier Dropdown",
            this.page.locator("//*[text()='Supplier']/../..//*[@type='text']"));
    }

    get deliveryAddressLabel(): Locator {
        return this.named("Delivery Address Label",
            this.page.locator("//*[text()='Delivery Address']"));
    }

    get deliveryAddressDropdown(): Locator {
        return this.named("Delivery Address Dropdown",
            this.page.locator("//*[text()='Delivery Address']/../..//*[@type='text']"));
    }

    get purchaseExecutiveDropdown(): Locator {
        return this.named("Purchase Executive Dropdown",
            this.page.locator("//*[text()='Purchase Executive']/../..//*[@type='text']"));
    }

    // ── Item Details ──────────────────────────────────────────────────────────

    get addItemsButton(): Locator {
        return this.named("Add Items Button",
            this.page.locator("//span[normalize-space()='Add items']"));
    }

    get itemTextbox(): Locator {
        return this.named("Item Textbox",
            this.page.locator("//label[text()='Item']/../following-sibling::div//input"));
    }

    get itemOption(): Locator {
        return this.named("Item Option",
            this.page.locator("//div[@role='listbox']/div[1]"));
    }

    get quantityTextbox(): Locator {
        return this.named("Quantity Textbox",
            this.page.locator("//*[text()='Quantity']/../..//*[@type='number']"));
    }

    get rateTextbox(): Locator {
        return this.named("Rate Textbox",
            this.page.locator("//*[text()='Rate']/../..//*[@type='number']"));
    }

    get amountTextbox(): Locator {
        return this.named("Amount Textbox",
            this.page.locator("(//*[text()='Amount']/../..//*[@type='number'])[last()]"));
    }

    // ── Order Brand ───────────────────────────────────────────────────────────

    get orderBrandDropdown(): Locator {
        return this.named("Order Brand Dropdown",
            this.page.locator("(//*[text()='Order Brand']/../..//input)[3]"));
    }

    get orderBrandOption(): Locator {
        return this.named("Order Brand Option",
            this.page.locator("//div[@role='listbox']/div[1]"));
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    get actionsButton(): Locator {
        return this.named("Actions Button",
            this.page.locator("(//*[text()='Action'])[last()]"));
    }

    get saveOption(): Locator {
        return this.named("Save Option",
            this.page.locator("//div[normalize-space()='Save']"));
    }

    get submitOption(): Locator {
        return this.named("Submit Option",
            this.page.locator("//span[normalize-space()='Submit'] | //div[normalize-space()='Submit']"));
    }

    // ── Status & Alerts ───────────────────────────────────────────────────────

    get draftStatus(): Locator {
        return this.named("Draft Status",
            this.page.locator("//span[normalize-space()='Draft']"));
    }

    get interstatePartnerAlert(): Locator {
        return this.named("Interstate Partner Alert",
            this.page.locator("//h1[normalize-space()='Interstate partner alert']"));
    }

    get noContinueLocalGST(): Locator {
        return this.named("No Continue Local GST",
            this.page.locator("//button//span[normalize-space()='No, continue with local GST']"));
    }

    // ── Popups ────────────────────────────────────────────────────────────────

    get yesSubmitButton(): Locator {
        return this.named("Yes Submit Button",
            this.page.locator("//*[contains(text(),'Yes, submit')]"));
    }

    get yesApproveButton(): Locator {
        return this.named("Yes Approve Button",
            this.page.locator("//*[contains(text(),'Yes, approve it')]"));
    }

    get yesButton(): Locator {
        return this.named("Yes Button",
            this.page.locator("//*[contains(text(),'Yes')]"));
    }

    // ── Approval ──────────────────────────────────────────────────────────────

    get approveThisDocumentButton(): Locator {
        return this.named("Approve This Document Button",
            this.page.locator("//*[text()='Approve this document']"));
    }

    get approvedStatus(): Locator {
        return this.named("Approved Status",
            this.page.locator("//*[normalize-space()='Approved']"));
    }

    // ── Receipt Note (GRN) ────────────────────────────────────────────────────

    get relatedDocs(): Locator {
        return this.named("Related Docs",
            this.page.locator("//*[text()[normalize-space()='Related Docs']]"));
    }

    get receiptNoteGRNButton(): Locator {
        return this.named("Receipt Note GRN Button",
            this.page.locator("//span[text()[normalize-space()='Receipt Note (GRN)']]"));
    }

    get selectItemsButtonGRN(): Locator {
        return this.named("Select Items Button GRN",
            this.page.locator("//span[normalize-space()='Select items']"));
    }

    get poNo(): Locator {
        return this.named("PO Number Checkbox",
            this.page.locator("//div[contains(@class,'picking-tbl-row') and contains(@class,'undefined') and .//span[text()[normalize-space()='PO No.']]]//*[local-name()='svg']"));
    }

    get doneButtonGRN(): Locator {
        return this.named("Done Button GRN",
            this.page.locator("//span[normalize-space()='Done']"));
    }

    // ── Purchase Invoice ──────────────────────────────────────────────────────

    get relatedDocs1(): Locator {
        return this.named("Related Docs (PI)",
            this.page.locator("//*[text()[normalize-space()='Related Docs']]"));
    }

    get purchaseInvoiceButton(): Locator {
        return this.named("Purchase Invoice Button",
            this.page.locator("//span[normalize-space()='Purchase Invoice']"));
    }

    get supplierInvoiceDate(): Locator {
        return this.named("Supplier Invoice Date",
            this.page.locator("//label[contains(normalize-space(),'Supplier Invoice Date')]/../following-sibling::div//input"));
    }

    get documentDate(): Locator {
        return this.named("Document Date",
            this.page.locator("//label[text()='Document Date']/../following-sibling::div//input"));
    }

    get dueDate(): Locator {
        return this.named("Due Date",
            this.page.locator("//label[contains(normalize-space(),'Due Date')]/../following-sibling::div//input"));
    }

    get supplierInvoiceNo(): Locator {
        return this.named("Supplier Invoice No",
            this.page.locator('//*[contains(text(),"Supplier Invoice No")]/../..//input'));
    }

    get selectItemsButtonPI(): Locator {
        return this.named("Select Items Button PI",
            this.page.locator("//span[text()[normalize-space()='Select Items']]"));
    }

    get receiptNo(): Locator {
        return this.named("Receipt No Checkbox",
            this.page.locator("//div[contains(@class,'picking-tbl-row') and contains(@class,'undefined') and .//span[text()[normalize-space()='Receipt No.']]]//*[local-name()='svg']"));
    }

    get doneButton3(): Locator {
        return this.named("Done Button PI",
            this.page.locator("//span[normalize-space()='Done']"));
    }

    // ── Close Button ──────────────────────────────────────────────────────────

    get closeButton(): Locator {
        return this.named("Close Button",
            this.page.locator("(//*[text()='Close'])[last()-1]"));
    }

    // ── Final Status ──────────────────────────────────────────────────────────

    get approved1Status(): Locator {
        return this.named("Approved Status (Final)",
            this.page.locator("//*[normalize-space()='Approved']"));
    }

    get fullyReceived1Status(): Locator {
        return this.named("Fully Received Status",
            this.page.locator("//td[text()[normalize-space()='Fully received']]"));
    }

    get fullyInvoicedStatus(): Locator {
        return this.named("Fully Invoiced Status",
            this.page.locator("//td[text()[normalize-space()='Fully invoiced']]"));
    }
     get model(){
       return this.named("model",
         this.page.locator("//div[contains(@class,'modal_overlay')]"));
    }

    // ── Dynamic locators ─────────────────────────────────────────────────────

    get supplierOption() {
        return (name: string): Locator =>
            this.named(
                `Supplier (${name})`,
                this.page.locator(`//*[text()='${name}']`)
            );
    }

    get deliveryAddressOption() {
        return (address: string): Locator =>
            this.named(
                `Delivery Address (${address})`,
                this.page.locator(`//*[text()='${address}']`)
            );
    }

    get purchaseExecutiveOption() {
        return (name: string): Locator =>
            this.named(
                `Purchase Executive (${name})`,
                this.page.locator(`//*[text()='${name}']`)
            );
    }

    get itemOption1() {
        return (name: string): Locator =>
            this.named(
                `Item Option (${name})`,
                this.page.locator(`//div[@role='listbox']//*[contains(normalize-space(),'${name}')][1]`)
            );
    }
   
}
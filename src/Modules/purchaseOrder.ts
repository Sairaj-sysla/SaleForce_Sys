import { BasePage } from '@pages/basePage';
import { PurchaseOrderLocators } from '../pages/Element/purchaseOrderLocators';

export async function stepGroup_HandleSubmitPopups(
    base: BasePage,
    el: PurchaseOrderLocators
) {
    await base.ifVisible(el.interstatePartnerAlert, async () => {
        await base.click(el.noContinueLocalGST);
    }, undefined, 3000);

    await base.ifVisible(el.yesSubmitButton, async () => {
        await base.click(el.yesSubmitButton);
    }, undefined, 3000);

    //await base.waitForElementToDisappear(el.model)
}

export async function stepGroup_ApproveUntilDone(
    base: BasePage,
    el: PurchaseOrderLocators,
    maxApprovals = 5
) {

    // Give page time after submit
    await base.pause(5000);

    for (let i = 0; i < maxApprovals; i++) {

        const visible = await el.approveThisDocumentButton
            .isVisible()
            .catch(() => false);

        if (!visible) {
            console.log('Approve button not visible - exiting loop');
            break;
        }

        await base.click(el.approveThisDocumentButton);

        await base.ifVisible(
            el.yesApproveButton,
            async () => {
                await base.click(el.yesApproveButton);
            },
            undefined,
            5000
        );

        await base.waitForLoadState('domcontentloaded');

        // Let page refresh after approval
        await base.pause(3000);
    }
}
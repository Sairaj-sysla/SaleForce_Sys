import { BasePage } from '@pages/basePage';
import { SaleForceLocators } from '../pages/Element/SaleForce';
import { configManager } from '@config/env.index';
import { getLatestOtp, initGmailClient } from '@utils/gmailOtp';

const SALESFORCE_HOST = /(^|\.)(salesforce\.com|force\.com)$/i;

// Fails fast if the base URL is not a Salesforce host (e.g. the QA config was
// picked up) or, when SALESFORCE_EXPECTED_HOST is set, not the intended org.
export function assertSalesforceOrgUrl(url: string): void {
    const env  = configManager.getEnvironment();
    const host = new URL(url).hostname.toLowerCase();
    if (!SALESFORCE_HOST.test(host)) {
        throw new Error(
            `Salesforce login aborted: base URL host "${host}" (ENVIRONMENT="${env}") is not a Salesforce domain. ` +
            `Run with ENVIRONMENT=dev or set BASE_URL to the Salesforce org login URL.`
        );
    }
    const expected = process.env.SALESFORCE_EXPECTED_HOST?.trim().toLowerCase();
    if (expected && host !== expected) {
        throw new Error(
            `Salesforce login aborted: base URL host "${host}" does not match SALESFORCE_EXPECTED_HOST "${expected}".`
        );
    }
}

export async function SaleForceLogin( basePage: BasePage, el: SaleForceLocators,


) {

    const url = configManager.getBaseURL();
    assertSalesforceOrgUrl(url);
    const { username, password } = configManager.getCredentials()
    await basePage.navigateTo(url);
    await basePage.click(el.loginWithUsername);
    await basePage.type(el.username, username);
    await basePage.click(el.loginButton);
    await basePage.type(el.passwordEnter, password, undefined, { mask: true });
    // Submitting the password triggers the OTP email.
    const otpRequestedAt = Date.now();
    await basePage.click(el.loginButton);
    await initGmailClient();
    await basePage.waitForLoadState('domcontentloaded');
    await basePage.waitForElementIsVisible(el.verificationCode);
    const otp = await getLatestOtp(otpRequestedAt);
    await basePage.type(el.verificationCode, otp, undefined, { mask: true });
    await basePage.press(el.verificationCode, 'Enter');
    await basePage.waitForElementIsVisible(el.homePageHeader)

}

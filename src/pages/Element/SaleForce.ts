import { Page, Locator } from "@playwright/test";



export class SaleForceLocators {
 readonly page: Page;

    constructor(page: Page) {
        this.page = page;
    }

    // ── Named helper — attaches display name for logger ───────────────────────
    private named(name: string, locator: Locator): Locator {
        (locator as any).__name = name;
        return locator
    }
    get username(): Locator {
        return this.named("Username Field",
            this.page.locator("//input[@id='username']"));
    }
    get passwordEnter(): Locator {
        return this.named("Password Enter",
            this.page.locator("//input[@type='password']"));
    }
    get loginButton(): Locator {
        return this.named("Login Button",
            this.page.locator("//input[@id='Login']"));
    }
    get loginWithUsername(): Locator {
        return this.named("Login with Username",
            this.page.locator("//*[text()='Log In with Username']"));
    }
    get verificationCode(): Locator {
        return this.named("Verification Code",
            this.page.locator('//input[@id="emc"]'));
    }

    get homePageHeader(): Locator {
        return this.named("Home Page Header",
            this.page.locator("(//*[text()='Home'])[3]"));
    }



}
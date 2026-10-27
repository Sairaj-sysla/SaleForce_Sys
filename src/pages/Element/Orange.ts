import { Page, Locator } from "@playwright/test";

export class Orange {

    readonly page: Page;

    constructor(page: Page) {
        this.page = page;
    }

    // ── Named helper — attaches display name for logger ───────────────────────
    private named(name: string, locator: Locator): Locator {
        (locator as any).__name = name;
        return locator;
    }

    get loginButton(): Locator {
        return this.named("loginButton",
            this.page.locator("//*[@type='submit']"));
    }
    get username(): Locator {
        return this.named("username",
            this.page.locator("//*[@placeholder='']"));
    }

    get password(): Locator {
        return this.named("password",
            this.page.locator("//*[@placeholder='Password']"));
    }

    get admin(): Locator {
        return this.named("admin",
            this.page.locator("//*[text()='admin']"));
    }

























};
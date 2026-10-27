/**
 * Test Fixtures - Custom Playwright fixtures
 */
import { test as base, expect, TestInfo } from '@playwright/test';
import { BasePage } from '../pages/basePage';

type TestFixtures = {
  basePage: BasePage;
};

export const test = base.extend<TestFixtures>({
  basePage: async ({ page }, use, testInfo: TestInfo) => {
    // Pass testInfo if your BasePage needs it
    const basePage = new BasePage(page, test ,testInfo);
    await use(basePage);
  },
});

export { expect };
import { test as base, expect, TestInfo } from '@playwright/test';
import { BasePage } from '../pages/basePage';

type TestFixtures = {
  basePage: BasePage;
};

export const test = base.extend<TestFixtures>({
  basePage: async ({ page }, use, testInfo: TestInfo) => {
    // Pass the original 'base' test object (which has .step()) and the testInfo
    const basePage = new BasePage(page, base, testInfo);
    await use(basePage);
  },
});

export { expect };
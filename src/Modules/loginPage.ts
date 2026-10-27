import { Page, Locator, expect, test as baseTest, TestInfo } from '@playwright/test';
import { BasePage } from '../pages/basePage';
import { WaitUtils } from '../utils/waitUtils';
import { ErrorHandler } from '../utils/errorHandler';
import { logger } from '../helpers/logger';
import { configManager } from '../config/env.index';
import { Global_Timeout } from '../config/globalTimeout';

export class LoginPage extends BasePage {
  private usernameInput: Locator;
  private passwordInput: Locator;
  private loginButton: Locator;
  private projectBaseHeader: Locator;

  constructor(page: Page, test: typeof baseTest, testInfo: TestInfo) {
    super(page, test, testInfo);

    this.usernameInput      = page.locator('//input[@type="email"]');
    this.passwordInput      = page.locator('//input[@type="password"]');
    this.loginButton        = page.locator('//button[normalize-space()="LOGIN"]');
    this.projectBaseHeader  = page.locator('//span[normalize-space()="ProjectBase 2.0"]');
  }

  async navigateTo(): Promise<this> {
    return this._wrapWithStep('Navigate to login page', async () => {
      const url = configManager.getBaseURL();

      logger.info(`Opening Base URL: ${url}`);

      await this.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: Global_Timeout.navigation,
      });

      const domain = url.replace(/^https?:\/\//, '').split('/')[0];

      await WaitUtils.waitForURLContains(
        this.page,
        domain,
        Global_Timeout.navigation
      );

      return this;
    });
  }

  async login(): Promise<this> {
    return this._wrapWithStep('Login to application', async () => {
      const { username, password } = configManager.getCredentials();

      logger.info(`Logging in as: ${username}`);

      // Use BasePage's methods for auto-step and logs
      await this.fill(this.usernameInput, username, { label: 'Username' });
      await this.fill(this.passwordInput, password, { label: 'Password' });
      await this.click(this.loginButton, { label: 'Login Button' });

      // If projectBaseHeader not visible after login → reload and retry once
      const isVisible = await this.projectBaseHeader
        .waitFor({ state: 'visible', timeout: Global_Timeout.wait })
        .then(() => true)
        .catch(() => false);

      if (!isVisible) {
        logger.warn('ProjectBase 2.0 not visible — refreshing browser and retrying...');

        await this.page.reload({ waitUntil: 'domcontentloaded' });

        await this.waitForElementIsVisible(
          this.projectBaseHeader,
          Global_Timeout.wait
        );
      }

      logger.info('Login successful');

      return this;
    });
  }

  async validateUI(): Promise<this> {
    return this._wrapWithStep('Validate login UI', async () => {
      await expect(this.usernameInput).toBeVisible();
      await expect(this.passwordInput).toBeVisible();
      await expect(this.loginButton).toBeEnabled();
      return this;
    });
  }

  async verifyLoginSuccessful(): Promise<this> {
    return this._wrapWithStep('Verify login successful', async () => {
      await expect(this.projectBaseHeader).toBeVisible();
      logger.info('ProjectBase 2.0 is displayed');
      return this;
    });
  }
}
// src/config/types.ts

export type Environment  = 'dev' | 'qa';
export type TimeoutKeys  = 'action' | 'wait' | 'navigation';

export interface CredentialsConfig {
  username: string;
  password: string;
}

export interface BrowserConfig {
  headless: boolean;
  slowMo?:  number;
  timeout:  number;
}

// Defines which fields are mandatory in every test-data.json expected block
// Add new required fields here — TestData.validate() enforces them automatically
export interface ExpectedFieldsConfig {
  required: string[];   // e.g. ["landingMenu"] — must exist in every expected{}
}

// ─────────────────────────────────────────────────────────────────────────────
// Framework Settings — single source of truth for all feature toggles.
//
// SOLID rationale:
// - Open/Closed: consumers (BasePage, ElementUtils, AutoHeal, etc.) never
//   change when a new flag is added; they only read from this interface.
// - Single Responsibility: this interface's only job is to describe which
//   framework features exist and their on/off state.
// - Interface Segregation: consumers depend only on the flags they use via
//   getFrameworkSettings(), not on the whole AppConfig.
//
// To add a new feature flag:
//   1. Add the key here (typed boolean).
//   2. Add its default value in ConfigManager.frameworkSettings.
//   No other file needs to change.
// ─────────────────────────────────────────────────────────────────────────────
export interface FrameworkSettings {
  autoHeal: boolean;
  // Future flags (already supported by architecture, add when needed):
  // aiLocator?: boolean;
  // smartWait?: boolean;
  // retryFailedAction?: boolean;
  // screenshotOnFailure?: boolean;
  // trace?: boolean;
  // video?: boolean;
  // visualTesting?: boolean;
  // accessibility?: boolean;
  // networkCapture?: boolean;
  [key: string]: boolean; // index signature keeps this open for extension
}

// Gmail OTP fetching (src/utils/gmailOtp.ts). Values come from env vars
// GMAIL_OTP_* with defaults applied in ConfigManager.
export interface GmailOtpConfig {
  sender?:         string;   // optional "from:" filter
  subject?:        string;   // optional "subject:" filter
  otpPattern?:     string;   // optional regex; capture group 1 = OTP
  timeoutMs:       number;
  pollIntervalMs:  number;
  clockSkewMs:     number;   // tolerance between local clock and Gmail internalDate
  credentialsPath: string;   // Google OAuth Desktop client JSON
  tokenPath:       string;   // persisted authorized-user token
}

export interface AppConfig {
  env:         Environment;
  baseURL:     string;
  easyURL?:    string;
  apiBaseURL?: string;
  readonly testDataPath: string;
  requestOptions?: {
    timeout?: number;
    retries?: number;
    headers?: Record<string, string>;
  };
  credentials: CredentialsConfig;
  timeouts: {
    action:     number;
    wait:       number;
    navigation: number;
  };
  browser: BrowserConfig;
  logging?: {
    level?:   'debug' | 'info' | 'warn' | 'error';
    verbose?: boolean;
  };
  gmailOtp?: Partial<GmailOtpConfig>;
}
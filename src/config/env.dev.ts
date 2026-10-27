import type { AppConfig } from "./types";

export const devConfig: AppConfig = {
  env: "dev",
  baseURL: "https://welcome.salesforce.com/",
  easyURL: "https://welcome.salesforce.com/",
  testDataPath: "testdata/JSON Files",

  credentials: {
    username: "",  // from PLAYWRIGHT_USERNAME (.env.dev / CI secret)
    password: "",  // from PLAYWRIGHT_PASSWORD (.env.dev / CI secret)
  },

  timeouts: {
    action: 30000,
    wait: 30000,
    navigation: 40000,
  },

  browser: {
    headless: false,
    slowMo: 100,
    timeout: 600000,
  },

  requestOptions: {
    timeout: 30000,
    retries: 1,
  },

  logging: {
    level: "debug",
    verbose: true,
  },
};

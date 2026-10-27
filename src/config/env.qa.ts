import type { AppConfig } from "./types";

export const qaConfig: AppConfig = {
  env: "qa",
  baseURL: "https://sandbox5101.projectlane.io/spa#/1/home",
  easyURL : "https://opensource-demo.orangehrmlive.com/web/index.php/auth/login",
  testDataPath: "testdata/JSON Files",

  credentials: {
    username: "user2@gm.com",
    password: "12345",
  },

  timeouts: {
    action: 15000,
    wait: 15000,
    navigation: 10000,
  },

  browser: {
    headless: false,
    slowMo: 0,
    timeout: 600000,
  },

  requestOptions: {
    timeout: 30000,
    retries: 1,
  },

  logging: {
    level: "info",
    verbose: false,
  },
};

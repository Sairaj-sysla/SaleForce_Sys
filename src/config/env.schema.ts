// src/config/env.schema.ts
import { z } from "zod";

export const TimeoutSchema = z.object({
  action:     z.number().int().positive(),
  wait:       z.number().int().positive(),
  navigation: z.number().int().positive(),
});

export const CredentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const BrowserSchema = z.object({
  headless: z.boolean(),
  slowMo:   z.number().int().nonnegative().optional(),
  timeout:  z.number().int().positive(),
});

export const RequestOptionsSchema = z.object({
  timeout: z.number().int().positive(),
  retries: z.number().int().nonnegative(),
}).optional();

export const LoggingSchema = z.object({
  level:   z.enum(["debug", "info", "warn", "error"]),
  verbose: z.boolean().optional(),
}).optional();

export const GmailOtpSchema = z.object({
  sender:          z.string().min(1).optional(),
  subject:         z.string().min(1).optional(),
  otpPattern:      z.string().min(1).optional(),
  timeoutMs:       z.number().int().positive(),
  pollIntervalMs:  z.number().int().positive(),
  clockSkewMs:     z.number().int().nonnegative(),
  credentialsPath: z.string().min(1),
  tokenPath:       z.string().min(1),
}).partial().optional();

export const AppConfigSchema = z.object({
  env:            z.enum(["dev", "qa"]),   // ✅ removed staging + prod
  baseURL:        z.string().url(),
  easyURL:        z.string().url().optional(),
  apiBaseURL:     z.string().url().optional(),
  testDataPath:   z.string().min(1),
  credentials:    CredentialsSchema,
  timeouts:       TimeoutSchema,
  browser:        BrowserSchema,
  requestOptions: RequestOptionsSchema,
  logging:        LoggingSchema,
  gmailOtp:       GmailOtpSchema,
});

// src/utils/gmailOtp.ts
// ============================================================================
//  GMAIL OTP — fetch a login verification code from a dedicated test inbox
// ============================================================================
//
//  Uses the official Gmail API (read-only scope) with a Google OAuth
//  "Desktop app" client. First run performs the normal interactive consent
//  flow (or run `npm run gmail:auth` once); the authorized refresh token is
//  persisted to token.json so later runs are non-interactive.
//
//  Usage:
//    const otpRequestedAt = Date.now();
//    await basePage.click(el.loginButton);           // action that sends the OTP
//    const otp = await getLatestOtp(otpRequestedAt);
//
//  Configuration (via configManager.getGmailOtpConfig() / env vars):
//    GMAIL_OTP_SENDER, GMAIL_OTP_SUBJECT, GMAIL_OTP_PATTERN,
//    GMAIL_OTP_TIMEOUT_MS (90000), GMAIL_OTP_POLL_INTERVAL_MS (5000),
//    GMAIL_OTP_CLOCK_SKEW_MS (5000), GMAIL_CREDENTIALS_PATH, GMAIL_TOKEN_PATH
//
//  CI / GitHub Actions (non-interactive): provide the token as a secret via
//    GMAIL_TOKEN_JSON        — token.json contents (raw JSON or base64)
//    GMAIL_CREDENTIALS_JSON  — optional OAuth client JSON (raw or base64),
//                              only needed if the token lacks client_id/secret
//
//  Security: never logs the OTP, message bodies, tokens or credentials.
// ============================================================================

import * as fs from "fs";
import { google, gmail_v1 } from "googleapis";
import { configManager } from "../config/env.index";
import { logger } from "../helpers/logger";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const AUTH_HELP = "Run `npm run gmail:auth` to re-authorize the test Gmail account.";

// ── Default OTP patterns (capture group 1 = code) ───────────────────────────
// Anchored on wording around the code so 6-digit timestamps, phone numbers,
// years or footer numbers are not mistaken for the OTP.
export const DEFAULT_OTP_PATTERNS: RegExp[] = [
  // "Verification Code: 123456", "Your security code is\n123456"
  /(?:verification|security|one[-\s]?time|login|sign[-\s]?in|access|confirmation|authentication)\s+(?:code|passcode|pin|otp)\b[^\d.]{0,30}?(?<!\d)(\d{4,8})(?!\d)/i,
  // "OTP: 123456", "code is 123456"
  /\b(?:otp|passcode|code)\b\s*(?:is\s*)?[:\-=]?\s*(?<!\d)(\d{4,8})(?!\d)/i,
  // "123456 is your verification code"
  /(?<!\d)(\d{4,8})(?!\d)\s+is\s+your\s+(?:[\w-]+\s+){0,3}(?:code|otp|passcode|pin)\b/i,
];

// ============================================================================
//  TYPES
// ============================================================================

/** Minimal Gmail surface used by the poller — lets unit tests inject fakes. */
export interface GmailMessageSource {
  listMessageIds(query: string, maxResults: number): Promise<string[]>;
  getMessage(id: string): Promise<gmail_v1.Schema$Message>;
}

export interface GetOtpOptions {
  sender?:         string;
  subject?:        string;
  otpPattern?:     string | RegExp;
  timeoutMs?:      number;
  pollIntervalMs?: number;
  clockSkewMs?:    number;
  maxResults?:     number;
  /** Override the Gmail client (unit tests). */
  source?:         GmailMessageSource;
}

export interface MessageContent {
  subject: string;
  plain:   string;
  html:    string;
}

export class GmailOtpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailOtpError";
  }
}

// ============================================================================
//  PARSING — pure functions (unit tested)
// ============================================================================

export function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(head|style|script)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|td|th|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Walks a (possibly multipart) payload collecting text/plain and text/html bodies. */
export function extractMessageContent(message: gmail_v1.Schema$Message): MessageContent {
  const plain: string[] = [];
  const html:  string[] = [];

  const walk = (part?: gmail_v1.Schema$MessagePart): void => {
    if (!part) return;
    const mime       = (part.mimeType ?? "").toLowerCase();
    const isAttached = !!part.filename || !!part.body?.attachmentId;
    if (!isAttached && part.body?.data) {
      if (mime === "text/plain")     plain.push(decodeBase64Url(part.body.data));
      else if (mime === "text/html") html.push(decodeBase64Url(part.body.data));
    }
    part.parts?.forEach(walk);
  };
  walk(message.payload);

  const subject = message.payload?.headers
    ?.find(h => h.name?.toLowerCase() === "subject")?.value ?? "";

  return { subject, plain: plain.join("\n"), html: html.join("\n") };
}

export function toRegExp(pattern: string | RegExp): RegExp {
  if (pattern instanceof RegExp) return pattern;
  try {
    return new RegExp(pattern, "i");
  } catch (e: any) {
    throw new GmailOtpError(`Invalid GMAIL_OTP_PATTERN regular expression: ${e.message}`);
  }
}

/** Returns the OTP from free text, or null. Custom pattern: group 1 if present, else full match. */
export function extractOtp(text: string, pattern?: string | RegExp): string | null {
  if (!text) return null;
  const patterns = pattern ? [toRegExp(pattern)] : DEFAULT_OTP_PATTERNS;
  for (const re of patterns) {
    const m = text.match(re);
    const code = (m?.[1] ?? m?.[0])?.trim();
    if (code) return code;
  }
  return null;
}

/** Tries the plain body, then the HTML body (as text), then the subject. */
export function extractOtpFromMessage(message: gmail_v1.Schema$Message, pattern?: string | RegExp): string | null {
  const { subject, plain, html } = extractMessageContent(message);
  return extractOtp(plain, pattern)
      ?? extractOtp(htmlToText(html), pattern)
      ?? extractOtp(subject, pattern);
}

/** Messages received at/after `minInternalDate`, newest first. */
export function selectEligibleMessages(
  messages: gmail_v1.Schema$Message[],
  minInternalDate: number,
): gmail_v1.Schema$Message[] {
  return messages
    .filter(m => Number(m.internalDate) >= minInternalDate)
    .sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
}

export function buildSearchQuery(opts: { sender?: string; subject?: string; afterMs: number }): string {
  const parts: string[] = [];
  if (opts.sender)  parts.push(`from:${opts.sender.replace(/\s+/g, "")}`);
  if (opts.subject) parts.push(`subject:"${opts.subject.replace(/"/g, "")}"`);
  // Gmail's after: has coarse granularity — widen by 60s here and let
  // internalDate do the precise filtering.
  parts.push(`after:${Math.floor(opts.afterMs / 1000) - 60}`);
  return parts.join(" ");
}

// ============================================================================
//  AUTH — one authenticated client per worker process, reused across polls
// ============================================================================

let cachedSource: Promise<GmailMessageSource> | null = null;

/** OTP-bearing message ids already returned in this process — never reused. */
const consumedMessageIds = new Set<string>();

export function resetGmailClientCache(): void {
  cachedSource = null;
  consumedMessageIds.clear();
}

function describeAuthError(e: any): string | null {
  const msg    = String(e?.response?.data?.error ?? e?.message ?? e);
  const status = e?.code ?? e?.response?.status;
  if (/invalid_grant/i.test(msg)) {
    return `Gmail OAuth token has expired or been revoked (invalid_grant). ` +
           `Delete token.json, then: ${authHelp()} Note: OAuth apps in "Testing" ` +
           `publishing status issue refresh tokens that expire after 7 days.`;
  }
  if (/invalid_client|unauthorized_client/i.test(msg)) {
    return `Gmail OAuth client was rejected (${msg.split("\n")[0]}). ` +
           `Download a fresh "Desktop app" OAuth client JSON from Google Cloud Console, then: ${authHelp()}`;
  }
  if (status === 401 || status === 403) {
    return `Gmail API denied access (HTTP ${status}). Ensure the Gmail API is enabled for the ` +
           `Google Cloud project and the token grants gmail.readonly. ${authHelp()}`;
  }
  return null;
}

// JSON.parse errors can echo part of the input — never surface them.
function parseSecretJson(raw: string, label: string): any {
  const text = raw.trim();
  try {
    return JSON.parse(text.startsWith("{") ? text : Buffer.from(text, "base64").toString("utf8"));
  } catch {
    throw new GmailOtpError(`${label} is not valid JSON (or base64-encoded JSON).`);
  }
}

function readJsonFile(file: string, label: string): any {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e: any) {
    throw new GmailOtpError(`Could not read ${label} at "${file}": ${e.code ?? "read error"}`);
  }
  return parseSecretJson(raw, `${label} at "${file}"`);
}

type ClientKeys = { client_id: string; client_secret: string };

/** OAuth client from GMAIL_CREDENTIALS_JSON (secret) or the credentials file; null if neither exists. */
function loadClientKeys(credentialsPath: string): ClientKeys | null {
  const fromEnv = process.env.GMAIL_CREDENTIALS_JSON?.trim();
  let json: any;
  if (fromEnv)                              json = parseSecretJson(fromEnv, "GMAIL_CREDENTIALS_JSON");
  else if (fs.existsSync(credentialsPath))  json = readJsonFile(credentialsPath, "Gmail OAuth client file");
  else                                      return null;

  const keys = json.installed ?? json.web;
  if (!keys?.client_id || !keys?.client_secret) {
    throw new GmailOtpError(`Gmail OAuth client JSON is invalid (expected an "installed" section with client_id/client_secret).`);
  }
  return keys;
}

function requireClientKeys(credentialsPath: string): ClientKeys {
  const keys = loadClientKeys(credentialsPath);
  if (!keys) {
    throw new GmailOtpError(
      `Gmail OAuth client not found at "${credentialsPath}". Download the Desktop app OAuth client ` +
      `JSON from Google Cloud Console and save it there (or set GMAIL_CREDENTIALS_PATH / GMAIL_CREDENTIALS_JSON).`
    );
  }
  return keys;
}

/**
 * Authorized-user token from GMAIL_TOKEN_JSON (secret) or the token file; null if neither exists.
 * client_id/client_secret missing from the token are filled from the OAuth client JSON.
 */
export function loadToken(credentialsPath: string, tokenPath: string): Record<string, string> | null {
  const fromEnv = process.env.GMAIL_TOKEN_JSON?.trim();
  let token: any;
  if (fromEnv)                         token = parseSecretJson(fromEnv, "GMAIL_TOKEN_JSON");
  else if (fs.existsSync(tokenPath))   token = readJsonFile(tokenPath, "Gmail token file");
  else                                 return null;

  if (!token.refresh_token) {
    throw new GmailOtpError(`Gmail token has no refresh_token. ${authHelp()}`);
  }
  if (!token.client_id || !token.client_secret) {
    const keys = loadClientKeys(credentialsPath);
    if (!keys) {
      throw new GmailOtpError(`Gmail token lacks client_id/client_secret and no OAuth client JSON was provided (GMAIL_CREDENTIALS_JSON).`);
    }
    token = { ...token, client_id: keys.client_id, client_secret: keys.client_secret };
  }
  return { ...token, type: token.type ?? "authorized_user" };
}

function isNonInteractive(): boolean {
  return !!process.env.CI || process.env.GMAIL_OTP_NONINTERACTIVE === "true";
}

function authHelp(): string {
  return isNonInteractive()
    ? "Run `npm run gmail:auth` locally and update the GMAIL_TOKEN_JSON secret with the new token.json."
    : AUTH_HELP;
}

/**
 * Interactive consent via @google-cloud/local-auth; persists the refresh token
 * to `tokenPath`. Opens a browser — only for local runs by the account owner.
 */
export async function runInteractiveAuth(): Promise<void> {
  const { credentialsPath, tokenPath } = configManager.getGmailOtpConfig();
  const keys = requireClientKeys(credentialsPath);
  if (!fs.existsSync(credentialsPath)) {
    throw new GmailOtpError(`Interactive authorization needs the OAuth client file on disk at "${credentialsPath}".`);
  }

  // Lazy import — only needed on first-time authorization.
  const { authenticate } = await import("@google-cloud/local-auth");
  logger.info("[GmailOTP] Opening browser for one-time Gmail read-only authorization…");
  const client = await authenticate({ scopes: [GMAIL_READONLY_SCOPE], keyfilePath: credentialsPath });

  const refreshToken = client.credentials.refresh_token;
  if (!refreshToken) {
    throw new GmailOtpError(
      "Google did not return a refresh token. Remove this app's access at " +
      "https://myaccount.google.com/permissions, delete token.json, and authorize again."
    );
  }

  fs.writeFileSync(tokenPath, JSON.stringify({
    type:          "authorized_user",
    client_id:     keys.client_id,
    client_secret: keys.client_secret,
    refresh_token: refreshToken,
  }), { encoding: "utf8", mode: 0o600 });
  logger.info(`[GmailOTP] Authorization saved to ${tokenPath}`);
}

async function createGmailSource(): Promise<GmailMessageSource> {
  const { credentialsPath, tokenPath } = configManager.getGmailOtpConfig();

  let token = loadToken(credentialsPath, tokenPath);
  if (!token) {
    if (isNonInteractive()) {
      throw new GmailOtpError(
        `No Gmail token: GMAIL_TOKEN_JSON is not set and "${tokenPath}" does not exist ` +
        `(interactive auth is disabled on CI). ${authHelp()}`
      );
    }
    await runInteractiveAuth();
    token = loadToken(credentialsPath, tokenPath)!;
  }

  const auth = new google.auth.OAuth2(token.client_id, token.client_secret);
  auth.setCredentials({ refresh_token: token.refresh_token });
  const gmail = google.gmail({ version: "v1", auth });

  // Validate credentials once (also refreshes the access token).
  try {
    await gmail.users.getProfile({ userId: "me" });
  } catch (e: any) {
    throw new GmailOtpError(describeAuthError(e) ?? `Gmail API check failed: ${e?.message ?? e}`);
  }
  logger.info("[GmailOTP] Gmail API client authorized (read-only)");

  return {
    async listMessageIds(query, maxResults) {
      const res = await gmail.users.messages.list({ userId: "me", q: query, maxResults });
      return (res.data.messages ?? []).map(m => m.id!).filter(Boolean);
    },
    async getMessage(id) {
      const res = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      return res.data;
    },
  };
}

/**
 * Authorizes and caches the Gmail client. Call before triggering the OTP so
 * auth problems surface before an email is sent.
 */
export async function initGmailClient(): Promise<GmailMessageSource> {
  if (!cachedSource) {
    cachedSource = createGmailSource().catch(e => {
      cachedSource = null; // allow a retry after the user fixes credentials
      throw e;
    });
  }
  return cachedSource;
}

// ============================================================================
//  POLLING
// ============================================================================

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Polls Gmail for the newest OTP email received after `afterTimestamp`
 * (epoch ms, recorded just before the action that sends the OTP) and
 * returns the extracted code. Throws GmailOtpError on timeout/failure.
 */
export async function getLatestOtp(afterTimestamp: number, options: GetOtpOptions = {}): Promise<string> {
  const cfg = configManager.getGmailOtpConfig();
  const sender         = options.sender         ?? cfg.sender;
  const subject        = options.subject        ?? cfg.subject;
  const pattern        = options.otpPattern     ?? cfg.otpPattern;
  const timeoutMs      = options.timeoutMs      ?? cfg.timeoutMs;
  const pollIntervalMs = options.pollIntervalMs ?? cfg.pollIntervalMs;
  const clockSkewMs    = options.clockSkewMs    ?? cfg.clockSkewMs;
  const maxResults     = options.maxResults     ?? 10;

  if (!Number.isFinite(afterTimestamp) || afterTimestamp <= 0) {
    throw new GmailOtpError(`getLatestOtp: afterTimestamp must be epoch milliseconds, got "${afterTimestamp}"`);
  }
  if (pattern) toRegExp(pattern); // fail fast on a bad regex

  const source          = options.source ?? await initGmailClient();
  const minInternalDate = afterTimestamp - clockSkewMs;
  const query           = buildSearchQuery({ sender, subject, afterMs: minInternalDate });
  const deadline        = Date.now() + timeoutMs;

  // Messages already judged ineligible are not fetched again on later polls.
  const tooOld     = new Set<string>();
  const noCodeIds  = new Set<string>();
  let   attempts   = 0;
  let   lastApiErr = "";

  logger.info(`[GmailOTP] Waiting for OTP email | timeout: ${timeoutMs}ms | poll: ${pollIntervalMs}ms`);
  logger.debug(`[GmailOTP] query: ${query}`);

  while (true) {
    attempts++;
    try {
      const ids = (await source.listMessageIds(query, maxResults))
        .filter(id => !consumedMessageIds.has(id) && !tooOld.has(id) && !noCodeIds.has(id));

      const messages = await Promise.all(ids.map(id => source.getMessage(id)));
      for (const m of messages) {
        if (m.id && Number(m.internalDate) < minInternalDate) tooOld.add(m.id);
      }

      for (const msg of selectEligibleMessages(messages, minInternalDate)) {
        const otp = extractOtpFromMessage(msg, pattern);
        if (otp) {
          if (msg.id) consumedMessageIds.add(msg.id);
          const receivedAt = new Date(Number(msg.internalDate)).toISOString();
          logger.info(`[GmailOTP] OTP retrieved (email received ${receivedAt}, poll #${attempts})`);
          return otp;
        }
        if (msg.id) noCodeIds.add(msg.id);
        logger.warn("[GmailOTP] Matching email found but no OTP could be extracted — skipping it");
      }
    } catch (e: any) {
      if (e instanceof GmailOtpError) throw e;
      const authMsg = describeAuthError(e);
      if (authMsg) {
        cachedSource = null;
        throw new GmailOtpError(authMsg);
      }
      lastApiErr = String(e?.message ?? e).split("\n")[0];
      logger.warn(`[GmailOTP] Gmail API error on poll #${attempts} (will retry): ${lastApiErr}`);
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining));
  }

  const filters = [sender && `sender "${sender}"`, subject && `subject "${subject}"`].filter(Boolean).join(", ") || "no sender/subject filter";
  const hints: string[] = [];
  if (noCodeIds.size) {
    hints.push(`${noCodeIds.size} matching email(s) arrived but no OTP could be extracted — set GMAIL_OTP_PATTERN to match the email format`);
  }
  if (tooOld.size) {
    hints.push(`${tooOld.size} matching email(s) ignored because they were received before this login attempt`);
  }
  if (lastApiErr) hints.push(`last Gmail API error: ${lastApiErr}`);
  hints.push(
    "check the OTP was actually sent to the authorized Gmail account (Spam is not searched), " +
    "verify GMAIL_OTP_SENDER / GMAIL_OTP_SUBJECT, or raise GMAIL_OTP_TIMEOUT_MS"
  );

  throw new GmailOtpError(
    `OTP email not received within ${Math.round(timeoutMs / 1000)}s ` +
    `(${attempts} poll(s), ${filters}).\n - ${hints.join("\n - ")}`
  );
}

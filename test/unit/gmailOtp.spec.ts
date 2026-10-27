// Unit tests for src/utils/gmailOtp.ts — synthetic emails only, no Gmail/network.
import { test, expect } from "@playwright/test";
import type { gmail_v1 } from "googleapis";
import {
  extractOtp,
  extractOtpFromMessage,
  htmlToText,
  selectEligibleMessages,
  buildSearchQuery,
  getLatestOtp,
  resetGmailClientCache,
  loadToken,
  GmailMessageSource,
  GmailOtpError,
} from "@utils/gmailOtp";
import { assertSalesforceOrgUrl } from "@modules/saleForceLogin";

// ── Synthetic message builders ───────────────────────────────────────────────
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function plainMsg(id: string, internalDate: number, body: string, subject = "Verify your identity"): gmail_v1.Schema$Message {
  return {
    id, internalDate: String(internalDate),
    payload: {
      mimeType: "text/plain",
      headers: [{ name: "Subject", value: subject }],
      body: { data: b64url(body) },
    },
  };
}

function multipartMsg(id: string, internalDate: number, html: string, plain?: string): gmail_v1.Schema$Message {
  const alt: gmail_v1.Schema$MessagePart[] = [];
  if (plain !== undefined) alt.push({ mimeType: "text/plain", body: { data: b64url(plain) } });
  alt.push({ mimeType: "text/html", body: { data: b64url(html) } });
  return {
    id, internalDate: String(internalDate),
    payload: {
      mimeType: "multipart/mixed",
      headers: [{ name: "Subject", value: "Verify your identity" }],
      parts: [
        { mimeType: "multipart/alternative", parts: alt },
        { mimeType: "text/plain", filename: "terms.txt", body: { attachmentId: "att1" } },
      ],
    },
  };
}

function fakeSource(messages: gmail_v1.Schema$Message[]): GmailMessageSource & { listCalls: number } {
  const src = {
    listCalls: 0,
    async listMessageIds() { src.listCalls++; return messages.map(m => m.id!); },
    async getMessage(id: string) { return messages.find(m => m.id === id)!; },
  };
  return src;
}

const FAST = { timeoutMs: 300, pollIntervalMs: 20, clockSkewMs: 0 };

test.beforeEach(() => resetGmailClientCache());

// ── Extraction ───────────────────────────────────────────────────────────────
test.describe("extractOtp", () => {
  test("extracts code from Salesforce-style plain text", () => {
    const body = "To finish logging in, enter this verification code.\n\nVerification Code: 482913\n\nSalesforce, Inc., 415 Mission St, San Francisco, CA 94105 | 1-800-667-6389";
    expect(extractOtp(body)).toBe("482913");
  });

  test("supports '<code> is your verification code' wording", () => {
    expect(extractOtp("731045 is your one-time verification code.")).toBe("731045");
  });

  test("ignores timestamps, phone numbers, years and footer numbers", () => {
    const body = "Login attempt at 20261027 103045 from +1 415 555 0199. © 2026 Example Corp, PO Box 123456. Ref 987654.";
    expect(extractOtp(body)).toBeNull();
  });

  test("does not take a year after 'code of conduct'", () => {
    expect(extractOtp("Read our code of conduct 2026 edition.")).toBeNull();
  });

  test("returns null when no OTP present", () => {
    expect(extractOtp("Welcome to Salesforce! Your account is ready.")).toBeNull();
  });

  test("custom pattern uses capture group 1", () => {
    expect(extractOtp("PIN=AB12CD", "PIN=([A-Z0-9]{6})")).toBe("AB12CD");
  });

  test("invalid custom pattern throws a descriptive error", () => {
    expect(() => extractOtp("x", "([unclosed")).toThrow(/Invalid GMAIL_OTP_PATTERN/);
  });
});

test.describe("message body decoding", () => {
  test("HTML-only multipart email", () => {
    const html = `<html><head><style>.x{color:red}</style></head><body>
      <p>Verification&nbsp;Code:</p><p><b>605218</b></p><p>Call 1-800-555-0100</p></body></html>`;
    expect(extractOtpFromMessage(multipartMsg("m1", 1, html))).toBe("605218");
  });

  test("multipart/alternative prefers text/plain and skips attachments", () => {
    const msg = multipartMsg("m1", 1, "<p>Verification Code: 111111</p>", "Verification Code: 222222");
    expect(extractOtpFromMessage(msg)).toBe("222222");
  });

  test("htmlToText strips tags and decodes entities", () => {
    expect(htmlToText("<div>A&amp;B&#32;&lt;ok&gt;</div><script>x()</script>")).toBe("A&B <ok>");
  });
});

test.describe("selection helpers", () => {
  test("filters old messages and sorts newest first", () => {
    const res = selectEligibleMessages(
      [plainMsg("a", 1000, ""), plainMsg("b", 3000, ""), plainMsg("c", 2000, ""), plainMsg("old", 500, "")],
      1000,
    );
    expect(res.map(m => m.id)).toEqual(["b", "c", "a"]);
  });

  test("builds query with optional filters", () => {
    expect(buildSearchQuery({ afterMs: 120_000 })).toBe("after:60");
    expect(buildSearchQuery({ sender: "noreply@salesforce.com", subject: 'Verify "you"', afterMs: 120_000 }))
      .toBe('from:noreply@salesforce.com subject:"Verify you" after:60');
  });
});

// ── getLatestOtp with injected fake Gmail source ─────────────────────────────
test.describe("getLatestOtp", () => {
  const loginAt = 1_800_000_000_000;

  test("returns OTP from an email received after the login attempt", async () => {
    const src = fakeSource([plainMsg("new", loginAt + 4000, "Verification Code: 123987")]);
    await expect(getLatestOtp(loginAt, { ...FAST, source: src })).resolves.toBe("123987");
  });

  test("never uses an email received before the login attempt", async () => {
    const src = fakeSource([plainMsg("old", loginAt - 60_000, "Verification Code: 999999")]);
    const err = await getLatestOtp(loginAt, { ...FAST, source: src }).catch(e => e);
    expect(err).toBeInstanceOf(GmailOtpError);
    expect(err.message).toMatch(/received before this login attempt/);
    expect(err.message).not.toContain("999999");
  });

  test("selects the newest eligible email when several match", async () => {
    const src = fakeSource([
      plainMsg("stale",  loginAt - 30_000, "Verification Code: 100001"),
      plainMsg("first",  loginAt + 2000,   "Verification Code: 200002"),
      plainMsg("newest", loginAt + 9000,   "Verification Code: 300003"),
    ]);
    await expect(getLatestOtp(loginAt, { ...FAST, source: src })).resolves.toBe("300003");
  });

  test("skips a newer email without a code and falls back to the next eligible one", async () => {
    const src = fakeSource([
      plainMsg("otp",    loginAt + 2000, "Verification Code: 456456"),
      plainMsg("notice", loginAt + 5000, "New login to your account was detected."),
    ]);
    await expect(getLatestOtp(loginAt, { ...FAST, source: src })).resolves.toBe("456456");
  });

  test("does not return the same message twice in one process", async () => {
    const src = fakeSource([plainMsg("once", loginAt + 1000, "Verification Code: 777000")]);
    await expect(getLatestOtp(loginAt, { ...FAST, source: src })).resolves.toBe("777000");
    await expect(getLatestOtp(loginAt, { ...FAST, source: src })).rejects.toThrow(GmailOtpError);
  });

  test("times out with an actionable error when no email arrives", async () => {
    const src = fakeSource([]);
    const started = Date.now();
    const err = await getLatestOtp(loginAt, { ...FAST, source: src }).catch(e => e);
    expect(err).toBeInstanceOf(GmailOtpError);
    expect(err.message).toMatch(/OTP email not received within/);
    expect(err.message).toMatch(/GMAIL_OTP_TIMEOUT_MS/);
    expect(src.listCalls).toBeGreaterThan(1);           // polled repeatedly
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("reports eligible emails whose code could not be extracted", async () => {
    const src = fakeSource([plainMsg("nocode", loginAt + 1000, "Your account is ready.")]);
    const err = await getLatestOtp(loginAt, { ...FAST, source: src }).catch(e => e);
    expect(err.message).toMatch(/no OTP could be extracted.*GMAIL_OTP_PATTERN/);
  });

  test("waits for an email that arrives during polling", async () => {
    const inbox: gmail_v1.Schema$Message[] = [];
    const src = fakeSource(inbox);
    setTimeout(() => inbox.push(plainMsg("late", loginAt + 3000, "Your OTP: 135790")), 60);
    await expect(getLatestOtp(loginAt, { ...FAST, source: src })).resolves.toBe("135790");
  });

  test("keeps polling through transient Gmail API errors", async () => {
    let calls = 0;
    const msg = plainMsg("ok", loginAt + 1000, "Verification Code: 246810");
    const src: GmailMessageSource = {
      async listMessageIds() { if (++calls === 1) throw new Error("socket hang up"); return ["ok"]; },
      async getMessage() { return msg; },
    };
    await expect(getLatestOtp(loginAt, { ...FAST, source: src })).resolves.toBe("246810");
  });
});

// ── Token loading from CI secrets (GMAIL_TOKEN_JSON / GMAIL_CREDENTIALS_JSON) ─
test.describe("loadToken (CI secrets)", () => {
  const NO_FILE = "does-not-exist/none.json";
  const FAKE_TOKEN  = { type: "authorized_user", client_id: "cid", client_secret: "csecret", refresh_token: "fake-refresh" };
  const FAKE_CLIENT = { installed: { client_id: "cid2", client_secret: "csecret2" } };
  let saved: Record<string, string | undefined>;

  test.beforeEach(() => {
    saved = { t: process.env.GMAIL_TOKEN_JSON, c: process.env.GMAIL_CREDENTIALS_JSON };
    delete process.env.GMAIL_TOKEN_JSON;
    delete process.env.GMAIL_CREDENTIALS_JSON;
  });
  test.afterEach(() => {
    for (const [k, v] of [["GMAIL_TOKEN_JSON", saved.t], ["GMAIL_CREDENTIALS_JSON", saved.c]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  test("reads raw JSON from GMAIL_TOKEN_JSON", () => {
    process.env.GMAIL_TOKEN_JSON = JSON.stringify(FAKE_TOKEN);
    expect(loadToken(NO_FILE, NO_FILE)).toEqual(FAKE_TOKEN);
  });

  test("reads base64-encoded JSON", () => {
    process.env.GMAIL_TOKEN_JSON = Buffer.from(JSON.stringify(FAKE_TOKEN)).toString("base64");
    expect(loadToken(NO_FILE, NO_FILE)?.refresh_token).toBe("fake-refresh");
  });

  test("fills client id/secret from GMAIL_CREDENTIALS_JSON", () => {
    process.env.GMAIL_TOKEN_JSON = JSON.stringify({ refresh_token: "fake-refresh" });
    process.env.GMAIL_CREDENTIALS_JSON = JSON.stringify(FAKE_CLIENT);
    expect(loadToken(NO_FILE, NO_FILE)).toEqual({
      type: "authorized_user", refresh_token: "fake-refresh", client_id: "cid2", client_secret: "csecret2",
    });
  });

  test("returns null when no secret and no file", () => {
    expect(loadToken(NO_FILE, NO_FILE)).toBeNull();
  });

  test("invalid secret error does not echo the secret", () => {
    process.env.GMAIL_TOKEN_JSON = "{not-json super-secret-value";
    const err = (() => { try { loadToken(NO_FILE, NO_FILE); return null; } catch (e) { return e as Error; } })();
    expect(err).toBeInstanceOf(GmailOtpError);
    expect(err!.message).toMatch(/GMAIL_TOKEN_JSON is not valid JSON/);
    expect(err!.message).not.toContain("super-secret-value");
  });

  test("token without refresh_token is rejected", () => {
    process.env.GMAIL_TOKEN_JSON = JSON.stringify({ client_id: "a", client_secret: "b" });
    expect(() => loadToken(NO_FILE, NO_FILE)).toThrow(/no refresh_token/);
  });
});

// ── Salesforce org URL guard ─────────────────────────────────────────────────
test.describe("assertSalesforceOrgUrl", () => {
  test("accepts Salesforce domains", () => {
    expect(() => assertSalesforceOrgUrl("https://welcome.salesforce.com/")).not.toThrow();
    expect(() => assertSalesforceOrgUrl("https://acme.my.salesforce.com/")).not.toThrow();
    expect(() => assertSalesforceOrgUrl("https://acme--uat.sandbox.lightning.force.com/")).not.toThrow();
  });

  test("rejects non-Salesforce hosts such as the QA app", () => {
    expect(() => assertSalesforceOrgUrl("https://sandbox5101.projectlane.io/spa#/1/home")).toThrow(/not a Salesforce domain/);
    expect(() => assertSalesforceOrgUrl("https://salesforce.com.evil.example/")).toThrow(/not a Salesforce domain/);
  });

  test("enforces SALESFORCE_EXPECTED_HOST when set", () => {
    const prev = process.env.SALESFORCE_EXPECTED_HOST;
    process.env.SALESFORCE_EXPECTED_HOST = "acme.my.salesforce.com";
    try {
      expect(() => assertSalesforceOrgUrl("https://other.my.salesforce.com/")).toThrow(/does not match/);
      expect(() => assertSalesforceOrgUrl("https://acme.my.salesforce.com/")).not.toThrow();
    } finally {
      if (prev === undefined) delete process.env.SALESFORCE_EXPECTED_HOST; else process.env.SALESFORCE_EXPECTED_HOST = prev;
    }
  });
});

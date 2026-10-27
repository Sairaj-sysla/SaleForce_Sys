// scripts/gmail-auth.js
// ============================================================================
//  One-time Gmail read-only authorization for src/utils/gmailOtp.ts
//  Usage:  npm run gmail:auth
//  Opens a browser for Google consent and writes token.json (refresh token).
//  Never prints credential or token contents.
// ============================================================================

const fs   = require("fs");
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");
const { google }       = require("googleapis");

const SCOPES          = ["https://www.googleapis.com/auth/gmail.readonly"];
const credentialsPath = path.resolve(process.env.GMAIL_CREDENTIALS_PATH || "credentials.json");
const tokenPath       = path.resolve(process.env.GMAIL_TOKEN_PATH       || "token.json");

async function main() {
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`OAuth client file not found: ${credentialsPath}`);
  }
  const json = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  const keys = json.installed || json.web;
  if (!keys || !keys.client_id || !keys.client_secret) {
    throw new Error(`${credentialsPath} is not a Desktop app OAuth client file`);
  }

  console.log("Opening browser for Gmail read-only consent — sign in with the dedicated test account…");
  const client = await authenticate({ scopes: SCOPES, keyfilePath: credentialsPath });
  if (!client.credentials.refresh_token) {
    throw new Error(
      "No refresh token returned. Remove the app at https://myaccount.google.com/permissions and run again."
    );
  }

  fs.writeFileSync(tokenPath, JSON.stringify({
    type:          "authorized_user",
    client_id:     keys.client_id,
    client_secret: keys.client_secret,
    refresh_token: client.credentials.refresh_token,
  }), { encoding: "utf8", mode: 0o600 });

  // Verify the saved token works.
  const auth    = new google.auth.OAuth2(keys.client_id, keys.client_secret);
  auth.setCredentials({ refresh_token: client.credentials.refresh_token });
  const gmail   = google.gmail({ version: "v1", auth });
  const profile = await gmail.users.getProfile({ userId: "me" });
  console.log(`✅ Authorized Gmail account ${profile.data.emailAddress} — token saved to ${tokenPath}`);
}

main().catch(err => {
  console.error(`❌ Gmail authorization failed: ${err.message}`);
  process.exit(1);
});

# Syslatech Salesforce — Playwright + TypeScript

Enterprise Playwright framework (BasePage, custom logger, auto-heal, enterprise/Allure reporters)
with Salesforce login automation that reads the identity-verification OTP from Gmail.

## Local setup

```powershell
npm ci
npx playwright install chromium
Copy-Item .env.example .env.dev      # then fill in PLAYWRIGHT_USERNAME / PLAYWRIGHT_PASSWORD
npm run gmail:auth                   # one-time Gmail consent → token.json
npm run test:otp-unit                # OTP utility unit tests (no network)
$env:ENVIRONMENT = "dev"; npx playwright test test/saleforce.spec.ts --headed
```

- `ENVIRONMENT` selects `src/config/env.<env>.ts` (`dev` = Salesforce, `qa` = default locally).
  Unknown values fail fast; on CI it must be set explicitly.
- Secrets load from `.env` and `.env.<env>` (git-ignored). Shell/CI variables override them.
- `credentials.json`, `token.json`, `.env*` and generated reports/logs are git-ignored — never commit them.

## Running on GitHub Actions

Workflow: `.github/workflows/playwright.yml` — runs headless on `ubuntu-latest`.

| Job | What it does |
|---|---|
| `unit-tests` | Gmail OTP parsing/selection unit tests (synthetic emails, no secrets) |
| `salesforce-login` | Real login via `test/saleforce.spec.ts` → `SaleForceLogin` → `getLatestOtp` |

The cloud job never runs `npm run gmail:auth`; it uses a token you authorize once locally.

### 1. Create the Gmail token locally (one time)

1. In Google Cloud Console: enable the **Gmail API**; OAuth client type **Desktop app**; save it as `credentials.json`.
2. Run `npm run gmail:auth` and sign in with the **dedicated test Gmail account** (scope: `gmail.readonly`).
3. This writes `token.json` (contains a refresh token — treat it like a password).

> If the OAuth consent screen is in **Testing** status, Google expires refresh tokens after **7 days**.
> Publish the app to "In production" (no verification needed for a personal test account) or
> re-run `npm run gmail:auth` and update the secret when the job reports `invalid_grant`.

### 2. Add repository secrets

GitHub → repository → **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Required | Value |
|---|---|---|
| `SALESFORCE_BASE_URL` | ✅ | Salesforce login URL, e.g. `https://yourorg.my.salesforce.com/` |
| `SALESFORCE_USERNAME` | ✅ | Salesforce test user |
| `SALESFORCE_PASSWORD` | ✅ | Salesforce test user password |
| `GMAIL_TOKEN_JSON` | ✅ | Full contents of `token.json` (raw JSON or base64) |
| `GMAIL_CREDENTIALS_JSON` | optional | Contents of `credentials.json` — only needed if the token lacks `client_id`/`client_secret` |
| `SALESFORCE_EXPECTED_HOST` | optional | e.g. `yourorg.my.salesforce.com` — login aborts if the base URL host differs |
| `GMAIL_OTP_SENDER` | optional | e.g. `noreply@salesforce.com` |
| `GMAIL_OTP_SUBJECT` | optional | e.g. `Verify your identity` |
| `GMAIL_OTP_TIMEOUT_MS` | optional | default `90000` |
| `GMAIL_OTP_POLL_INTERVAL_MS` | optional | default `5000` |
| `GMAIL_OTP_PATTERN` | optional | regex, capture group 1 = OTP (default matches "Verification Code: 123456") |

With the GitHub CLI (values are read from files/prompts, not echoed):

```powershell
gh secret set GMAIL_TOKEN_JSON       < token.json
gh secret set GMAIL_CREDENTIALS_JSON < credentials.json
gh secret set SALESFORCE_BASE_URL
gh secret set SALESFORCE_USERNAME
gh secret set SALESFORCE_PASSWORD
```

### 3. Trigger the workflow

- **Manual:** Actions → *Salesforce Login (Gmail OTP)* → **Run workflow** (or `gh workflow run playwright.yml`).
- **Automatic:** pushes and same-repo pull requests to `main`/`master`. Fork PRs run unit tests only.
- Runs are serialized (`concurrency`) so two logins never race for the same OTP inbox.

### 4. Results

Artifacts (7-day retention): `salesforce-login-results` — Playwright HTML report, enterprise report,
Allure results, JUnit XML, logs, and on failure screenshots/traces/videos.

> Traces and videos can capture typed field values. Keep the repository **private**.
> OTPs, passwords and tokens are masked in framework logs; GitHub also masks secret values.

### Troubleshooting

| Message | Fix |
|---|---|
| `Missing repository secrets: …` | Add the listed secrets. |
| `invalid_grant` / token expired or revoked | Re-run `npm run gmail:auth` locally, update `GMAIL_TOKEN_JSON`. |
| `OTP email not received within 90s` | Check the Salesforce user's email is the authorized Gmail account, the sender/subject filters, and Spam (not searched). |
| `no OTP could be extracted` | Set `GMAIL_OTP_PATTERN` (capture group 1 = code). |
| `not a Salesforce domain` / `does not match SALESFORCE_EXPECTED_HOST` | Fix `SALESFORCE_BASE_URL` / `ENVIRONMENT=dev`. |

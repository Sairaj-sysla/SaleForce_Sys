// ============================================================================
//  ENTERPRISE HTML REPORTER — Plain JavaScript (no compilation needed)
//  Place at: reports/enterprise-reporter.js
//  Add to playwright.config.ts:
//     ["./reports/enterprise-reporter.js", { outputFolder: "enterprise-report" }]
// ============================================================================

"use strict";
const fs   = require("fs");
const path = require("path");

console.log('🧪 Enterprise Reporter loaded');

class EnterpriseReporter {

  constructor(options) {
    this.suites    = new Map();
    this.startTime = Date.now();
    this.outputDir = (options && options.outputFolder) || "playwright-report";
  }

  onBegin(config, suite) {
    this.startTime = Date.now();
  }

  onTestEnd(test, result) {
    const file     = test.location?.file;
    if (!file) {
      return;
    }
    const fileBase = path.basename(file);
    const suiteKey = fileBase;

    if (!this.suites.has(suiteKey)) {
      this.suites.set(suiteKey, {
        title:   test.parent?.title ?? fileBase,
        file:    fileBase,
        tests:   [],
        passed:  0,
        failed:  0,
        skipped: 0,
      });
    }

    const suite = this.suites.get(suiteKey);

    const steps = (result.steps || [])
      .filter(s =>
        !s.title.startsWith("Before Hooks") &&
        !s.title.startsWith("After Hooks")  &&
        !s.title.startsWith("Worker Cleanup") &&
        !s.title.startsWith("Fixture") &&
        !s.title.startsWith("Attach")
      )
      .map(s => ({
        title:    s.title,
        status:   s.error ? "failed" : "passed",
        duration: s.duration,
        error:    s.error?.message?.split("\n")[0],
      }));

    const attachments = (result.attachments || []).map(a => {
      const rec = { name: a.name, contentType: a.contentType, body: null };
      if (a.path && fs.existsSync(a.path)) {
        if (a.contentType.startsWith("image/")) {
          rec.body = fs.readFileSync(a.path).toString("base64");
        } else if (a.contentType === "text/plain") {
          rec.body = fs.readFileSync(a.path, "utf8");
        }
      } else if (a.body) {
        if (a.contentType.startsWith("image/")) {
          rec.body = Buffer.isBuffer(a.body) ? a.body.toString("base64") : a.body;
        } else {
          rec.body = Buffer.isBuffer(a.body) ? a.body.toString("utf8") : a.body;
        }
      }
      return rec;
    });

    let stepLogsMap = new Map();
    const metadataAttachments = attachments.filter(a => a.name.startsWith("Step Metadata - "));
    for (const att of metadataAttachments) {
      try {
        const parsed = JSON.parse(att.body);
        if (parsed && typeof parsed === "object") {
          const stepTitle = parsed.stepTitle || "unknown";
          stepLogsMap.set(stepTitle, {
            logs:     parsed.logs || "",
            duration: parsed.duration,
            status:   parsed.status,
            actions:  parsed.actions || [],
            autoHeal: parsed.autoHeal || [],
          });
        }
      } catch {
        // ignore
      }
    }

    const annotations = (test.annotations || []).map(a => ({
      type:        a.type,
      description: a.description ?? "",
    }));

    let stepMetadata = { actions: [], autoHeal: [] };
    const testMetadataAttachment = attachments.find(a => a.name === "Step Metadata");
    if (testMetadataAttachment?.body) {
      try {
        const parsed = JSON.parse(testMetadataAttachment.body);
        if (parsed && typeof parsed === "object") {
          stepMetadata = {
            actions:  Array.isArray(parsed.actions)  ? parsed.actions  : [],
            autoHeal: Array.isArray(parsed.autoHeal) ? parsed.autoHeal : [],
          };
        }
      } catch {
        // ignore
      }
    }

    const record = {
      id:          `${suiteKey}-${suite.tests.length}`,
      title:       test.title,
      suite:       test.parent?.title ?? fileBase,
      file:        fileBase,
      status:      result.status,
      duration:    result.duration,
      retry:       result.retry || 0,
      steps,
      attachments,
      annotations,
      error:       result.errors?.[0]?.message?.split("\n")[0] || null,
      stepMetadata,
      stepLogsMap,
    };

    suite.tests.push(record);
    if (result.status === "passed")  suite.passed++;
    else if (result.status === "skipped") suite.skipped++;
    else suite.failed++;
  }

  async onEnd(result) {
    console.log("\n==================================================");
    console.log("🚀 [ENTERPRISE REPORTER] Starting Generation...");
    console.log("==================================================");

    let allTests = [];
    let totalTests = 0;
    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let totalDur = 0;
    let passRate = 0;
    let nowIST = "";
    let suiteCards = "";
    let html = "";

    try {
      allTests = [...this.suites.values()].flatMap(s => s.tests);
      totalTests = allTests.length;
      totalPassed  = allTests.filter(t => t.status === "passed").length;
      totalFailed  = allTests.filter(t => t.status !== "passed" && t.status !== "skipped").length;
      totalSkipped = allTests.filter(t => t.status === "skipped").length;
      totalDur     = Date.now() - this.startTime;
      passRate     = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0;

      nowIST = new Date(Date.now() + 5.5 * 3600000)
        .toISOString().replace("T", " ").replace(/\.\d+Z/, "") + " IST";

      if (totalTests > 0) {
        for (const suite of this.suites.values()) {
          this.validateSuiteCards(suite);
          for (const test of suite.tests) {
            this.validateSteps(test);
            this.validateAttachments(test);
            this.validateAnnotations(test);
          }
        }
      }

      suiteCards = [...this.suites.values()].map(s => this.buildSuiteCard(s)).join("\n");
      
      html = this.buildHTML({
        totalTests, totalPassed, totalFailed, totalSkipped,
        totalDur, passRate, nowIST, suiteCards,
        status: result?.status || (totalFailed > 0 ? "failed" : "passed"),
      });

      const targetDir = path.join(process.cwd(), this.outputDir);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const outFile = path.join(targetDir, "enterprise-report.html");

      fs.writeFileSync(outFile, html, "utf8");

      console.log(`
==================================================
📊 Enterprise Report Generated
==================================================

Open Report:

.\\${this.outputDir}\\enterprise-report.html

Or

ii .\\${this.outputDir}\\enterprise-report.html

==================================================
`);

    } catch (error) {
      console.error("\n❌ [CRITICAL] Enterprise HTML Compilation or storage process failed!");
      console.error(`Reason: ${error.message}`);
      console.error(error.stack);
      
      this.generateFallbackReport(path.join(process.cwd(), this.outputDir), "enterprise-report.html", error, {
        totalTests, totalPassed, totalFailed, totalSkipped, nowIST
      });
    }
  }

  validateSteps(test) {
    if (!Array.isArray(test.steps)) throw new Error(`Test object instance '${test.title}' contains an unparseable steps structure.`);
  }

  validateAttachments(test) {
    if (!Array.isArray(test.attachments)) throw new Error(`Test object instance '${test.title}' contains an unparseable attachments block.`);
  }

  validateAnnotations(test) {
    if (!Array.isArray(test.annotations)) throw new Error(`Test object instance '${test.title}' contains an unparseable annotations structure.`);
  }

  validateSuiteCards(suite) {
    if (!suite || !suite.title || !Array.isArray(suite.tests)) {
      throw new Error("Suite baseline architecture structural parsing validation fault.");
    }
  }

  generateFallbackReport(targetDir, outFile, error, metrics) {
    const fullPath = path.join(targetDir, outFile);
    try {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const fallbackHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Reporter Failure Fallback</title>
  <style>
    body { font-family: monospace; background: #1a0505; color: #ffcccc; padding: 40px; line-height: 1.5; }
    .card { background: #2d0d0d; border: 2px solid #ff4444; padding: 24px; border-radius: 8px; max-width: 1000px; margin: 0 auto; }
    h1 { color: #ff4444; margin-top: 0; border-bottom: 1px solid #ff4444; padding-bottom: 10px;}
    pre { background: #000; padding: 16px; border-radius: 4px; overflow-x: auto; color: #ff6666; border: 1px solid #551111; }
    .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 20px; color: #ffaa99; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚠️ Enterprise Reporter Compilation Failure</h1>
    <p>The custom HTML reporter crashed while processing telemetry data. Raw metrics preserved below.</p>
    <div class="meta">
      <div><strong>Timestamp:</strong> ${metrics.nowIST || new Date().toISOString()}</div>
      <div><strong>Total Tests Processed:</strong> ${metrics.totalTests || 0} (P: ${metrics.totalPassed || 0}, F: ${metrics.totalFailed || 0})</div>
    </div>
    <h3>Error Details</h3>
    <p><strong>Message:</strong> ${error.message}</p>
    <h3>Stack Trace</h3>
    <pre>${error.stack || "No trace context array evaluated."}</pre>
  </div>
</body>
</html>`;

      fs.writeFileSync(fullPath, fallbackHtml, "utf8");
      console.log(`🚨 Emergency Fallback Report Written to → ${fullPath}`);
    } catch (fallbackError) {
      console.error(`[FATAL] Hardware context error preventing filesystem interaction entries entirely: ${fallbackError.message}`);
    }
  }

  esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  dur(ms) {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  }

  parseFailureAnnotation(text) {
    const lines = text.split("\n");
    const result = {};
    for (const line of lines) {
      const m = line.match(/^\s*([\w ]+?)\s*:\s*(.+)$/);
      if (m) result[m[1].trim().toLowerCase()] = m[2].trim();
    }
    return result;
  }

  buildSuiteCard(suite) {
    const cards = suite.tests.map(t => this.buildTestCard(t)).join("\n");
    return `
<div class="suite" data-suite>
  <div class="suite-hdr">
    <span class="suite-icon">📁</span>
    <span class="suite-title">${this.esc(suite.title)}</span>
    <div class="chips">
      <span class="chip pass">✅ ${suite.passed}</span>
      <span class="chip fail">❌ ${suite.failed}</span>
      ${suite.skipped ? `<span class="chip skip">⏭ ${suite.skipped}</span>` : ""}
    </div>
  </div>
  ${cards}
</div>`;
  }

  buildTestCard(t) {
    const icon   = t.status === "passed" ? "✅" : t.status === "skipped" ? "⏭" : "❌";
    const status = t.status === "passed" ? "passed" : t.status === "skipped" ? "skipped" : "failed";

    const stepsHtml = t.steps.length > 0 ? `
<div class="section">
  <div class="sec-label">Test Steps</div>
  ${t.steps.map(s => {
    const stepLogs = t.stepLogsMap?.get(s.title) || null;
    const logHtml = stepLogs?.logs ? `
      <details style="margin-left:auto; width:100%;">
        <summary style="cursor:pointer; color:#8892a4; font-size:11px;">📋 Logs</summary>
        <pre style="margin-top:6px; background:#141622; padding:8px; border-radius:4px; font-size:11px; white-space:pre-wrap; word-break:break-all; max-height:300px; overflow-y:auto;">${this.esc(stepLogs.logs)}</pre>
      </details>
    ` : '';
    return `
    <div class="step-row ${s.status === "failed" ? "step-fail" : "step-pass"}">
      <span>${s.status === "failed" ? "❌" : "✅"}</span>
      <span class="step-txt">${this.esc(s.title)}</span>
      <span class="step-dur">${this.dur(s.duration)}</span>
      ${logHtml}
    </div>`;
  }).join("")}
</div>` : "";

    const actions = t.stepMetadata?.actions || [];
    const actionHtml = actions.length > 0 ? `
<div class="section">
  <div class="sec-label">Actions Executed</div>
  ${actions.map(a => `
  <div class="step-row step-pass">
    <span>⚡</span>
    <span class="step-txt">${this.esc(a)}</span>
  </div>`).join("")}
</div>` : "";

    const autoHeal = t.stepMetadata?.autoHeal || [];
    const autoHealHtml = autoHeal.length > 0 ? `
<div class="section">
  <div class="sec-label">Auto Heal</div>
  ${autoHeal.map(a => `
  <div class="step-row">
    <span>🩹</span>
    <span class="step-txt">${this.esc(a)}</span>
  </div>`).join("")}
</div>` : "";

    const failAnn = t.annotations.find(a => a.type === "tc-step-failed");
    let failHtml = "";
    if (failAnn) {
      const d = this.parseFailureAnnotation(failAnn.description);
      const row = (k, v, cls) => v ? `
        <div class="fd-key">${k}</div>
        <div class="fd-val ${cls||""}">${this.esc(v)}</div>` : "";
      failHtml = `
<div class="section">
  <div class="fail-card">
    <div class="fail-hdr">❌ FAILED STEP DETAIL</div>
    <div class="fail-grid">
      ${row("Step",    d["step"],    "")}
      ${row("Source",  d["source"],  "")}
      ${row("Duration", d["duration"], "")}
      <div class="fd-div"></div>
      ${row("Element",  d["element"],  "")}
      ${row("Expected", d["expected"], "fd-pass")}
      ${row("Actual",   d["actual"],   "fd-fail")}
      ${row("Locator",  d["locator"],  "")}
      ${row("AutoHeal", d["autoheal"], "fd-heal")}
      <div class="fd-div"></div>
      ${row("Error",    d["error"],    "fd-warn")}
    </div>
  </div>
</div>`;
    }

    const ss = t.attachments.find(a =>
      a.name === "failure-screenshot" || (a.name.includes("screenshot") && a.contentType?.startsWith("image/"))
    );
    const ssHtml = ss?.body ? `
<div class="section">
  <div class="sec-label">Screenshot</div>
  <img class="screenshot" src="data:${ss.contentType};base64,${ss.body}"
       onclick="openLb(this.src)" alt="screenshot">
</div>` : "";

    const logAnn = t.annotations.find(a => a.type === "tc-execution-log");
    const logAtt = t.attachments.find(a => a.name === "tc-logs");
    const logText = logAnn?.description || logAtt?.body || "";
    const logHtml = logText ? `
<div class="section">
  <div class="log-toggle" onclick="toggleLog('${t.id}')">
    📋 Full Execution Log &nbsp;<span style="margin-left:auto;font-size:10px">▼</span>
  </div>
  <div class="log-body" id="log-${t.id}">
    ${logText.split("\n").map(line => {
      let cls = "";
      if (line.includes("[INFO]"))  cls = "li";
      else if (line.includes("[PASS]"))  cls = "lp";
      else if (line.includes("[ERROR]") || line.includes("[FAIL]")) cls = "le";
      else if (line.includes("[WARN]"))  cls = "lw";
      else if (line.includes("[STEP]"))  cls = "ls";
      else if (line.includes("[AutoHeal]")) cls = "lh";
      return `<div class="${cls}">${this.esc(line)}</div>`;
    }).join("")}
  </div>
</div>` : "";

    return `
<div class="tc ${status}" data-id="${t.id}" data-status="${status}" data-title="${this.esc(t.title)}">
  <div class="tc-hdr" onclick="toggle('${t.id}')">
    <span class="dot dot-${status}"></span>
    <span class="tc-title">${icon} ${this.esc(t.title)}</span>
    <div class="tc-meta">
      ${t.retry > 0 ? `<span class="retry-badge">Retry ${t.retry}</span>` : ""}
      <span class="dur-badge">${this.dur(t.duration)}</span>
      <span class="chev" id="chev-${t.id}">▶</span>
    </div>
  </div>
  <div class="tc-body" id="body-${t.id}">
    ${stepsHtml}
    ${actionHtml}
    ${autoHealHtml}
    ${failHtml}
    ${ssHtml}
    ${logHtml}
  </div>
</div>`;
  }

  buildHTML(d) {
    // ── Branding: only the logo (larger) and subtitle below ──────────────
    const brandHtml = `
      <div style="display:flex; flex-direction:column; align-items:flex-start; gap:4px;">
        <img src="https://syslatech.com/Images/Logo.png" 
             alt="SyslaTech" 
             style="height:60px; width:auto; object-fit:contain;">
        <div class="brand-sub">QA Execution Report • Playwright TypeScript Automation Framework</div>
      </div>
    `;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA Execution Report</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0f1117;--sur:#1a1d27;--sur2:#222536;--bdr:#2e3147;
  --acc:#4f6ef7;--acc2:#7c5cfc;
  --pass:#22c55e;--fail:#ef4444;--skip:#f59e0b;--warn:#f97316;
  --txt:#e2e8f0;--muted:#8892a4;--code:#141622;
  --r:8px;--r2:14px;
  --mono:"JetBrains Mono","Fira Code",monospace;
  --sans:"Inter","Segoe UI",system-ui,sans-serif;
}
body{font-family:var(--sans);background:var(--bg);color:var(--txt);font-size:14px;line-height:1.6}

.hdr{background:linear-gradient(135deg,#1a1d27,#141622);border-bottom:1px solid var(--bdr);padding:28px 40px}
.hdr-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:16px}
.brand{display:flex;flex-direction:column;align-items:flex-start;gap:4px}
.brand-sub{font-size:12px;color:var(--muted)}
.run-meta{text-align:right;font-size:12px;color:var(--muted);line-height:1.8}
.run-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;margin-top:6px}
.run-badge.passed{background:rgba(34,197,94,.15);color:var(--pass);border:1px solid rgba(34,197,94,.3)}
.run-badge.failed{background:rgba(239,68,68,.15);color:var(--fail);border:1px solid rgba(239,68,68,.3)}

.sum-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:16px;margin-bottom:20px}
.sum-card{background:var(--sur2);border:1px solid var(--bdr);border-radius:var(--r);padding:16px 20px}
.sum-card .lbl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px}
.sum-card .val{font-size:28px;font-weight:700;font-family:var(--mono)}
.sum-card.c-pass .val{color:var(--pass)}.sum-card.c-fail .val{color:var(--fail)}
.sum-card.c-skip .val{color:var(--skip)}.sum-card.c-rate .val{color:var(--acc)}
.sum-card.c-tot  .val{color:var(--txt)}
.prog{height:4px;background:var(--sur2);border-radius:2px;overflow:hidden}
.prog-fill{height:100%;background:linear-gradient(90deg,var(--pass),var(--acc));border-radius:2px}

.main{padding:32px 40px;max-width:1400px;margin:0 auto}

.fbar{display:flex;gap:8px;margin-bottom:24px;align-items:center;flex-wrap:wrap}
.fbtn{padding:6px 16px;border-radius:20px;border:1px solid var(--bdr);background:var(--sur);color:var(--muted);cursor:pointer;font-size:13px;font-family:var(--sans);transition:all .15s;white-space:nowrap}
.fbtn:hover,.fbtn.active{background:var(--acc);border-color:var(--acc);color:#fff}
.fbtn.ff.active{background:var(--fail);border-color:var(--fail)}
.fbtn.fp.active{background:var(--pass);border-color:var(--pass)}
.fbtn.fs.active{background:var(--skip);border-color:var(--skip)}
.srch{flex:1;min-width:150px;padding:6px 14px;border-radius:20px;border:1px solid var(--bdr);background:var(--sur);color:var(--txt);font-size:13px;font-family:var(--sans);outline:none}
.srch:focus{border-color:var(--acc)}

.suite{margin-bottom:32px}
.suite-hdr{display:flex;align-items:center;gap:10px;padding:10px 16px;background:var(--sur);border:1px solid var(--bdr);border-radius:var(--r);margin-bottom:12px;flex-wrap:wrap}
.suite-icon{font-size:16px}
.suite-title{flex:1;font-weight:600;font-size:14px}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.chip{padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.chip.pass{background:rgba(34,197,94,.12);color:var(--pass)}
.chip.fail{background:rgba(239,68,68,.12);color:var(--fail)}
.chip.skip{background:rgba(245,158,11,.12);color:var(--skip)}

.tc{background:var(--sur);border:1px solid var(--bdr);border-radius:var(--r2);margin-bottom:10px;overflow:hidden;transition:border-color .15s}
.tc:hover{border-color:var(--acc)}
.tc.passed{border-left:3px solid var(--pass)}
.tc.failed{border-left:3px solid var(--fail)}
.tc.skipped{border-left:3px solid var(--skip)}
.tc-hdr{display:flex;align-items:center;padding:14px 18px;cursor:pointer;user-select:none;gap:12px;flex-wrap:wrap}
.tc-hdr:hover{background:rgba(255,255,255,.03)}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot-passed{background:var(--pass);box-shadow:0 0 6px var(--pass)}
.dot-failed{background:var(--fail);box-shadow:0 0 6px var(--fail)}
.dot-skipped{background:var(--skip)}
.tc-title{flex:1;font-weight:500;font-size:14px}
.tc-meta{display:flex;align-items:center;gap:10px;font-size:12px;flex-wrap:wrap}
.dur-badge{font-family:var(--mono);font-size:11px;padding:2px 8px;background:var(--sur2);border-radius:10px}
.retry-badge{font-size:11px;padding:2px 8px;background:rgba(245,158,11,.12);color:var(--skip);border-radius:10px}
.chev{font-size:10px;color:var(--muted);transition:transform .2s}
.chev.open{transform:rotate(90deg)}

.tc-body{display:none;padding:0 18px 18px;border-top:1px solid var(--bdr)}
.tc-body.open{display:block}
.section{margin-top:16px}
.sec-label{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:8px;font-weight:600}

.step-row{display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:6px;margin-bottom:4px;font-size:13px;background:var(--sur2);flex-wrap:wrap}
.step-fail{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2)}
.step-pass{background:rgba(34,197,94,.05)}
.step-txt{flex:1;font-family:var(--mono);font-size:12px}
.step-dur{font-family:var(--mono);font-size:11px;color:var(--muted)}

details summary { outline: none; }
details summary::-webkit-details-marker { color: #8892a4; }

.fail-card{background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.25);border-radius:var(--r);overflow:hidden}
.fail-hdr{display:flex;align-items:center;gap:8px;padding:10px 16px;background:rgba(239,68,68,.1);font-weight:600;font-size:13px;color:var(--fail)}
.fail-grid{display:grid;grid-template-columns:110px 1fr;gap:0;padding:12px 16px}
.fd-key{font-size:12px;color:var(--muted);padding:5px 0;font-weight:500}
.fd-val{font-size:12px;font-family:var(--mono);padding:5px 0;color:var(--txt);word-break:break-all}
.fd-pass{color:var(--pass)}.fd-fail{color:var(--fail)}.fd-warn{color:var(--warn)}.fd-heal{color:var(--acc2)}
.fd-div{grid-column:1/-1;height:1px;background:rgba(239,68,68,.15);margin:4px 0}

.log-toggle{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--sur2);border:1px solid var(--bdr);border-radius:6px;cursor:pointer;font-size:12px;color:var(--muted);user-select:none}
.log-toggle:hover{border-color:var(--acc);color:var(--txt)}
.log-body{display:none;margin-top:6px;padding:12px 14px;background:var(--code);border:1px solid var(--bdr);border-radius:6px;font-family:var(--mono);font-size:11px;line-height:1.7;max-height:320px;overflow-y:auto;white-space:pre-wrap;word-break:break-all}
.log-body.open{display:block}
.li{color:#67e8f9}.lp{color:var(--pass)}.le{color:var(--fail)}.lw{color:var(--skip)}.ls{color:var(--txt);font-weight:600}.lh{color:var(--acc2)}

.screenshot{max-width:100%;border-radius:6px;border:1px solid var(--bdr);cursor:pointer;transition:opacity .15s;margin-top:6px}
.screenshot:hover{opacity:.85}

.lb{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1000;align-items:center;justify-content:center;cursor:zoom-out}
.lb.open{display:flex}
.lb img{max-width:90vw;max-height:90vh;border-radius:8px}

.footer{text-align:center;padding:24px;border-top:1px solid var(--bdr);font-size:12px;color:var(--muted)}

::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:var(--sur)}
::-webkit-scrollbar-thumb{background:var(--bdr);border-radius:3px}
</style>
</head>
<body>

<div class="hdr">
  <div class="hdr-top">
    <div class="brand">
      ${brandHtml}
    </div>
    <div class="run-meta">
      <div>Generated: ${d.nowIST}</div>
      <div>Duration: ${(d.totalDur/1000).toFixed(1)}s</div>
      <div><span class="run-badge ${d.status === "passed" ? "passed" : "failed"}">${d.status === "passed" ? "✅" : "❌"} ${d.status.toUpperCase()}</span></div>
    </div>
  </div>
  <div class="sum-grid">
    <div class="sum-card c-tot"><div class="lbl">Total Tests</div><div class="val">${d.totalTests}</div></div>
    <div class="sum-card c-pass"><div class="lbl">Passed</div><div class="val">${d.totalPassed}</div></div>
    <div class="sum-card c-fail"><div class="lbl">Failed</div><div class="val">${d.totalFailed}</div></div>
    <div class="sum-card c-skip"><div class="lbl">Skipped</div><div class="val">${d.totalSkipped}</div></div>
    <div class="sum-card c-rate"><div class="lbl">Pass Rate</div><div class="val">${d.passRate}%</div></div>
  </div>
  <div class="prog"><div class="prog-fill" style="width:${d.passRate}%"></div></div>
</div>

<div class="main">
  <div class="fbar">
    <button class="fbtn active"  onclick="filt('all',this)">All (${d.totalTests})</button>
    <button class="fbtn ff" onclick="filt('failed',this)">❌ Failed (${d.totalFailed})</button>
    <button class="fbtn fp" onclick="filt('passed',this)">✅ Passed (${d.totalPassed})</button>
    <button class="fbtn fs" onclick="filt('skipped',this)">⏭ Skipped (${d.totalSkipped})</button>
    <input class="srch" type="text" id="searchInput" placeholder="🔍  Search tests..." oninput="srch(this.value)">
  </div>
  ${d.suiteCards}
</div>

<div class="footer">Enterprise QA Report • Playwright TypeScript Framework • ${d.nowIST}</div>

<div class="lb" id="lb" onclick="closeLb()"><img id="lb-img" src="" alt="screenshot"></div>

<script>
function toggle(id){
  document.getElementById('body-'+id).classList.toggle('open');
  document.getElementById('chev-'+id).classList.toggle('open');
}
function toggleLog(id){
  document.getElementById('log-'+id).classList.toggle('open');
}
function filt(status,btn){
  document.querySelectorAll('.fbtn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.tc').forEach(c=>{
    c.style.display=status==='all'?'':c.dataset.status===status?'':'none';
  });
  updSuites();
}
function srch(q){
  const lq=q.toLowerCase().trim();
  document.querySelectorAll('.tc').forEach(c=>{
    const title = c.dataset.title ? c.dataset.title.toLowerCase() : '';
    c.style.display = title.includes(lq) ? '' : 'none';
  });
  updSuites();
}
function updSuites(){
  document.querySelectorAll('.suite').forEach(s=>{
    const visible = [...s.querySelectorAll('.tc')].some(c=>c.style.display!=='none');
    s.style.display = visible ? '' : 'none';
  });
}
function openLb(src){document.getElementById('lb-img').src=src;document.getElementById('lb').classList.add('open')}
function closeLb(){document.getElementById('lb').classList.remove('open')}
// ❌ REMOVED auto-open of failed tests – everything stays collapsed by default
</script>
</body>
</html>`;
  }
}

module.exports = EnterpriseReporter;
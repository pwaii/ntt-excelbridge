/**
 * Screenshots quality and transformation review pages with mocked API.
 * Usage: node scripts/screenshot.mjs
 */
import { chromium } from "playwright-core";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdir } from "fs/promises";

const baseUrl = "http://localhost:5173";
const jobId = "11111111-1111-4111-8111-111111111111";
const outDir = join(dirname(fileURLToPath(import.meta.url)), "../screenshots");
const chromiumExe = "C:\\Users\\bower\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe";

const baseJob = {
  job_id: jobId, owner_id: "local-user", revision: 7,
  config: { comment_name: "Profit", output_header: "profit", standardize: false, update: false, conflict_policy: "reject_all", input_sheet: null, main_sheet: null, key_column: null, input_header_row: null, main_header_row: null, main_key_column: null },
  configuration_confirmed: true, workbook_selections: {}, files: {}, artifacts: {},
  input_hash: null, main_hash: null, output_hash: null,
  created_at: "2026-10-20T09:00:00Z", updated_at: "2026-10-23T14:00:00Z", expires_at: 1800000000,
};

const qualityJob = { ...baseJob, status: "QUALITY_REVIEW_PENDING" };
const transformJob = { ...baseJob, status: "TRANSFORMATION_REVIEW_PENDING" };

function item(id, kind, title, severity, confidence, cells = [], extra = {}) {
  return { id, kind, title, severity, confidence, reason: `Automated analysis detected an issue with ${title.toLowerCase()}.`, cells, status: "proposed", requiresDecision: true, allowedDecisions: ["accept", "reject", "edit", "ignore"], ...extra };
}

const qualityItems = [
  item("q1", "type-mismatch", "Date format differs", "high", 0.45, [{ coordinate: "A3", before: "31/12/2025", after: "2025-12-31" }, { coordinate: "A4", before: "15/01/2026", after: "2026-01-15" }]),
  item("q2", "duplicate-row", "Duplicate rows detected", "high", 0.62, [{ coordinate: "B7", before: "Acme Corp", after: null }]),
  item("q3", "blank-column", "Empty column F", "medium", 0.78, [{ coordinate: "F1", before: null, after: null }]),
  item("q4", "normalization-rule", "Inconsistent capitalisation", "low", 0.91, [{ coordinate: "C2", before: "new york", after: "New York" }], { pattern: "^[a-z]", affectedCount: 47 }),
];

const transformItems = [
  item("t1", "standardization", "Region code mapping", "high", 0.38, [{ coordinate: "D3", before: "NYC", after: "US-NY" }]),
  item("t2", "formula", "Calculate net profit", "medium", 0.71, [], { formula: { text: "=B2-C2-D2", referencedColumns: ["B", "C", "D"], syntax: "verified" } }),
  item("t3", "update-match", "Match customer record", "medium", 0.85, [{ coordinate: "A5", before: "CUST-001", after: "CUST-001" }], { match: { type: "exact", sourceKey: "CUST-001", targetKeys: ["CUST-001"] } }),
  item("t4", "standardization", "Currency symbol normalisation", "low", 0.93, [{ coordinate: "E2", before: "USD 1,200", after: "1200.00" }]),
];

function reportPage(jobObj, items) {
  return { jobId: jobObj.job_id, revision: jobObj.revision, status: jobObj.status, stage: jobObj.status.toLowerCase().includes("quality") ? "quality" : "transformation", items, complete: true, total: items.length, nextCursor: null, requestId: "mock-report-1" };
}

async function shot(page, name) {
  await page.waitForTimeout(1200);
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`  → ${path}`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: chromiumExe, headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // Set sessionStorage before any JS runs (app uses sessionStorage for local-dev auth)
  await ctx.addInitScript(() => sessionStorage.setItem("xlsx.local-development-access", "enabled"));

  const page = await ctx.newPage();

  const scenarios = [
    { name: "quality-review", job: qualityJob, items: qualityItems },
    { name: "transformation-review", job: transformJob, items: transformItems },
  ];

  for (const { name, job, items } of scenarios) {
    console.log(`\n${name} …`);

    // Mock GET /v1/jobs/:id
    await page.route(`**/v1/jobs/${jobId}`, route =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ job, request_id: "mock-get" }) }));

    // Mock GET /v1/jobs/:id/review-report
    await page.route(`**/v1/jobs/${jobId}/review-report**`, route =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reportPage(job, items)) }));

    await page.goto(`${baseUrl}/jobs/${jobId}/${name.replace("-review", "")}-review`, { waitUntil: "networkidle", timeout: 20_000 }).catch(() => {
      console.log("  networkidle timeout — capturing anyway");
    });
    await shot(page, name);

    // Clear routes for next iteration
    await page.unrouteAll();
  }

  await browser.close();
  console.log("\nDone.");
}

main().catch(e => { console.error(e); process.exit(1); });

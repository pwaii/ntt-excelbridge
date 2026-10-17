import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const root = new URL("../", import.meta.url);
const snapshot = new URL("openapi/backend.json", root);
let schema;
if (process.argv.includes("--offline")) {
  schema = JSON.parse(await readFile(snapshot, "utf8"));
} else {
  const response = await fetch(process.env.OPENAPI_URL || "http://127.0.0.1:8000/openapi.json", {
    signal: AbortSignal.timeout(15_000), redirect: "error", credentials: "omit",
  });
  if (!response.ok) throw new Error(`OpenAPI download failed: HTTP ${response.status}`);
  schema = await response.json();
}
if (!schema.openapi || !schema.paths?.["/v1/jobs"]) throw new Error("Not the XLSX backend OpenAPI document.");
const source = astToString(await openapiTS(schema));
await mkdir(new URL("openapi/", root), { recursive: true });
await mkdir(new URL("src/api/generated/", root), { recursive: true });
await writeFile(fileURLToPath(new URL("src/api/generated/backend.ts", root)), source);
if (!process.argv.includes("--offline")) await writeFile(snapshot, `${JSON.stringify(schema, null, 2)}\n`);
console.log("Generated API types from the backend OpenAPI contract.");

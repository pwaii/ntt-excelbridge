const storageKey = "xlsx.recent-jobs";
const valid = (id: string) => /^[A-Za-z0-9_-]+$/.test(id);
const MAX = 5;
// Store only server-provided job IDs. No tokens, workbook bytes, prompts or presigned URLs are persisted.
export function rememberJob(id: string) {
  if (!valid(id)) return;
  try {
    const prev = rememberedJobs().filter(j => j !== id);
    window.sessionStorage.setItem(storageKey, JSON.stringify([id, ...prev].slice(0, MAX)));
  } catch { /* sidebar link remains visible when storage is unavailable. */ }
}
export function rememberedJobs(): string[] {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(valid) : [];
  } catch { return []; }
}
export function rememberedJob(): string | null {
  return rememberedJobs()[0] ?? null;
}

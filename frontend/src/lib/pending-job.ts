const storageKey = "xlsx.last-created-job";
const valid = (id: string) => /^[A-Za-z0-9_-]+$/.test(id);
// Store only the server-provided job ID for a resume link. No tokens, workbook
// bytes, prompts or presigned URLs are persisted; GET still checks ownership.
export function rememberJob(id: string) {
  if (!valid(id)) return;
  try { window.sessionStorage.setItem(storageKey, id); } catch { /* Job link remains visible when storage is unavailable. */ }
}
export function rememberedJob(): string | null {
  try { const id = window.sessionStorage.getItem(storageKey); return id && valid(id) ? id : null; } catch { return null; }
}

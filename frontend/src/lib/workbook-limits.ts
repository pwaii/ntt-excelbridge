// ADR D1 gives MB without a byte convention. Preserve the existing browser limit:
// 25 * 1024^2 bytes (25 MiB); align this explicitly with backend enforcement on Day 2.
export const MAX_WORKBOOK_BYTES = 25 * 1024 * 1024;
export const DEMO_WORKING_ROWS = 2_000;
export const MAX_DATA_ROWS = 50_000;
export const MAX_HEADER_ROW = 20;

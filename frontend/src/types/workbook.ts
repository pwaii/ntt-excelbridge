// An integration adapter must supply these only from validated backend metadata,
// bound to the selected workbook version and sheet; never infer counts from bytes.
export interface WorkbookMetadata {
  workbookVersion: string;
  sheetName: string;
  dataRowCount?: number;
  detectedHeaderRow?: number | null;
  topIssuesOnly?: boolean;
  headerRowBounds?: HeaderRowBounds;
  columns?: readonly WorkbookColumn[];
  columnsHeaderRow?: number;
}

// Temporary frontend metadata, not API fields. A future adapter maps exact API
// indexing/bounds and column identifiers; absent values must remain absent.
export interface HeaderRowBounds { readonly min: number; readonly max: number; readonly indexBase: 0 | 1 }
export interface WorkbookColumn { readonly id: string; readonly label: string }

export interface HeaderConfirmation {
  metadataKey: string;
  row: number;
}

// No metadata means no detection. A changed guess requires new confirmation.
export type HeaderConfirmationViewModel =
  | { readonly state: "pending-metadata"; readonly detectedRow: null; readonly selectedRow: null }
  | {
      readonly state: "awaiting-confirmation" | "confirmed";
      readonly metadataKey: string;
      readonly detectedRow: number | null;
      readonly selectedRow: number | null;
    };

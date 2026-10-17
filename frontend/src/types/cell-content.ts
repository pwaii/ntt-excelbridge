// Raw user input / uploaded text is always data. Only validated backend review
// results may supply approved-formula origin and its audit reference (ADR D5).
export type CellOrigin = "data" | "approved-formula";

// Backend owns export escaping and live formula writing.
export type CellContent =
  | { readonly origin: "data"; readonly value: string }
  | { readonly origin: "approved-formula"; readonly value: string; readonly approvalId: string };

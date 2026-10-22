import { ApiError } from "@/api/errors";
import { workflowConfigurationSchema, type WorkflowConfiguration } from "@/schemas/job-creation";
import { headerConfirmed } from "@/lib/workflow-readiness";
import type { HeaderConfirmation } from "@/types/workbook";
import type { WorkbookRole } from "@/uploads/types";
import { getMetadataReadiness, requiredWorkbookRoles } from "./readiness";
import type { MetadataAdapter, MetadataFlowState, WorkbookChoice, WorkbookChoices } from "./types";

const emptyChoice = (): WorkbookChoice => ({ sheetName: null, keyColumnId: null, header: null });
export function createMetadataFlow(jobId: string, input: WorkflowConfiguration, adapter?: MetadataAdapter, currentRoles: readonly WorkbookRole[] = ["current"]) {
  const configuration = workflowConfigurationSchema.parse(input);
  const roles = requiredWorkbookRoles(configuration, currentRoles);
  const initialChoices = Object.fromEntries(roles.map((role) => [role, emptyChoice()])) as WorkbookChoices;
  let state: MetadataFlowState = { phase: "unavailable", choices: initialChoices, reconcileRequired: false };
  let busy = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const mutable = () => !busy && state.phase !== "started";
  const choiceFor = (choices: WorkbookChoices, role: WorkbookRole) => choices[role] ?? emptyChoice();
  const sheetFor = (role: WorkbookRole) => state.snapshot?.workbooks[role]?.sheets.find((sheet) => sheet.sheetName === choiceFor(state.choices, role).sheetName);
  const updateChoice = (role: WorkbookRole, choice: WorkbookChoice) => { state = { ...state, configurationSaved: false, choices: { ...state.choices, [role]: choice }, error: undefined }; emit(); };
  async function load() {
    if (busy) return false;
    if (!adapter) { state = { ...state, phase: "unavailable", snapshot: undefined, error: { message: "Workbook metadata is unavailable until a documented backend adapter is connected." } }; emit(); return false; }
    busy = true;
    const choices = state.choices;
    state = { ...state, phase: "loading", snapshot: undefined, error: undefined }; emit();
    try {
      const snapshot = await adapter.load(jobId, choices, new AbortController().signal);
      if (snapshot.jobId !== jobId || !snapshot.serverRevision.trim()) throw new ApiError("protocol", "Workbook metadata could not be validated.");
      const nextChoices: Partial<Record<WorkbookRole, WorkbookChoice>> = Object.fromEntries(roles.map((role) => [role, emptyChoice()]));
      for (const role of roles) {
        const choice = choiceFor(choices, role);
        const name = choice.sheetName;
        const saved = snapshot.persistedChoices?.[role];
        if (saved && (!name || JSON.stringify(choice) === JSON.stringify(saved))) {
          nextChoices[role] = saved;
          continue;
        }
        if (snapshot.workbooks[role]?.sheets.filter((sheet) => sheet.sheetName === name).length === 1) {
          nextChoices[role] = { ...emptyChoice(), sheetName: name };
        }
      }
      // All reloads invalidate local confirmations/keys, including changes to
      // detection, columns, file versions, or server revision.
      state = { phase: "review", snapshot, choices: nextChoices as WorkbookChoices, configurationSaved: roles.every((role) => Boolean(snapshot.persistedChoices?.[role]?.header) && JSON.stringify(nextChoices[role]) === JSON.stringify(snapshot.persistedChoices?.[role])), reconcileRequired: snapshot.startState === "unknown" };
      if (snapshot.startState === "started") {
        if (!snapshot.startedJob?.accepted || snapshot.startedJob.jobId !== jobId || !snapshot.startedJob.statusLabel.trim()) throw new ApiError("protocol", "Started job status could not be validated.");
        state = { ...state, phase: "started", startedJob: snapshot.startedJob };
      }
      emit(); return true;
    } catch (error) {
      state = { ...state, phase: "error", snapshot: undefined, error: { message: "Workbook metadata could not be loaded. Reload backend state before continuing.", requestId: error instanceof ApiError ? error.requestId : undefined } }; emit(); return false;
    } finally { busy = false; }
  }
  return {
    configuration,
    roles,
    getSnapshot: () => state,
    getReadiness: () => getMetadataReadiness(state, configuration, jobId, adapter, currentRoles),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load,
    async save() {
      if (busy || !getMetadataReadiness(state, configuration, jobId, adapter, currentRoles).canStart || !state.snapshot || !adapter?.persistSelections) return false;
      busy = true;
      const key = JSON.stringify(state.choices);
      state = { ...state, phase: "saving", configurationSaved: false, error: undefined }; emit();
      try {
        const saved = await adapter.persistSelections(jobId, { configuration, choices: state.choices }, key, state.snapshot!.serverRevision, new AbortController().signal);
        if (saved.selectionKey !== key || !saved.serverRevision.trim()) throw new ApiError("protocol", "Configuration acknowledgement mismatch.");
        state = { ...state, phase: "review", snapshot: { ...state.snapshot!, serverRevision: saved.serverRevision }, configurationSaved: true }; emit(); return true;
      } catch (error) {
        state = { ...state, phase: "error", reconcileRequired: !(error instanceof ApiError) || error.kind !== "http" || error.status === 409 || (error.status ?? 0) >= 500, error: { message: "Configuration could not be saved. Reload server state before retrying if the outcome is unknown.", requestId: error instanceof ApiError ? error.requestId : undefined } }; emit(); return false;
      } finally { busy = false; }
    },
    selectSheet(role: WorkbookRole, sheetName: string) {
      if (!mutable() || !roles.includes(role)) return false;
      if (state.snapshot?.workbooks[role]?.sheets.filter((sheet) => sheet.sheetName === sheetName).length !== 1) return false;
      updateChoice(role, { sheetName, keyColumnId: null, header: null }); return true;
    },
    setHeader(role: WorkbookRole, header: HeaderConfirmation | null) {
      if (!mutable()) return false;
      const sheet = sheetFor(role);
      if (!sheet || !sheet.headerRowBounds || (header && !headerConfirmed(sheet, header))) return false;
      updateChoice(role, { ...choiceFor(state.choices, role), header, keyColumnId: null }); return true;
    },
    selectKey(role: WorkbookRole, id: string | null) {
      if (!mutable()) return false;
      const sheet = sheetFor(role); const choice = choiceFor(state.choices, role);
      if (!sheet || state.snapshot?.workbooks[role]?.keyRule === "not-applicable") return false;
      if (id !== null && (!headerConfirmed(sheet, choice.header) || sheet.columnsHeaderRow !== choice.header?.row || sheet.columns?.filter((column) => column.id === id).length !== 1)) return false;
      updateChoice(role, { ...choice, keyColumnId: id }); return true;
    },
    async start() {
      if (busy || !getMetadataReadiness(state, configuration, jobId, adapter, currentRoles).canStart || !state.snapshot || !adapter?.persistSelections || !adapter.start) return false;
      busy = true;
      const choices = state.choices;
      const key = JSON.stringify([state.snapshot.serverRevision, configuration.comment_name, configuration.outputHeader, configuration.standardize, configuration.update, choices]);
      state = { ...state, phase: "saving", error: undefined }; emit();
      let sendingStart = false;
      try {
        const saved = state.configurationSaved ? { selectionKey: key, serverRevision: state.snapshot!.serverRevision } : await adapter.persistSelections(jobId, { configuration, choices }, key, state.snapshot!.serverRevision, new AbortController().signal);
        if (saved.selectionKey !== key || !saved.serverRevision.trim()) throw new ApiError("protocol", "Backend selection persistence could not be verified.");
        state = { ...state, phase: "starting", snapshot: { ...state.snapshot!, serverRevision: saved.serverRevision } }; emit(); sendingStart = true;
        const started = await adapter.start(jobId, saved.serverRevision, new AbortController().signal);
        if (!started.accepted || started.jobId !== jobId || !started.statusLabel.trim()) throw new ApiError("protocol", "Workflow start was not confirmed by the backend.");
        state = { ...state, phase: "started", startedJob: started, reconcileRequired: false }; emit(); return true;
      } catch (error) {
        const unknown = !(error instanceof ApiError) || ["network", "timeout", "cancelled", "protocol"].includes(error.kind) || error.status === 409 || (error.status ?? 0) >= 500;
        state = { ...state, phase: "error", reconcileRequired: unknown, error: {
          message: sendingStart ? "Workflow start could not be confirmed. Reload backend job state before another attempt." : "Final selections could not be verified as saved by the backend. Workflow start was not requested.",
          requestId: error instanceof ApiError ? error.requestId : undefined, code: error instanceof ApiError ? error.code : undefined,
        } }; emit(); return false;
      } finally { busy = false; }
    },
  };
}
export type MetadataFlow = ReturnType<typeof createMetadataFlow>;

# UI simplification

The interface now prioritizes the current task, its required inputs, and the next
action. Supporting information remains available through disclosures.

- Sign-in keeps the product explanation and authentication action; the repeated
  three-step introduction and header slogan have been removed.
- Creation keeps file selection, the requested calculation, its output header,
  optional processing, and the output policy. Bare column-name shortcuts were
  removed because the calculation placeholder and rule hint provide a clearer
  example. Worksheet instructions appear after upload, when users can act on them.
- The creation action is **Upload workbooks**. Main-workbook terminology is
  consistent across creation, validation, review, and output descriptions.
- Completed uploads collapse into **Uploaded files**. Worksheet setup shows only
  the next relevant requirements: key-selection reminders wait until the header
  is confirmed. The readiness checks themselves remain unchanged.
- Key guidance is brief beside each selector. Shared duplicate-key and
  standardization rules appear once below both workbook sections.
- Progress leads with the actual status and next action. Requested column,
  worksheet, timestamps, IDs, and server details are under **Workflow details**.
- Review retains evidence, validation, draft state, explicit confirmation, and
  submission. After submission, the saved decisions remain accessible through
  **View submitted review**. On mobile, the submit section stays in the document
  flow while required decisions remain, so it does not cover the evidence.
- Results lead with the workbook download and reported counts. Missing counts do
  not create empty tiles; actual zero counts remain visible. Reports and
  verification details remain available on demand. Formula limitations remain
  visible where users review or use formulas.
- The shared footer states that originals are preserved, replacing repeated
  assurances throughout individual screens.

Validation includes the frontend test suite, production build, lint, and desktop
and mobile browser inspection. Review, setup, progress, and result screenshots use
synthetic data in a temporary preview, not live service acceptance evidence.
Screenshots are kept in the ignored `.venv/ui-qa` folder. The temporary preview
files are removed after inspection.

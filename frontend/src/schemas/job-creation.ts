import { z } from "zod";
import { MAX_WORKBOOK_BYTES } from "@/lib/workbook-limits";

export const isBrowserFile = (value: unknown): value is File =>
  typeof File !== "undefined" && value instanceof File;

export const workbookFileSchema = z.custom<File>(isBrowserFile, "Select a real XLSX workbook.")
  .superRefine((file, context) => {
    if (!isBrowserFile(file)) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      context.addIssue({ code: "custom", message: "Choose an .xlsx workbook. Other file formats are not supported." });
    }
    if (file.size > MAX_WORKBOOK_BYTES) {
      context.addIssue({ code: "custom", message: "This workbook exceeds the 25 MB limit. Choose a smaller file." });
    }
  });

export const jobCreationSchema = z.object({
  currentFile: workbookFileSchema.nullable().refine((file) => file !== null, "Select a current workbook."),
  // The first file is kept as currentFile for existing form consumers. The
  // current-workbook picker fills this array when more than one is selected.
  currentFiles: z.array(workbookFileSchema).max(8, "You can select up to 8 current workbooks.").optional(),
  // Keep the existing backend field name; the UI labels this field "Prompt".
  comment_name: z.string().trim().min(1, "Describe the column you want to add.").max(200, "Prompt must contain at most 200 characters."),
  outputHeader: z.string().trim().min(1, "Enter the output column header."),
  standardize: z.boolean().optional().default(false),
  update: z.boolean().optional().default(false),
  mainFile: workbookFileSchema.nullable().optional(),
}).superRefine((values, context) => {
  if ((values.standardize || values.update) && !values.mainFile) {
    context.addIssue({ code: "custom", path: ["mainFile"], message: "Select a master workbook for standardization or updates." });
  }
});

export type JobFormInput = z.input<typeof jobCreationSchema>;
export type JobFormValues = z.output<typeof jobCreationSchema>;
export const workflowConfigurationSchema = z.object({
  comment_name: jobCreationSchema.shape.comment_name,
  outputHeader: jobCreationSchema.shape.outputHeader,
  standardize: z.boolean(), update: z.boolean(),
});
export type WorkflowConfiguration = z.infer<typeof workflowConfigurationSchema>;

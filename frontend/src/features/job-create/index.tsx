import { FormEvent, useState } from "react";
import { completeUpload, createJob, startJob, uploadToS3 } from "../../api/client";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function JobCreate() {
  const [file, setFile] = useState<File | null>(null);
  const [commentName, setCommentName] = useState("Status");
  const [message, setMessage] = useState("Choose an .xlsx file to begin.");
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!file) {
      setError("Choose an .xlsx file first.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setError("Only .xlsx files are accepted.");
      return;
    }

    setBusy(true);
    try {
      setMessage("Creating job and requesting a secure S3 upload URL...");
      const created = await createJob(file.name, commentName.trim() || "Status");
      setJobId(created.job.job_id);
      const inputUpload = created.uploads.find((upload) => upload.slot === "input");
      if (!inputUpload) throw new Error("The API did not return an input upload URL.");

      setMessage("Uploading the workbook directly to S3...");
      await uploadToS3(inputUpload, file);
      setMessage("Verifying the S3 object...");
      await completeUpload(created.job.job_id, "input");
      setMessage("Starting the workbook pipeline...");
      const completed = await startJob(created.job.job_id);
      setMessage(`Finished. Job ${completed.job.job_id} is ${completed.job.status}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The upload failed.");
      setMessage("The job stopped. Check the backend terminal for details.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: "3rem auto", fontFamily: "system-ui" }}>
      <h1>Upload workbook</h1>
      <p>The file goes directly from this browser to S3 using a short-lived upload URL.</p>
      <form onSubmit={submit}>
        <label style={{ display: "block", marginBottom: "1rem" }}>
          Comment column name
          <input value={commentName} onChange={(event) => setCommentName(event.target.value)} disabled={busy} style={{ display: "block", width: "100%", marginTop: ".25rem" }} />
        </label>
        <label style={{ display: "block", marginBottom: "1rem" }}>
          XLSX file
          <input type="file" accept={XLSX_CONTENT_TYPE + ",.xlsx"} onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={busy} style={{ display: "block", marginTop: ".25rem" }} />
        </label>
        <button type="submit" disabled={busy || !file}>{busy ? "Working..." : "Upload and process"}</button>
      </form>
      <p aria-live="polite">{message}</p>
      {jobId && <p>Job ID: <code>{jobId}</code></p>}
      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
    </main>
  );
}

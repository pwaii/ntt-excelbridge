import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { JobCreate } from "../features/job-create";

// Route shell. Pages live in src/features/* (§12.1). TODO(FE Day 1): flesh out.
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<main><h1>XLSX Workflow</h1><Link to="/jobs/new">Upload a workbook</Link></main>} />
        <Route path="/jobs/new" element={<JobCreate />} />
        <Route path="/jobs/:jobId" element={<div>Job progress</div>} />
        <Route path="/jobs/:jobId/quality" element={<div>Quality review</div>} />
        <Route path="/jobs/:jobId/transform" element={<div>Transformation review</div>} />
        <Route path="/jobs/:jobId/result" element={<div>Result</div>} />
      </Routes>
    </BrowserRouter>
  );
}

import { BrowserRouter, Routes, Route } from "react-router-dom";

// Route shell. Pages live in src/features/* (§12.1). TODO(FE Day 1): flesh out.
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div>Sign in</div>} />
        <Route path="/jobs/new" element={<div>Job creation</div>} />
        <Route path="/jobs/:jobId" element={<div>Job progress</div>} />
        <Route path="/jobs/:jobId/quality" element={<div>Quality review</div>} />
        <Route path="/jobs/:jobId/transform" element={<div>Transformation review</div>} />
        <Route path="/jobs/:jobId/result" element={<div>Result</div>} />
      </Routes>
    </BrowserRouter>
  );
}

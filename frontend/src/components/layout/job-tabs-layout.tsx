import { useState, useEffect } from "react";
import { matchPath, useLocation, useParams } from "react-router-dom";
import { JobProgressPage } from "@/pages/job-progress-page";
import { QualityReviewPage } from "@/pages/quality-review-page";
import { TransformationReviewPage } from "@/pages/transformation-review-page";
import { ResultPage } from "@/pages/result-page";
import { NotFoundPage } from "@/pages/not-found-page";

const tabs = [
  { suffix: "", Page: JobProgressPage },
  { suffix: "/quality-review", Page: QualityReviewPage },
  { suffix: "/transformation-review", Page: TransformationReviewPage },
  { suffix: "/result", Page: ResultPage },
];

// Mount on first visit; hide (not unmount) on tab switch to preserve fetched state.
function JobTabsInner({ id }: { id: string }) {
  const { pathname } = useLocation();
  const active = tabs.findIndex(({ suffix }) => matchPath(`/jobs/${id}${suffix}`, pathname));
  const [seen, setSeen] = useState<Set<number>>(() => new Set(active >= 0 ? [active] : []));
  useEffect(() => { if (active >= 0) setSeen(prev => new Set([...prev, active])); }, [active]);
  if (active < 0) return <NotFoundPage />;
  return <>
    {tabs.map(({ Page }, i) =>
      seen.has(i) ? <div key={i} hidden={i !== active}><Page /></div> : null
    )}
  </>;
}

export function JobTabsLayout() {
  const { id } = useParams<"id">();
  return id ? <JobTabsInner key={id} id={id} /> : null;
}

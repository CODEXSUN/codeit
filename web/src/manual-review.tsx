import { useState, type FormEvent } from "react";
import { Button } from "./components/ui/button.js";
import type { ProjectSettings } from "./project-dialog.js";

export type ManualReviewRecord = {
  workerRunId: string; reviewer: string; scope: string; omissions: string; findings: string; reviewedAt: string; approvedSettings: ProjectSettings;
  resolution?: { decision: "accept" | "changes_requested"; findings: string; decidedAt: string };
};
type ManualReviewInput = { workerRunId: string; reviewer: string; scope: string; omissions: string; findings: string; confirmed: true };

export function ManualReviewForm({ workerRunId, disabled, onSubmit }: { workerRunId: string; disabled: boolean; onSubmit: (value: ManualReviewInput) => void }) {
  const [reviewer, setReviewer] = useState("");
  const [scope, setScope] = useState("");
  const [omissions, setOmissions] = useState("");
  const [findings, setFindings] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || !confirmed || !reviewer.trim() || !scope.trim() || !omissions.trim() || !findings.trim()) return;
    onSubmit({ workerRunId, reviewer, scope, omissions, findings, confirmed: true });
  }
  return <details className="manual-review"><summary>Record a manual review</summary><form className="loop-form" onSubmit={submit}>
    <p>Review the full retained worker evidence before recording your review. This does not accept the task. A separate decision follows.</p>
    <p>Worker run: <code>{workerRunId}</code></p><p>Reviewer identity is self-reported and is not authenticated.</p>
    <label>Reviewer name<input value={reviewer} onChange={(event) => setReviewer(event.target.value)} maxLength={200} required /></label>
    <label>Review scope<textarea value={scope} onChange={(event) => setScope(event.target.value)} maxLength={20000} rows={3} required /></label>
    <label>Omissions or limitations<textarea value={omissions} onChange={(event) => setOmissions(event.target.value)} maxLength={20000} rows={3} placeholder="Enter none if there are no omissions" required /></label>
    <label>Review findings<textarea value={findings} onChange={(event) => setFindings(event.target.value)} maxLength={20000} rows={3} placeholder="Enter none if there are no findings" required /></label>
    <label className="loop-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I confirm that I reviewed the specified worker run and described the scope, omissions, and findings.</label>
    <Button type="submit" disabled={disabled || !confirmed || !reviewer.trim() || !scope.trim() || !omissions.trim() || !findings.trim()}>Record manual review</Button>
  </form></details>;
}

export function ManualReviewEvidence({ review }: { review: ManualReviewRecord }) {
  return <div className="manual-review-evidence"><p>Worker run: {review.workerRunId}</p><p>Reviewer (self-reported, not authenticated): {review.reviewer}</p><p>Reviewed at: {review.reviewedAt}</p><p>Approved folder: {review.approvedSettings.folder}</p><p>Approved file access: {review.approvedSettings.sandbox}; approvals: {review.approvedSettings.approvalPolicy}</p><h4>Scope</h4><pre>{review.scope}</pre><h4>Omissions or limitations</h4><pre>{review.omissions}</pre><h4>Findings</h4><pre>{review.findings}</pre>{review.resolution && <><h4>Decision</h4><p>{review.resolution.decision.replaceAll("_", " ")} · {review.resolution.decidedAt}</p><pre>{review.resolution.findings}</pre></>}</div>;
}

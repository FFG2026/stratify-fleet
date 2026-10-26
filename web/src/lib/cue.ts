// CUE (Claims and Underwriting Exchange) queue: wording and small pure helpers shared by the server and the browser.
// The portal is NOT connected to CUE. Queueing prepares a record from the claim's FNOL data and keeps it; nothing is transmitted.

export type CueStatus = 'queued' | 'submitted' | 'accepted' | 'rejected' | 'error';
export const cueStatusLabel: Record<CueStatus, string> = {
  queued: 'Queued · not transmitted', submitted: 'Submitted', accepted: 'Accepted', rejected: 'Rejected', error: 'Error'
};
export const cueStatuses: CueStatus[] = ['queued', 'submitted', 'accepted', 'rejected', 'error'];

export type CueSubmission = {
  id: string; claim_id: string; version: number; submission_status: CueStatus; status_detail: string;
  external_reference: string | null; created_at: string;
};

export const cueNotConnected = 'The portal is not connected to CUE, so nothing is transmitted. Queueing prepares the record from this claim and keeps it. Download it to enter on CUE through your own route.';

// A safe download name such as CLM-2026-000012-cue-v2.json.
export const cueFileName = (reference: string, version: number) => `${reference.replace(/[^\w-]/g, '_')}-cue-v${Math.max(1, Math.floor(version))}.json`;

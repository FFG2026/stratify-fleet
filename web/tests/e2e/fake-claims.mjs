// Stand-in for the claims tables and functions, used ONLY by the browser test. It follows the same workflow as the real
// functions (report, review, send, ask, answer, close) so the screens can be exercised end to end. Who may see what is proven
// against the real database in supabase/tests/claims.sql, not here.
import { randomUUID as uid } from 'node:crypto';

export function createClaims(ids) {
  const db = { claims: [], parties: [], events: [], requests: [], files: [], notices: [] };
  const sideOf = u => (u.role === 'driver' ? 'driver' : ['insurer_admin', 'platform_super_admin'].includes(u.role) ? 'insurer' : ['fleet_admin', 'fleet_manager'].includes(u.role) ? 'fleet' : null);
  const visible = (c, u) => { const s = sideOf(u); return s === 'fleet' ? c.fleet_id === u.org : s === 'insurer' ? !!c.submitted_at && (u.see === 'all' || u.see.includes(c.fleet_id)) : s === 'driver' ? c.reported_by === u.id || c.driver_user_id === u.id : false; };
  const err = message => { const e = new Error(message); e.http = 400; return e; };
  const now = () => new Date().toISOString();
  const event = (c, kind, side, visibility, body, email) => db.events.push({ id: uid(), claim_id: c.id, kind, side, visibility, actor_label: side === 'insurer' ? 'Example Mutual' : side === 'fleet' ? 'Northbank Logistics' : 'Dana Driver', actor_email: side === 'driver' ? null : email, body, created_at: now() });
  const notice = (target, c, kind, title, body) => db.notices.push({ id: uid(), target, claim_id: c.id, kind, title, body, created_at: now(), read: {} });
  const find = id => db.claims.find(c => c.id === id) || (() => { throw err('claim not found'); })();
  const gaps = (c, extraNoPhotos = c.no_photos_confirmed) => {
    const g = [];
    if (c.police_attended === null) g.push('say whether the police attended');
    if (c.third_party_involved && !db.parties.some(p => p.claim_id === c.id && p.kind === 'third_party' && !p.deleted)) g.push('add the other party\'s details');
    if (!extraNoPhotos && !db.files.some(f => f.claim_id === c.id && !f.deleted)) g.push('add photos, or confirm that none are available');
    return g;
  };
  const base = (b, u, origin, status) => ({
    id: uid(), reference: 'CLM-2026-' + String(db.claims.length + 1).padStart(6, '0'), fleet_id: b.p_fleet || u.org, insurer_id: ids.i1, policy_id: ids.p1, vehicle_id: b.p_vehicle || null,
    registration: b.p_registration, driver_user_id: origin === 'driver' ? u.id : b.p_driver || null, driver_name: origin === 'driver' ? 'Dana Driver' : b.p_driver_name || null, origin, reported_by: u.id, status,
    incident_at: b.p_incident_at, location: b.p_location, description: b.p_description, anyone_injured: b.p_injured, injury_details: b.p_injury_details, police_attended: b.p_police, police_reference: b.p_police_ref,
    vehicle_driveable: b.p_driveable ?? null, third_party_involved: b.p_third_party ?? null, on_cover_at_incident: b.p_vehicle ? true : null, no_photos_confirmed: false, assessed_at: null, assessment_notes: null,
    submitted_at: null, insurer_reference: null, closed_at: null, outcome: null, outcome_note: null, created_at: now(), updated_at: now()
  });
  const checkFields = b => {
    if (b.p_injured === null || b.p_injured === undefined) throw err('say whether anyone was injured');
    if (new Date(b.p_incident_at) > new Date(Date.now() + 600000)) throw err('the incident cannot be in the future');
  };
  const touch = c => { c.updated_at = now(); return c; };
  const open = r => !r.answered_at && !r.cancelled_at;
  const settle = c => { if (c.status === 'awaiting_information') c.status = db.requests.some(r => r.claim_id === c.id && open(r)) ? 'awaiting_information' : 'under_review'; };

  function rpc(name, b, u, email) {
    switch (name) {
      case 'report_claim': {
        checkFields(b);
        const origin = u.role === 'driver' ? 'driver' : 'fleet';
        const c = base(b, u, origin, 'reported'); db.claims.push(c); event(c, 'reported', origin, 'shared', origin === 'driver' ? 'Reported by the driver.' : 'Reported by the fleet.', email);
        if (origin === 'driver') notice('fleet:' + c.fleet_id, c, 'claim_reported', 'New claim reported by Dana Driver', c.registration);
        return c.id;
      }
      case 'log_insurer_claim': {
        checkFields(b);
        if (!(u.see === 'all' || u.see.includes(b.p_fleet))) throw err('permission denied');
        const c = base(b, u, 'insurer', 'under_review'); c.submitted_at = now(); c.insurer_reference = b.p_insurer_ref; db.claims.push(c); event(c, 'logged_by_insurer', 'insurer', 'shared', 'Logged by the insurer.', email);
        notice('fleet:' + c.fleet_id, c, 'claim_logged', 'A claim has been logged by your insurer', c.reference + ' · ' + c.registration);
        return c.id;
      }
      case 'update_claim_details': {
        const c = find(b.p_claim); if (c.status !== 'reported') throw err('this claim has been sent to the insurer; add a note or photos instead');
        checkFields(b);
        Object.assign(c, { incident_at: b.p_incident_at, location: b.p_location, description: b.p_description, anyone_injured: b.p_injured, injury_details: b.p_injury_details, police_attended: b.p_police, police_reference: b.p_police_ref, vehicle_driveable: b.p_driveable, third_party_involved: b.p_third_party, assessed_at: null });
        if (b.p_registration) c.registration = b.p_registration;
        event(c, 'updated', u.role === 'driver' ? 'driver' : 'fleet', 'shared', 'Details changed.', email); touch(c); return null;
      }
      case 'add_claim_party': {
        const c = find(b.p_claim); const id = uid();
        db.parties.push({ id, claim_id: c.id, kind: b.p_kind, name: b.p_name, phone: b.p_phone, vehicle_registration: b.p_reg, insurer_name: b.p_insurer, injured: b.p_injured, notes: b.p_notes, added_by: u.id, deleted: false });
        if (c.status === 'reported') c.assessed_at = null; else event(c, 'party_added', 'fleet', 'shared', 'Other party added: ' + b.p_name, email);
        return id;
      }
      case 'remove_claim_party': { const p = db.parties.find(x => x.id === b.p_id); const c = find(p.claim_id); if (c.status !== 'reported') throw err('this claim has been sent to the insurer; details can no longer be removed'); p.deleted = true; c.assessed_at = null; return null; }
      case 'add_claim_attachment': {
        const c = find(b.p_claim); if (c.status === 'closed') throw err('permission denied');
        const id = uid(); const side = sideOf(u);
        db.files.push({ id, claim_id: c.id, request_id: b.p_request, kind: b.p_kind, storage_path: b.p_path, file_name: b.p_name, content_type: b.p_type, size_bytes: b.p_size, caption: b.p_caption, uploaded_by: u.id, uploaded_side: side, uploaded_at: now(), deleted: false });
        if (c.status === 'reported') c.no_photos_confirmed = false; return id;
      }
      case 'remove_claim_attachment': {
        const f = db.files.find(x => x.id === b.p_id); const c = find(f.claim_id);
        if (c.status !== 'reported') throw err('files cannot be removed once a claim has been sent'); f.deleted = true; c.assessed_at = null; return f.storage_path;
      }
      case 'log_claim_file_view': return null;
      case 'assess_claim': {
        const c = find(b.p_claim); if (c.status !== 'reported') throw err('this claim has already been sent');
        const noPhotos = !!b.p_no_photos && !db.files.some(f => f.claim_id === c.id && !f.deleted); const g = gaps(c, noPhotos);
        if (g.length) throw err('before reviewing: ' + g[0]);
        c.no_photos_confirmed = noPhotos; c.assessed_at = now(); c.assessment_notes = b.p_notes; event(c, 'assessed', 'fleet', 'fleet', b.p_notes || 'Reviewed by the fleet.', email); touch(c); return null;
      }
      case 'submit_claim': {
        const c = find(b.p_claim); if (c.status !== 'reported') throw err('this claim has already been sent'); if (!c.assessed_at) throw err('review the claim before sending it');
        const g = gaps(c); if (g.length) throw err('before sending: ' + g[0]);
        c.status = 'submitted'; c.submitted_at = now(); event(c, 'submitted', 'fleet', 'shared', 'Sent to the insurer.', email);
        notice('insurer:' + c.insurer_id, c, 'claim_submitted', 'New claim from Northbank Logistics', c.reference); touch(c); return null;
      }
      case 'withdraw_claim': { const c = find(b.p_claim); if (String(b.p_note || '').length < 3) throw err('say why this report is being withdrawn'); c.status = 'closed'; c.closed_at = now(); c.outcome = 'withdrawn'; event(c, 'closed', 'fleet', 'shared', 'Withdrawn by the fleet before it was sent: ' + b.p_note, email); touch(c); return null; }
      case 'start_claim_review': {
        const c = find(b.p_claim); if (c.status === 'submitted') { c.status = 'under_review'; event(c, 'status_changed', 'insurer', 'shared', 'The insurer is reviewing this claim.', email); notice('fleet:' + c.fleet_id, c, 'claim_status', c.reference + ' is being reviewed by the insurer', null); }
        if (b.p_insurer_ref) c.insurer_reference = b.p_insurer_ref; touch(c); return null;
      }
      case 'request_claim_info': {
        const c = find(b.p_claim); if (c.status === 'closed') throw err('this claim is closed; reopen it first');
        const id = uid(); db.requests.push({ id, claim_id: c.id, question: b.p_question, due_on: b.p_due, requested_at: now(), answered_at: null, answer: null, cancelled_at: null });
        c.status = 'awaiting_information'; event(c, 'info_requested', 'insurer', 'shared', b.p_question, email);
        notice('fleet:' + c.fleet_id, c, 'info_requested', 'The insurer needs more information on ' + c.reference, b.p_question); touch(c); return id;
      }
      case 'cancel_claim_request': { const r = db.requests.find(x => x.id === b.p_request); r.cancelled_at = now(); const c = find(r.claim_id); settle(c); event(c, 'info_cancelled', 'insurer', 'shared', 'The insurer withdrew a question: ' + r.question, email); return null; }
      case 'respond_claim_request': {
        const r = db.requests.find(x => x.id === b.p_request); if (!open(r)) throw err('that question is no longer open');
        r.answered_at = now(); r.answer = b.p_answer; const c = find(r.claim_id); settle(c); event(c, 'info_provided', 'fleet', 'shared', b.p_answer, email);
        notice('insurer:' + c.insurer_id, c, 'info_provided', 'More information on ' + c.reference, b.p_answer); touch(c); return null;
      }
      case 'add_claim_note': { const c = find(b.p_claim); const s = sideOf(u); event(c, 'note', s, b.p_internal ? s : 'shared', b.p_body, email); return null; }
      case 'close_claim': {
        const c = find(b.p_claim); db.requests.filter(r => r.claim_id === c.id && open(r)).forEach(r => { r.cancelled_at = now(); });
        c.status = 'closed'; c.closed_at = now(); c.outcome = b.p_outcome; c.outcome_note = b.p_note; event(c, 'closed', 'insurer', 'shared', 'Closed by the insurer. ' + b.p_note, email);
        notice('fleet:' + c.fleet_id, c, 'claim_closed', c.reference + ' has been closed', b.p_note); touch(c); return null;
      }
      case 'reopen_claim': { const c = find(b.p_claim); c.status = 'under_review'; c.closed_at = null; c.outcome = null; event(c, 'reopened', 'insurer', 'shared', 'Reopened by the insurer. ' + b.p_note, email); touch(c); return null; }
      case 'mark_notifications_read': { for (const n of db.notices) if (mineNotice(n, u)) n.read[u.id] = now(); return null; }
      default: return undefined;
    }
  }
  const mineNotice = (n, u) => n.target === 'fleet:' + u.org && ['fleet_admin', 'fleet_manager'].includes(u.role) || n.target === 'insurer:' + u.org && u.role === 'insurer_admin' || n.target === 'user:' + u.id;

  // Reads: returns an array of rows (before paging) or undefined for tables that are not claims tables.
  function get(path, q, u) {
    const eq = k => (q.get(k) || '').startsWith('eq.') ? q.get(k).slice(3) : '';
    if (path === 'claims') {
      let rows = db.claims.filter(c => visible(c, u));
      if (eq('id')) rows = rows.filter(c => c.id === eq('id'));
      const st = q.get('status') || '';
      if (st === 'neq.closed') rows = rows.filter(c => c.status !== 'closed');
      else if (st === 'eq.closed') rows = rows.filter(c => c.status === 'closed');
      else if (st.startsWith('in.(')) { const list = st.slice(4, -1).split(','); rows = rows.filter(c => list.includes(c.status)); }
      if (eq('anyone_injured') === 'true') rows = rows.filter(c => c.anyone_injured);
      const or = q.get('or'); if (or) { const m = /reference\.ilike\.\*(.*?)\*,/.exec(or); const term = (m ? m[1] : '').toLowerCase(); rows = rows.filter(c => c.reference.toLowerCase().includes(term) || c.registration.toLowerCase().includes(term)); }
      return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    }
    const claimOf = () => { const c = db.claims.find(x => x.id === eq('claim_id')); return c && visible(c, u) ? c : null; };
    if (path === 'claim_parties') return claimOf() ? db.parties.filter(p => p.claim_id === eq('claim_id') && !p.deleted) : [];
    if (path === 'claim_requests') return claimOf() ? db.requests.filter(r => r.claim_id === eq('claim_id')) : [];
    if (path === 'claim_attachments') {
      if (eq('id')) { const f = db.files.find(x => x.id === eq('id') && !x.deleted); const c = f && db.claims.find(x => x.id === f.claim_id); return f && c && visible(c, u) ? [f] : []; }
      return claimOf() ? db.files.filter(f => f.claim_id === eq('claim_id') && !f.deleted) : [];
    }
    if (path === 'claim_events') {
      const c = claimOf(); if (!c) return []; const s = sideOf(u);
      return db.events.filter(e => e.claim_id === c.id && (e.visibility === 'shared' || e.visibility === s));
    }
    if (path === 'my_notifications') {
      let rows = db.notices.filter(n => mineNotice(n, u)).map(n => ({ ...n, read_at: n.read[u.id] || null })).sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (q.get('read_at') === 'is.null') rows = rows.filter(n => !n.read_at); return rows;
    }
    return undefined;
  }
  return { db, rpc, get };
}

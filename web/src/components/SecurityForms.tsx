'use client';
import { useState, useTransition } from 'react';
import { startEnrol, confirmEnrol, removeFactor, type Enrolment } from '@/app/security/actions';

export function SecurityPanel({ enabledFactor, canTurnOff }: { enabledFactor: string | null; canTurnOff: boolean }) {
  const [setup, setSetup] = useState<Enrolment | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (enabledFactor) {
    return (
      <div>
        <p>Two-step sign-in is <strong>on</strong>. You are asked for a code from your authenticator app each time you sign in.</p>
        {canTurnOff && <button disabled={pending} onClick={() => start(async () => { const r = await removeFactor(enabledFactor); setMessage({ ok: r.ok, text: r.message }); })}>Turn off two-step sign-in</button>}
        {!canTurnOff && <p className="form-note">Your role requires two-step sign-in, so it cannot be turned off.</p>}
        <div role="status" className={message?.ok === false ? 'form-error' : 'form-note'}>{message?.text}</div>
      </div>
    );
  }
  if (!setup?.factorId) {
    return (
      <div>
        <p>Two-step sign-in is <strong>off</strong>. Turn it on to protect this account with a code from an authenticator app (Microsoft Authenticator, Google Authenticator, 1Password and similar).</p>
        <button className="primary" disabled={pending} onClick={() => start(async () => { const r = await startEnrol(); if (r.ok) { setSetup(r); setMessage(null); } else setMessage({ ok: false, text: r.message }); })}>Set up two-step sign-in</button>
        <div role="status" className="form-error">{message?.ok === false ? message.text : ''}</div>
      </div>
    );
  }
  return (
    <form onSubmit={e => { e.preventDefault(); const code = String(new FormData(e.currentTarget).get('code') ?? ''); start(async () => { const r = await confirmEnrol(setup.factorId!, code); setMessage({ ok: r.ok, text: r.message }); if (r.ok) window.location.assign('/security'); }); }}>
      <p>1. Scan this with your authenticator app.</p>
      {setup.qr && <img src={setup.qr} alt="Set-up code to scan with your authenticator app" width={200} height={200} />}
      <p className="subtext">Cannot scan? Enter this key instead: <code>{setup.secret}</code></p>
      <p>2. Type the 6-digit code it shows.</p>
      <label>6-digit code<input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required /></label>
      <button className="primary" disabled={pending}>{pending ? 'Checking…' : 'Turn on'}</button>
      <div role="status" className={message?.ok ? 'form-note' : 'form-error'}>{message?.text}</div>
    </form>
  );
}

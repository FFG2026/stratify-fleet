'use client';
import { useState, type InputHTMLAttributes } from 'react';

// A password field with a Show/Hide button, so people can check what they typed (useful on a phone).
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <span className="password-field">
      <input {...props} type={shown ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button type="button" className="password-toggle" onClick={() => setShown(s => !s)} aria-pressed={shown} aria-label={shown ? 'Hide password' : 'Show password'}>{shown ? 'Hide' : 'Show'}</button>
    </span>
  );
}

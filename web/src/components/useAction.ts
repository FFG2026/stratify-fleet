'use client';
import { useState, useTransition, type FormEvent } from 'react';

export type ActionResult = { ok: boolean; message: string; redirectTo?: string };

// Runs a server action from a form WITHOUT React clearing the fields when it fails, and shows its message.
export function useAction(action: (data: FormData) => Promise<ActionResult | void>, resetOnSuccess = true, onSuccess?: (result: ActionResult) => void) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    start(async () => {
      const outcome = await action(data);
      if (outcome) { setResult(outcome); if (outcome.ok && resetOnSuccess) form.reset(); if (outcome.ok) onSuccess?.(outcome); }
    });
  };
  const run = (data: FormData) => start(async () => { const outcome = await action(data); if (outcome) setResult(outcome); });
  return { pending, result, onSubmit, run };
}

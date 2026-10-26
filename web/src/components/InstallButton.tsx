'use client';
import { useEffect, useState } from 'react';

type Prompt = Event & { prompt: () => Promise<void> };

// Shows a one-tap install button where the browser offers it (Android Chrome, desktop Chrome/Edge).
// iPhone has no such prompt, so the page's steps are the way there.
export function InstallButton() {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as Prompt); };
    const onInstalled = () => { setDone(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if (window.matchMedia('(display-mode: standalone)').matches) setDone(true);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);
  if (done) return <p className="form-note">Stratify is installed on this device.</p>;
  if (!prompt) return null;
  return <div className="actions"><button className="primary" type="button" onClick={() => prompt.prompt()}>Install Stratify on this device</button></div>;
}

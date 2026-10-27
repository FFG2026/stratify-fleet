'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { recentUnread } from '@/app/(app)/claim-actions';

type Toast = { id: string; claim_id: string | null; title: string; body: string | null };
const key = 'stratify-toasts-shown';
const seen = (): Set<string> => { try { return new Set(JSON.parse(sessionStorage.getItem(key) ?? '[]')); } catch { return new Set(); } };
const remember = (s: Set<string>) => { try { sessionStorage.setItem(key, JSON.stringify([...s].slice(-200))); } catch { /* storage can be blocked; toasts then repeat once per page load */ } };

// Pops up new notifications in the corner. Checks on load and every 30 seconds while the tab is open and visible.
export function NotificationToasts() {
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const shown = useRef<Set<string>>(new Set());
  const dismiss = useCallback((id: string) => setToasts(t => t.filter(x => x.id !== id)), []);
  const check = useCallback(async () => {
    if (document.visibilityState === 'hidden') return;
    const unread = await recentUnread();
    const fresh = unread.filter(n => !shown.current.has(n.id));
    if (!fresh.length) return;
    fresh.forEach(n => shown.current.add(n.id)); remember(shown.current);
    setToasts(t => [...fresh, ...t].slice(0, 3));
    fresh.forEach(n => setTimeout(() => dismiss(n.id), 12000));
    router.refresh();
  }, [dismiss, router]);
  useEffect(() => {
    shown.current = seen();
    check();
    const timer = setInterval(check, 30000);
    return () => clearInterval(timer);
  }, [check]);
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map(n => (
        <div className="toast-card" key={n.id}>
          <div>
            {n.claim_id ? <Link prefetch={false} href={'/claims/' + n.claim_id} onClick={() => dismiss(n.id)}><strong>{n.title}</strong></Link> : <strong>{n.title}</strong>}
            {n.body && <p>{n.body}</p>}
          </div>
          <button type="button" className="textbtn" aria-label="Dismiss" onClick={() => dismiss(n.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

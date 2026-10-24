'use client';
import { useEffect } from 'react';

// Sets the accent colour through the style API (allowed by the page's security policy; an inline style attribute would not be).
export function ApplyBranding({ accent }: { accent: string | null }) {
  useEffect(() => {
    if (accent && /^#[0-9a-fA-F]{6}$/.test(accent)) document.documentElement.style.setProperty('--accent', accent);
    return () => { document.documentElement.style.removeProperty('--accent'); };
  }, [accent]);
  return null;
}

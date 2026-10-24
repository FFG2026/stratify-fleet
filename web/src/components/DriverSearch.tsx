'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { findDrivers, type DriverSuggestion } from '@/app/(app)/driver-actions';

// Type two letters of a name and matching drivers appear. Staff only see drivers they are allowed to see.
export function DriverSearch({ initial, fleet }: { initial: string; fleet: string }) {
  const [value, setValue] = useState(initial);
  const [items, setItems] = useState<DriverSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const latest = useRef(0);
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) { setItems([]); return; }
    const id = ++latest.current;
    const timer = setTimeout(async () => {
      const found = await findDrivers(q, fleet || undefined);
      if (id === latest.current) { setItems(found); setOpen(true); }
    }, 250);
    return () => clearTimeout(timer);
  }, [value, fleet]);
  return (
    <form className="driver-search" action="/drivers" method="get" role="search" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      {fleet && <input type="hidden" name="fleet" value={fleet} />}
      <label>Search drivers by name
        <input name="q" value={value} onChange={e => { setValue(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} autoComplete="off"
          role="combobox" aria-expanded={open && items.length > 0} aria-controls="driver-suggestions" placeholder="Start typing a name" />
      </label>
      {open && items.length > 0 && (
        <ul id="driver-suggestions" className="suggestions" role="listbox">
          {items.map(d => <li key={d.id} role="option" aria-selected="false"><Link prefetch={false} href={'/drivers/' + d.id}>{d.name}</Link></li>)}
        </ul>
      )}
    </form>
  );
}

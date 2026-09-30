// Development-only: compares the design directions on a shared dev server.
// root.tsx renders it only when !import.meta.env.PROD.
import { useEffect, useState } from 'react';
import { Palette, X } from 'lucide-react';
import { setAppearance, useAppearance, type Design, type Theme } from '../lib/appearance';

const directions: { key: Design; name: string }[] = [
  { key: '0', name: 'Current' },
  { key: 'a', name: 'Plaque émaillée' },
  { key: 'b', name: 'Carnet de devis' },
  { key: 'c', name: 'Standard' },
];
const themeChoices: { key: Theme; name: string }[] = [
  { key: 'light', name: 'Light' },
  { key: 'dark', name: 'Dark' },
  { key: 'system', name: 'System' },
];
const openKey = 'eq-design-switcher-open';

export function DesignSwitcher() {
  const { design, theme } = useAppearance();
  // Collapsed until mounted, so it never covers the page on first paint.
  const [open, setOpen] = useState(false);
  // Automated browsers (tests, the screenshot script) never see it, so it
  // cannot cover what they check.
  const [automated, setAutomated] = useState(true);
  useEffect(() => {
    setAutomated(navigator.webdriver);
    let stored: string | null = null;
    try { stored = localStorage.getItem(openKey); } catch { /* Storage may be unavailable. */ }
    setOpen(stored === null ? !window.matchMedia('(max-width: 600px)').matches : stored === 'true');
  }, []);
  function toggle(next: boolean) {
    setOpen(next);
    try { localStorage.setItem(openKey, String(next)); } catch { /* Keep it for this visit. */ }
  }
  if (automated) return null;
  if (!open) return <button type="button" className="eq-design-switcher-tab" onClick={() => toggle(true)} aria-label={`Design switcher (design ${design.toUpperCase()})`}>
    <Palette aria-hidden="true" /><span>{design.toUpperCase()}</span>
  </button>;
  return <div className="eq-design-switcher" role="group" aria-label="Design switcher (development only)">
    <div role="group" aria-label="Design direction">
      {directions.map(entry => <button key={entry.key} type="button" aria-pressed={design === entry.key} onClick={() => setAppearance('design', entry.key)} title={entry.name}>
        <strong>{entry.key.toUpperCase()}</strong><span>{entry.name}</span>
      </button>)}
    </div>
    <div role="group" aria-label="Theme">
      {themeChoices.map(entry => <button key={entry.key} type="button" aria-pressed={theme === entry.key} onClick={() => setAppearance('theme', entry.key)}>{entry.name}</button>)}
    </div>
    <button type="button" className="eq-design-switcher-close" onClick={() => toggle(false)} aria-label="Collapse design switcher"><X aria-hidden="true" /></button>
  </div>;
}

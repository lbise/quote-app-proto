// Development-only: compares designs, presets and taste dials on a shared dev
// server, and previews the current page in a phone frame. root.tsx renders it
// only when !import.meta.env.PROD. French labels: the founders review in French.
import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useLocation } from 'react-router';
import { ChevronDown, ExternalLink, Palette, Smartphone, X } from 'lucide-react';
import {
  applyAppearance, dialValues, layoutValues, normalizeAppearance, presetNames, setAppearance, themes, useAppearance,
  type Appearance, type DialKey, type Layout,
} from '../lib/appearance';

/** The phone preview frame's window name. It survives navigation inside the frame. */
const frameName = 'eq-phone-preview';
const openKey = 'eq-design-switcher-open';
const dialsKey = 'eq-design-switcher-dials';
const phoneKey = 'eq-phone-preview';
const phone = { width: 390, height: 844 };

const presetLabels = { graphite: 'Graphite', sarcelle: 'Sarcelle', foret: 'Forêt', indigo: 'Indigo' } as const;
const dialRows: { key: DialKey; label: string; names: Record<string, string> }[] = [
  { key: 'font', label: 'Police', names: { geist: 'Geist', inter: 'Inter', hanken: 'Hanken', figtree: 'Figtree', source: 'Source' } },
  { key: 'accent', label: 'Accent', names: { graphite: 'Graphite', teal: 'Sarcelle', indigo: 'Indigo', forest: 'Forêt', red: 'Rouge', ochre: 'Ocre' } },
  { key: 'neutral', label: 'Gris', names: { cool: 'Froid', neutral: 'Neutre', warm: 'Chaud' } },
  { key: 'radius', label: 'Arrondis', names: { sharp: 'Net', medium: 'Moyen', soft: 'Doux' } },
  { key: 'density', label: 'Densité', names: { compact: 'Compacte', comfortable: 'Confortable' } },
  { key: 'accentUse', label: 'Usage de l’accent', names: { minimal: 'Minimal', rich: 'Riche' } },
  { key: 'panels', label: 'Panneaux', names: { lines: 'Lignes', tinted: 'Teintés' } },
  { key: 'badge', label: 'Badges', names: { dot: 'Point', pill: 'Pastille', outline: 'Contour' } },
];
/** Swatches for the accent choices; the real colours live in design-c.css. */
const swatches: Record<string, string> = { graphite: '#3f3f46', teal: '#0f766e', indigo: '#4f46e5', forest: '#2f6b3a', red: '#c2410c', ochre: '#b7791f' };
const layoutRows: { key: keyof Layout; label: string; names: Record<string, string> }[] = [
  { key: 'nav', label: 'Navigation', names: { topbar: 'Barre du haut', sidebar: 'Barre latérale' } },
  { key: 'mobileList', label: 'Liste mobile', names: { table: 'Tableau', grouped: 'Groupée' } },
];
const themeNames = { light: 'Clair', dark: 'Sombre', system: 'Système' } as const;

function stored(storage: 'local' | 'session', key: string) {
  try { return (storage === 'local' ? localStorage : sessionStorage).getItem(key); } catch { return null; }
}
function store(storage: 'local' | 'session', key: string, value: string) {
  try { (storage === 'local' ? localStorage : sessionStorage).setItem(key, value); } catch { /* Keep it for this visit. */ }
}

function Segmented<T extends string>({ label, values, names, value, onChange, swatch }: {
  label: string; values: readonly T[]; names: Record<string, string>; value: T; onChange: (value: T) => void; swatch?: boolean;
}) {
  const id = useId();
  return <div className="eq-ds-row">
    <span className="eq-ds-label" id={id}>{label}</span>
    <div className="eq-ds-segmented" role="group" aria-labelledby={id} data-swatch={swatch || undefined}>
      {values.map(entry => <button key={entry} type="button" aria-pressed={value === entry} onClick={() => onChange(entry)} title={swatch ? names[entry] : undefined}>
        {swatch ? <><span className="eq-ds-swatch" style={{ background: swatches[entry] }} aria-hidden="true" /><span className="eq-ds-sr">{names[entry]}</span></> : names[entry]}
      </button>)}
    </div>
  </div>;
}

export function DesignSwitcher() {
  const appearance = useAppearance();
  const location = useLocation();
  // Collapsed and hidden until mounted, so it never covers the first paint.
  // Automated browsers (tests, the screenshot script) never see it.
  const [mode, setMode] = useState<'hidden' | 'embedded' | 'visible'>('hidden');
  const [open, setOpen] = useState(false);
  const [dialsOpen, setDialsOpen] = useState(false);
  const [phoneOn, setPhoneOn] = useState(false);
  const [canPreview, setCanPreview] = useState(false);
  const frame = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (window.name === frameName && window.parent !== window) { setMode('embedded'); return; }
    if (navigator.webdriver) return;
    setMode('visible');
    const openStored = stored('local', openKey);
    setOpen(openStored === null ? !window.matchMedia('(max-width: 640px)').matches : openStored === 'true');
    setDialsOpen(stored('local', dialsKey) === 'true');
    const wide = window.matchMedia('(min-width: 720px)');
    const follow = () => setCanPreview(wide.matches);
    follow();
    wide.addEventListener('change', follow);
    setPhoneOn(stored('session', phoneKey) === 'on');
    return () => wide.removeEventListener('change', follow);
  }, []);

  // Inside the phone frame: follow the outer switcher, and let Escape close the frame.
  useEffect(() => {
    if (mode !== 'embedded') return;
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data = event.data as { type?: string; appearance?: Partial<Appearance> } | null;
      if (data?.type === 'eq-appearance' && data.appearance) applyAppearance(normalizeAppearance(data.appearance));
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[role="dialog"], [role="menu"]')) window.parent.postMessage({ type: 'eq-phone-close' }, window.location.origin);
    };
    window.addEventListener('message', receive);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('message', receive); window.removeEventListener('keydown', escape); };
  }, [mode]);

  const previewing = mode === 'visible' && phoneOn && canPreview;
  function togglePhone(next: boolean) {
    setPhoneOn(next);
    store('session', phoneKey, next ? 'on' : 'off');
  }
  useEffect(() => {
    if (!previewing) return;
    const receive = (event: MessageEvent) => {
      if (event.origin === window.location.origin && (event.data as { type?: string } | null)?.type === 'eq-phone-close') togglePhone(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) togglePhone(false); };
    window.addEventListener('message', receive);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('message', receive); window.removeEventListener('keydown', escape); };
  }, [previewing]);
  // Dial changes reach the frame at once; its cookies already match.
  useEffect(() => {
    if (previewing) frame.current?.contentWindow?.postMessage({ type: 'eq-appearance', appearance }, window.location.origin);
  }, [previewing, appearance]);

  if (mode !== 'visible') return null;
  const src = `${location.pathname}${location.search}`;
  const toggle = (next: boolean) => { setOpen(next); store('local', openKey, String(next)); };
  const toggleDials = () => { setDialsOpen(!dialsOpen); store('local', dialsKey, String(!dialsOpen)); };
  const summary = appearance.design === '0' ? 'Actuel' : appearance.preset === 'custom' ? 'Personnalisé' : presetLabels[appearance.preset];

  return <>
    {previewing && <PhonePreview src={src} frame={frame} onClose={() => togglePhone(false)} />}
    {!open ? <button type="button" className="eq-ds-pill" onClick={() => toggle(true)} aria-label={`Apparence (développement) : ${appearance.design === '0' ? 'design actuel' : `Standard, ${summary}`}`}>
      <Palette aria-hidden="true" /><span>{appearance.design === '0' ? '0' : summary}</span>
    </button> : <section className="eq-ds" aria-label="Apparence (développement)">
      <header className="eq-ds-header">
        <strong>Apparence</strong><span>dev</span>
        <button type="button" className="eq-ds-icon" onClick={() => toggle(false)} aria-label="Réduire"><X aria-hidden="true" /></button>
      </header>
      <div className="eq-ds-body">
        <Segmented label="Design" values={['0', 'c'] as const} names={{ '0': 'Actuel', c: 'Standard' }} value={appearance.design} onChange={value => setAppearance('design', value)} />
        <fieldset className="eq-ds-standard" disabled={appearance.design === '0'} aria-describedby={appearance.design === '0' ? 'eq-ds-ignored' : undefined}>
          <legend className="eq-ds-sr">Réglages du design Standard</legend>
          {appearance.design === '0' && <p className="eq-ds-note" id="eq-ds-ignored">Le design actuel ignore les réglages.</p>}
          <div className="eq-ds-row">
            <span className="eq-ds-label" id="eq-ds-preset">Preset{appearance.preset === 'custom' && <em>Personnalisé</em>}</span>
            <div className="eq-ds-segmented" role="group" aria-labelledby="eq-ds-preset">
              {presetNames.map(name => <button key={name} type="button" aria-pressed={appearance.preset === name} onClick={() => setAppearance('preset', name)}>{presetLabels[name]}</button>)}
            </div>
          </div>
          <button type="button" className="eq-ds-disclosure" aria-expanded={dialsOpen} aria-controls="eq-ds-dials" onClick={toggleDials}>
            <ChevronDown aria-hidden="true" />Réglages
          </button>
          {dialsOpen && <div className="eq-ds-dials" id="eq-ds-dials">
            {dialRows.map(row => <Segmented key={row.key} label={row.label} values={dialValues[row.key] as readonly string[]} names={row.names} value={appearance[row.key]} swatch={row.key === 'accent'} onChange={value => setAppearance(row.key, value as never)} />)}
          </div>}
          {layoutRows.map(row => <Segmented key={row.key} label={row.label} values={layoutValues[row.key] as readonly string[]} names={row.names} value={appearance[row.key]} onChange={value => setAppearance(row.key, value as never)} />)}
        </fieldset>
        <Segmented label="Thème" values={themes} names={themeNames} value={appearance.theme} onChange={value => setAppearance('theme', value)} />
        {canPreview && <div className="eq-ds-row eq-ds-switch-row">
          <span className="eq-ds-label" id="eq-ds-phone"><Smartphone aria-hidden="true" />Téléphone</span>
          <button type="button" role="switch" aria-checked={phoneOn} aria-labelledby="eq-ds-phone" className="eq-ds-switch" onClick={() => togglePhone(!phoneOn)}><span aria-hidden="true" /></button>
        </div>}
      </div>
    </section>}
  </>;
}

/** The current page in a 390×844 frame, scaled down to fit short screens. */
function PhonePreview({ src, frame, onClose }: { src: string; frame: RefObject<HTMLIFrameElement | null>; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const close = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerHeight - 88) / (phone.height + 24)));
    fit();
    window.addEventListener('resize', fit);
    close.current?.focus();
    return () => window.removeEventListener('resize', fit);
  }, []);
  function fullScreen() {
    const opened = window.open(src, 'eq-phone-window', `popup,width=${phone.width},height=${phone.height}`);
    if (!opened) window.location.assign(src);
  }
  return <div className="eq-phone">
    <div className="eq-phone-backdrop" onClick={onClose} aria-hidden="true" />
    <section className="eq-phone-stage" aria-label="Aperçu téléphone">
      <div className="eq-phone-bar">
        <span>{phone.width} × {phone.height}</span>
        <button type="button" onClick={fullScreen}><ExternalLink aria-hidden="true" />Ouvrir en plein écran</button>
        <button type="button" ref={close} onClick={onClose} aria-label="Fermer l’aperçu téléphone"><X aria-hidden="true" /></button>
      </div>
      <div className="eq-phone-device" style={{ '--eq-phone-scale': scale } as CSSProperties}>
        <iframe ref={frame} name={frameName} title="Aperçu téléphone de la page" src={src} width={phone.width} height={phone.height} />
      </div>
    </section>
  </div>;
}


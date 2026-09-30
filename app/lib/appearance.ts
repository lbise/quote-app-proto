// Appearance preferences kept in cookies: the colour theme (a user feature),
// and the design direction with its taste dials (a development-only comparison
// aid). Shared by the server loader and the browser. See app/styles/README.md.
import { useSyncExternalStore } from 'react';
import { useRouteLoaderData } from 'react-router';

export const designs = ['0', 'c'] as const;
export const themes = ['light', 'dark', 'system'] as const;
export const dialValues = {
  font: ['geist', 'inter', 'hanken', 'figtree', 'source'],
  accent: ['graphite', 'teal', 'indigo', 'forest', 'red', 'ochre'],
  neutral: ['cool', 'neutral', 'warm'],
  radius: ['sharp', 'medium', 'soft'],
  density: ['compact', 'comfortable'],
  accentUse: ['minimal', 'rich'],
  panels: ['lines', 'tinted'],
  badge: ['dot', 'pill', 'outline'],
} as const;
export const layoutValues = {
  nav: ['topbar', 'sidebar'],
  mobileList: ['table', 'grouped'],
} as const;

export type Design = typeof designs[number];
export type Theme = typeof themes[number];
export type Dials = { [K in keyof typeof dialValues]: typeof dialValues[K][number] };
export type Layout = { [K in keyof typeof layoutValues]: typeof layoutValues[K][number] };
export type DialKey = keyof Dials;

export const presets = {
  graphite: { font: 'inter', accent: 'graphite', neutral: 'neutral', radius: 'medium', density: 'compact', accentUse: 'minimal', panels: 'lines', badge: 'dot' },
  sarcelle: { font: 'geist', accent: 'teal', neutral: 'cool', radius: 'medium', density: 'comfortable', accentUse: 'rich', panels: 'lines', badge: 'pill' },
  foret: { font: 'figtree', accent: 'forest', neutral: 'warm', radius: 'soft', density: 'comfortable', accentUse: 'rich', panels: 'tinted', badge: 'pill' },
  indigo: { font: 'hanken', accent: 'indigo', neutral: 'cool', radius: 'sharp', density: 'compact', accentUse: 'minimal', panels: 'lines', badge: 'outline' },
} as const satisfies Record<string, Dials>;
export type PresetName = keyof typeof presets;
export type Preset = PresetName | 'custom';
export const presetNames = Object.keys(presets) as PresetName[];

export type Appearance = { design: Design; theme: Theme; preset: Preset } & Dials & Layout;

export const defaultAppearance: Appearance = { design: 'c', theme: 'system', preset: 'graphite', ...presets.graphite, nav: 'topbar', mobileList: 'grouped' };

export const designCookie = 'eq-design';
export const themeCookie = 'eq-theme';
/** Preset, dials and layout choices in one URL-encoded query string. */
export const lookCookie = 'eq-look';

const dialKeys = Object.keys(dialValues) as DialKey[];
const layoutKeys = Object.keys(layoutValues) as (keyof Layout)[];
const lookKeys = ['preset', ...dialKeys, ...layoutKeys] as const;
type LookKey = typeof lookKeys[number];

/** The `<html>` attribute of each preference, e.g. accentUse → data-accent-use. */
export const attributeOf = (key: keyof Appearance) => `data-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;
export const appearanceKeys = ['design', 'theme', ...lookKeys] as (keyof Appearance)[];

function cookieValue(cookie: string | null | undefined, name: string) {
  const match = cookie?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!match) return undefined;
  try { return decodeURIComponent(match[1]); } catch { return undefined; }
}

const oneOf = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  (values as readonly unknown[]).includes(value) ? value as T : undefined;

/** Validates every value; unknown or missing ones take their default. */
export function normalizeAppearance(input: Partial<Record<keyof Appearance, unknown>>): Appearance {
  // Designs A and B were withdrawn; people who had chosen them see Standard.
  const design = oneOf(designs, input.design) ?? defaultAppearance.design;
  const theme = oneOf(themes, input.theme) ?? defaultAppearance.theme;
  const preset = oneOf([...presetNames, 'custom'] as Preset[], input.preset) ?? defaultAppearance.preset;
  // A named preset fixes every dial; a custom look keeps each valid dial.
  const dials = preset === 'custom'
    ? Object.fromEntries(dialKeys.map(key => [key, oneOf(dialValues[key], input[key]) ?? presets.graphite[key]])) as Dials
    : { ...presets[preset] };
  const layout = Object.fromEntries(layoutKeys.map(key => [key, oneOf(layoutValues[key], input[key]) ?? defaultAppearance[key]])) as Layout;
  return { design, theme, preset, ...dials, ...layout };
}

export function parseAppearance(cookie: string | null | undefined): Appearance {
  const look = new URLSearchParams(cookieValue(cookie, lookCookie) ?? '');
  return normalizeAppearance({
    design: cookieValue(cookie, designCookie),
    theme: cookieValue(cookie, themeCookie),
    ...Object.fromEntries(lookKeys.map(key => [key, look.get(key) ?? undefined])),
  });
}

/** `<html>` attributes for an appearance. `data-theme-resolved` is left to themeScript. */
export function appearanceAttributes(appearance: Appearance) {
  return Object.fromEntries(appearanceKeys.map(key => [attributeOf(key), appearance[key]])) as Record<string, string>;
}

/**
 * Runs in <head> before first paint. It resolves `system` from
 * prefers-color-scheme into `data-theme-resolved`, mirrors the result in the
 * `.dark` class that shadcn components use, and follows system changes.
 * `window.__eqApplyTheme` re-applies it after the attributes change.
 */
export const themeScript = `(function(){var d=document.documentElement,m=window.matchMedia('(prefers-color-scheme: dark)');function a(){var t=d.getAttribute('data-theme'),r=t==='dark'||(t!=='light'&&m.matches)?'dark':'light';d.setAttribute('data-theme-resolved',r);d.classList.toggle('dark',r==='dark');}a();m.addEventListener('change',a);window.__eqApplyTheme=a;})();`;

declare global { interface Window { __eqApplyTheme?: () => void } }

const listeners = new Set<() => void>();

function readDocument(): Appearance {
  const root = document.documentElement;
  return normalizeAppearance(Object.fromEntries(appearanceKeys.map(key => [key, root.getAttribute(attributeOf(key)) ?? undefined])));
}

/** Sets the `<html>` attributes without persisting them (used by the phone preview frame). */
export function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(appearanceAttributes(appearance))) root.setAttribute(name, value);
  window.__eqApplyTheme?.();
  listeners.forEach(listener => listener());
}

const cookieAttributes = '; Path=/; Max-Age=31536000; SameSite=Lax';

/** Persist preferences for a year and apply them to <html> at once. */
export function updateAppearance(change: Partial<Appearance>) {
  const next = normalizeAppearance({ ...readDocument(), ...change });
  document.cookie = `${designCookie}=${next.design}${cookieAttributes}`;
  document.cookie = `${themeCookie}=${next.theme}${cookieAttributes}`;
  const look = new URLSearchParams(lookKeys.map(key => [key, next[key]])).toString();
  document.cookie = `${lookCookie}=${encodeURIComponent(look)}${cookieAttributes}`;
  applyAppearance(next);
  return next;
}

/** Change one preference. A dial makes the look custom; a preset sets every dial. */
export function setAppearance<K extends keyof Appearance>(key: K, value: Appearance[K]) {
  if (key === 'preset') {
    const name = value as Preset;
    return updateAppearance(name === 'custom' ? { preset: 'custom' } : { preset: name, ...presets[name] });
  }
  const current = readDocument();
  if ((dialKeys as string[]).includes(key) && current[key] !== value) return updateAppearance({ ...current, preset: 'custom', [key]: value });
  return updateAppearance({ [key]: value } as Partial<Appearance>);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

let snapshot: { key: string; value: Appearance } | null = null;
function documentSnapshot() {
  const value = readDocument();
  const key = JSON.stringify(value);
  if (snapshot?.key !== key) snapshot = { key, value };
  return snapshot.value;
}

/** The current preferences: the server's cookie reading until the browser changes them. */
export function useAppearance(): Appearance {
  const root = useRouteLoaderData('root') as Partial<Appearance> | undefined;
  const server = normalizeAppearance(root ?? {});
  const serverKey = JSON.stringify(server);
  return useSyncExternalStore(subscribe, documentSnapshot, () => serverSnapshot(serverKey, server));
}

let serverCache: { key: string; value: Appearance } | null = null;
function serverSnapshot(key: string, value: Appearance) {
  if (serverCache?.key !== key) serverCache = { key, value };
  return serverCache.value;
}

// Appearance preferences kept in cookies: the colour theme (a user feature) and
// the visual design direction (a development-only comparison aid). Shared by the
// server loader and the browser. See app/styles/README.md.
import { useSyncExternalStore } from 'react';
import { useRouteLoaderData } from 'react-router';

export const designs = ['0', 'a', 'b', 'c'] as const;
export const themes = ['light', 'dark', 'system'] as const;
export type Design = typeof designs[number];
export type Theme = typeof themes[number];
export type Appearance = { design: Design; theme: Theme };

export const designCookie = 'eq-design';
export const themeCookie = 'eq-theme';

function cookieValue(cookie: string | null | undefined, name: string) {
  const match = cookie?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

export function parseAppearance(cookie: string | null | undefined): Appearance {
  const design = cookieValue(cookie, designCookie);
  const theme = cookieValue(cookie, themeCookie);
  return {
    design: (designs as readonly string[]).includes(design ?? '') ? design as Design : '0',
    theme: (themes as readonly string[]).includes(theme ?? '') ? theme as Theme : 'system',
  };
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

/** Persist a preference for a year and apply it to <html> at once. */
export function setAppearance<K extends keyof Appearance>(key: K, value: Appearance[K]) {
  const name = key === 'design' ? designCookie : themeCookie;
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  document.documentElement.setAttribute(`data-${key}`, value);
  window.__eqApplyTheme?.();
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The current preferences: the server's cookie reading until the browser changes them. */
export function useAppearance(): Appearance {
  const root = useRouteLoaderData('root') as Partial<Appearance> | undefined;
  const fallback: Appearance = { design: root?.design ?? '0', theme: root?.theme ?? 'system' };
  const design = useSyncExternalStore(subscribe, () => (document.documentElement.dataset.design as Design | undefined) ?? fallback.design, () => fallback.design);
  const theme = useSyncExternalStore(subscribe, () => (document.documentElement.dataset.theme as Theme | undefined) ?? fallback.theme, () => fallback.theme);
  return { design, theme };
}

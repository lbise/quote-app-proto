// THROWAWAY shared UI switcher. Never rendered in a production build.
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from './ui/button';
export const prototypeVariants = [{ key: 'A', name: 'Desk' }, { key: 'B', name: 'Review' }, { key: 'C', name: 'Focus' }] as const;
export function PrototypeSwitcher() {
  const [params, setParams] = useSearchParams();
  const index = Math.max(0, prototypeVariants.findIndex(v => v.key === params.get('variant')));
  function cycle(delta: number) {
    const next = new URLSearchParams(params);
    next.set('variant', prototypeVariants[(index + delta + prototypeVariants.length) % prototypeVariants.length].key);
    setParams(next, { replace: true, preventScrollReset: true });
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable], [role="dialog"], [role="tablist"], [role="slider"]'))) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowLeft' ? -1 : 1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  if (import.meta.env.PROD) return null;
  return <nav className="qp-switcher" aria-label="Prototype layouts">
    <span className="qp-switcher-tag">PROTOTYPE v0.1</span>
    <Button variant="ghost" size="icon" aria-label="Previous layout" onClick={() => cycle(-1)}><ArrowLeft /></Button>
    <span aria-live="polite">{prototypeVariants[index].key} <span className="qp-switcher-name">· {prototypeVariants[index].name}</span></span>
    <Button variant="ghost" size="icon" aria-label="Next layout" onClick={() => cycle(1)}><ArrowRight /></Button>
  </nav>;
}

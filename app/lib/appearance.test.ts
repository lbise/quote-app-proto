import { describe, expect, it } from 'vitest';
import { appearanceAttributes, parseAppearance, presets } from './appearance';

const look = (values: Record<string, string>) => `eq-look=${encodeURIComponent(new URLSearchParams(values).toString())}`;

describe('appearance cookies', () => {
  it('defaults to Standard with the Graphite preset, the top bar and the grouped phone list', () => {
    expect(parseAppearance(undefined)).toEqual({ design: 'c', theme: 'system', preset: 'graphite', ...presets.graphite, nav: 'topbar', mobileList: 'grouped' });
  });

  it('sends people who had chosen a withdrawn design to Standard', () => {
    expect(parseAppearance('eq-design=a').design).toBe('c');
    expect(parseAppearance('eq-design=b; eq-theme=dark')).toMatchObject({ design: 'c', theme: 'dark' });
    expect(parseAppearance('eq-design=0').design).toBe('0');
  });

  it('lets a named preset fix every dial', () => {
    expect(parseAppearance(look({ preset: 'foret', font: 'inter', nav: 'sidebar' }))).toMatchObject({ preset: 'foret', ...presets.foret, nav: 'sidebar' });
  });

  it('keeps each valid dial of a custom look and replaces invalid ones', () => {
    const appearance = parseAppearance(look({ preset: 'custom', font: 'source', accent: 'ochre', radius: 'huge', mobileList: 'table' }));
    expect(appearance).toMatchObject({ preset: 'custom', font: 'source', accent: 'ochre', radius: presets.graphite.radius, mobileList: 'table' });
  });

  it('ignores a malformed cookie', () => {
    expect(parseAppearance('eq-look=%E0%A4%A').preset).toBe('graphite');
  });

  it('names the html attributes of the design contract', () => {
    expect(appearanceAttributes(parseAppearance(undefined))).toMatchObject({ 'data-design': 'c', 'data-accent-use': 'minimal', 'data-mobile-list': 'grouped', 'data-nav': 'topbar', 'data-preset': 'graphite' });
  });
});

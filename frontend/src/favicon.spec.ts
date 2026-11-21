import { readFileSync } from 'node:fs';

// `ng test` runs from the frontend directory.
const FAVICON = readFileSync('public/favicon.svg', 'utf8');
const TOKENS = readFileSync('src/styles/_tokens.scss', 'utf8');

function token(name: string): string {
  const match = TOKENS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`token --${name} not found`);
  return match[1].toLowerCase();
}

function parse(svg: string): Document {
  return new DOMParser().parseFromString(svg, 'image/svg+xml');
}

describe('favicon', () => {
  it('is well-formed SVG', () => {
    const doc = parse(FAVICON);
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc.documentElement.tagName).toBe('svg');
  });

  it('is titled Spitsrit', () => {
    expect(parse(FAVICON).querySelector('title')?.textContent).toBe('Spitsrit');
  });

  it('uses only the brand colours from the design tokens', () => {
    const fills = [...FAVICON.matchAll(/fill="([^"]+)"/g)].map((m) => m[1].toLowerCase());
    expect(new Set(fills)).toEqual(new Set([token('sp-brand'), token('sp-on-brand')]));
  });
});

import { readFileSync, readdirSync } from 'node:fs';

// `ng test` runs from the frontend directory.
const APP_DIR = 'src/app';
const TOKENS = readFileSync('src/styles/_tokens.scss', 'utf8');

/** Component styles only do layout: colours, fonts and type sizes come from the tokens. */
const FORBIDDEN: [string, RegExp][] = [
  ['hex colour', /#[0-9a-fA-F]{3,8}\b/],
  ['rgb/hsl/oklch colour', /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/],
  // Only `transparent`, `currentColor` and `inherit` are allowed as keywords.
  [
    'named colour',
    /\b(black|white|gr[ae]y|silver|red|green|blue|yellow|orange|purple|pink|brown|navy|teal|cyan|magenta|lime|maroon|olive|aqua|gold|crimson|indigo|violet)\b(?!-)\s*[;,)!]?\s*$/i,
  ],
  ['font family', /font-family\s*:\s*(?!\s|var\()/],
  ['font shorthand', /(?<![-\w])font\s*:\s*(?!\s|var\()/],
  ['hard-coded font size', /font-size\s*:\s*(?!\s|var\()/],
];

function componentStyles(): string[] {
  return readdirSync(APP_DIR, { recursive: true })
    .filter((path) => path.endsWith('.scss'))
    .map((path) => `${APP_DIR}/${path}`);
}

describe('component styles', () => {
  const files = componentStyles();

  it('finds the component stylesheets', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(FORBIDDEN)('contain no %s', (_name, pattern) => {
    const offenders = files.filter((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .some((line) => pattern.test(line.replace(/\/\/.*$/, ''))),
    );
    expect(offenders).toEqual([]);
  });
});

/** Relative luminance of a `#rrggbb` colour, per WCAG 2.x. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** The `[light, dark]` values of a token, which is either `light-dark(a, b)` or a single value. */
function token(name: string): [string, string] {
  const match = new RegExp(`--${name}:\\s*(?:light-dark\\((#\\w+), (#\\w+)\\)|(#\\w+));`).exec(
    TOKENS,
  );
  if (!match) {
    throw new Error(`Token ${name} not found`);
  }
  return [match[1] ?? match[3], match[2] ?? match[3]];
}

// Material surfaces for the neutral palette: tone 98 in light mode, tone 6 in dark mode.
const SURFACE = ['#faf9fd', '#121316'];
const ON_SURFACE = ['#1a1b1f', '#e3e2e6'];
const AA = 4.5;

describe('colour tokens meet WCAG AA', () => {
  it.each([0, 1])('for text and status colours (scheme %i)', (scheme) => {
    const pairs: [string, string][] = [
      [token('sp-on-brand')[scheme], token('sp-brand')[scheme]],
      [token('sp-on-sign')[scheme], token('sp-sign')[scheme]],
      [token('sp-signal-red')[scheme], SURFACE[scheme]],
      [token('sp-signal-red')[scheme], token('sp-signal-green-surface')[scheme]],
      [token('sp-blue')[scheme], SURFACE[scheme]],
      [ON_SURFACE[scheme], token('sp-signal-green-surface')[scheme]],
    ];
    for (const [foreground, background] of pairs) {
      expect(contrast(foreground, background), `${foreground} on ${background}`).toBeGreaterThan(
        AA,
      );
    }
  });
});

// Screenshots of the main pages in each design, preset, navigation and theme, taken
// against a running dev server. Seeds a dedicated demo account with French
// Swiss sample data in the local development database first.
//
//   npm run design:screens
//   npm run design:screens -- --design=c --preset=foret --nav=sidebar --theme=dark --page=quotes,workspace --device=mobile
//   npm run design:screens -- --base-url=http://192.168.1.20:5173 --no-seed
//
// Output: .impeccable/review/designs/c-<preset>-<nav>-<theme>-<page>-<device>.png
// for Standard and 0-<theme>-<page>-<device>.png for the current design
// (git-ignored). See app/styles/README.md.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

loadDotenv({ quiet: true });

const designs = ['0', 'c'] as const;
const presets = ['graphite', 'sarcelle', 'foret', 'indigo'] as const;
const navs = ['topbar', 'sidebar'] as const;
const themes = ['light', 'dark'] as const;
const pages = ['signin', 'quotes', 'workspace', 'customers', 'settings'] as const;
const devices = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } } as const;
type Device = keyof typeof devices;

const account = { email: 'design-review@easy-quote.test', password: 'design-review-password' };
const outputDir = resolve('.impeccable/review/designs');
const usage = `Usage: npm run design:screens -- [--base-url=URL] [--design=0,c] [--preset=${presets.join(',')}] [--nav=${navs.join(',')}] [--theme=light,dark] [--page=${pages.join(',')}] [--device=desktop,mobile] [--no-seed]`;

class ScriptError extends Error {}

function options() {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new ScriptError(usage);
    args.set(match[1], match[2] ?? 'true');
  }
  const list = <T extends string>(name: string, all: readonly T[]): T[] => {
    const value = args.get(name);
    if (!value) return [...all];
    const chosen = value.split(',').map(entry => entry.trim().toLowerCase()) as T[];
    const unknown = chosen.filter(entry => !all.includes(entry));
    if (unknown.length) throw new ScriptError(`Unknown --${name} ${unknown.join(', ')}. Choose from ${all.join(', ')}.`);
    return chosen;
  };
  for (const key of args.keys()) if (!['base-url', 'design', 'preset', 'nav', 'theme', 'page', 'device', 'no-seed', 'help'].includes(key)) throw new ScriptError(usage);
  if (args.has('help')) { console.info(usage); process.exit(0); }
  return {
    baseURL: (args.get('base-url') ?? process.env.DESIGN_SCREENS_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
    designs: list('design', designs),
    // By default every preset with the top bar, plus the sidebar for Graphite.
    looks: args.has('nav')
      ? list('preset', presets).flatMap(preset => list('nav', navs).map(nav => ({ preset, nav })))
      : list('preset', presets).flatMap(preset => [{ preset, nav: 'topbar' as const }, ...(preset === 'graphite' && !args.has('preset') ? [{ preset, nav: 'sidebar' as const }] : [])]),
    themes: list('theme', themes),
    pages: list('page', pages),
    devices: list('device', Object.keys(devices) as Device[]),
    seed: !args.has('no-seed'),
  };
}

/** Only the local development database, never a shared one. */
function localDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  try {
    const url = new URL(value ?? '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/_local$/.test(decodeURIComponent(url.pathname.slice(1)))) throw new Error();
    return value!;
  } catch {
    throw new ScriptError('DATABASE_URL must be a loopback PostgreSQL database whose name ends in _local. The demo account is only seeded there.');
  }
}

// --- Sample data -----------------------------------------------------------

type Line = { id: string; sectionId: string; description: string; mode: 'quantity' | 'fixed'; quantity: string; unit: string; unitPrice: string; amount: string };
const fixed = (id: string, sectionId: string, description: string, amount: string): Line => ({ id, sectionId, description, mode: 'fixed', quantity: '', unit: '', unitPrice: '', amount });
const priced = (id: string, sectionId: string, description: string, quantity: string, unit: string, unitPrice: string): Line => ({ id, sectionId, description, mode: 'quantity', quantity, unit, unitPrice, amount: '' });

const business = {
  businessName: 'Atelier du Fil Sàrl',
  businessAddress: 'Route de la Menuiserie 6\n1027 Saint-Saphorin',
  businessContact: 'bonjour@atelier-du-fil.ch · 021 555 01 14',
  vatRegistered: true,
  vatId: 'CHE-123.456.789 TVA',
  terms: 'Prix en CHF, TVA comprise. Acompte de 30 % à la commande, solde à 30 jours. Garantie de 2 ans sur les ouvrages.',
};

const customers = [
  { name: 'Camille Morel', address: 'Chemin des Tilleuls 14\n1024 Rivaz', contact: '' },
  { name: 'Fiduciaire Rochat SA', address: 'Avenue de la Gare 12\n1003 Lausanne', contact: 'Mme Sophie Rochat' },
  { name: 'Commune de Lutry', address: 'Service des bâtiments\nPlace du Temple 1\n1095 Lutry', contact: 'M. Pierre Bovet' },
  { name: 'Nicolas et Léa Favre', address: 'Route de Chexbres 31\n1071 Chexbres', contact: '' },
  { name: 'Émilie Dubois', address: 'Rue du Bourg 5\n1800 Vevey', contact: '079 555 12 34' },
  { name: 'Boulangerie Gerber Sàrl', address: 'Grand-Rue 22\n1110 Morges', contact: 'M. Luc Gerber' },
  { name: 'Anne-Sophie Berset', address: 'Chemin du Levant 3\n1005 Lausanne', contact: '' },
];

const customerFields = (name: string) => {
  const customer = customers.find(entry => entry.name === name)!;
  return { customerName: customer.name, customerAddress: customer.address, customerContact: customer.contact };
};

type Draft = Record<string, unknown> & { reference: string };
type SampleQuote = { title: string; build: (draft: Draft) => Draft; then?: ('publish' | 'new-draft' | 'archive')[]; after?: (draft: Draft) => Draft; messages?: { role: 'artisan' | 'assistant'; fr: string; en: string }[] };

const samples: SampleQuote[] = [
  {
    title: 'Agencements intérieurs sur mesure',
    build: draft => ({
      ...draft, ...business, ...customerFields('Camille Morel'),
      title: 'Agencements intérieurs sur mesure', siteAddress: 'Chemin des Tilleuls 14\n1024 Rivaz',
      issueDate: '2026-09-18', validUntil: '2026-10-18', discountMode: 'percent', discount: '5',
      sections: [
        { id: 'kitchen', title: 'Cuisine' }, { id: 'entry', title: 'Entrée' }, { id: 'living', title: 'Séjour' },
        { id: 'bedroom', title: 'Chambre principale' }, { id: 'bathroom', title: 'Salle de bains' },
      ],
      lines: [
        fixed('k1', 'kitchen', 'Relevé final, protection des sols et installation de chantier.', '650.00'),
        fixed('k2', 'kitchen', 'Meuble bas sur mesure en mélaminé chêne naturel, L 3 180 mm, P 600 mm, H 720 mm, avec caissons, plinthes noires et réglage des façades.', '4800.00'),
        priced('k3', 'kitchen', 'Plan de travail stratifié compact noir, chants finis et découpes pour évier et plaque de cuisson.', '4.8', 'm', '610.00'),
        priced('k4', 'kitchen', 'Façade battante en MDF laqué mat, perçages et charnières amorties compris.', '6', 'pce', '385.00'),
        fixed('e1', 'entry', 'Vestiaire d’entrée avec banc, patères et casiers à chaussures, en chêne huilé.', '2350.00'),
        priced('e2', 'entry', 'Habillage mural en lames de chêne, pose sur lattage.', '7.5', 'm²', '145.00'),
        fixed('l1', 'living', 'Bibliothèque murale sur mesure, 5 modules, fixations invisibles.', '5900.00'),
        priced('l2', 'living', 'Tablettes flottantes en chêne massif, 40 mm, fixation cachée.', '4', 'pce', '240.00'),
        fixed('b1', 'bedroom', 'Dressing en angle avec portes coulissantes miroir et éclairage LED intégré.', '6400.00'),
        priced('b2', 'bathroom', 'Meuble vasque suspendu en chêne, traitement hydrofuge.', '1', 'pce', '1850.00'),
        fixed('b3', 'bathroom', 'Évacuation des déchets et nettoyage de fin de chantier.', '480.00'),
      ],
    }),
    messages: [
      { role: 'artisan', fr: 'Cuisine chez Camille Morel à Rivaz : meuble bas 3,18 m en chêne, plan compact noir 4,8 m à 610 le mètre, six façades laquées. Ajoute l’entrée, le séjour et la chambre comme on a vu sur place.', en: 'Kitchen for Camille Morel in Rivaz: 3.18 m oak base unit, 4.8 m black compact worktop at 610 per metre, six lacquered doors. Add the entry, living room and bedroom as we saw on site.' },
      { role: 'assistant', fr: 'J’ai organisé le devis en cinq sections et ajouté 11 lignes. Le plan de travail est calculé à 4,8 m × 610.00. Vérifiez le prix du dressing, que j’ai repris de votre note.', en: 'I organised the Quote into five sections and added 11 lines. The worktop is calculated at 4.8 m × 610.00. Check the wardrobe price, taken from your note.' },
      { role: 'artisan', fr: 'Mets une remise de 5 % et une validité d’un mois.', en: 'Apply a 5% discount and one month validity.' },
      { role: 'assistant', fr: 'C’est fait : remise de 5 % avant TVA et offre valable jusqu’au 18 octobre 2026.', en: 'Done: 5% discount before VAT, and the offer is valid until 18 October 2026.' },
    ],
  },
  {
    title: 'Rénovation de la salle de bains',
    build: draft => ({
      ...draft, ...business, ...customerFields('Nicolas et Léa Favre'),
      title: 'Rénovation de la salle de bains', siteAddress: 'Route de Chexbres 31\n1071 Chexbres', issueDate: '2026-08-04', validUntil: '2026-09-04',
      lines: [
        fixed('s1', '', 'Démontage du mobilier existant et évacuation.', '520.00'),
        priced('s2', '', 'Meuble colonne en chêne, portes à ouverture par pression.', '2', 'pce', '980.00'),
        fixed('s3', '', 'Pose et raccordements, finitions silicone.', '740.00'),
      ],
    }),
    then: ['publish'],
  },
  {
    title: 'Bibliothèque de la salle de conférence',
    build: draft => ({
      ...draft, ...business, ...customerFields('Fiduciaire Rochat SA'),
      title: 'Bibliothèque de la salle de conférence', siteAddress: 'Avenue de la Gare 12\n1003 Lausanne', issueDate: '2026-07-21',
      lines: [
        fixed('r1', '', 'Bibliothèque en noyer, 4 m linéaires, avec portes vitrées en partie haute.', '8900.00'),
        fixed('r2', '', 'Livraison et montage.', '650.00'),
      ],
    }),
    then: ['publish', 'new-draft'],
    after: draft => ({ ...draft, lines: [...(draft.lines as Line[]), priced('r3', '', 'Éclairage LED intégré aux tablettes.', '8', 'm', '85.00')] }),
  },
  {
    title: 'Remplacement des fenêtres du collège',
    build: draft => ({
      ...draft, ...business, ...customerFields('Commune de Lutry'),
      title: 'Remplacement des fenêtres du collège', siteAddress: 'Collège du Grand-Pont\n1095 Lutry', issueDate: '2026-09-02',
      lines: [
        priced('w1', '', 'Fenêtre bois-métal, triple vitrage, 120 × 140 cm.', '14', 'pce', '1640.00'),
        priced('w2', '', 'Dépose des anciennes fenêtres et élimination.', '14', 'pce', ''),
        fixed('w3', '', 'Échafaudage et protections.', ''),
      ],
    }),
  },
  {
    title: 'Cuisine d’été',
    build: draft => ({
      ...draft, ...business, ...customerFields('Émilie Dubois'),
      title: 'Cuisine d’été', siteAddress: 'Rue du Bourg 5\n1800 Vevey', issueDate: '2026-05-12',
      lines: [fixed('c1', '', 'Meuble extérieur en mélèze avec plan en granit.', '6200.00')],
    }),
    then: ['publish', 'archive'],
  },
  {
    title: 'Escalier en chêne',
    build: draft => ({
      ...draft, ...business,
      title: 'Escalier en chêne', issueDate: '2026-09-20',
      lines: [priced('t1', '', 'Marches en chêne massif, 40 mm, huilées.', '14', 'pce', '')],
    }),
  },
];

// --- HTTP ------------------------------------------------------------------

class Session {
  cookies = new Map<string, string>();
  constructor(readonly baseURL: string) {}
  header() { return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '); }
  keep(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }
  async fetch(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.baseURL}${path}`, { ...init, redirect: 'manual', headers: { origin: this.baseURL, cookie: this.header(), ...init.headers } });
    this.keep(response);
    return response;
  }
  async quotes<T>(body?: Record<string, unknown>): Promise<T> {
    const response = await this.fetch('/api/quotes', body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), ...body }) } : {});
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new ScriptError(`/api/quotes ${body?.action ?? 'GET'} failed with ${response.status}: ${data.error ?? 'unknown error'}.`);
    return data;
  }
}

async function signIn(baseURL: string) {
  const session = new Session(baseURL);
  const response = await session.fetch('/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(account) });
  if (!response.ok) throw new ScriptError(`Signing in the demo account failed with ${response.status}. Is the dev server running at ${baseURL}, with this origin in AUTH_TRUSTED_ORIGINS? Run without --no-seed to create the account.`);
  const language = await session.fetch('/language', { method: 'POST', body: new URLSearchParams({ locale: 'fr', returnTo: '/quotes' }) });
  if (language.status >= 400) throw new ScriptError('Setting the interface language failed.');
  return session;
}

type Detail = { id: string; version: number; draft: Draft | null };

async function seed(baseURL: string) {
  const { connectDatabase } = await import('../app/lib/db.server');
  const { createAuthForDatabase } = await import('../app/lib/auth.server');
  const { seedDemoAccounts } = await import('../app/lib/demo-accounts.server');
  const { quoteMessage } = await import('../app/lib/db/schema');
  const connection = connectDatabase(localDatabaseUrl());
  try {
    // Resetting recreates the account empty, so every run has the same data.
    await seedDemoAccounts({ database: connection.db, auth: createAuthForDatabase(connection.db), accounts: [account], reset: true });
    const session = await signIn(baseURL);
    await session.quotes({ action: 'defaults-save', defaults: business });
    for (const customer of customers) await session.quotes({ action: 'customer-save', customer });
    for (const sample of samples) {
      let detail = await session.quotes<Detail>({ action: 'create' });
      detail = await session.quotes<Detail>({ action: 'save', id: detail.id, expectedVersion: detail.version, quote: sample.build(detail.draft!) });
      for (const step of sample.then ?? []) {
        if (step === 'archive') await session.quotes({ action: 'archive', id: detail.id });
        else detail = await session.quotes<Detail>({ action: step, id: detail.id, expectedVersion: detail.version });
      }
      if (sample.after && detail.draft) detail = await session.quotes<Detail>({ action: 'save', id: detail.id, expectedVersion: detail.version, quote: sample.after(detail.draft) });
      for (const message of sample.messages ?? []) await connection.db.insert(quoteMessage).values({ id: crypto.randomUUID(), quoteId: detail.id, ...message });
    }
    console.info(`Seeded ${account.email}: ${customers.length} Customers, ${samples.length} Quotes.`);
  } finally {
    await connection.pool.end();
  }
}

// --- Screenshots -----------------------------------------------------------

type Look = { preset: typeof presets[number]; nav: typeof navs[number] };

async function newContext(browser: Browser, baseURL: string, device: Device, design: string, theme: string, look: Look, session?: Session) {
  const context = await browser.newContext({ baseURL, viewport: devices[device], deviceScaleFactor: device === 'mobile' ? 2 : 1, isMobile: device === 'mobile', hasTouch: device === 'mobile', locale: 'fr-CH', colorScheme: theme as 'light' | 'dark' });
  const url = baseURL;
  await context.addCookies([
    { name: 'eq-design', value: design, url },
    { name: 'eq-theme', value: theme, url },
    // Preset, navigation and phone list; see app/lib/appearance.ts.
    { name: 'eq-look', value: encodeURIComponent(new URLSearchParams({ ...look, mobileList: 'grouped' }).toString()), url },
    ...(session ? [...session.cookies].map(([name, value]) => ({ name, value, url })) : []),
  ]);
  return context;
}

async function settle(page: Page) {
  // The switcher is for people comparing designs, not part of them.
  await page.addStyleTag({ content: '.eq-ds, .eq-ds-pill, .eq-phone { display: none !important; } *, *::before, *::after { caret-color: transparent !important; }' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

async function capture(context: BrowserContext, name: string, device: Device, ids: { workspace: string; customer: string }) {
  const page = await context.newPage();
  try {
    if (name === 'signin') {
      await page.goto('/sign-in');
      await page.locator('h1').waitFor();
    } else if (name === 'quotes') {
      await page.goto('/quotes');
      // Phones may show the grouped list instead of the table.
      await page.locator('.eq-quote-table tbody tr').first().waitFor({ state: 'attached' });
    } else if (name === 'workspace') {
      await page.goto(`/quotes?id=${encodeURIComponent(ids.workspace)}`);
      if (device === 'mobile') {
        await page.locator('.qp-narrow-tabs [data-slot="toggle-group-item"]').nth(1).click();
      }
      await page.locator('.qp-paper').waitFor();
    } else if (name === 'customers') {
      await page.goto(`/customers?id=${encodeURIComponent(ids.customer)}`);
      await page.locator('#customer-name').waitFor();
      await page.waitForFunction(() => (document.getElementById('customer-name') as HTMLInputElement | null)?.value !== '');
    } else if (name === 'settings') {
      await page.goto('/settings/business');
      await page.waitForFunction(() => (document.getElementById('settings-business-name') as HTMLInputElement | null)?.value !== '');
    }
    await settle(page);
    // Phones are shown as the screen a person sees: full-page captures pin the
    // fixed tab bar and actions mid-page. So are pages with sticky save bars.
    const fullPage = device === 'desktop' && (name === 'signin' || name === 'quotes');
    return await page.screenshot({ fullPage, animations: 'disabled' });
  } finally {
    await page.close();
  }
}

async function main() {
  const settings = options();
  if (settings.seed) await seed(settings.baseURL);
  const session = await signIn(settings.baseURL);
  const list = await session.quotes<{ quotes: { id: string; title: string }[]; customers: { id: string; name: string }[] }>();
  const workspace = list.quotes.find(entry => entry.title === samples[0].title)?.id;
  const customer = list.customers.find(entry => entry.name === customers[0].name)?.id;
  if (!workspace || !customer) throw new ScriptError('The demo data is missing. Run without --no-seed.');

  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch();
  const { writeFile } = await import('node:fs/promises');
  let count = 0;
  try {
    // Design 0 ignores the dials, so it is captured once per theme.
    const runs = settings.designs.flatMap((design): { design: string; look: Look; prefix: string }[] => design === '0' ? [{ design, look: { preset: 'graphite', nav: 'topbar' } as Look, prefix: '0' }]
      : settings.looks.map(look => ({ design, look, prefix: `${design}-${look.preset}-${look.nav}` })));
    for (const { design, look, prefix } of runs) for (const theme of settings.themes) for (const device of settings.devices) {
      const signedIn = await newContext(browser, settings.baseURL, device, design, theme, look, session);
      const signedOut = await newContext(browser, settings.baseURL, device, design, theme, look);
      try {
        for (const name of settings.pages) {
          const image = await capture(name === 'signin' ? signedOut : signedIn, name, device, { workspace, customer });
          const file = `${outputDir}/${prefix}-${theme}-${name}-${device}.png`;
          await writeFile(file, image);
          count += 1;
          console.info(file.replace(`${process.cwd()}/`, ''));
        }
      } finally {
        await signedIn.close();
        await signedOut.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.info(`${count} screenshots in ${outputDir.replace(`${process.cwd()}/`, '')}.`);
}

main().catch(error => {
  console.error(error instanceof ScriptError ? error.message : error);
  process.exitCode = 1;
});

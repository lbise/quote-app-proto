# Designs: handoff

The app ships two visual designs on one DOM. Design `0` is the current look, kept for comparison. Design `c` (Standard, `app/styles/design-c.css`) is the base: one design with taste dials and four presets. Designs A and B were withdrawn; a cookie that still names them falls back to `c`.

## Rules

- Standard's look lives in `app/styles/design-c.css`. `app/styles/std-structure.css` holds base styles for markup only Standard shows (the grouped phone list); it uses `:where()` so design-c.css can refine it. `app/root.tsx` imports both globally, after `shell.css` and `theme-0-dark.css`.
- Scope every rule under `html[data-design="c"]` (plus a dial attribute when it depends on one). Dark rules go under `html[data-design="c"][data-theme-resolved="dark"]`. Never write an unscoped selector.
- Change CSS only. Don't edit TSX, add or remove elements, change copy, or hide labels that are visible in design 0. If a design needs a hook that doesn't exist, report it and don't add it yourself.
- Keep focus outlines, 44px touch targets below 600px, and WCAG AA contrast in both themes.
- Don't restyle the development switcher (`.eq-ds`, `.eq-ds-pill`, `.eq-phone`, in `design-switcher.css`). Don't touch `eval/`, `app/components/quote-prototype/` or the PDF layouts in `app/lib/quote-layouts/`.

## The `<html>` contract

The root loader reads the cookies (`app/lib/appearance.ts`), validates every value and renders these attributes on `<html>`. The switcher changes them at once without a reload. Design `0` ignores the dials.

| Attribute | Values | Default |
|---|---|---|
| `data-design` | `0`, `c` | `c` |
| `data-theme` | `light`, `dark`, `system` | `system` |
| `data-preset` | `graphite`, `sarcelle`, `foret`, `indigo`, `custom` | `graphite` |
| `data-font` | `geist`, `inter`, `hanken`, `figtree`, `source` | preset |
| `data-accent` | `graphite`, `teal`, `indigo`, `forest`, `red`, `ochre` | preset |
| `data-neutral` | `cool`, `neutral`, `warm` | preset |
| `data-radius` | `sharp` (4px), `medium` (8px), `soft` (12px) | preset |
| `data-density` | `compact`, `comfortable` (phones ≤ 640px always comfortable) | preset |
| `data-accent-use` | `minimal` (primary buttons, focus, links), `rich` (also current nav item, selection, active tabs, section highlight) | preset |
| `data-panels` | `lines` (white surfaces, 1px borders), `tinted` (grey ground, raised white panels) | preset |
| `data-badge` | `dot`, `pill`, `outline` | preset |
| `data-nav` | `topbar`, `sidebar` | `topbar` |
| `data-mobile-list` | `table`, `grouped` | `grouped` |

Presets set the eight dials; changing any dial makes `data-preset="custom"`. Navigation and the phone list are independent of the preset.

| Preset | font | accent | neutral | radius | density | accent use | panels | badge |
|---|---|---|---|---|---|---|---|---|
| `graphite` | inter | graphite | neutral | medium | compact | minimal | lines | dot |
| `sarcelle` | geist | teal | cool | medium | comfortable | rich | lines | pill |
| `foret` | figtree | forest | warm | soft | comfortable | rich | tinted | pill |
| `indigo` | hanken | indigo | cool | sharp | compact | minimal | lines | outline |

### Cookies

| Cookie | Holds |
|---|---|
| `eq-design` | `0` or `c` |
| `eq-theme` | `light`, `dark` or `system` |
| `eq-look` | URL-encoded query string: `preset`, the eight dials (`font`, `accent`, `neutral`, `radius`, `density`, `accentUse`, `panels`, `badge`), `nav`, `mobileList` |

A named preset in `eq-look` fixes every dial whatever else the cookie says; with `preset=custom` each valid dial is kept and an invalid one takes Graphite's value. All three last a year (`Path=/`, `SameSite=Lax`).

When the theme isn't `system`, the server also renders `data-theme-resolved`. An inline head script (`themeScript`) runs before first paint. It resolves `system` through `prefers-color-scheme`, sets `data-theme-resolved="light|dark"`, toggles the shadcn `.dark` class to match, and follows system changes.

- Style dark mode with `[data-theme-resolved="dark"]`. Don't use `[data-theme="dark"]` or `@media (prefers-color-scheme)`, because they miss `system`.
- `html[data-theme-resolved]` already sets `color-scheme` (`theme-0-dark.css`).
- People change the theme in the account menu (Light / Dark / System) and in Settings › Account.

### Development switcher

In development only (`!import.meta.env.PROD`), a pill at the bottom left opens the Apparence panel: Design (Actuel / Standard), Preset, a Réglages disclosure with every dial, Navigation, Liste mobile, Thème and a Téléphone switch. It is hidden from automated browsers (`navigator.webdriver`), so tests and screenshots never show it.

Téléphone (screens ≥ 720px) shows the current page in a 390×844 `<iframe>` on a dimmed backdrop. The frame's window name is `eq-phone-preview`; a document loaded under that name renders no switcher and no frame of its own. The frame follows the outer page's navigation, the outer switcher posts each change to it (`postMessage`, same origin), and Escape (inside or outside the frame), the close button or the backdrop closes it. "Ouvrir en plein écran" opens the page in a phone-sized window. The on/off state lives in `sessionStorage`.

## Tokens and specificity

The tokens live in `app/components/quotes/quote-tokens.css`. It is imported globally, but it only applies while a `.qp-app` element is on the page (`html:has(.qp-app)`), which covers every signed-in page. Auth pages have no `.qp-app`. They use the shadcn variables from `app/app.css`. See "Auth pages" below.

| Block | Selector | Specificity | To override it |
|---|---|---|---|
| Design tokens (`--color-*`, `--font-*`, `--space-*`, `--text-*`, `--radius-*`…) | `:where(html:has(.qp-app))` | 0 | `html[data-design="c"]` |
| shadcn mapping (`--background`, `--primary`, `--border`, `--ring`, `--popover`…) | `html:has(.qp-app)` | 0,1,1 | `html[data-design="c"]:has(.qp-app)` |
| `--color-hover` and page background (app-pages.css) | `html:has(.qp-page)` | 0,1,1 | `html[data-design="c"]:has(.qp-page)` |
| shadcn defaults (auth pages) | `:root`, `.dark` in app.css | 0,1,0 | `html[data-design="c"]`, `html[data-design="c"].dark` |

Usually you only need to set the design tokens. The shadcn mapping follows them.

### Colour tokens

| Token | What it colours |
|---|---|
| `--color-canvas` | App background behind panels. Toolbar background. Page background of the list, customers, settings and admin. |
| `--color-paper` | Header, panels, the Quote document (`.qp-paper`), menus and popovers (`--popover`), inputs and selects, shadcn `--background` |
| `--color-chat` | Conversation panel background, row hover in the Quote list and in Customers |
| `--color-ink` | Body text, headings, shadcn `--foreground` |
| `--color-muted` | Secondary text, table headers, inactive nav links, breadcrumb parent, shadcn `--muted-foreground` |
| `--color-rule` | Hairlines, table rows, panel borders, header bottom border, shadcn `--border` |
| `--color-input-rule` | Input and select borders, breadcrumb `/` separator, scrollbar thumb, shadcn `--input` |
| `--color-accent` | Primary buttons (`--primary`), current nav link text, links, brand dot, mobile nav underline |
| `--color-accent-ink` | Text on primary buttons (`--primary-foreground`) |
| `--color-accent-soft` | Current nav link background, selected segmented item, outline hover, prompt chips |
| `--color-focus` | Every focus outline (`--ring`) |
| `--color-warning` / `--color-warning-soft` | Missing-field warnings, "unsaved changes" status, pending save |
| `--color-error` / `--color-error-soft` | Errors, destructive actions (`--destructive`) |
| `--color-success` / `--color-changed` | Saved state, lines the assistant changed |
| `--color-overlay`, `--color-shadow` | Modal backdrop, paper shadow |
| `--color-switcher`, `--color-switcher-ink` | Old prototype switcher (unused in the app) |
| `--color-hover` | Nav and settings-nav hover (set in app-pages.css; see table above) |

### Type, space and shape

- Fonts: `--font-body` (UI text), `--font-display` (headings and page titles; Space Grotesk in design 0), `--font-document` (the Quote paper), `--font-technical` (wordmark), `--font-editorial` (unused in the app).
- Sizes: `--text-sm` .8125rem, `--text-base` .9375rem, `--text-md`, `--text-lg`, `--text-display`.
- Space: `--space-2xs` … `--space-3xl` (.25rem to 4rem).
- Shape: `--radius-control` (buttons, inputs; .375rem in design 0), `--radius-panel` (.75rem), `--rule-width`.
- Motion: `--ease-out`, `--ease-in`, `--ease-in-out`, `--dur-micro`, `--dur-short`.

### Fonts

The candidate families are installed: `@fontsource-variable/geist`, `inter`, `hanken-grotesk`, `figtree` and `source-sans-3`. Import them at the very top of design-c.css, before any rule, and map `data-font` to `--font-*`. Geist Variable (app.css) and Space Grotesk Variable (quotes.css) are already loaded.

### Hard-coded values left to override

- `--color-hover: oklch(92% .012 250)` in app-pages.css (see the table above).
- `.qp-wordmark`: `font-size: 25px` (23px on phones), `letter-spacing: -.065em`.
- `.qp-app-header`: `min-height: 72px` (60px ≤1000px, 56px ≤600px).
- Auth pages: Tailwind utilities (`bg-primary`, `text-muted-foreground`, `border`, `rounded-md`, `text-3xl`) on the `.eq-auth*` hooks. They read the shadcn variables, so set those.
- Everything else in `quotes.css`, `app-pages.css` and `shell.css` reads tokens.

## App shell

`app/components/app-shell.tsx` wraps the Quote list, the Quote workspace, Customers, Settings and Administration:

```html
<div class="qp-app eq-shell [qp-page | qp-workspace-shell]" data-shell-mode="page|quote" lang>
  <header class="qp-app-header qp-app-header-nav eq-shell-header">
    <a class="qp-wordmark eq-shell-brand" href="/quotes">easy<span>quote</span><span class="qp-brand-dot">.</span></a>
    <nav class="eq-breadcrumb" aria-label="Breadcrumb">          <!-- quote mode only -->
      <ol><li><a href="/quotes">My Quotes</a></li>
          <li><span aria-current="page"><span class="eq-breadcrumb-reference">Q-1</span> <strong>Title</strong></span></li></ol>
    </nav>
    <nav class="qp-app-nav eq-shell-nav" aria-label="Main navigation">
      <a class="eq-nav-link" data-section="quotes|customers|settings|admin" aria-current="page|true"><svg/><span>Quotes</span></a>…
    </nav>
    <div class="qp-header-end eq-shell-account">
      <button class="eq-account-trigger"><svg/><span class="eq-account-short">Account</span><span class="eq-account-email">…</span><svg/></button>
    </div>
  </header>
  <div class="eq-shell-main"> <main class="qp-workspace | qp-quote-list | qp-customers | qp-settings | qp-admin">…</main> </div>
</div>
```

- `aria-current="page"` marks the current page's nav link. Inside a Quote, the Quotes link gets `aria-current="true"` (current section). Select both with `.eq-nav-link[aria-current]`.
- The Administration link only renders for Administrators. Lay out the nav for 3 or 4 links.
- The account menu is a Radix dropdown, portalled outside the shell: `.eq-account-menu` with `.eq-account-identity`, radio groups for language and theme, then Account settings and Sign out. It shares `.qp-line-menu` styling with the other menus.
- In design 0 below 1200px, the email is hidden and the "Account" text shows instead. Below 1000px in quote mode, the brand and nav icons are hidden (the breadcrumb leads back). Below 800px, nav icons are hidden everywhere. Below 600px, the nav wraps onto its own full-width row of equal tabs under the brand and account, and in quote mode the breadcrumb reference is hidden.

### Placing the nav

Move the nav with CSS alone. `.eq-shell-header { display: contents; }` makes brand, breadcrumb, nav and account direct grid items of `.eq-shell`, which you can then lay out with a grid:

- Left rail: `.eq-shell { display: grid; grid-template-columns: 14rem 1fr; grid-template-rows: auto 1fr; }`, then place `.eq-shell-nav` in column 1 spanning the rows and `.eq-shell-main` in column 2.
- Top bar: design 0 already does this.
- Bottom bar (phones): `position: fixed; inset: auto 0 0 0` on `.eq-shell-nav`, plus bottom padding on `.eq-shell-main`. Set `--eq-shell-bottom-offset` to the bar height so the sticky Settings save bar (`.qp-panel-footer`) sits above it.

The workspace needs a full-height split. `.qp-app` is `height: 100dvh; display: flex; flex-direction: column`. In the workspace (`.qp-workspace-shell`), `.eq-shell-main` is `flex: 1; min-height: 0; display: flex; flex-direction: column`, and `.qp-workspace` fills it without scrolling itself. The document and the conversation scroll inside. If you switch `.eq-shell` to a grid, give the workspace's main cell a definite height with `min-height: 0` (for example `grid-template-rows: auto minmax(0, 1fr)`), or the panes lose their inner scrolling. The other pages (`.qp-page`) have `height: auto` and scroll the document, with a sticky header.

## Quote workspace (`workspace.tsx`, `quotes.css`)

- Layout: `.qp-workspace` > `.qp-narrow-tabs` (phones) + `.qp-layout.qp-layout-b` > `.qp-review-rail` (section outline, `.qp-outline`) + `.qp-review-main` > `.qp-work-toolbar` + `.qp-split` > `.qp-document-pane` + `.qp-conversation`.
- Toolbar: `.qp-work-toolbar` > `.qp-document-status` (version badge, `.qp-save` state) + `.qp-toolbar-actions` (version `select`, `.qp-undo`, `.qp-pdf-action`, `.qp-primary-action`, `.qp-more-actions`, the labelled More menu with start-from, archive/restore and delete). Below 600px it becomes a status row and one action row. `.qp-label-long` and `.qp-label-short` swap the labels there.
- Conversation / Quote switch: `.qp-narrow-tabs.eq-segmented`, a shadcn ToggleGroup. Items are `[data-slot='toggle-group-item']`, and the selected one has `[data-state='on']`. It shows at ≤1000px. `.qp-app[data-narrow-panel='chat|quote']` picks the visible pane.
- Document: `.qp-paper` > `.qp-paper-header` (`.qp-business-name`, `.qp-paper-meta`, `.qp-addresses`), `.qp-document-title`, `.qp-quote-section` (`.qp-section-title`, `.qp-section-subtotal`), `.qp-line` (`.qp-line-number`, `.qp-line-content`, `.qp-line-description`, `.qp-line-pricing`, `.qp-line-actions`), `.qp-totals` / `.qp-total`, `.qp-terms`. Missing values: `.qp-missing`, `.qp-field-warning`. Assistant changes: `.qp-line-changed`, `.qp-changed-label`.
- Conversation: `.qp-conversation` > `.qp-panel-heading`, `.qp-chat-scroller` > `.qp-chat-content` (messages, `.qp-message-markdown`, `.qp-note-message`), `.qp-compose-area` > `.qp-composer` (textarea, `.qp-composer-actions`, dictation `.qp-dictation-*`).
- Banners: `.qp-archived-banner`, `.qp-started-banner`, `.qp-request-error`.
- Dialogs (portalled): `.qp-modal`, `.qp-modal-actions`, `.qp-publication-summary`, `.qp-publication-checks`.
- `.qp-variant-b` and `[data-assistant-collapsed]` are layout state. Don't restyle them into different layouts. The approved desktop layout stays.

## Quote list (`routes/quotes.tsx`)

- `.qp-quote-list` > `.qp-list-heading` (eyebrow `p`, `h1`, New Quote button), `.qp-list-controls` (search `.qp-search-label`, Active/Archived tabs), then `table.eq-quote-table.qp-list-table`.
- Columns (class on both `th` and `td`): `.eq-col-reference`, `.eq-col-project` (holds the row's real link `a.qp-list-open`), `.eq-col-customer` (`.qp-list-missing` when empty), `.eq-col-status`, `.eq-col-amount` (right-aligned, tabular figures, `—` when incomplete), `.eq-col-updated` (`<time>`), `.eq-col-actions` (row menu).
- Rows: `tr.qp-list-row[data-quote-id]`. The whole row is clickable.
- Status: `.eq-status[data-status="working-draft|published|archived"][data-revision]`. Archived rows prefix `.eq-status-archived`.
- At ≤760px, rows stack as grid cards (see `shell.css`). You can replace that layout. This is the phone layout when `data-mobile-list="table"`.
- Grouped phone list (Standard, ≤ 640px, `data-mobile-list="grouped"`; hidden otherwise, the table is hidden instead): `.eq-quote-groups` > `section.eq-quote-group[data-group="to-finish|published|archived"]` > `h2.eq-quote-group-heading` (label + `.eq-quote-group-count`) + `ul.eq-quote-items` > `li.eq-quote-item[data-quote-id]` > `a.qp-list-open.eq-quote-item-open` (`.eq-quote-item-title`, `.eq-quote-item-amount`, `.eq-quote-item-customer`, `.eq-quote-item-meta` with reference and `<time>`, `.eq-quote-item-status` with the `.eq-status` badge) + `.eq-quote-item-actions` (row menu). "To finish" holds every Working Draft, including one on top of Published Revisions; "Published" the Quotes whose latest version is a Published Revision; the Archived tab shows one "Archived" group.
- `.eq-list-new-bar` > `.eq-list-new-fixed`: the thumb-reach New Quote button, fixed above `--eq-shell-bottom-offset`. It shows with the grouped list, which hides the heading's `.eq-list-new`.
- Empty states: `.qp-list-empty`, `.qp-list-footnote`.

## Customers (`customers-page.tsx`)

- `.qp-customers[data-view="list|detail"]` > `.qp-page-heading`, `.qp-customers-layout` > `.qp-customer-list` + `.qp-customer-detail` (both `.qp-panel`).
- ≤ 1000px it is list → detail: `data-view="detail"` (a Customer or `?id=new` in the URL) shows only the detail, led by `.qp-back-link` ("← Clients", back to `/customers`).
- List: `.qp-customer-search`, `nav.eq-alpha-index` (letter links `a[href="#customers-X"]`, or `#customers-other` for `#`). Then `.qp-customer-groups` > `section.eq-alpha-group#customers-X` > `h3.eq-alpha-heading` + `ul.qp-customer-rows` > `li > a[aria-current="true"]` for the selected Customer.
- `.eq-alpha-index` is `display: none` and `.eq-alpha-heading` is visually hidden in design 0. To show them, set `display: flex|grid` on the index and undo the clip on the headings (`position: static; width: auto; height: auto; overflow: visible; clip-path: none`). Letter links scroll to the group and focus its first Customer.
- States: `.qp-customer-empty`, `.qp-customer-message`, `.qp-customer-placeholder`.

## Settings (`settings-page.tsx`, `app-pages.css`)

- `.qp-settings` > `.qp-page-heading`, `.qp-settings-layout` > `nav.qp-settings-nav` (`a[aria-current="page"]`) + `.qp-panel` > `.qp-panel-header`, `.qp-panel-body` (shadcn `Field*` slots), `.qp-panel-footer`.
- `.qp-panel-footer` holds the save bar. It sticks to the viewport bottom (`bottom: var(--eq-shell-bottom-offset, 0px)`) and its status `p` has `[data-tone='pending']`.
- The Account section: `.qp-account`, `.qp-account-signout`, and the theme ToggleGroup.

## Administration (`admin/*`)

`.qp-admin[data-wide]` > `nav.qp-admin-sections` (`a[aria-current="page"]`), `.qp-admin-back`, then `.qp-admin-table` (inside `.qp-admin-table-scroll`), `.qp-admin-record`, `.qp-admin-facts`, `.qp-admin-badges`, `.qp-admin-filters`, `.qp-admin-document`, `.qp-admin-conversation`, `.qp-admin-turn-trace` with `.qp-trace-*`, and `.qp-json`. Admin screens are low priority: make them legible, not special.

## Auth pages (`auth-shell.tsx`, `routes/sign-in.tsx` and the others)

These pages have no `.qp-app`, so the quote tokens don't apply. They use shadcn variables (`--background`, `--foreground`, `--primary`, `--primary-foreground`, `--muted-foreground`, `--border`, `--input`, `--ring`, `--destructive`). Set those under `html[data-design="c"]` and `html[data-design="c"].dark`.

Hooks: `main.eq-auth` > `.eq-auth-top` (`.eq-auth-brand`, `.eq-auth-language`), `section.eq-auth-card` > `header.eq-auth-heading` (`h1`, intro `p`), `form` with `label.eq-auth-field` > `input.eq-auth-input` + `.eq-auth-description`, `.eq-auth-message` (error), `button.eq-auth-submit`, `nav.eq-auth-links`. The pages: sign-in, sign-up, verify, forgot-password and reset-password.

## Dark theme

- Design 0 dark: `theme-0-dark.css` overrides the colour tokens under `html[data-design='0'][data-theme-resolved='dark']`, plus `--card` and `--accent`. Use it as a checklist of tokens to set. Auth pages in design 0 dark use app.css `.dark`.
- Your dark theme is the same token set under `html[data-design="c"][data-theme-resolved="dark"]` (specificity 0,2,1). That selector already beats the shadcn mapping and `--color-hover`, so you don't need the `:has()` forms there.

## Screenshots

The dev server must be running (default `http://localhost:5173`), and `DATABASE_URL` must point to a loopback database whose name ends in `_local`.

```sh
npm run design:screens                                   # seed, then design 0 and Standard (see below) × light/dark × page × device
npm run design:screens -- --design=c --preset=foret --nav=topbar,sidebar --theme=dark
npm run design:screens -- --page=quotes,workspace --device=mobile --no-seed
npm run design:screens -- --base-url=http://127.0.0.1:5173
```

- By default Standard is captured with every preset in the top bar, plus Graphite with the sidebar. `--preset` and `--nav` pick the combinations (all chosen presets × all chosen navs once `--nav` is given). The phone list is always `grouped`.
- Pages: `signin`, `quotes`, `workspace` (the sectioned Quote with 11 lines; the mobile capture shows the Quote pane), `customers` (with a detail open), `settings` (Business section).
- Devices: `desktop` 1440×900 and `mobile` 390×844 (at 2×).
- Output: `.impeccable/review/designs/c-<preset>-<nav>-<theme>-<page>-<desktop|mobile>.png` for Standard and `0-<theme>-<page>-<desktop|mobile>.png` for design 0. It's git-ignored.
- Seeding resets the demo account `design-review@easy-quote.test` each run, so the data is always the same: 7 French Swiss Customers and 6 Quotes (sectioned working draft, published, published with a newer draft, incomplete pricing, archived, no Customer). Add `--no-seed` to reuse the existing data.
- The design, theme and look come from the `eq-design`, `eq-theme` and `eq-look` cookies. The script only captures `light` and `dark`, not `system`.

import { useLayoutEffect, type ReactNode } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";
import type { Route } from "./+types/root";

import { getArtisanForUser } from "./lib/artisan.server";
import {
  browserLanguage,
  interfaceLanguage,
  isAdministrator,
  localeCookie,
  parseLocaleCookie,
  type InterfaceLanguage,
} from "./lib/auth-config.server";
import { getSession } from "./lib/auth.server";
import { quoteAIDisclosure } from "./lib/quote-ai-config.server";
import { parseAppearance, themeScript, type Appearance } from "./lib/appearance";
import { DesignSwitcher } from "./components/design-switcher";

import "./app.css";
// Global so every page, including sign-in, can use the tokens. Scoped with
// zero specificity; see app/styles/README.md for the override order.
import "./components/quotes/quote-tokens.css";
import "./styles/shell.css";
import "./styles/theme-0-dark.css";
import "./styles/design-a.css";
import "./styles/design-b.css";
import "./styles/design-c.css";
import "./styles/design-switcher.css";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  let locale = parseLocaleCookie(request.headers.get("cookie")) ??
    browserLanguage(request.headers.get("accept-language"));

  // Shows the admin area's navigation entry. The area checks access itself.
  let administrator = false;
  let email: string | null = null;

  // Health and auth resource requests must remain useful without a database
  // connection. The protected application gets the persisted profile choice.
  if (!url.pathname.startsWith("/health/") && !url.pathname.startsWith("/api/")) {
    try {
      const current = await getSession(request);
      if (current) {
        const profile = await getArtisanForUser(current.user.id);
        locale = interfaceLanguage(profile?.interfaceLanguage);
        administrator = isAdministrator(current.user);
        email = current.user.email;
      }
    } catch {
      // The child route will report an unavailable protected request. Rendering
      // the language selected by the visitor is still safe.
    }
  }

  return Response.json(
    { locale, administrator, email, quoteAI: quoteAIDisclosure(), ...parseAppearance(request.headers.get("cookie")) },
    { headers: { "Set-Cookie": localeCookie(locale) } },
  );
}

export function Layout({ children }: Readonly<{ children: ReactNode }>) {
  const { locale, design = "0", theme = "system" } = (useLoaderData<typeof loader>() ?? {}) as { locale: InterfaceLanguage } & Partial<Appearance>;
  // React may drop the resolved theme when the loader's choice changes; the
  // head script sets it again before paint.
  useLayoutEffect(() => { window.__eqApplyTheme?.(); }, [design, theme]);
  const resolved = theme === "system" ? undefined : theme;
  return (
    // The head script resolves the system theme before hydration.
    <html lang={locale} data-design={design} data-theme={theme} data-theme-resolved={resolved} className={resolved === "dark" ? "dark" : undefined} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <>
    <Outlet />
    {!import.meta.env.PROD && <DesignSwitcher />}
  </>;
}

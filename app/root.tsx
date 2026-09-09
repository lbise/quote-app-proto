import type { ReactNode } from "react";
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
  localeCookie,
  parseLocaleCookie,
  type InterfaceLanguage,
} from "./lib/auth-config.server";
import { getSession } from "./lib/auth.server";

import "./app.css";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  let locale = parseLocaleCookie(request.headers.get("cookie")) ??
    browserLanguage(request.headers.get("accept-language"));

  // Health and auth resource requests must remain useful without a database
  // connection. The protected application gets the persisted profile choice.
  if (!url.pathname.startsWith("/health/") && !url.pathname.startsWith("/api/")) {
    try {
      const current = await getSession(request);
      if (current) {
        const profile = await getArtisanForUser(current.user.id);
        locale = interfaceLanguage(profile?.interfaceLanguage);
      }
    } catch {
      // The child route will report an unavailable protected request. Rendering
      // the language selected by the visitor is still safe.
    }
  }

  return Response.json(
    { locale },
    { headers: { "Set-Cookie": localeCookie(locale) } },
  );
}

export function Layout({ children }: Readonly<{ children: ReactNode }>) {
  const { locale } = useLoaderData<typeof loader>() as { locale: InterfaceLanguage };
  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
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
  return <Outlet />;
}

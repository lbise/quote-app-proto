import { Form, useLocation } from "react-router";

import type { InterfaceLanguage } from "../lib/auth-config.server";

export function LanguageSwitch({ locale }: { locale: InterfaceLanguage }) {
  const location = useLocation();
  const next = locale === "en" ? "fr" : "en";
  return (
    <Form method="post" action="/language" className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{locale === "en" ? "Language" : "Langue"}</span>
      <input type="hidden" name="locale" value={next} />
      <input type="hidden" name="returnTo" value={`${location.pathname}${location.search}`} />
      <button className="underline underline-offset-4" type="submit">
        {next.toUpperCase()}
      </button>
    </Form>
  );
}

import type { ReactNode } from "react";

import type { InterfaceLanguage } from "../lib/auth-config.server";
import { LanguageSwitch } from "./language-switch";

export function AuthShell({
  locale,
  children,
}: {
  locale: InterfaceLanguage;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-8 px-6 py-12">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Easy Quote</p>
        <LanguageSwitch locale={locale} />
      </div>
      {children}
    </main>
  );
}

export function Field({
  label,
  name,
  type = "text",
  required = true,
  autoComplete,
  defaultValue,
  minLength,
  readOnly,
  description,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  defaultValue?: string;
  minLength?: number;
  readOnly?: boolean;
  /** Shown under the field and announced with it. */
  description?: string;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium" htmlFor={name}>
      {label}
      <input
        className="h-10 rounded-md border bg-background px-3 font-normal outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring read-only:bg-muted read-only:text-muted-foreground"
        id={name}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        minLength={minLength}
        readOnly={readOnly}
        aria-describedby={description ? `${name}-description` : undefined}
        autoComplete={autoComplete ?? (name === "email" ? "email" : name === "password" ? "current-password" : undefined)}
      />
      {description ? <span id={`${name}-description`} className="font-normal text-muted-foreground">{description}</span> : null}
    </label>
  );
}

export function FormMessage({ message }: { message?: string }) {
  return message ? <p className="text-sm text-destructive" role="alert">{message}</p> : null;
}

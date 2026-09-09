import type { Route } from "./+types/home";

import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Easy Quote prototype" },
    {
      name: "description",
      content: "Easy Quote prototype status page for invited testers.",
    },
  ];
}

export default function Home() {
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-6 px-6 py-12">
      <header className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Easy Quote</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Prototype status
        </h1>
        <p className="max-w-prose text-muted-foreground">
          This page confirms the prototype is online for invited testers.
        </p>
      </header>

      <Alert>
        <AlertTitle>Prototype only</AlertTitle>
        <AlertDescription>
          This page uses fake data only. Sign-in and quote workflows are not
          available.
        </AlertDescription>
      </Alert>

      <a className="w-fit text-sm underline" href="/health/ready">
        Check readiness
      </a>
    </main>
  );
}

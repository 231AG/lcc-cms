"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";

/**
 * The Students page's error boundary -- the app's first. Every page here
 * does real cross-region database work on render, so a failed query
 * previously surfaced as the framework's own error screen with no way back
 * except the browser's reload button.
 *
 * `reset()` re-runs the failed render, which is exactly what "Try again"
 * should mean for a transient database or network fault. The error's
 * message is deliberately not printed: it can carry connection strings and
 * query text, and this page is staff-facing but not developer-facing. It
 * goes to the console instead, where a developer can find it.
 */
export default function StudentsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Students page failed to render:", error);
  }, [error]);

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-lg flex-1 px-4 py-12 outline-none">
      <Card>
        <CardBody className="text-center">
          <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-danger-surface">
            <AlertTriangle className="h-5 w-5 text-danger-fg" aria-hidden="true" />
          </span>
          <h1 className="text-base font-semibold text-fg">Could not load students</h1>
          <p className="mx-auto mt-1 max-w-sm text-sm text-fg-secondary">
            Something went wrong reading the student list. No data was changed. If this keeps happening, report the
            reference below.
          </p>
          {error.digest && <p className="mt-2 font-mono text-xs text-fg-subtle">Reference: {error.digest}</p>}
          <div className="mt-5 flex justify-center gap-2">
            <Button type="button" onClick={reset}>
              Try again
            </Button>
          </div>
        </CardBody>
      </Card>
    </main>
  );
}

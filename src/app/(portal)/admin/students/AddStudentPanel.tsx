"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { EnrollStudentForm } from "./EnrollStudentForm";

/**
 * Page header plus the "+ Add Student" primary action, with the enrolment
 * panel it opens.
 *
 * The button and the panel share one piece of state, which is why the
 * header lives in here rather than in the page: PageHeader's `actions`
 * slot and the panel below it are far apart in the markup but must open
 * together.
 *
 * The panel itself is the EXISTING EnrollStudentForm, unchanged -- same
 * fields, same labels, same `enrollStudentAction`, same useActionState
 * handling of the one-time temporary password (which is why this is a
 * panel on the page and not a modal or a separate route: the generated
 * password must be shown once, in place, and never put in a URL).
 */
export function StudentsHeader({
  canEnrol,
  departments,
}: {
  canEnrol: boolean;
  departments: Array<{ id: string; code: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Breadcrumb items={[{ label: "Home", href: "/portal" }, { label: "Student Listing" }]} />
      <PageHeader
        title="Student Listing"
        actions={
          canEnrol ? (
            <Button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="enrol-student-panel"
            >
              {open ? <X className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              {open ? "Close" : "Add Student"}
            </Button>
          ) : undefined
        }
      />

      {canEnrol && open && (
        <div id="enrol-student-panel">
          <EnrollStudentForm departments={departments} />
        </div>
      )}
    </>
  );
}

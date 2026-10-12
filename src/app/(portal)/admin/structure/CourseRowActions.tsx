"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Power, PowerOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Form";
import { SubmitButton, SubmitIconButton } from "@/components/ui/SubmitButton";
import { toggleCourseActiveAction, updateCourseAction } from "./actions";

const iconAction =
  "rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-brand-fg " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const iconDanger =
  "rounded-md p-1.5 text-fg-muted transition-colors hover:bg-danger-surface hover:text-danger-fg " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

const dialogClasses =
  "m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-fg shadow-xl " +
  "backdrop:bg-black/40";

/**
 * Closes the dialog once the form inside it has finished submitting.
 *
 * A Server Action here ends in a redirect back to this same page, so the row
 * stays mounted and an open dialog would stay open -- on top of the page's own
 * error banner when the change was refused. `useFormStatus` only reports for
 * the form it sits inside, which is why this is a child of each form.
 */
function CloseWhenDone({ onDone }: { onDone: () => void }) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  useEffect(() => {
    if (pending) {
      wasPending.current = true;
    } else if (wasPending.current) {
      wasPending.current = false;
      onDone();
    }
  }, [pending, onDone]);
  return null;
}

/** Click on the dimmed backdrop (the <dialog> itself, not its content) closes it. */
function closeOnBackdrop(event: React.MouseEvent<HTMLDialogElement>) {
  if (event.target === event.currentTarget) event.currentTarget.close();
}

/**
 * The Action cell of one row in the Courses table: an Edit icon that opens the
 * course's code, title and credit hours in a dialog, and a Deactivate (or
 * Reactivate) icon. Deactivating asks first; reactivating is harmless and does
 * not.
 */
export function CourseRowActions({
  courseId,
  code,
  title,
  creditHours,
  departmentName,
  isActive,
}: {
  courseId: string;
  code: string;
  title: string;
  creditHours: number;
  departmentName: string;
  isActive: boolean;
}) {
  const uid = useId();
  const editRef = useRef<HTMLDialogElement>(null);
  const editFormRef = useRef<HTMLFormElement>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);

  const closeEdit = useCallback(() => editRef.current?.close(), []);
  const closeConfirm = useCallback(() => confirmRef.current?.close(), []);

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        title={`Edit ${code}`}
        aria-label={`Edit ${code}`}
        className={iconAction}
        onClick={() => editRef.current?.showModal()}
      >
        <Pencil className="h-4 w-4" aria-hidden="true" />
      </button>

      {isActive ? (
        <button
          type="button"
          title={`Deactivate ${code}`}
          aria-label={`Deactivate ${code}`}
          className={iconDanger}
          onClick={() => confirmRef.current?.showModal()}
        >
          <PowerOff className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <form action={toggleCourseActiveAction}>
          <input type="hidden" name="courseId" value={courseId} />
          <input type="hidden" name="isActive" value="true" />
          <SubmitIconButton
            title={`Reactivate ${code}`}
            aria-label={`Reactivate ${code}`}
            className={iconAction}
            icon={<Power className="h-4 w-4" aria-hidden="true" />}
          />
        </form>
      )}

      {/* ---- Edit ---------------------------------------------------- */}
      <dialog
        ref={editRef}
        className={dialogClasses}
        aria-labelledby={`${uid}-edit-title`}
        onClick={closeOnBackdrop}
        onClose={() => editFormRef.current?.reset()}
      >
        <form ref={editFormRef} action={updateCourseAction} className="flex flex-col gap-4 p-5">
          <CloseWhenDone onDone={closeEdit} />
          <input type="hidden" name="courseId" value={courseId} />
          <div>
            <h2 id={`${uid}-edit-title`} className="text-base font-semibold text-fg">
              Edit course
            </h2>
            <p className="mt-0.5 text-xs text-fg-muted">{departmentName}</p>
          </div>
          <div>
            <Label htmlFor={`${uid}-code`} className="text-xs">
              Course code
            </Label>
            <Input id={`${uid}-code`} name="code" required defaultValue={code} autoComplete="off" />
          </div>
          <div>
            <Label htmlFor={`${uid}-title`} className="text-xs">
              Title
            </Label>
            <Input id={`${uid}-title`} name="title" required defaultValue={title} autoComplete="off" />
          </div>
          <div>
            <Label htmlFor={`${uid}-credits`} className="text-xs">
              Credit hours
            </Label>
            <Input
              id={`${uid}-credits`}
              name="creditHours"
              type="number"
              min={1}
              required
              defaultValue={creditHours}
              className="w-24"
            />
          </div>
          <p className="text-xs text-fg-muted">
            Offerings and plans follow the new code. Grades already recorded keep the code they were entered with.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={closeEdit}>
              Cancel
            </Button>
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
          </div>
        </form>
      </dialog>

      {/* ---- Deactivate: confirm first ----------------------------------- */}
      <dialog
        ref={confirmRef}
        className={dialogClasses}
        aria-labelledby={`${uid}-confirm-title`}
        onClick={closeOnBackdrop}
      >
        <form action={toggleCourseActiveAction} className="flex flex-col gap-4 p-5">
          <CloseWhenDone onDone={closeConfirm} />
          <input type="hidden" name="courseId" value={courseId} />
          <input type="hidden" name="isActive" value="false" />
          <div>
            <h2 id={`${uid}-confirm-title`} className="text-base font-semibold text-fg">
              Deactivate this course?
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              <span className="font-mono text-xs">{code}</span> — {title}
            </p>
          </div>
          <p className="text-sm text-fg-secondary">
            No new offerings can be created for it. Offerings, plans and grades that already exist are kept, and you can
            reactivate it at any time.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={closeConfirm}>
              Cancel
            </Button>
            <SubmitButton variant="danger" pendingLabel="Deactivating…">
              Deactivate
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </div>
  );
}

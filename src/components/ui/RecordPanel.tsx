/**
 * One line of an academic record, as a bordered panel with a glyph -- the
 * 2x2 the design reference draws inside that card. `emphasis` is for CGPA,
 * the one figure on the panel that is meant to be read first.
 *
 * Shared by the student profile and the Grades page, which show the same
 * four figures and should not drift apart. Meant to sit inside a <dl>:
 * these are term/value pairs and the markup keeps saying so.
 */
export function RecordPanel({
  icon,
  term,
  emphasis,
  children,
}: {
  icon: React.ReactNode;
  term: string;
  emphasis?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="border-line-subtle bg-surface-subtle rounded-xl border p-3">
      <dt className="text-fg-muted flex items-center gap-1.5 text-xs font-semibold">
        <span className="text-fg-subtle">{icon}</span>
        {term}
      </dt>
      <dd className={emphasis ? "text-brand-fg mt-1 text-2xl font-extrabold" : "text-fg mt-1 text-sm font-bold"}>{children}</dd>
    </div>
  );
}

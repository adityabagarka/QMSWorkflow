/**
 * Form controls, defined once.
 *
 * Fields were previously styled per page, which is why their sizes and spacing
 * drifted apart. Everything that takes input on a deal comes from here.
 */

export function Field({
  label,
  hint,
  children,
  wide = false,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? 'ff ff--wide' : 'ff'}>
      <span className="ff__label">{label}</span>
      {children}
      {hint ? <span className="ff__hint">{hint}</span> : null}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className="ff__control" {...props} />;
}

export function Select({
  options,
  placeholder = 'Select…',
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: string[];
  placeholder?: string;
}) {
  return (
    <select className="ff__control" {...props}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** Two fields per row on desktop, one on mobile — the deal intake's shape. */
export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="ff-row">{children}</div>;
}

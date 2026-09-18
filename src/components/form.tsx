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

/**
 * Options are either plain strings, where the value and the label are the same
 * thing (an industry, a constitution), or a value/label pair where they are
 * not — a stored vocabulary like the cover-start reasons, whose values are
 * snake_case identifiers that a person should never have to read.
 */
export type SelectOption = string | { value: string; label: string };

export function Select({
  options,
  placeholder = 'Select…',
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: SelectOption[];
  placeholder?: string;
}) {
  return (
    <select className="ff__control" {...props}>
      <option value="">{placeholder}</option>
      {options.map((o) => {
        const { value, label } = typeof o === 'string' ? { value: o, label: o } : o;
        return (
          <option key={value} value={value}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

/** Two fields per row on desktop, one on mobile — the deal intake's shape. */
export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="ff-row">{children}</div>;
}

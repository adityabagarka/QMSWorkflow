'use client';

import * as React from 'react';

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

/**
 * A text input backed by a fixed list — the value must come from the list, but
 * the list is too long to sit in a dropdown.
 *
 * A `<datalist>` would be simpler and is the wrong tool: browsers render it
 * inconsistently, it cannot say whether what was typed is in the list, and on
 * mobile it mostly does not appear at all.
 */
export function Typeahead({
  name,
  value,
  onChange,
  search,
  placeholder,
  required,
}: {
  name: string;
  value: string;
  onChange: (next: string) => void;
  search: (query: string) => string[];
  placeholder?: string;
  required?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);

  const matches = open ? search(value) : [];
  const exact = matches.length === 1 && matches[0] === value;
  const showing = exact ? [] : matches;

  function choose(next: string) {
    onChange(next);
    setOpen(false);
    setActive(0);
  }

  return (
    <span className="typeahead">
      <input
        className="ff__control"
        name={name}
        value={value}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        // Not onBlur: clicking a suggestion blurs the input, and closing the
        // list on blur would remove the option before the click lands.
        onKeyDown={(e) => {
          if (!showing.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, showing.length - 1));
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          }
          if (e.key === 'Enter' && showing[active]) {
            e.preventDefault();
            choose(showing[active]);
          }
          if (e.key === 'Escape') setOpen(false);
        }}
      />

      {showing.length > 0 ? (
        <ul className="typeahead__list">
          {showing.map((m, i) => (
            <li key={m}>
              <button
                type="button"
                className={i === active ? 'is-active' : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(m)}
              >
                {m}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}

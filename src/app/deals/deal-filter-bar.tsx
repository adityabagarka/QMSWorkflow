'use client';

import Link from 'next/link';
import { useRef } from 'react';
import {
  FILTER_PARAMS,
  activeFilterCount,
  monthLabel,
  type DealFilters,
} from '@/lib/cases/deal-filters';

export type FilterOption = { value: string; label: string };

/**
 * The controls above the deal list.
 *
 * A plain GET form, not client state. Choosing a filter navigates, so the URL
 * always says what is on screen — shareable, bookmarkable, and correct when
 * somebody goes back to it. It also means the filtering is done by the query
 * that builds the page rather than by hiding rows after they arrive.
 *
 * Each control submits on change, because a filter behind an "apply" button is
 * two actions for one decision. The empty ones are disabled on the way out:
 * a disabled control is not submitted, so the URL carries the filters that are
 * on and nothing else.
 */
export function DealFilterBar({
  filters,
  stages,
  months,
  insurers,
  customers,
  dealTypes,
  showing,
  total,
}: {
  filters: DealFilters;
  stages: FilterOption[];
  months: string[];
  insurers: FilterOption[];
  customers: FilterOption[];
  dealTypes: FilterOption[];
  showing: number;
  total: number;
}) {
  const form = useRef<HTMLFormElement>(null);
  const active = activeFilterCount(filters);

  const submit = () => {
    const element = form.current;
    if (!element) return;
    for (const field of Array.from(element.elements)) {
      if (field instanceof HTMLSelectElement) field.disabled = field.value === '';
    }
    element.requestSubmit();
  };

  const select = (
    name: string,
    value: string | null,
    anything: string,
    options: FilterOption[],
  ) => (
    <label className="dealfilters__field">
      <span className="dealfilters__label">{anything}</span>
      <select
        className="ff__control"
        name={name}
        defaultValue={value ?? ''}
        onChange={submit}
        aria-label={anything}
      >
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <form className="dealfilters" method="get" action="/deals" ref={form}>
      {select(
        FILTER_PARAMS.stage,
        filters.stage === null ? null : String(filters.stage),
        'Stage',
        stages,
      )}
      {select(
        FILTER_PARAMS.month,
        filters.month,
        'Cover starts',
        months.map((month) => ({ value: month, label: monthLabel(month) })),
      )}
      {select(FILTER_PARAMS.insurer, filters.insurer, 'Incumbent insurer', insurers)}
      {select(FILTER_PARAMS.customer, filters.customer, 'Customer', customers)}
      {select(FILTER_PARAMS.dealType, filters.dealType, 'Deal type', dealTypes)}
      {select(FILTER_PARAMS.owner, filters.owner, 'Owner', [{ value: 'mine', label: 'Mine' }])}

      {/* Without JavaScript the selects still submit; this is what submits them. */}
      <noscript>
        <button className="button button--secondary" type="submit">
          apply
        </button>
      </noscript>

      <div className="dealfilters__count">
        {active > 0 ? (
          <>
            <span>
              {showing} of {total}
            </span>
            <Link className="linkish" href="/deals">
              clear
            </Link>
          </>
        ) : (
          <span>
            {total} {total === 1 ? 'deal' : 'deals'}
          </span>
        )}
      </div>
    </form>
  );
}

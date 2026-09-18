/**
 * Reading a member roster.
 *
 * What this does NOT do is decide who is eligible. On a rollover the expiring
 * policy's terms decide that, and a life already on cover is a continuation —
 * an 82-year-old parent under an 80-year limit stays, and is flagged to the
 * insurer as a continuation rather than dropped from the roster. That check
 * belongs to the deviation pass, which runs against the policy terms once they
 * are confirmed.
 *
 * This layer only asks whether the file makes sense: can a row be read, does a
 * dependent have an employee, is a date of birth plausible. Data sanity, not
 * eligibility.
 */
import { matchColumns, MEMBER_FIELDS, valueFor, type Mapping } from './columns';
import type { Sheet } from './sheet';
import {
  ageOn,
  parseDate,
  parseGender,
  parseRelationship,
  parseText,
  parseAmount,
  type Gender,
  type Relationship,
} from './values';

export type MemberRow = {
  rowNumber: number;
  employeeId: string | null;
  name: string | null;
  relationship: Relationship | null;
  gender: Gender | null;
  dob: string | null;
  age: number | null;
  sumInsured: number | null;
  joinedOn: string | null;
};

export type RosterIssueCode =
  | 'relationship_unreadable'
  | 'dob_unreadable'
  | 'dob_in_future'
  | 'dependent_without_employee'
  | 'duplicate_member'
  | 'age_disagrees_with_dob';

export type RosterIssue = {
  code: RosterIssueCode;
  rowNumber: number | null;
  detail: string;
  /** A row this stops from being loaded at all, versus one merely worth saying. */
  blocking: boolean;
};

export type RosterResult = {
  mapping: Mapping;
  members: MemberRow[];
  issues: RosterIssue[];
  /** Whole columns that had to be guessed, so a person can confirm them once. */
  assumptions: string[];
  counts: { rows: number; read: number; self: number; dependents: number };
};

/**
 * `asOf` is the date ages are computed against — cover start, not today, since
 * that is the date the insurer prices on.
 */
export function readRoster(sheet: Sheet, asOf: string, overrides?: Mapping): RosterResult {
  const mapping = overrides ?? matchColumns(sheet.headers, MEMBER_FIELDS);

  const members: MemberRow[] = [];
  const issues: RosterIssue[] = [];
  let dayFirstAssumed = 0;

  sheet.rows.forEach((row, i) => {
    const rowNumber = sheet.headerRow + 1 + i;

    const relationship = parseRelationship(valueFor(row, mapping, 'relationship'));
    const rawRelationship = parseText(valueFor(row, mapping, 'relationship'));

    if (!relationship) {
      issues.push({
        code: 'relationship_unreadable',
        rowNumber,
        detail: rawRelationship
          ? `"${rawRelationship}" is not a relationship this system recognises.`
          : 'No relationship given, so this life cannot be placed in a family.',
        blocking: true,
      });
      return;
    }

    const { iso: dob, ambiguity } = parseDate(valueFor(row, mapping, 'dob'));
    if (ambiguity === 'day_first_assumed') dayFirstAssumed += 1;

    if (dob && dob > asOf) {
      issues.push({
        code: 'dob_in_future',
        rowNumber,
        detail: `Date of birth ${dob} is after cover starts, so it cannot be right.`,
        blocking: false,
      });
    }

    const statedAge = Number(parseText(valueFor(row, mapping, 'age')));
    const derivedAge = ageOn(dob, asOf);

    if (!dob && !Number.isFinite(statedAge)) {
      issues.push({
        code: 'dob_unreadable',
        rowNumber,
        detail: 'Neither a date of birth nor an age, so this life cannot be rated.',
        blocking: false,
      });
    }

    // A stated age and a date of birth that disagree is usually a stale age
    // column left over from last year's file. Worth saying, never worth
    // guessing between.
    if (
      dob &&
      Number.isFinite(statedAge) &&
      derivedAge !== null &&
      Math.abs(statedAge - derivedAge) > 1
    ) {
      issues.push({
        code: 'age_disagrees_with_dob',
        rowNumber,
        detail: `The file says ${statedAge}, the date of birth gives ${derivedAge} at cover start.`,
        blocking: false,
      });
    }

    members.push({
      rowNumber,
      employeeId: parseText(valueFor(row, mapping, 'employee_id')),
      name: parseText(valueFor(row, mapping, 'name')),
      relationship,
      gender: parseGender(valueFor(row, mapping, 'gender')),
      dob,
      age: derivedAge ?? (Number.isFinite(statedAge) ? statedAge : null),
      sumInsured: parseAmount(valueFor(row, mapping, 'sum_insured')),
      joinedOn: parseDate(valueFor(row, mapping, 'joined_on')).iso,
    });
  });

  /*
   * A dependent with no employee on the roster is a hard error, settled in
   * review: cover attaches to an employee, so a spouse with nobody to attach to
   * is either a missing row or a mistyped employee id — and both need a person,
   * not a default.
   *
   * Only checked when the file identifies employees at all; a roster with no
   * employee column cannot be grouped into families and says so once, above,
   * rather than once per row.
   */
  const hasEmployeeColumn = Boolean(mapping.matches.find((m) => m.field === 'employee_id')?.header);
  if (hasEmployeeColumn) {
    const employees = new Set(
      members.filter((m) => m.relationship === 'self' && m.employeeId).map((m) => m.employeeId),
    );

    for (const member of members) {
      if (member.relationship === 'self') continue;
      if (!member.employeeId) {
        issues.push({
          code: 'dependent_without_employee',
          rowNumber: member.rowNumber,
          detail: 'A dependent with no employee id — there is nobody to attach this life to.',
          blocking: true,
        });
        continue;
      }
      if (!employees.has(member.employeeId)) {
        issues.push({
          code: 'dependent_without_employee',
          rowNumber: member.rowNumber,
          detail: `No employee ${member.employeeId} on this roster for this dependent to belong to.`,
          blocking: true,
        });
      }
    }
  }

  // The same life twice is double-counted in every figure downstream.
  const seen = new Map<string, number>();
  for (const member of members) {
    const key = [member.employeeId ?? '', member.relationship, member.dob ?? '', member.name ?? '']
      .join('|')
      .toLowerCase();
    if (key.replace(/\|/g, '').trim() === '') continue;

    const first = seen.get(key);
    if (first !== undefined) {
      issues.push({
        code: 'duplicate_member',
        rowNumber: member.rowNumber,
        detail: `The same life appears on row ${first}.`,
        blocking: false,
      });
    } else {
      seen.set(key, member.rowNumber);
    }
  }

  const assumptions: string[] = [];
  if (dayFirstAssumed > 0) {
    assumptions.push(
      `${dayFirstAssumed} date${dayFirstAssumed === 1 ? '' : 's'} could be read either way round and ` +
        'were taken as day first (03/04 is 3 April). Worth a glance if the file came from an American system.',
    );
  }
  for (const match of mapping.matches) {
    if (match.confidence === 'likely' && match.header) {
      const spec = MEMBER_FIELDS.find((f) => f.field === match.field);
      assumptions.push(`"${match.header}" was read as ${spec?.label ?? match.field}.`);
    }
  }

  const blocked = new Set(issues.filter((i) => i.blocking).map((i) => i.rowNumber));
  const loadable = members.filter((m) => !blocked.has(m.rowNumber));

  return {
    mapping,
    members: loadable,
    issues,
    assumptions,
    counts: {
      rows: sheet.rows.length,
      read: loadable.length,
      self: loadable.filter((m) => m.relationship === 'self').length,
      dependents: loadable.filter((m) => m.relationship !== 'self').length,
    },
  };
}

/** The demography the rates are built on, from a roster that has been read. */
export function summariseRoster(members: MemberRow[]): {
  lives: number;
  byRelationship: Record<string, number>;
  byAgeBand: Record<string, number>;
  averageAge: number | null;
  withoutAge: number;
} {
  const byRelationship: Record<string, number> = {};
  const byAgeBand: Record<string, number> = {};

  // The bands insurers rate on, not even decades.
  const bands: [string, number, number][] = [
    ['0–17', 0, 17],
    ['18–35', 18, 35],
    ['36–45', 36, 45],
    ['46–55', 46, 55],
    ['56–65', 56, 65],
    ['66–75', 66, 75],
    ['76+', 76, 200],
  ];

  let ageTotal = 0;
  let aged = 0;

  for (const m of members) {
    const relationship = m.relationship ?? 'unknown';
    byRelationship[relationship] = (byRelationship[relationship] ?? 0) + 1;

    if (m.age === null) continue;
    aged += 1;
    ageTotal += m.age;

    const band = bands.find(([, lo, hi]) => m.age! >= lo && m.age! <= hi);
    if (band) byAgeBand[band[0]] = (byAgeBand[band[0]] ?? 0) + 1;
  }

  return {
    lives: members.length,
    byRelationship,
    byAgeBand,
    averageAge: aged > 0 ? Math.round((ageTotal / aged) * 10) / 10 : null,
    withoutAge: members.length - aged,
  };
}

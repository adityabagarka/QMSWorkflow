'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { decideUserAccess, type DecisionResult } from './actions';
import { ROLE_LABELS, type Role } from '@/lib/auth/roles';
import { daysUntil, formatDate } from '@/lib/format';

const ASSIGNABLE_ROLES = Object.keys(ROLE_LABELS) as Role[];

export function RequestRow({
  userId,
  name,
  email,
  requestedAt,
  managers,
  canGrantSuperAdmin,
}: {
  userId: string;
  name: string;
  email: string;
  requestedAt: string;
  managers: { id: string; name: string; email: string }[];
  canGrantSuperAdmin: boolean;
}) {
  const [result, submit] = useFormState<DecisionResult, FormData>(decideUserAccess, null);

  // §15 reserves Super Admin to Super Admins; an Admin is not offered it.
  const roles = ASSIGNABLE_ROLES.filter((r) => canGrantSuperAdmin || r !== 'super_admin');

  // Negated because daysUntil looks forward and this looks back; both count
  // calendar days in India rather than 24-hour blocks off the server clock.
  const waitingDays = Math.max(0, -(daysUntil(requestedAt) ?? 0));

  return (
    <tr>
      <td>
        <div>{name}</div>
        <div className="cell-muted" style={{ fontSize: 13 }}>
          {email}
        </div>
      </td>
      <td className="cell-muted">{formatDate(requestedAt)}</td>
      <td>
        {/* The severity scale carries waiting time, so a request that has been
            sitting for a fortnight reads differently from one raised today. */}
        <span
          className={
            waitingDays >= 14
              ? 'chip chip--critical'
              : waitingDays >= 7
                ? 'chip chip--urgent'
                : waitingDays >= 3
                  ? 'chip chip--waiting'
                  : 'chip'
          }
        >
          {waitingDays === 0 ? 'today' : `${waitingDays}d waiting`}
        </span>
      </td>
      <td colSpan={3}>
        <form action={submit}>
          <input type="hidden" name="userId" value={userId} />
          <div className="field-row">
            <select name="role" defaultValue="" aria-label={`Role for ${name}`} required>
              <option value="" disabled>
                Assign a role
              </option>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>

            <select name="managerId" defaultValue="" aria-label={`Reporting line for ${name}`}>
              <option value="">Reports to nobody</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.name}
                </option>
              ))}
            </select>

            <DecisionButtons />
          </div>

          {result && !result.ok ? (
            <p style={{ color: 'var(--plum-red-deep)', fontSize: 13, margin: '10px 0 0' }}>
              {result.message}
            </p>
          ) : null}
        </form>
      </td>
    </tr>
  );
}

/**
 * Submit buttons live in their own component so they can read the pending state
 * of the enclosing form; useFormStatus only reports for an ancestor form.
 */
function DecisionButtons() {
  const { pending } = useFormStatus();

  return (
    <>
      <button className="button" type="submit" name="intent" value="approve" disabled={pending}>
        {pending ? 'saving…' : 'approve'}
      </button>
      <button
        className="button button--secondary"
        type="submit"
        name="intent"
        value="reject"
        disabled={pending}
      >
        reject
      </button>
    </>
  );
}

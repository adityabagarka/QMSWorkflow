import { formatRupees } from '@/lib/format';
import type { BurnView } from './actions';

/**
 * The burn, and everything still assumed about it.
 *
 * Marked as an estimate wherever it appears, with the reasons beside it —
 * ADR 0011 rule 7 makes that a property of the data rather than a convention,
 * because otherwise "back of the envelope" becomes "the number we quoted" by
 * nothing more than time passing.
 *
 * The workings are shown rather than the answer alone. A premium an RM cannot
 * take apart is a premium they cannot defend on a call, and the first question
 * an insurer asks is which assumption it rests on.
 */
export function BurnPanel({ view }: { view: BurnView }) {
  if (!view.burn) {
    return (
      <div className="notice" style={{ marginTop: 24 }}>
        <p style={{ margin: 0 }}>
          A burn needs claims and a roster. {view.estimateReasons[0] ?? 'Not enough is loaded yet.'}
        </p>
      </div>
    );
  }

  const { burn, comparison } = view;

  return (
    <div className="burn">
      <div className="burn__head">
        <div>
          <span className="burn__label">Indicative premium</span>
          <span className="burn__figure">{formatRupees(burn.indicativePremium)}</span>
          <span className="burn__gst">Excluding GST</span>
        </div>
        <span className="chip chip--urgent">Estimate</span>
      </div>

      {comparison ? (
        <p className="burn__move">
          {comparison.direction === 'flat'
            ? 'Level with what they pay now.'
            : `${Math.abs(comparison.changePct)}% ${comparison.direction} on what they pay now.`}
        </p>
      ) : null}

      <table className="bandtable" style={{ marginTop: 18 }}>
        <tbody>
          {burn.workings.map((step) => (
            <tr key={step.label}>
              <td>{step.label}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{formatRupees(step.value)}</td>
              <td className="cell-muted">{step.note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="burn__caveats">
        <p className="burn__caveats-head">Still an estimate because</p>
        <ul className="plainlist">
          {view.estimateReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

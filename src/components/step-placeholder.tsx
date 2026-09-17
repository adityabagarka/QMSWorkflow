/**
 * A step that exists in the sequence but has not been built yet.
 *
 * Deliberately a real page rather than a missing route: the wizard offers these
 * steps, so walking into one must show where you are and how to get back, not a
 * 404. It says plainly what is not here rather than pretending to be empty.
 */
export function StepPlaceholder({ what }: { what: string }) {
  return (
    <div className="notice">
      <p className="eyebrow">Not built yet</p>
      <p style={{ margin: 0 }}>{what}</p>
    </div>
  );
}

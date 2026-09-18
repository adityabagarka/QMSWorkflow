/**
 * The burn calculation (ARCHITECTURE.md §10).
 *
 * What a programme costs to run, worked from the claims actually incurred,
 * grossed up for the claims that have happened but not yet been reported, and
 * loaded for the year of medical inflation between the period observed and the
 * period being quoted. The indicative premium is that per-life cost multiplied
 * by the lives being quoted, with the insurer's own costs and commissions on
 * top.
 *
 * It exists to answer "is this deal worth chasing, and what will the insurer
 * come back with" before an insurer has said anything — which is how the work
 * actually starts. It is an ESTIMATE, and ADR 0011 rule 7 makes that a property
 * of the data rather than a convention: a figure computed from inputs nobody
 * has confirmed is marked as such wherever it appears, and cannot reach an RFQ
 * or a customer-facing page.
 */

export type BurnInputs = {
  /** Settled plus outstanding: what the period has actually cost. */
  incurredClaims: number;
  /** Lives on cover through the expiring period. */
  livesCovered: number;
  /** Lives being quoted for, which is rarely the same number. */
  livesQuoted: number;
  /** How much of the expiring period the claims cover, in months. */
  monthsObserved: number;

  /** Claims incurred but not reported. §18 leaves the default open; 8% is the working figure. */
  ibnrPct: number;
  /** Medical inflation between the observed period and the quoted one. */
  inflationPct: number;
  tpaFeePct: number;
  brokeragePct: number;
  insurerOpexPct: number;
};

export type Burn = {
  annualisedClaims: number;
  claimsWithIbnr: number;
  perLifeClaimsCost: number;
  inflatedPerLifeCost: number;
  expectedClaims: number;
  indicativePremium: number;
  /** Each step, so a figure can be argued with rather than only accepted. */
  workings: { label: string; value: number; note: string }[];
};

/**
 * Sensible starting points, every one overridable.
 *
 * The IBNR and outlier thresholds are open questions in §18 and are NOT decided
 * here — these are working defaults the RM can change on the screen, and the
 * screen says they are assumptions. Picking one silently in a calculation that
 * produces a premium is exactly what §18 asks not to happen.
 */
export const BURN_DEFAULTS = {
  ibnrPct: 8,
  inflationPct: 10,
  tpaFeePct: 5,
  brokeragePct: 10,
  insurerOpexPct: 15,
} as const;

export function computeBurn(inputs: BurnInputs): Burn | null {
  const { incurredClaims, livesCovered, livesQuoted, monthsObserved } = inputs;

  // Every one of these divides something. A burn computed against zero lives
  // or zero months is not a small number, it is a meaningless one.
  if (livesCovered <= 0 || livesQuoted <= 0 || monthsObserved <= 0) return null;

  const annualisedClaims = (incurredClaims * 12) / monthsObserved;
  const claimsWithIbnr = annualisedClaims * (1 + inputs.ibnrPct / 100);
  const perLifeClaimsCost = claimsWithIbnr / livesCovered;
  const inflatedPerLifeCost = perLifeClaimsCost * (1 + inputs.inflationPct / 100);
  const expectedClaims = inflatedPerLifeCost * livesQuoted;

  /*
   * The loadings are a share of the PREMIUM, not of the claims — that is what
   * an expense ratio means. So the premium is what the expected claims become
   * once those shares are taken out of it, which is a division rather than a
   * multiplication.
   *
   * Loading the claims instead is the common mistake and it understates the
   * premium: at a combined 30%, claims x 1.3 gives 130 where the correct
   * answer is 143.
   */
  const loadRatio = (inputs.tpaFeePct + inputs.brokeragePct + inputs.insurerOpexPct) / 100;
  if (loadRatio >= 1) return null;

  const indicativePremium = expectedClaims / (1 - loadRatio);

  return {
    annualisedClaims,
    claimsWithIbnr,
    perLifeClaimsCost,
    inflatedPerLifeCost,
    expectedClaims,
    indicativePremium,
    workings: [
      {
        label: 'Claims incurred',
        value: incurredClaims,
        note: `Settled plus outstanding, over ${monthsObserved} months`,
      },
      {
        label: 'Annualised',
        value: annualisedClaims,
        note:
          monthsObserved === 12
            ? 'A full year already'
            : `Scaled from ${monthsObserved} months to 12`,
      },
      {
        label: 'Plus IBNR',
        value: claimsWithIbnr,
        note: `${inputs.ibnrPct}% for claims incurred but not yet reported`,
      },
      {
        label: 'Per life',
        value: perLifeClaimsCost,
        note: `Across ${livesCovered.toLocaleString('en-IN')} lives on cover`,
      },
      {
        label: 'Plus inflation',
        value: inflatedPerLifeCost,
        note: `${inputs.inflationPct}% medical inflation to the quoted period`,
      },
      {
        label: 'Expected claims',
        value: expectedClaims,
        note: `For the ${livesQuoted.toLocaleString('en-IN')} lives being quoted`,
      },
      {
        label: 'Indicative premium',
        value: indicativePremium,
        note: `Grossed up for TPA ${inputs.tpaFeePct}%, brokerage ${inputs.brokeragePct}%, insurer costs ${inputs.insurerOpexPct}% — excluding GST`,
      },
    ],
  };
}

/**
 * How the burn compares with what is being paid now.
 *
 * The number an RM actually wants: not the premium, but whether it is going up
 * and by how much. §18 leaves the outlier threshold open, so this reports the
 * movement and does not judge it.
 */
export function comparedWithExpiring(
  indicativePremium: number,
  expiringPremium: number | null,
): { changePct: number; direction: 'up' | 'down' | 'flat' } | null {
  if (!expiringPremium || expiringPremium <= 0) return null;

  const changePct =
    Math.round(((indicativePremium - expiringPremium) / expiringPremium) * 1000) / 10;
  return {
    changePct,
    direction: changePct > 1 ? 'up' : changePct < -1 ? 'down' : 'flat',
  };
}

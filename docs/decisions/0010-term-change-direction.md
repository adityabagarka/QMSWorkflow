# 0010 — Enhancement or restriction

**Status:** accepted
**Relates to:** ARCHITECTURE.md §4.1, §7, §12, §13

## Two changes, one cause

**Every option shows the full term**, including where it matches the expiring
policy. "Same as expiring" reads fine on screen and fails everywhere else: this
table is exported to Excel, insurers quote from that export, and the policy an
insurer issues has to contain the words. A cross-reference is not a term.

**Storage is unchanged, and stays a difference.** `rfq_option_terms` still holds
only what an option overrides, which is what lets a corrected expiring term flow
into every option that had not changed it, and makes "changed" a row that exists
rather than a comparison. The model was right; the presentation was not.

## Direction, and why it is not arithmetic

An enhancement and a restriction move price in opposite directions — one is
costed, the other is grounds for a discount. Showing them alike leaves the RM to
work it out fifty-eight times per option.

Direction cannot be read off the number:

| Change                                              | Number           | Direction       |
| --------------------------------------------------- | ---------------- | --------------- |
| Co-pay 10% → 20%                                    | rises            | **restriction** |
| Maternity ₹50,000 → ₹75,000                         | rises            | **enhancement** |
| Room rent twin sharing → single private AC          | no number at all | **enhancement** |
| Proportionate deduction not applicable → applicable | no number at all | **restriction** |

So each benefit carries its own sense, held as reference data in
`benefit_polarity` — admin-editable like the guardrails tables, because it is
domain judgement and not application logic:

- `higher_better` — sum insured, maternity limit, age ceilings
- `lower_better` — co-pay, deductible, waiting periods
- `presence_better` — a cover that is either there or not
- `absence_better` — a clause whose presence restricts
- `ordinal` — ranked wording, in `benefit_value_ranks`
- `none` — genuinely directionless

53 of the 58 benefits are classified. The five left as `none` are decisions:
`members_covered` and `age_band` because swapping or reshaping cover is not a
move up or down, and the three service terms because they describe
administration rather than cover.

## The governing rule: a wrong answer is worse than none

A restriction shown as an enhancement invites the RM to add cost where they
should be asking for a discount. So every uncertain path returns plain
`changed` — marked as different, with no claim about which way:

- the benefit is unclassified, or classified `none`
- no number can be read from one side
- the wording matches no rank
- the values are equal

Six of the eighteen assertions in `070_term_direction.sql` are refusals.

## The RM has the last word

`rfq_option_terms.change_kind_override` lets an RM correct the classifier. It
fixes the display and records the disagreement, which is how the reference data
earns its corrections — the same loop as `policy_extraction_edits`.

## Colour

This widens the palette, which the design system otherwise resists: plum-red
does all the emphasis work. Two directions need two colours, and the green is
muted and warm so it sits on cream rather than shouting off it.

**Colour never carries the meaning alone.** Every marked cell also has an arrow
and a word — for anyone who cannot distinguish the two, and for the Excel
export, where a fill may not survive but a label will.

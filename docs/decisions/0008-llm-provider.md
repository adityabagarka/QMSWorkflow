# 0008 — LLM provider for policy extraction

**Status:** proposed — needs a human decision (§18.2)
**Relates to:** ARCHITECTURE.md §3, §8, §16, §18.2

§18.2 makes this a decision for a person, not a default. This records the
analysis; the choice and the commercial agreement behind it are not ours to make.

## Proposal: Claude, via the Anthropic API

### It fits the shape of the problem

**PDFs go in directly.** A policy document is passed as a `document` content
block — up to 32 MB and 600 pages per request. No file conversion stage.

**Scanned policies are read as images.** §8 warns that policy copies are often
scanned and tells us not to assume clean text. Claude reads PDF pages visually,
so a scanned policy is handled by the same call as a digital one. That removes a
separate OCR stage from the pipeline — though it should be tested against a real
scanned policy before we rely on it, because "handled" and "handled accurately
enough to review" are different claims.

**Extraction lands schema-shaped.** Structured outputs (`output_config.format`)
constrain the response to a JSON schema. The schema here is not invented: it is
the 58 `benefit_key`s from `benefit_catalogue`, generated from the table, which
is what §4.1 and CLAUDE.md require. The model cannot return a field that is not
a benefit key.

**Confidence per field** (§8) comes back in the same structured response, which
is what drives the RM review screen: sort the low-confidence fields to the top.

### Cost

Rates as of the pricing table current at the time of writing — confirm before
committing, since these move:

| Model            | Input $/1M | Output $/1M |
| ---------------- | ---------- | ----------- |
| Claude Opus 5    | $5.00      | $25.00      |
| Claude Sonnet 5  | $2.00      | $10.00      |
| Claude Haiku 4.5 | $1.00      | $5.00       |

A worked estimate for one policy, assuming ~40 pages at roughly 2,500 tokens per
page (~100K input) and ~8K output for 58 fields with confidence scores:

| Model    | Per policy | 100 policies/month |
| -------- | ---------- | ------------------ |
| Opus 5   | ~$0.70     | ~$70               |
| Sonnet 5 | ~$0.28     | ~$28               |

Two levers, both worth taking:

- **Batch API** runs non-urgent work asynchronously at **50% cost**. Extraction
  is not latency-sensitive if it happens on upload and the RM reviews later,
  which is the natural flow here. That halves the figures above.
- **Prompt caching** makes a repeated prefix roughly 90% cheaper to read. The
  extraction instructions and the 58-field schema are identical on every
  policy, so they cache. The saving is modest in relative terms because the
  document dominates the token count — but it is close to free to take.

So realistically **$15–$35 a month at 100 policies**. Against the cost of one
insurer query caused by a misread term, this is not the number that should drive
the decision.

**Model choice is yours, not ours.** The default here is Opus 5. Extraction
quality on a dense insurance document is the whole point of the feature, and a
term read wrongly propagates into the RFQ, the comparison table and the
customer's decision. If the evaluation shows Sonnet 5 reads policies as
accurately, the saving is real and worth taking — but that is a measurement to
make, not an assumption to start from.

### What it does not settle

**The data processing agreement.** §16 is explicit: do not send PHI or PII to any
LLM API without a DPA covering it. Policy documents carry member and claims
detail. So:

- With synthetic data, as now, there is nothing to resolve.
- Before a real policy is uploaded, Plum needs a commercial agreement with
  Anthropic covering this data, and should look at zero-data-retention terms as
  part of it.

This is a contract to sign, not a setting to configure, and it is the actual
§18.2 blocker. Choosing Claude technically does not close it.

## What is needed to proceed

1. An API key from `console.anthropic.com`, stored as `ANTHROPIC_API_KEY`.
   Server-side only — never a `NEXT_PUBLIC_` variable, since that would ship it
   to every visitor's browser.
2. A model decision: Opus 5 by default, Sonnet 5 if measurement supports it.
3. The DPA, before real data.

## How this is built so the decision stays reversible

The extraction step sits behind one interface — document in, `benefit_key`-keyed
terms plus confidences out — with two implementations: the model, and manual
entry by the RM. Manual entry is not a stub; it is a real fallback for a policy
the model reads badly, and it is what makes the pipeline testable before any key
exists.

Every correction an RM makes is already captured in `policy_extraction_edits`
(§8), which means the accuracy of whichever provider is chosen becomes
measurable from real use rather than argued about.

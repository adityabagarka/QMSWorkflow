import Anthropic from '@anthropic-ai/sdk';
import { bespokePages, type PdfText } from '@/lib/parsing/pdf-text';

/**
 * Reading the expiring policy.
 *
 * This is the only document in the flow that needs a model. The roster and the
 * claims dump are tables and a parser reads them exactly; a policy copy is
 * prose, written differently by every insurer, and saying what the room rent
 * limit is means reading a sentence rather than a cell (ADR 0011 rule 3).
 *
 * Three rules shape everything below:
 *
 *  1. Every value carries the sentence it was read from. A term whose source
 *     cannot be checked is not reviewable, and a reviewer confirming one would
 *     be confirming the model rather than the policy (§9, §16).
 *  2. Absence is an answer. "Not stated in this policy" is a real finding about
 *     a rollover — it is what an insurer will ask about — so the reader is told
 *     to say so rather than to guess a market-standard value.
 *  3. Nothing here decides anything. Every value comes back proposed, and the
 *     database refuses to accept an extracted term that arrives reviewed.
 */

export const EXTRACTION_MODEL = 'claude-opus-5';

export type CatalogueEntry = {
  benefit_key: string;
  section: string;
  benefit_label: string;
};

export type ExtractedTerm = {
  benefitKey: string;
  /** Null means the reader looked and the policy does not say. */
  value: string | null;
  /** Verbatim from the policy. Null only when there is no value. */
  evidence: string | null;
  page: number | null;
  confidence: number;
};

export type ExtractionOutcome =
  | { ok: true; terms: ExtractedTerm[]; model: string }
  | {
      ok: false;
      reason: 'not_configured' | 'too_large' | 'refused' | 'unreadable' | 'failed';
      message: string;
    };

/**
 * How much policy text to send.
 *
 * Generous — a trimmed schedule runs to a few tens of thousands of characters,
 * well inside this — but not unbounded, because a document that arrives far
 * larger than any real schedule is a sign the wording was not trimmed rather
 * than a policy worth reading whole.
 */
const MAX_TEXT_CHARS = 400_000;

/**
 * Whether extraction can run at all.
 *
 * Absent a key the feature is unavailable rather than broken: the screen says
 * the terms are entered by hand for now, and everything else in the flow works
 * exactly as it did. This is deliberate — the DPA in §18.2 has not happened, so
 * a deployment that never sets the key is a supported state, not a misconfigured
 * one.
 */
export function extractionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM = `You read expiring group health insurance policies issued in India and report what they say, benefit by benefit.

You are reading for an insurance broker who is taking this policy to other insurers for a rollover quote. The terms you report become the "expiring terms" column those insurers are asked to match, so a wrong value costs real money and a guessed one is worse than a blank.

Rules, in order of importance:

1. Report only what the document says. Never supply a market-standard value, a typical value, or a value implied by the plan name. If the policy does not state a benefit, report it as not stated.
2. Every value you report must be accompanied by the sentence or clause you read it from, quoted exactly as printed, including its numbers and punctuation. If you cannot quote it, you cannot report it.
3. Quote the clause, not the schedule heading, where the two differ — an endorsement later in the document overrides the schedule, and the later clause is the one that applies.
4. Report values as the policy expresses them: "Rs. 5,000 per day", "1% of sum insured per day", "Covered up to Rs. 50,000", "9 months waiting period", "Covered", "Not covered". Do not convert, round, annualise or normalise.
5. Where a benefit differs by plan, grade or category within one policy, report all of them in the value, naming each.
6. Confidence is about the document, not about you: high when the clause states the benefit plainly, low when you are reading it off a table with ambiguous headers, or when two parts of the policy disagree. If two parts disagree, say so in the value and quote the clause you took.`;

const TOOL_NAME = 'report_policy_terms';

export type ReportedTerm = {
  benefit_key: string;
  status: 'stated' | 'not_stated';
  value?: string | null;
  evidence?: string | null;
  page?: number | null;
  confidence?: number | null;
};

/**
 * A tool rather than a JSON response format, for one reason: the API rejects
 * `output_config.format` together with document citations, and a schema-shaped
 * tool call gives the same guarantee. `strict: true` means the arguments
 * validate against the schema before they ever reach this code.
 */
function reportingTool(catalogue: CatalogueEntry[]): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description:
      'Report every benefit in the catalogue, whether or not the policy states it. One entry per benefit_key, no extras, none omitted.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['terms'],
      properties: {
        terms: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['benefit_key', 'status', 'value', 'evidence', 'page', 'confidence'],
            properties: {
              benefit_key: {
                type: 'string',
                enum: catalogue.map((c) => c.benefit_key),
              },
              status: {
                type: 'string',
                enum: ['stated', 'not_stated'],
                description: 'not_stated means you read the policy and it does not say.',
              },
              value: {
                type: ['string', 'null'],
                description: 'The benefit as the policy expresses it. Null when not_stated.',
              },
              evidence: {
                type: ['string', 'null'],
                description:
                  'The clause this was read from, quoted exactly. Null only when not_stated.',
              },
              page: {
                type: ['integer', 'null'],
                description: '1-indexed page the quote appears on, or null if you cannot place it.',
              },
              confidence: {
                type: ['number', 'null'],
                description: '0 to 1. How plainly the document states this, not how sure you feel.',
              },
            },
          },
        },
      },
    },
  };
}

function catalogueBrief(catalogue: CatalogueEntry[]): string {
  const bySection = new Map<string, CatalogueEntry[]>();
  for (const entry of catalogue) {
    bySection.set(entry.section, [...(bySection.get(entry.section) ?? []), entry]);
  }

  return [...bySection.entries()]
    .map(
      ([section, entries]) =>
        `${section}\n${entries.map((e) => `  ${e.benefit_key} — ${e.benefit_label}`).join('\n')}`,
    )
    .join('\n\n');
}

/**
 * Turns what the reader said into what the database will accept.
 *
 * Pure, and separate from the call, because this is where the rules with teeth
 * live — a value without a quote is not a value, a benefit outside the
 * catalogue is not a benefit — and rules with teeth deserve tests that do not
 * need a network.
 */
export function normaliseReported(
  reported: ReportedTerm[],
  catalogue: CatalogueEntry[],
): ExtractedTerm[] {
  const known = new Set(catalogue.map((c) => c.benefit_key));
  const seen = new Set<string>();
  const terms: ExtractedTerm[] = [];

  for (const term of reported) {
    // Belt and braces over `strict: true`: a benefit_key outside the catalogue
    // would fail the foreign key on write, and dropping it here says so in one
    // place rather than failing the whole run. First mention wins on a
    // duplicate — a second reading of the same benefit is not a correction of
    // the first, and picking between them is the reviewer's job.
    if (!known.has(term.benefit_key) || seen.has(term.benefit_key)) continue;
    seen.add(term.benefit_key);

    const hasValue =
      term.status === 'stated' && typeof term.value === 'string' && term.value.trim() !== '';
    const quote =
      typeof term.evidence === 'string' && term.evidence.trim() !== ''
        ? term.evidence.trim()
        : null;

    // A value nobody can trace is not reviewable, so it is not a value. Kept as
    // not-stated rather than dropped: the reviewer still sees the benefit and
    // still has to answer it.
    const usable = hasValue && quote !== null;

    terms.push({
      benefitKey: term.benefit_key,
      value: usable ? (term.value as string).trim() : null,
      evidence: usable ? quote : null,
      page:
        usable && typeof term.page === 'number' && term.page >= 1 ? Math.floor(term.page) : null,
      confidence:
        typeof term.confidence === 'number' && Number.isFinite(term.confidence)
          ? Math.min(1, Math.max(0, term.confidence))
          : 0.5,
    });
  }

  return terms;
}

/**
 * Reads a policy PDF against the benefit catalogue.
 *
 * The catalogue is passed in rather than imported: `benefit_catalogue` is the
 * single schema for every extraction target (CLAUDE.md), and a second list
 * hard-coded here would be exactly the duplicate that rule forbids.
 */
export async function extractPolicyTerms(
  text: PdfText,
  catalogue: CatalogueEntry[],
): Promise<ExtractionOutcome> {
  if (!extractionConfigured()) {
    return {
      ok: false,
      reason: 'not_configured',
      message: 'Policy reading is not switched on in this environment.',
    };
  }

  if (catalogue.length === 0) {
    return {
      ok: false,
      reason: 'failed',
      message: 'The benefit catalogue is empty, so there is nothing to look for.',
    };
  }

  if (!text.usable) {
    return {
      ok: false,
      reason: 'unreadable',
      message:
        'That PDF has no readable text layer — it decodes to symbols rather than words. The terms will have to be entered by hand.',
    };
  }

  /*
   * The insurer's filed wording is dropped before anything is sent.
   *
   * It is the bulk of the document — pages 15 to 55 of an ICICI Lombard policy,
   * 8 to 21 of a TATA AIG one — and none of it can be negotiated, so none of it
   * can be an expiring term. What a broker quotes against is the schedule, the
   * benefit tables and the endorsements, which is what is left.
   */
  const pages = bespokePages(text);
  const document = pages
    .map((p) => `===== PAGE ${p.page} =====\n${p.lines.join('\n')}`)
    .join('\n\n');

  if (document.length === 0) {
    return {
      ok: false,
      reason: 'unreadable',
      message: 'There is no readable text in that policy.',
    };
  }

  if (document.length > MAX_TEXT_CHARS) {
    return {
      ok: false,
      reason: 'too_large',
      message: `That policy is ${Math.round(document.length / 1000)}k characters even after the filed wording is removed, which is far larger than any schedule. Upload the schedule and endorsements without the annexures.`,
    };
  }

  const client = new Anthropic();

  try {
    /*
     * Streamed because a 60-page policy read against 58 benefits is a long
     * request in both directions, and a non-streaming call of this size runs
     * into the HTTP timeout before the model is finished.
     */
    const stream = client.messages.stream({
      model: EXTRACTION_MODEL,
      max_tokens: 64000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      tools: [reportingTool(catalogue)],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: [
            {
              /*
               * Text, not the PDF. A document block is processed page by page
               * with the page rendered as an image; the text layer carries
               * everything a policy states, and the page markers below keep the
               * evidence page numbers true to the original file.
               */
              type: 'text',
              text: `POLICY TEXT\n\n${document}`,
            },
            {
              type: 'text',
              text: `Read the policy above and report each of the following benefits. Report every one — a benefit the policy does not mention is reported as not_stated, which is itself a finding the broker needs.\n\nGive the page from the "===== PAGE n =====" marker the clause appears under, so a reviewer can find it in the original document.\n\n${catalogueBrief(catalogue)}`,
            },
          ],
        },
      ],
    });

    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      return {
        ok: false,
        reason: 'refused',
        message:
          'The reader declined to process that document. Enter the terms by hand and flag this deal.',
      };
    }

    if (message.stop_reason === 'max_tokens') {
      return {
        ok: false,
        reason: 'failed',
        message:
          'The reader ran out of room before finishing. Nothing has been saved — try the policy wording on its own, without annexures.',
      };
    }

    const call = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === 'tool_use' && block.name === TOOL_NAME,
    );

    if (!call) {
      return {
        ok: false,
        reason: 'unreadable',
        message: 'The reader did not report any terms for that document.',
      };
    }

    const reported = (call.input as { terms?: ReportedTerm[] }).terms ?? [];
    const terms = normaliseReported(reported, catalogue);

    return { ok: true, terms, model: message.model };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return {
        ok: false,
        reason: 'not_configured',
        message: 'The reader’s credentials were refused. The terms can be entered by hand.',
      };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return {
        ok: false,
        reason: 'failed',
        message:
          'The reader is rate limited right now. Nothing has been saved — try again shortly.',
      };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, reason: 'failed', message: `The reader failed: ${error.message}` };
    }
    return {
      ok: false,
      reason: 'failed',
      message: error instanceof Error ? error.message : 'The reader failed.',
    };
  }
}

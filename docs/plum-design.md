# Plum Design System — Web

A web adaptation of the **Plum Design System**. Editorial and print‑inspired at its root — warm cream surfaces, hairline rules, a serif display face paired with a humanist sans, and a single plum‑red doing all the emphasis work — translated to responsive screens. Calm, considered, advisory.

Origin is an A4 editorial page; on the web that fixed canvas becomes a **fluid, max‑width column** (~720–960px for long‑form, up to 1200px for marketing) centered on a cream field, with the same generous margins expressed as responsive padding (clamp from ~20px mobile to ~64px desktop).

---

## Fonts

Two brand families, wired via `@font-face` in `colors_and_type.css`, exposed as CSS variables:

- **`var(--font-display)` → GT Alpina** (serif). Weights: Light 300, Light Italic 300i, Regular 400, Bold 700. Used for hero and section headlines, long‑form editorial prose, pull quotes, large stat numerals. Fallback: Georgia, serif.
- **`var(--font-sans)` → Passenger Sans** (humanist sans). Weights: Light 300, Regular 400, Medium 500, Semibold 600, Bold 700. Used for eyebrows, nav, buttons, UI labels, captions, stat units, table headers, form controls. Fallback: system‑ui, sans‑serif.

**Italic GT Alpina carries meaning** — reserved for one or two emphasis words inside a headline (*right*, *design*, *you*). Never whole sentences.

Large serif headings tighten letter‑spacing to about **‑0.03 to ‑0.04em**.

### Type scale (fluid — use `clamp()`)
| Role | Family | Size / weight |
|---|---|---|
| Hero headline | GT Alpina | `clamp(38px, 6vw, 64px)` / 400, ‑0.03em |
| Section title (`h2`) | GT Alpina | `clamp(26px, 3.5vw, 40px)` / 400, ‑0.04em |
| Subhead (`h3`) | GT Alpina | `clamp(18px, 2vw, 24px)` / 400 |
| Pull quote | GT Alpina italic | `clamp(18px, 2.6vw, 28px)` / 400 |
| Serif body | GT Alpina | 17–18px / 1.6 (long‑form reading) |
| Sans body | Passenger Sans | 15–16px / 1.55 |
| Stat numeral | GT Alpina | `clamp(36px, 5vw, 64px)` / 400 |
| Eyebrow (red) | Passenger Sans | 12–13px / 500, uppercase, 0.06em |
| Nav / button | Passenger Sans | 15px / 500 |
| Caption / unit | Passenger Sans | 11–12px / 500, uppercase |

Body text scales up for screen reading — never below **15px** on the web; long‑form serif sits at 17–18px.

---

## Color

A single warm cream surface holds everything; one confident red does emphasis. No gradients, meshes, or noise.

| Token | Value | Use |
|---|---|---|
| `--cream` | `#FFFAF2` | Page background |
| `--cream-deep`, `--cream-warm` | warmer creams | Cards, alternating rows, section bands |
| `--plum-red` | `#FF4052` | Links, logo, hairline dividers, eyebrows, emphasis, primary CTA |
| `--plum-red-deep`, `--plum-red-press` | darker reds | Hover / press states |
| `--fg-1` | `#3A0E2B` (deep aubergine) | Body copy, headings |
| `--fg-2`, `--fg-muted` | paler plums | Secondary text, footers |
| `--line-lavender`, `--line-lavender-2` | `#C7B1C0` | Hairline dividers, borders |
| `--fg-on-red` | cream | Text on red surfaces |

**Severity / intensity scale** (four tinted fills, low → high):
`--sev-blush #FFE7EA` → `--sev-pink #FFD9DC` → `--sev-coral #FF9FA8` → `--plum-red #FF4052`.
Use for tags, status chips, comparison tables, or data emphasis.

**Links:** default `--plum-red`; hover shifts to `--plum-red-deep` (or deep aubergine underline). Always define `a` and `a:hover` explicitly. Only use `var(--*)` names defined in `colors_and_type.css` — never guess a token.

---

## Layout & structure

Translate the print page frame into web sections:

- **Header / nav:** tiny plum logo left, lightweight sans nav right, a hairline rule beneath. Sticky optional; keep it slim and cream.
- **Hero:** red eyebrow label, large serif headline with one italic emphasis word, short sans standfirst, one primary CTA. Optional full‑bleed cinematic image or a flat cream field.
- **Content sections:** each opens with a red eyebrow + serif `h2` + 1px plum‑red rule. Two‑column editorial grids on desktop collapse to one column on mobile. Generous vertical rhythm between sections.
- **Footer:** mirrored hairline, `plumhq.com`‑style wordmark left, links/legal right; may sit on a full‑bleed plum‑red band.

### Signature elements
- **Arrow‑tipped rule:** 1px line with tiny triangular arrowheads at both ends. Lavender for chrome, red for section dividers.
- **Plain rules:** 1px plum‑red or lavender section breaks.
- **Stat figure:** large serif numeral + small‑caps sans unit + short sans label. Lay out in a responsive grid.
- **Severity chips / tags:** uppercase sans on tinted fills, 0.5px red border, no rounding.
- **Cards:** cream‑deep fill, 7px radius, diffuse shadow (`--shadow-cta`) for CTA/feature cards; hairline‑bordered blocks elsewhere.
- **Tables:** 0.5px plum‑red hairlines on tinted fills, lavender uppercase headers, clean outer outline, vertically centered cells; on mobile, allow horizontal scroll or stack rows.
- **Buttons:** primary = plum‑red fill, cream text, ~1.5px radius, diffuse shadow, lowercase label ("get a quote"); hover darkens, press darkens further. Secondary = hairline outline on cream.
- **Full‑bleed plum‑red bands** for hero or closing CTA sections.

---

## Voice & content rules

- **Advisory, measured, literary.** Long, properly‑punctuated sentences; em dashes and semicolons welcome.
- **Second person** — "you", "your team".
- **British spelling** — *organisation, optimise, programme, recognisable*.
- **Casing:** eyebrows UPPERCASE; headlines sentence case; buttons lowercase; category chips UPPERCASE.
- **Numbers are dignified** — large serif numerals with a small sans unit, never in colored badges.
- **No emoji. Ever.**

---

## Icons

Icon‑light system. Line illustrations in plum‑red pen‑weight on cream; minimal linear UI glyphs. No icon font in the source. Where a broader set is needed, substitute **Lucide** (1.5px stroke, `currentColor`, 20–24px) — flag as a substitution.

---

## Motion & interaction

Calm fades and short transitions (150–250ms, ease‑out). No bounces or spring physics. Hover shifts to deeper aubergine or darker red; press darkens further; opacity for disabled. Respect `prefers-reduced-motion`. No blur or glassmorphism — tinted color blocks do the work transparency usually would.

---

## Responsive notes

- **Breakpoints:** ~640px (mobile → tablet), ~1024px (tablet → desktop).
- Two‑column editorial grids collapse to one column below ~768px.
- Hero and section type scale with `clamp()`; never let serif headlines drop below ~28px on mobile.
- Maintain the cream field edge‑to‑edge; content sits in a centered max‑width column.
- Tap targets ≥ 44px; keep the slim cream header from crowding on small screens.

---

## Files

- `colors_and_type.css` — Plum Design System tokens (color, type, spacing, radius, shadow) and semantic element styles.
- `fonts/` — GT Alpina + Passenger Sans (woff2/woff/otf).
- `assets/` — `plum-logo.svg`, `plum-wordmark-cover.png`, cover imagery.

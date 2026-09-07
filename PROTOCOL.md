# Hyderabad Synthetic Case Study — Research Protocol

Study of **hybrid deterministic code compliance checking** for architectural
pre-design, executed on synthetic residential sites in the GHMC jurisdiction
(Hyderabad, Telangana).

The protocol is confined to three standalone files — `PROTOCOL.md`,
`generate_synthetic_sites.py`, `analyze_results.py` — and touches no part of the
Terralogic web application, its UI or its server routing.

## 1. Research question

Does calibrating a deterministic pre-design compliance checker to the local
Hyderabad regulatory framework (GHMC / TS-bPASS / G.O. Ms. No. 168) change its
classification accuracy relative to a generic national baseline, and is that
change statistically significant on paired data?

* **H0** — the two checkers have the same probability of a correct verdict
  (equal discordant-pair proportions under McNemar's test).
* **H1** — the two checkers differ.

## 2. Scope: pre-design macro constraints only

Modelled: Floor Area Ratio, ground coverage, front / rear / side setbacks,
permissible height, and the resulting maximum building envelope (footprint,
built-up area, envelope volume).

Explicitly out of scope: staircases, fire and life safety, lifts, plumbing,
room-level daylight/ventilation, parking layout, structural design — i.e. every
constraint that only becomes decidable after schematic design.

## 3. Regulatory framework

Encoded as six auditable tables at the top of `generate_synthetic_sites.py`:

| Table | Constraint | Governing variable |
|---|---|---|
| 1 | Setbacks (front / rear / side) for buildings up to 10 m | plot area bracket |
| 2 | Front setback floor | abutting road width |
| 3 | Side / rear setback escalation | building height |
| 4 | Maximum permissible height | abutting road width |
| 5 | Ground coverage percentage | plot area bracket |
| 6 | Floor Area Ratio | abutting road width |

Plus the clause `height <= 1.5 x (abutting road width + front setback provided)`
for non-high-rise development, and the geometric requirement that the proposed
footprint fit inside the setback envelope actually provided.

**Verification note.** The numeric brackets are transcribed to the best
available reading of G.O. Ms. No. 168 (MA&UD, 07-04-2012) as amended, read with
the TS-bPASS self-certification schedules. They are centralised in one block
precisely so each figure can be checked against the current gazette before
publication; any correction is a one-line edit and re-run, with no change to the
experimental design.

## 4. Synthetic dataset

`generate_synthetic_sites.py` emits `terralogic_test_sites.csv`: 60 sites,
seeded (`SEED = 20260907`) and therefore exactly reproducible.

Plot areas span six brackets from 60 to 2 000 sq.m; abutting road widths are
drawn from {6, 7.5, 9, 12, 15, 18, 24, 30} m; plot depth:width ratios from
1.1 to 1.9.

| Stratum | n | Construction |
|---|---:|---|
| `compliant` | 20 | every macro parameter 8–20 % inside its permissible limit |
| `borderline` | 20 | exactly one governing limit approached within ±0.5 % (ratios/areas), ±20 mm (setbacks) or ±100 mm (height); alternating just-inside / just-outside |
| `non_compliant` | 20 | one governing limit breached by 12–60 % (FAR, coverage, setbacks, height, or footprint spilling outside the setback envelope) |

The borderline band is deliberately **tighter** than the tolerances any
practical checker applies, so the stratum probes tolerance design in addition to
rule calibration. Feasibility screening (`_borderline_feasible`) resamples plots
until the intended rule is the *binding* constraint; where the setback envelope
rather than the coverage percentage governs footprint — common on small
Hyderabad plots — the case is relabelled `COVERAGE_VIA_SETBACK_ENVELOPE` rather
than silently testing a different rule.

Ground-truth labels are produced by the rule module evaluated with **zero
tolerance** (floating-point epsilon only).

## 5. Systems under comparison

| | System A | System B |
|---|---|---|
| Name | Generic national baseline | Hyderabad-calibrated hybrid deterministic engine |
| Setbacks | height-driven table only | plot-area bracket, escalated by height, floored by road width |
| Height | flat 45 m zoning ceiling | road-width ceiling + 1.5 x (road + front setback) clause |
| FAR | single ceiling (2.0; 2.25 above 5 000 sq.m) | road-width schedule |
| Coverage | plot-area table | plot-area table (Hyderabad brackets) |
| Road width | not part of rule state | primary governing variable |
| Tolerances | none | 1 % FAR, 1 % coverage, 25 mm setbacks |

System A reproduces the pre-calibration Terralogic rule engine. System B is the
calibrated engine as it would ship: same rules as the ground-truth oracle but
with documented construction tolerances, so its residual error measures
tolerance design rather than rule knowledge.

## 6. Metrics

Per site: verdict (compliant / non-compliant), violation-code set, and the
discrepancy decomposition *missed* (in ground truth, absent from prediction) and
*spurious* (predicted, absent from ground truth).

Aggregate:

* accuracy and error rate per system;
* Type II errors (predicted compliant, truly non-compliant) and Type I errors
  (predicted non-compliant, truly compliant);
* 2 x 2 paired contingency matrix — both correct, only A correct, only B
  correct, both wrong;
* McNemar's test on the discordant pairs *b* and *c*: chi-square with Yates
  continuity correction `(|b - c| - 1)^2 / (b + c)` on 1 d.o.f., and the exact
  two-sided binomial p-value at p = 0.5 (the exact test is authoritative when
  `b + c < 25`);
* stratum-wise accuracy breakdown.

## 7. Execution

```bash
python3 generate_synthetic_sites.py   # -> terralogic_test_sites.csv
python3 analyze_results.py            # -> briefs, validation report, results CSV
```

Outputs: `terralogic_test_sites.csv`, `site_compliance_briefs.md`,
`validation_report.md`, `terralogic_test_results.csv`. Both scripts are pure
standard-library Python 3.10+ with no third-party dependencies.

## 8. Threats to validity

1. **Regulatory transcription.** Results are conditional on the tables in §3
   matching the operative gazette; see the verification note.
2. **Synthetic sampling.** Plot geometry is rectangular and idealised; real
   GHMC plots are irregular, may be corner plots with two abutting roads, and
   may carry site-specific conditions (nala buffers, heritage or airport
   restrictions) that are not modelled.
3. **Shared lineage of oracle and System B.** System B and the ground truth
   share a rule module and differ only in tolerance; System B's accuracy is
   therefore an upper bound for a calibrated implementation, and the comparison
   with System A measures the value of calibration, not of implementation
   quality generally.
4. **Stratum balance is by construction.** The 20/20/20 split is a design
   choice, not a prevalence estimate; accuracy figures should not be read as
   expected field performance.

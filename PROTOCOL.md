# Hyderabad Synthetic Case Study — Research Protocol

Study of **hybrid deterministic code compliance checking** for architectural
pre-design, executed on synthetic residential sites in the GHMC jurisdiction
(Hyderabad, Telangana).

The protocol is confined to three standalone files — `PROTOCOL.md`,
`generate_synthetic_sites.py`, `analyze_results.py` — and touches no part of the
Terralogic web application, its UI or its server routing.

## 1. Research question

How does the Terralogic hybrid deterministic pre-design checker — mathematics
calibrated to the local Hyderabad regulatory framework (GHMC / TS-bPASS /
G.O. Ms. No. 168) — perform across compliant, borderline and non-compliant
sites?

This phase establishes the deterministic baseline: the verdict the engine
returns for each of the 60 synthetic sites, and where it diverges from the
rule reference. Comparison against generic AI answers to the same sites is a
separate, later phase and is not modelled in these scripts.

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

## 5. Engine under test

The Terralogic hybrid deterministic checker: setbacks from the plot-area
bracket, escalated by height and floored by the abutting road width; height
limited by road width and by the `1.5 x (road + front setback)` clause; FAR from
the road-width schedule; coverage from the plot-area table; footprint bounded by
the setback envelope actually provided.

It runs with the practical construction tolerances it would ship with — 1 % on
FAR, 1 % on ground coverage, 25 mm on setbacks — while the reference labels use
the same rule module at zero tolerance. Any divergence between the two is
therefore attributable to tolerance design rather than to rule knowledge, and is
reported site by site.

## 6. Metrics

Per site: verdict (compliant / non-compliant), violation-code set, and the
discrepancy decomposition *missed* (in the reference, absent from the engine's
output) and *spurious* (reported by the engine, absent from the reference).

Aggregate:

* count of sites reported compliant / non-compliant;
* verdicts matching the rule reference, overall and per stratum;
* violations passed as compliant, and compliant sites flagged as violations;
* frequency of each violation code;
* an itemised list of every site where the engine and the reference differ.

No cross-system statistical test is computed at this stage. The results CSV is
structured so the later generic-AI comparison can be joined on `site_id`.

## 7. Running the sites through the live application

`analyze_results.py` scores a standalone Python transcription of the rules.
`run_case_study_through_app.py` scores the **application itself**: it POSTs each
site to `/api/bim/compliance` on the running server, which is the hybrid
pipeline the UI calls — the deterministic engine in `server/nbc_rules.ts`
followed by the AI recommendation pass. No application file is modified; the app
is exercised over HTTP exactly as a user would exercise it.

Each site becomes one rectangular massing centred in the plot bounding box, its
dimensions taken from the setback envelope actually provided and scaled to the
proposed footprint area, so the app's clearance-based setback check sees the
site's real setbacks. The app rate-limits this endpoint to 15 requests per
minute, so the runner paces itself at one request per 4.2 s.

The AI stage in `/api/bim/compliance` is explicitly advisory — it returns
recommendations and, by design, cannot alter the violations or the score. With
no `GEMINI_API_KEY` set it falls back to canned recommendations; the verdicts
recorded are unaffected either way.

## 8. Execution

```bash
python3 generate_synthetic_sites.py       # -> terralogic_test_sites.csv
python3 analyze_results.py                # -> briefs, validation report, results CSV

npm install                               # once
PORT=5000 SESSION_SECRET=... npx tsx server/index.ts &
python3 run_case_study_through_app.py     # -> app_* results against the live app
```

Outputs: `terralogic_test_sites.csv`, `site_compliance_briefs.md`,
`validation_report.md`, `terralogic_test_results.csv`, `app_test_results.csv`,
`app_validation_report.md`, `app_raw_responses.json`. All three Python scripts
are pure standard-library Python 3.10+ with no third-party dependencies.

## 9. Threats to validity

1. **Regulatory transcription.** Results are conditional on the tables in §3
   matching the operative gazette; see the verification note.
2. **Synthetic sampling.** Plot geometry is rectangular and idealised; real
   GHMC plots are irregular, may be corner plots with two abutting roads, and
   may carry site-specific conditions (nala buffers, heritage or airport
   restrictions) that are not modelled.
3. **Shared lineage of reference and engine.** The engine and the reference
   labels share a rule module and differ only in tolerance, so the reported
   match rate is an upper bound for a calibrated implementation and measures
   tolerance design, not rule knowledge. An independent check of the engine's
   rule knowledge requires an external oracle — the planned generic-AI
   comparison, or manual adjudication by a GHMC practitioner.
4. **Massing abstraction in the app run.** `/api/bim/compliance` models one
   centred rectangular block per site and checks setbacks as symmetric
   clearance, so asymmetric side setbacks are averaged; sites are constructed
   near-symmetrically to limit this effect, but it is an abstraction, not the
   plot's exact geometry.
5. **Stratum balance is by construction.** The 20/20/20 split is a design
   choice, not a prevalence estimate; accuracy figures should not be read as
   expected field performance.

# Application test results — Hyderabad synthetic case study

Sites were POSTed to `http://localhost:5000/api/bim/compliance` on the running Terralogic application: the deterministic NBC 2016 / GHMC rule engine (`server/nbc_rules.ts`) followed by the AI recommendation pass. Application code was not modified.

Mathematical ground truth comes from the Hyderabad rule tables in `generate_synthetic_sites.py` (GHMC / TS-bPASS / G.O. Ms. 168, road-width driven), evaluated at zero tolerance.

### Table 1 — Application verdicts (n = 60)

| Metric | Value |
|---|---:|
| Sites submitted | 60 |
| Application says COMPLIANT | 30 |
| Application says NON-COMPLIANT | 30 |
| Verdicts matching the mathematics | 60 (100.0%) |
| Violations passed as compliant | 0 (0.0%) |
| Compliant sites flagged as violations | 0 (0.0%) |
| Mean compliance score | 80.6 / 100 |

### Table 2 — Results by stratum

| Stratum | n | App compliant | App non-compliant | Matching mathematics | Mismatches | Mean score |
|---|---:|---:|---:|---:|---:|---:|
| compliant | 20 | 20 | 0 | 20 (100%) | 0 | 97.2 |
| borderline | 20 | 10 | 10 | 20 (100%) | 0 | 85.0 |
| non_compliant | 20 | 0 | 20 | 20 (100%) | 0 | 59.5 |

### Table 3 — Critical violations raised by the application

| Rule | Sites |
|---|---:|
| Footprint Outside Setback Envelope | 9 |
| Ground Coverage Exceeded | 7 |
| Insufficient Open Space | 7 |
| FAR Exceeded | 6 |
| Height Exceeds Road Width Limit | 6 |
| Side Setback Violation (9m massing) | 3 |
| Rear Setback Violation (9m massing) | 2 |
| Rear Setback Violation (18m massing) | 2 |
| Side Setback Violation (18m massing) | 2 |
| Front Setback Violation (15m massing) | 1 |
| Front Setback Violation (9m massing) | 1 |
| Side Setback Violation (15m massing) | 1 |
| Rear Setback Violation (3m massing) | 1 |
| Rear Setback Violation (24m massing) | 1 |
| Side Setback Violation (24m massing) | 1 |
| Rear Setback Violation (12m massing) | 1 |
| Side Setback Violation (12m massing) | 1 |

### Table 4 — Violations present in the mathematics

| Violation code | Sites |
|---|---:|
| `FOOTPRINT_OUTSIDE_SETBACK_ENVELOPE` | 9 |
| `SETBACK_SIDE` | 8 |
| `COVERAGE_EXCEEDED` | 7 |
| `SETBACK_REAR` | 7 |
| `FAR_EXCEEDED` | 6 |
| `HEIGHT_EXCEEDS_ROAD_WIDTH_LIMIT` | 6 |
| `SETBACK_FRONT` | 2 |
| `BUILTUP_EXCEEDS_FOOTPRINT_X_FLOORS` | 1 |

### Table 5 — Sites where the application and the mathematics disagree

| Site | Stratum | Plot (sq.m) | Road (m) | Mathematics | Application | Score | Rules the app raised |
|---|---|---:|---:|---|---|---:|---|
| — | — | — | — | — | — | — | — |

### Table 6 — Per-site record

| Site | Stratum | Perturbation | Mathematics | Application | Score | AI recommendations |
|---|---|---|---|---|---:|---:|
| HYD-CMP-01 | compliant | `none` | COMPLIANT | COMPLIANT | 100 | 4 |
| HYD-CMP-02 | compliant | `none` | COMPLIANT | COMPLIANT | 100 | 4 |
| HYD-CMP-03 | compliant | `none` | COMPLIANT | COMPLIANT | 100 | 4 |
| HYD-CMP-04 | compliant | `none` | COMPLIANT | COMPLIANT | 97 | 4 |
| HYD-CMP-05 | compliant | `none` | COMPLIANT | COMPLIANT | 95 | 4 |
| HYD-CMP-06 | compliant | `none` | COMPLIANT | COMPLIANT | 90 | 4 |
| HYD-CMP-07 | compliant | `none` | COMPLIANT | COMPLIANT | 100 | 4 |
| HYD-CMP-08 | compliant | `none` | COMPLIANT | COMPLIANT | 100 | 4 |
| HYD-CMP-09 | compliant | `none` | COMPLIANT | COMPLIANT | 100 | 4 |
| HYD-CMP-10 | compliant | `none` | COMPLIANT | COMPLIANT | 95 | 4 |
| HYD-CMP-11 | compliant | `none` | COMPLIANT | COMPLIANT | 95 | 4 |
| HYD-CMP-12 | compliant | `none` | COMPLIANT | COMPLIANT | 95 | 4 |
| HYD-CMP-13 | compliant | `none` | COMPLIANT | COMPLIANT | 100 | 4 |
| HYD-CMP-14 | compliant | `none` | COMPLIANT | COMPLIANT | 100 | 4 |
| HYD-CMP-15 | compliant | `none` | COMPLIANT | COMPLIANT | 100 | 4 |
| HYD-CMP-16 | compliant | `none` | COMPLIANT | COMPLIANT | 97 | 4 |
| HYD-CMP-17 | compliant | `none` | COMPLIANT | COMPLIANT | 95 | 4 |
| HYD-CMP-18 | compliant | `none` | COMPLIANT | COMPLIANT | 85 | 4 |
| HYD-CMP-19 | compliant | `none` | COMPLIANT | COMPLIANT | 100 | 4 |
| HYD-CMP-20 | compliant | `none` | COMPLIANT | COMPLIANT | 100 | 4 |
| HYD-BRD-01 | borderline | `FAR:inside` | COMPLIANT | COMPLIANT | 88 | 4 |
| HYD-BRD-02 | borderline | `COVERAGE_VIA_SETBACK_ENVELOPE:outside` | NON-COMPLIANT | NON-COMPLIANT | 85 | 4 |
| HYD-BRD-03 | borderline | `SETBACK_SIDE:inside` | COMPLIANT | COMPLIANT | 100 | 4 |
| HYD-BRD-04 | borderline | `SETBACK_FRONT:outside` | NON-COMPLIANT | NON-COMPLIANT | 80 | 4 |
| HYD-BRD-05 | borderline | `HEIGHT:inside` | COMPLIANT | COMPLIANT | 95 | 4 |
| HYD-BRD-06 | borderline | `FAR:outside` | NON-COMPLIANT | NON-COMPLIANT | 60 | 4 |
| HYD-BRD-07 | borderline | `COVERAGE:inside` | COMPLIANT | COMPLIANT | 91 | 4 |
| HYD-BRD-08 | borderline | `SETBACK_SIDE:outside` | NON-COMPLIANT | NON-COMPLIANT | 85 | 4 |
| HYD-BRD-09 | borderline | `SETBACK_FRONT:inside` | COMPLIANT | COMPLIANT | 97 | 4 |
| HYD-BRD-10 | borderline | `HEIGHT:outside` | NON-COMPLIANT | NON-COMPLIANT | 70 | 4 |
| HYD-BRD-11 | borderline | `FAR:inside` | COMPLIANT | COMPLIANT | 90 | 4 |
| HYD-BRD-12 | borderline | `COVERAGE:outside` | NON-COMPLIANT | NON-COMPLIANT | 55 | 4 |
| HYD-BRD-13 | borderline | `SETBACK_SIDE:inside` | COMPLIANT | COMPLIANT | 100 | 4 |
| HYD-BRD-14 | borderline | `SETBACK_FRONT:outside` | NON-COMPLIANT | NON-COMPLIANT | 85 | 4 |
| HYD-BRD-15 | borderline | `HEIGHT:inside` | COMPLIANT | COMPLIANT | 100 | 4 |
| HYD-BRD-16 | borderline | `FAR:outside` | NON-COMPLIANT | NON-COMPLIANT | 72 | 4 |
| HYD-BRD-17 | borderline | `COVERAGE:inside` | COMPLIANT | COMPLIANT | 93 | 4 |
| HYD-BRD-18 | borderline | `SETBACK_SIDE:outside` | NON-COMPLIANT | NON-COMPLIANT | 80 | 4 |
| HYD-BRD-19 | borderline | `SETBACK_FRONT:inside` | COMPLIANT | COMPLIANT | 100 | 4 |
| HYD-BRD-20 | borderline | `HEIGHT:outside` | NON-COMPLIANT | NON-COMPLIANT | 75 | 4 |
| HYD-NCP-01 | non_compliant | `FAR:violated` | NON-COMPLIANT | NON-COMPLIANT | 66 | 4 |
| HYD-NCP-02 | non_compliant | `COVERAGE:violated` | NON-COMPLIANT | NON-COMPLIANT | 45 | 4 |
| HYD-NCP-03 | non_compliant | `SETBACK:violated` | NON-COMPLIANT | NON-COMPLIANT | 70 | 4 |
| HYD-NCP-04 | non_compliant | `HEIGHT:violated` | NON-COMPLIANT | NON-COMPLIANT | 70 | 4 |
| HYD-NCP-05 | non_compliant | `ENVELOPE:violated` | NON-COMPLIANT | NON-COMPLIANT | 47 | 4 |
| HYD-NCP-06 | non_compliant | `FAR:violated` | NON-COMPLIANT | NON-COMPLIANT | 60 | 4 |
| HYD-NCP-07 | non_compliant | `COVERAGE:violated` | NON-COMPLIANT | NON-COMPLIANT | 45 | 4 |
| HYD-NCP-08 | non_compliant | `SETBACK:violated` | NON-COMPLIANT | NON-COMPLIANT | 70 | 4 |
| HYD-NCP-09 | non_compliant | `HEIGHT:violated` | NON-COMPLIANT | NON-COMPLIANT | 43 | 4 |
| HYD-NCP-10 | non_compliant | `ENVELOPE:violated` | NON-COMPLIANT | NON-COMPLIANT | 47 | 4 |
| HYD-NCP-11 | non_compliant | `FAR:violated` | NON-COMPLIANT | NON-COMPLIANT | 66 | 4 |
| HYD-NCP-12 | non_compliant | `COVERAGE:violated` | NON-COMPLIANT | NON-COMPLIANT | 45 | 4 |
| HYD-NCP-13 | non_compliant | `SETBACK:violated` | NON-COMPLIANT | NON-COMPLIANT | 85 | 4 |
| HYD-NCP-14 | non_compliant | `HEIGHT:violated` | NON-COMPLIANT | NON-COMPLIANT | 43 | 4 |
| HYD-NCP-15 | non_compliant | `ENVELOPE:violated` | NON-COMPLIANT | NON-COMPLIANT | 85 | 4 |
| HYD-NCP-16 | non_compliant | `FAR:violated` | NON-COMPLIANT | NON-COMPLIANT | 70 | 4 |
| HYD-NCP-17 | non_compliant | `COVERAGE:violated` | NON-COMPLIANT | NON-COMPLIANT | 42 | 4 |
| HYD-NCP-18 | non_compliant | `SETBACK:violated` | NON-COMPLIANT | NON-COMPLIANT | 60 | 4 |
| HYD-NCP-19 | non_compliant | `HEIGHT:violated` | NON-COMPLIANT | NON-COMPLIANT | 45 | 4 |
| HYD-NCP-20 | non_compliant | `ENVELOPE:violated` | NON-COMPLIANT | NON-COMPLIANT | 85 | 4 |

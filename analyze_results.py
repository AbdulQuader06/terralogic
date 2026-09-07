"""Hyderabad Synthetic Case Study — compliance evaluation and statistical report.

Reads ``terralogic_test_sites.csv`` (produced by ``generate_synthetic_sites.py``),
runs two deterministic pre-design compliance checkers over every site, and emits:

* ``site_compliance_briefs.md`` — one Site Compliance Brief per site
  (ID, stratum, inputs, ground truth vs predicted, error discrepancies).
* ``validation_report.md``      — contingency matrix, accuracy, error rates and
  McNemar's test (exact binomial + chi-square with continuity correction).
* ``terralogic_test_results.csv`` — per-site machine-readable results.
* the macro statistical tables, printed to stdout as publication-ready Markdown.

Systems under comparison
------------------------
System A — Generic national baseline. Height-driven setback table, single FAR
           ceiling, plot-area coverage table; the abutting road width is not
           part of its rule state. This mirrors the pre-calibration Terralogic
           rule engine.
System B — Hyderabad-calibrated hybrid deterministic engine: the GHMC /
           TS-bPASS / G.O. Ms. 168 rule module from ``generate_synthetic_sites``
           run with documented practical tolerances (1 % on ratio limits, 25 mm
           on setbacks) rather than as an exact regulatory oracle.

Ground truth is the same rule module evaluated with zero tolerance.

Run:  python3 analyze_results.py
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass

from generate_synthetic_sites import (
    OUTPUT_CSV,
    Site,
    compute_limits,
    evaluate,
)

# ─────────────────────────────────────────────────────────────────────────────
# System A — generic national baseline (road width ignored)
# ─────────────────────────────────────────────────────────────────────────────

BASELINE_SETBACK_BY_HEIGHT: list[tuple[float, tuple[float, float]]] = [
    (7.0,      (1.5, 1.5)),
    (10.0,     (3.0, 1.5)),
    (12.0,     (4.5, 3.0)),
    (15.0,     (5.0, 3.0)),
    (18.0,     (5.0, 5.0)),
    (21.0,     (6.0, 5.0)),
    (24.0,     (7.0, 5.0)),
    (30.0,     (8.0, 7.0)),
    (math.inf, (9.0, 9.0)),
]

BASELINE_COVERAGE_BY_PLOT_AREA: list[tuple[float, float]] = [
    (100.0,    75.0),
    (300.0,    70.0),
    (500.0,    60.0),
    (1000.0,   55.0),
    (math.inf, 50.0),
]

BASELINE_FAR = 2.0
BASELINE_FAR_LARGE_PLOT = 2.25      # group housing, plots >= 5000 sq.m
BASELINE_MIN_OPEN_SPACE_PCT = 30.0
BASELINE_MAX_HEIGHT = 45.0          # flat zoning ceiling, no road-width test


def _lookup(table, value):
    for upper, payload in table:
        if value < upper:
            return payload
    raise ValueError("table has no terminal bracket")


def evaluate_system_a(site: Site) -> list[str]:
    front, rear_side = _lookup(BASELINE_SETBACK_BY_HEIGHT, site.proposed_height)
    coverage_limit = _lookup(BASELINE_COVERAGE_BY_PLOT_AREA, site.plot_area)
    far_limit = BASELINE_FAR_LARGE_PLOT if site.plot_area >= 5000 else BASELINE_FAR

    v: list[str] = []
    if site.proposed_built_up_area / site.plot_area > far_limit:
        v.append("FAR_EXCEEDED")

    coverage = 100.0 * site.proposed_footprint_area / site.plot_area
    if coverage > coverage_limit:
        v.append("COVERAGE_EXCEEDED")
    if 100.0 - coverage < BASELINE_MIN_OPEN_SPACE_PCT:
        v.append("OPEN_SPACE_BELOW_MINIMUM")

    if site.provided_front_setback < front:
        v.append("SETBACK_FRONT")
    if site.provided_rear_setback < rear_side:
        v.append("SETBACK_REAR")
    if min(site.provided_side1_setback, site.provided_side2_setback) < rear_side:
        v.append("SETBACK_SIDE")

    if site.proposed_height > BASELINE_MAX_HEIGHT:
        v.append("HEIGHT_EXCEEDS_ZONING_CEILING")

    provided_envelope = (max(0.0, site.plot_width - site.provided_side1_setback - site.provided_side2_setback)
                         * max(0.0, site.plot_depth - site.provided_front_setback - site.provided_rear_setback))
    if site.proposed_footprint_area > provided_envelope:
        v.append("FOOTPRINT_OUTSIDE_SETBACK_ENVELOPE")
    return v


# ─────────────────────────────────────────────────────────────────────────────
# System B — Hyderabad-calibrated engine with practical tolerances
# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_B_FAR_TOLERANCE = 0.01        # 1 % of the permissible FAR
SYSTEM_B_COVERAGE_TOLERANCE = 0.01   # 1 % of the permissible coverage
SYSTEM_B_SETBACK_TOLERANCE = 0.025   # 25 mm construction tolerance


def evaluate_system_b(site: Site) -> list[str]:
    return evaluate(site,
                    far_tolerance=SYSTEM_B_FAR_TOLERANCE,
                    coverage_tolerance=SYSTEM_B_COVERAGE_TOLERANCE,
                    setback_tolerance=SYSTEM_B_SETBACK_TOLERANCE)


# ─────────────────────────────────────────────────────────────────────────────
# Statistics
# ─────────────────────────────────────────────────────────────────────────────

def binomial_two_sided_p(b: int, c: int) -> float:
    """Exact two-sided binomial p-value for McNemar's test (p = 0.5)."""
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    tail = sum(math.comb(n, i) for i in range(0, k + 1)) / (2 ** n)
    return min(1.0, 2 * tail)


def chi_square_p_df1(stat: float) -> float:
    """Upper-tail probability of a chi-square statistic with one d.o.f."""
    if stat <= 0:
        return 1.0
    return math.erfc(math.sqrt(stat / 2.0))


@dataclass
class McNemar:
    b: int              # System A correct, System B wrong
    c: int              # System B correct, System A wrong
    statistic: float    # chi-square with continuity correction
    p_chi2: float
    p_exact: float

    @classmethod
    def compute(cls, b: int, c: int) -> "McNemar":
        n = b + c
        stat = ((abs(b - c) - 1) ** 2) / n if n > 0 else 0.0
        return cls(b=b, c=c, statistic=stat,
                   p_chi2=chi_square_p_df1(stat),
                   p_exact=binomial_two_sided_p(b, c))


@dataclass
class SystemMetrics:
    name: str
    n: int
    correct: int
    false_positive: int   # predicted compliant, truly non-compliant
    false_negative: int   # predicted non-compliant, truly compliant

    @property
    def accuracy(self) -> float:
        return self.correct / self.n if self.n else 0.0

    @property
    def error_rate(self) -> float:
        return 1.0 - self.accuracy


# ─────────────────────────────────────────────────────────────────────────────
# Pipeline
# ─────────────────────────────────────────────────────────────────────────────

def load_sites(path: str = OUTPUT_CSV) -> list[Site]:
    sites: list[Site] = []
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            sites.append(Site(
                site_id=row["site_id"],
                stratum=row["stratum"],
                plot_area=float(row["plot_area"]),
                plot_width=float(row["plot_width"]),
                plot_depth=float(row["plot_depth"]),
                road_width=float(row["road_width"]),
                proposed_height=float(row["proposed_height"]),
                proposed_floors=int(row["proposed_floors"]),
                proposed_footprint_area=float(row["proposed_footprint_area"]),
                proposed_built_up_area=float(row["proposed_built_up_area"]),
                provided_front_setback=float(row["provided_front_setback"]),
                provided_rear_setback=float(row["provided_rear_setback"]),
                provided_side1_setback=float(row["provided_side1_setback"]),
                provided_side2_setback=float(row["provided_side2_setback"]),
                perturbed_rule=row["perturbed_rule"],
                ground_truth_compliant=row["ground_truth_compliant"] == "True",
                ground_truth_violations=row["ground_truth_violations"],
            ))
    return sites


@dataclass
class SiteResult:
    site: Site
    truth: list[str]
    a_violations: list[str]
    b_violations: list[str]

    @property
    def truth_compliant(self) -> bool:
        return not self.truth

    @property
    def a_compliant(self) -> bool:
        return not self.a_violations

    @property
    def b_compliant(self) -> bool:
        return not self.b_violations

    @property
    def a_correct(self) -> bool:
        return self.a_compliant == self.truth_compliant

    @property
    def b_correct(self) -> bool:
        return self.b_compliant == self.truth_compliant

    def discrepancies(self, predicted: list[str]) -> tuple[list[str], list[str]]:
        missed = [c for c in self.truth if c not in predicted]
        spurious = [c for c in predicted if c not in self.truth]
        return missed, spurious


def analyse(sites: list[Site]) -> list[SiteResult]:
    return [SiteResult(site=s,
                       truth=evaluate(s),
                       a_violations=evaluate_system_a(s),
                       b_violations=evaluate_system_b(s))
            for s in sites]


def system_metrics(results: list[SiteResult], name: str, use_a: bool) -> SystemMetrics:
    correct = fp = fn = 0
    for r in results:
        predicted_compliant = r.a_compliant if use_a else r.b_compliant
        if predicted_compliant == r.truth_compliant:
            correct += 1
        elif predicted_compliant:
            fp += 1
        else:
            fn += 1
    return SystemMetrics(name=name, n=len(results), correct=correct,
                         false_positive=fp, false_negative=fn)


def contingency(results: list[SiteResult]) -> dict[str, int]:
    both = only_a = only_b = neither = 0
    for r in results:
        if r.a_correct and r.b_correct:
            both += 1
        elif r.a_correct:
            only_a += 1
        elif r.b_correct:
            only_b += 1
        else:
            neither += 1
    return {"both_correct": both, "only_a_correct": only_a,
            "only_b_correct": only_b, "both_wrong": neither}


# ─────────────────────────────────────────────────────────────────────────────
# Reporting
# ─────────────────────────────────────────────────────────────────────────────

STRATA = ("compliant", "borderline", "non_compliant")


def _fmt_codes(codes: list[str]) -> str:
    return ", ".join(codes) if codes else "none"


def _fmt_p(p: float) -> str:
    return "< 0.001" if p < 0.001 else f"{p:.4f}"


def build_briefs(results: list[SiteResult]) -> str:
    lines = ["# Site Compliance Briefs — Hyderabad Synthetic Case Study", "",
             "Pre-design macro constraints only (FAR, ground coverage, setbacks, "
             "permissible height, maximum building envelope).", ""]
    for r in results:
        s = r.site
        limits = compute_limits(s.plot_area, s.plot_width, s.plot_depth,
                                s.road_width, s.proposed_height)
        a_missed, a_spurious = r.discrepancies(r.a_violations)
        b_missed, b_spurious = r.discrepancies(r.b_violations)
        lines += [
            f"## {s.site_id} — stratum: `{s.stratum}` (perturbation: `{s.perturbed_rule}`)",
            "",
            "**Input parameters**", "",
            "| Parameter | Value | Permissible |",
            "|---|---|---|",
            f"| Plot area | {s.plot_area:.1f} sq.m | — |",
            f"| Plot dimensions (W x D) | {s.plot_width:.2f} m x {s.plot_depth:.2f} m | — |",
            f"| Abutting road width | {s.road_width:.1f} m | — |",
            f"| Proposed height / floors | {s.proposed_height:.2f} m / {s.proposed_floors} | "
            f"{limits.max_height:.1f} m |",
            f"| Footprint | {s.proposed_footprint_area:.2f} sq.m "
            f"({100 * s.proposed_footprint_area / s.plot_area:.1f} %) | "
            f"{limits.max_footprint_area:.2f} sq.m ({limits.coverage_pct:.0f} % coverage cap) |",
            f"| Built-up area (FAR) | {s.proposed_built_up_area:.2f} sq.m "
            f"(FAR {s.proposed_built_up_area / s.plot_area:.3f}) | "
            f"{limits.max_built_up_area:.2f} sq.m (FAR {limits.far:.2f}) |",
            f"| Front setback | {s.provided_front_setback:.2f} m | {limits.front_setback:.2f} m |",
            f"| Rear setback | {s.provided_rear_setback:.2f} m | {limits.rear_setback:.2f} m |",
            f"| Side setbacks | {s.provided_side1_setback:.2f} m / "
            f"{s.provided_side2_setback:.2f} m | {limits.side_setback:.2f} m each |",
            f"| Max envelope volume | — | {limits.max_envelope_volume:,.0f} cu.m |",
            "",
            "**Ground truth vs prediction**", "",
            "| | Verdict | Violation codes |",
            "|---|---|---|",
            f"| Ground truth | {'COMPLIANT' if r.truth_compliant else 'NON-COMPLIANT'} | {_fmt_codes(r.truth)} |",
            f"| System A (generic baseline) | {'COMPLIANT' if r.a_compliant else 'NON-COMPLIANT'} | {_fmt_codes(r.a_violations)} |",
            f"| System B (Hyderabad-calibrated) | {'COMPLIANT' if r.b_compliant else 'NON-COMPLIANT'} | {_fmt_codes(r.b_violations)} |",
            "",
            "**Error discrepancies**", "",
            f"- System A: verdict {'correct' if r.a_correct else 'INCORRECT'}; "
            f"missed {_fmt_codes(a_missed)}; spurious {_fmt_codes(a_spurious)}",
            f"- System B: verdict {'correct' if r.b_correct else 'INCORRECT'}; "
            f"missed {_fmt_codes(b_missed)}; spurious {_fmt_codes(b_spurious)}",
            "",
        ]
    return "\n".join(lines)


def build_macro_tables(results: list[SiteResult]) -> str:
    a = system_metrics(results, "System A (generic baseline)", use_a=True)
    b = system_metrics(results, "System B (Hyderabad-calibrated)", use_a=False)
    cm = contingency(results)
    mc = McNemar.compute(cm["only_a_correct"], cm["only_b_correct"])

    out = [
        "### Table 1 — Overall classification performance (n = %d)" % len(results),
        "",
        "| System | Correct | Accuracy | Error rate | False compliant (Type II) | False violation (Type I) |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for m in (a, b):
        out.append(f"| {m.name} | {m.correct}/{m.n} | {m.accuracy:.1%} | {m.error_rate:.1%} | "
                   f"{m.false_positive} | {m.false_negative} |")

    out += [
        "",
        "### Table 2 — Paired contingency matrix (System A x System B)",
        "",
        "| | System B correct | System B wrong | Row total |",
        "|---|---:|---:|---:|",
        f"| **System A correct** | {cm['both_correct']} | {cm['only_a_correct']} | "
        f"{cm['both_correct'] + cm['only_a_correct']} |",
        f"| **System A wrong** | {cm['only_b_correct']} | {cm['both_wrong']} | "
        f"{cm['only_b_correct'] + cm['both_wrong']} |",
        f"| **Column total** | {cm['both_correct'] + cm['only_b_correct']} | "
        f"{cm['only_a_correct'] + cm['both_wrong']} | {len(results)} |",
        "",
        "### Table 3 — McNemar's test on discordant pairs",
        "",
        "| Quantity | Value |",
        "|---|---:|",
        f"| Discordant pairs b (only A correct) | {mc.b} |",
        f"| Discordant pairs c (only B correct) | {mc.c} |",
        f"| chi-square (Yates continuity correction, df = 1) | {mc.statistic:.4f} |",
        f"| p-value (chi-square) | {_fmt_p(mc.p_chi2)} |",
        f"| p-value (exact binomial, two-sided) | {_fmt_p(mc.p_exact)} |",
        f"| Decision at alpha = 0.05 | {'reject H0 (systems differ)' if mc.p_exact < 0.05 else 'fail to reject H0'} |",
        "",
        "### Table 4 — Accuracy by stratum",
        "",
        "| Stratum | n | System A accuracy | System B accuracy | Only A correct | Only B correct | Both wrong |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for stratum in STRATA:
        subset = [r for r in results if r.site.stratum == stratum]
        if not subset:
            continue
        sa = system_metrics(subset, "A", use_a=True)
        sb = system_metrics(subset, "B", use_a=False)
        scm = contingency(subset)
        out.append(f"| {stratum} | {len(subset)} | {sa.accuracy:.1%} | {sb.accuracy:.1%} | "
                   f"{scm['only_a_correct']} | {scm['only_b_correct']} | {scm['both_wrong']} |")
    return "\n".join(out)


def build_validation_report(results: list[SiteResult]) -> str:
    header = [
        "# Statistical Validation — Hyderabad Synthetic Case Study",
        "",
        "System A: generic national baseline (height-driven setbacks, single FAR ceiling, "
        "abutting road width not modelled).",
        "",
        "System B: Hyderabad-calibrated hybrid deterministic engine "
        "(GHMC / TS-bPASS / G.O. Ms. 168) with practical tolerances of "
        f"{SYSTEM_B_FAR_TOLERANCE:.0%} on FAR, {SYSTEM_B_COVERAGE_TOLERANCE:.0%} on ground coverage "
        f"and {SYSTEM_B_SETBACK_TOLERANCE * 1000:.0f} mm on setbacks.",
        "",
        "Ground truth: the same Hyderabad rule module evaluated with zero tolerance.",
        "",
    ]
    return "\n".join(header) + build_macro_tables(results) + "\n"


RESULTS_CSV = "terralogic_test_results.csv"
BRIEFS_MD = "site_compliance_briefs.md"
REPORT_MD = "validation_report.md"


def write_results_csv(results: list[SiteResult], path: str = RESULTS_CSV) -> None:
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["site_id", "stratum", "perturbed_rule",
                         "ground_truth_compliant", "ground_truth_violations",
                         "system_a_compliant", "system_a_violations",
                         "system_b_compliant", "system_b_violations",
                         "system_a_correct", "system_b_correct"])
        for r in results:
            writer.writerow([r.site.site_id, r.site.stratum, r.site.perturbed_rule,
                             r.truth_compliant, "|".join(r.truth),
                             r.a_compliant, "|".join(r.a_violations),
                             r.b_compliant, "|".join(r.b_violations),
                             r.a_correct, r.b_correct])


def main() -> None:
    sites = load_sites()
    results = analyse(sites)

    with open(BRIEFS_MD, "w", encoding="utf-8") as fh:
        fh.write(build_briefs(results))
    report = build_validation_report(results)
    with open(REPORT_MD, "w", encoding="utf-8") as fh:
        fh.write(report)
    write_results_csv(results)

    print(report)
    print(f"[written] {BRIEFS_MD}, {REPORT_MD}, {RESULTS_CSV}")


if __name__ == "__main__":
    main()

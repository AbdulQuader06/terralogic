"""Hyderabad Synthetic Case Study — run the deterministic engine and report results.

Reads ``terralogic_test_sites.csv`` (produced by ``generate_synthetic_sites.py``),
runs the Terralogic hybrid deterministic pre-design engine over every site, and
emits:

* ``site_compliance_briefs.md``   — one Site Compliance Brief per site
  (ID, stratum, input parameters, expected vs engine verdict, discrepancies).
* ``validation_report.md``        — the macro results tables.
* ``terralogic_test_results.csv`` — per-site machine-readable results.
* the macro results tables, printed to stdout as publication-ready Markdown.

Only the deterministic engine is scored here. Comparison against generic AI
answers is a separate exercise and is deliberately not modelled in this file.

Reference labels come from the same Hyderabad rule module evaluated with zero
tolerance; the engine under test runs with the practical construction
tolerances it would ship with.

Run:  python3 analyze_results.py
"""

from __future__ import annotations

import csv
from collections import Counter
from dataclasses import dataclass

from generate_synthetic_sites import (
    OUTPUT_CSV,
    Site,
    compute_limits,
    evaluate,
)

# ─────────────────────────────────────────────────────────────────────────────
# Engine under test — Hyderabad-calibrated deterministic checker
# ─────────────────────────────────────────────────────────────────────────────

FAR_TOLERANCE = 0.01        # 1 % of the permissible FAR
COVERAGE_TOLERANCE = 0.01   # 1 % of the permissible ground coverage
SETBACK_TOLERANCE = 0.025   # 25 mm construction tolerance


def run_engine(site: Site) -> list[str]:
    """Deterministic verdict for one site: the violation codes it reports."""
    return evaluate(site,
                    far_tolerance=FAR_TOLERANCE,
                    coverage_tolerance=COVERAGE_TOLERANCE,
                    setback_tolerance=SETBACK_TOLERANCE)


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
    expected: list[str]
    reported: list[str]

    @property
    def expected_compliant(self) -> bool:
        return not self.expected

    @property
    def reported_compliant(self) -> bool:
        return not self.reported

    @property
    def verdict_correct(self) -> bool:
        return self.reported_compliant == self.expected_compliant

    @property
    def missed(self) -> list[str]:
        return [c for c in self.expected if c not in self.reported]

    @property
    def spurious(self) -> list[str]:
        return [c for c in self.reported if c not in self.expected]


def analyse(sites: list[Site]) -> list[SiteResult]:
    return [SiteResult(site=s, expected=evaluate(s), reported=run_engine(s)) for s in sites]


# ─────────────────────────────────────────────────────────────────────────────
# Reporting
# ─────────────────────────────────────────────────────────────────────────────

STRATA = ("compliant", "borderline", "non_compliant")


def _fmt_codes(codes: list[str]) -> str:
    return ", ".join(codes) if codes else "none"


def _verdict(compliant: bool) -> str:
    return "COMPLIANT" if compliant else "NON-COMPLIANT"


def build_briefs(results: list[SiteResult]) -> str:
    lines = ["# Site Compliance Briefs — Hyderabad Synthetic Case Study", "",
             "Terralogic hybrid deterministic pre-design engine. Macro constraints only "
             "(FAR, ground coverage, setbacks, permissible height, maximum building envelope).", ""]
    for r in results:
        s = r.site
        limits = compute_limits(s.plot_area, s.plot_width, s.plot_depth,
                                s.road_width, s.proposed_height)
        lines += [
            f"## {s.site_id} — stratum: `{s.stratum}` (perturbation: `{s.perturbed_rule}`)",
            "",
            "**Input parameters**", "",
            "| Parameter | Proposed | Permissible |",
            "|---|---|---|",
            f"| Plot area | {s.plot_area:.1f} sq.m | — |",
            f"| Plot dimensions (W x D) | {s.plot_width:.2f} m x {s.plot_depth:.2f} m | — |",
            f"| Abutting road width | {s.road_width:.1f} m | — |",
            f"| Height / floors | {s.proposed_height:.2f} m / {s.proposed_floors} | "
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
            "**Result**", "",
            "| | Verdict | Violation codes |",
            "|---|---|---|",
            f"| Expected (rule reference) | {_verdict(r.expected_compliant)} | {_fmt_codes(r.expected)} |",
            f"| Deterministic engine | {_verdict(r.reported_compliant)} | {_fmt_codes(r.reported)} |",
            "",
            "**Discrepancies**", "",
            f"- Verdict: {'correct' if r.verdict_correct else 'INCORRECT'}",
            f"- Missed violations: {_fmt_codes(r.missed)}",
            f"- Spurious violations: {_fmt_codes(r.spurious)}",
            "",
        ]
    return "\n".join(lines)


def build_macro_tables(results: list[SiteResult]) -> str:
    n = len(results)
    correct = sum(1 for r in results if r.verdict_correct)
    missed_verdicts = sum(1 for r in results if r.reported_compliant and not r.expected_compliant)
    spurious_verdicts = sum(1 for r in results if not r.reported_compliant and r.expected_compliant)

    out = [
        f"### Table 1 — Engine results over the synthetic dataset (n = {n})",
        "",
        "| Metric | Value |",
        "|---|---:|",
        f"| Sites evaluated | {n} |",
        f"| Reported COMPLIANT | {sum(1 for r in results if r.reported_compliant)} |",
        f"| Reported NON-COMPLIANT | {sum(1 for r in results if not r.reported_compliant)} |",
        f"| Verdicts matching the rule reference | {correct} ({correct / n:.1%}) |",
        f"| Violations passed as compliant | {missed_verdicts} ({missed_verdicts / n:.1%}) |",
        f"| Compliant sites flagged as violations | {spurious_verdicts} ({spurious_verdicts / n:.1%}) |",
        "",
        "### Table 2 — Results by stratum",
        "",
        "| Stratum | n | Reported compliant | Reported non-compliant | Verdicts matching reference | Mismatches |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for stratum in STRATA:
        subset = [r for r in results if r.site.stratum == stratum]
        if not subset:
            continue
        ok = sum(1 for r in subset if r.verdict_correct)
        out.append(f"| {stratum} | {len(subset)} | "
                   f"{sum(1 for r in subset if r.reported_compliant)} | "
                   f"{sum(1 for r in subset if not r.reported_compliant)} | "
                   f"{ok} ({ok / len(subset):.0%}) | {len(subset) - ok} |")

    counts = Counter(code for r in results for code in r.reported)
    out += [
        "",
        "### Table 3 — Violation codes reported",
        "",
        "| Violation code | Sites |",
        "|---|---:|",
    ]
    for code, count in counts.most_common():
        out.append(f"| `{code}` | {count} |")
    if not counts:
        out.append("| none | 0 |")

    mismatches = [r for r in results if not r.verdict_correct]
    out += [
        "",
        "### Table 4 — Sites where the engine differs from the rule reference",
        "",
        "| Site | Stratum | Perturbation | Expected | Engine | Missed | Spurious |",
        "|---|---|---|---|---|---|---|",
    ]
    if mismatches:
        for r in mismatches:
            out.append(f"| {r.site.site_id} | {r.site.stratum} | `{r.site.perturbed_rule}` | "
                       f"{_verdict(r.expected_compliant)} | {_verdict(r.reported_compliant)} | "
                       f"{_fmt_codes(r.missed)} | {_fmt_codes(r.spurious)} |")
    else:
        out.append("| — | — | — | — | — | — | — |")
    return "\n".join(out)


def build_report(results: list[SiteResult]) -> str:
    header = [
        "# Results — Hyderabad Synthetic Case Study",
        "",
        "Engine under test: Terralogic hybrid deterministic pre-design checker "
        "(GHMC / TS-bPASS / G.O. Ms. 168), run with practical tolerances of "
        f"{FAR_TOLERANCE:.0%} on FAR, {COVERAGE_TOLERANCE:.0%} on ground coverage and "
        f"{SETBACK_TOLERANCE * 1000:.0f} mm on setbacks.",
        "",
        "Reference labels: the same rule module evaluated with zero tolerance.",
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
                         "plot_area", "road_width", "proposed_height",
                         "proposed_footprint_area", "proposed_built_up_area",
                         "expected_compliant", "expected_violations",
                         "engine_compliant", "engine_violations",
                         "verdict_correct", "missed_violations", "spurious_violations"])
        for r in results:
            s = r.site
            writer.writerow([s.site_id, s.stratum, s.perturbed_rule,
                             s.plot_area, s.road_width, s.proposed_height,
                             s.proposed_footprint_area, s.proposed_built_up_area,
                             r.expected_compliant, "|".join(r.expected),
                             r.reported_compliant, "|".join(r.reported),
                             r.verdict_correct, "|".join(r.missed), "|".join(r.spurious)])


def main() -> None:
    results = analyse(load_sites())

    with open(BRIEFS_MD, "w", encoding="utf-8") as fh:
        fh.write(build_briefs(results))
    report = build_report(results)
    with open(REPORT_MD, "w", encoding="utf-8") as fh:
        fh.write(report)
    write_results_csv(results)

    print(report)
    print(f"[written] {BRIEFS_MD}, {REPORT_MD}, {RESULTS_CSV}")


if __name__ == "__main__":
    main()

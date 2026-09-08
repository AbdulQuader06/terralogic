"""Run the 60 synthetic Hyderabad sites through the live Terralogic application.

Unlike ``analyze_results.py`` (which scores a standalone Python transcription of
the rules), this script drives the *actual application*: it POSTs each site to
the running server's ``/api/bim/compliance`` endpoint — the same hybrid pipeline
the UI calls, i.e. the deterministic NBC/GHMC rule engine in
``server/nbc_rules.ts`` followed by the AI recommendation pass.

No application file is modified; the app is exercised over HTTP exactly as a
user would exercise it.

Prerequisites
-------------
1. ``npm install``
2. ``PORT=5000 SESSION_SECRET=... npx tsx server/index.ts``
3. ``python3 generate_synthetic_sites.py``  (produces terralogic_test_sites.csv)

Then::

    python3 run_case_study_through_app.py            # default http://localhost:5000
    python3 run_case_study_through_app.py --base-url http://localhost:5000

Outputs
-------
* ``app_test_results.csv``   — one row per site: inputs, mathematical ground
  truth, and what the application returned (verdict, score, violation codes,
  number of AI recommendations).
* ``app_validation_report.md`` — macro results tables (also printed).
* ``app_raw_responses.json`` — the full API response per site, for audit.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from dataclasses import dataclass, field

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from generate_synthetic_sites import OUTPUT_CSV, Site, evaluate

DEFAULT_BASE_URL = "http://localhost:5000"
# The app rate-limits /api/bim/compliance to 15 requests per IP per minute.
DEFAULT_DELAY_S = 4.2
RESULTS_CSV = "app_test_results.csv"
REPORT_MD = "app_validation_report.md"
RAW_JSON = "app_raw_responses.json"

STRATA = ("compliant", "borderline", "non_compliant")


# ─────────────────────────────────────────────────────────────────────────────
# Site -> application payload
# ─────────────────────────────────────────────────────────────────────────────

def build_payload(site: Site) -> dict:
    """Translate one synthetic site into the body /api/bim/compliance expects.

    The app models a massing as a rectangular block centred in the site
    bounding box. The block dimensions are therefore derived from the setback
    envelope the site actually provides, scaled to the proposed footprint area,
    so that the app's clearance-based setback check sees the site's real
    setbacks.
    """
    env_w = max(site.plot_width - site.provided_side1_setback - site.provided_side2_setback, 0.1)
    env_d = max(site.plot_depth - site.provided_front_setback - site.provided_rear_setback, 0.1)
    scale = math.sqrt(site.proposed_footprint_area / (env_w * env_d))
    width = env_w * scale
    depth = env_d * scale

    coverage = 100.0 * site.proposed_footprint_area / site.plot_area
    return {
        "location": {"lat": 17.3850, "lon": 78.4867},  # Hyderabad
        "siteArea": site.plot_area,
        "roadWidth": site.road_width,
        "siteDimensions": {
            "width": site.plot_width,
            "depth": site.plot_depth,
            "roadWidth": site.road_width,
            "providedSetbacks": {
                "front": site.provided_front_setback,
                "rear": site.provided_rear_setback,
                "side1": site.provided_side1_setback,
                "side2": site.provided_side2_setback,
            },
        },
        "massings": [{
            "type": "residential",
            "width": width,
            "depth": depth,
            "height": site.proposed_height,
            "floors": site.proposed_floors,
            "footprint": site.proposed_footprint_area,
            "builtUp": site.proposed_built_up_area,
        }],
        "metrics": {
            "far": site.proposed_built_up_area / site.plot_area,
            "groundCoverage": coverage,
            "openSpace": 100.0 - coverage,
            "totalBuiltUp": site.proposed_built_up_area,
            "maxHeight": site.proposed_height,
            "massingCount": 1,
            "roadWidth": site.road_width,
        },
    }


def post_json(url: str, payload: dict, timeout: float = 120.0, retries: int = 5) -> dict:
    data = json.dumps(payload).encode("utf-8")
    for attempt in range(retries):
        req = urllib.request.Request(url, data=data,
                                     headers={"Content-Type": "application/json"},
                                     method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == retries - 1:
                raise
            print("      rate limited by the app, waiting 60 s ...", flush=True)
            time.sleep(60)
    raise RuntimeError("unreachable")


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
class AppResult:
    site: Site
    truth: list[str]
    app_compliant: bool
    app_score: float
    critical_codes: list[str]
    warning_codes: list[str]
    recommendations: list[str] = field(default_factory=list)
    raw: dict = field(default_factory=dict)

    @property
    def truth_compliant(self) -> bool:
        return not self.truth

    @property
    def verdict_correct(self) -> bool:
        return self.app_compliant == self.truth_compliant


def run(sites: list[Site], base_url: str, delay: float = DEFAULT_DELAY_S) -> list[AppResult]:
    url = base_url.rstrip("/") + "/api/bim/compliance"
    results: list[AppResult] = []
    for i, site in enumerate(sites, 1):
        if i > 1 and delay:
            time.sleep(delay)
        try:
            body = post_json(url, build_payload(site))
        except urllib.error.URLError as exc:
            sys.exit(f"Cannot reach the application at {url}: {exc}\n"
                     f"Start it with: npx tsx server/index.ts")
        violations = body.get("violations", [])
        results.append(AppResult(
            site=site,
            truth=evaluate(site),
            app_compliant=bool(body.get("compliant")),
            app_score=float(body.get("score", 0)),
            critical_codes=[v["code"] for v in violations if v.get("severity") == "critical"],
            warning_codes=[v["code"] for v in violations if v.get("severity") == "warning"],
            recommendations=list(body.get("recommendations", [])),
            raw=body,
        ))
        print(f"  [{i:2d}/{len(sites)}] {site.site_id}: "
              f"{'COMPLIANT' if results[-1].app_compliant else 'NON-COMPLIANT'} "
              f"(score {results[-1].app_score:.0f})", flush=True)
    return results


# ─────────────────────────────────────────────────────────────────────────────
# Reporting
# ─────────────────────────────────────────────────────────────────────────────

def _verdict(compliant: bool) -> str:
    return "COMPLIANT" if compliant else "NON-COMPLIANT"


def _short(code: str) -> str:
    """Trim the app's long rule citations to the trailing rule name."""
    return code.split("—")[-1].strip() if "—" in code else code


def build_report(results: list[AppResult], base_url: str) -> str:
    n = len(results)
    correct = sum(1 for r in results if r.verdict_correct)
    false_pass = sum(1 for r in results if r.app_compliant and not r.truth_compliant)
    false_flag = sum(1 for r in results if not r.app_compliant and r.truth_compliant)
    scores = [r.app_score for r in results]

    out = [
        "# Application test results — Hyderabad synthetic case study",
        "",
        f"Sites were POSTed to `{base_url}/api/bim/compliance` on the running "
        "Terralogic application: the deterministic NBC 2016 / GHMC rule engine "
        "(`server/nbc_rules.ts`) followed by the AI recommendation pass. "
        "Application code was not modified.",
        "",
        "Mathematical ground truth comes from the Hyderabad rule tables in "
        "`generate_synthetic_sites.py` (GHMC / TS-bPASS / G.O. Ms. 168, "
        "road-width driven), evaluated at zero tolerance.",
        "",
        f"### Table 1 — Application verdicts (n = {n})",
        "",
        "| Metric | Value |",
        "|---|---:|",
        f"| Sites submitted | {n} |",
        f"| Application says COMPLIANT | {sum(1 for r in results if r.app_compliant)} |",
        f"| Application says NON-COMPLIANT | {sum(1 for r in results if not r.app_compliant)} |",
        f"| Verdicts matching the mathematics | {correct} ({correct / n:.1%}) |",
        f"| Violations passed as compliant | {false_pass} ({false_pass / n:.1%}) |",
        f"| Compliant sites flagged as violations | {false_flag} ({false_flag / n:.1%}) |",
        f"| Mean compliance score | {sum(scores) / n:.1f} / 100 |",
        "",
        "### Table 2 — Results by stratum",
        "",
        "| Stratum | n | App compliant | App non-compliant | Matching mathematics | Mismatches | Mean score |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for stratum in STRATA:
        sub = [r for r in results if r.site.stratum == stratum]
        if not sub:
            continue
        ok = sum(1 for r in sub if r.verdict_correct)
        out.append(f"| {stratum} | {len(sub)} | "
                   f"{sum(1 for r in sub if r.app_compliant)} | "
                   f"{sum(1 for r in sub if not r.app_compliant)} | "
                   f"{ok} ({ok / len(sub):.0%}) | {len(sub) - ok} | "
                   f"{sum(r.app_score for r in sub) / len(sub):.1f} |")

    counts = Counter(_short(c) for r in results for c in r.critical_codes)
    out += ["", "### Table 3 — Critical violations raised by the application", "",
            "| Rule | Sites |", "|---|---:|"]
    for code, count in counts.most_common():
        out.append(f"| {code} | {count} |")
    if not counts:
        out.append("| none | 0 |")

    truth_counts = Counter(c for r in results for c in r.truth)
    out += ["", "### Table 4 — Violations present in the mathematics", "",
            "| Violation code | Sites |", "|---|---:|"]
    for code, count in truth_counts.most_common():
        out.append(f"| `{code}` | {count} |")

    mismatches = [r for r in results if not r.verdict_correct]
    out += ["", "### Table 5 — Sites where the application and the mathematics disagree", "",
            "| Site | Stratum | Plot (sq.m) | Road (m) | Mathematics | Application | Score | Rules the app raised |",
            "|---|---|---:|---:|---|---|---:|---|"]
    if mismatches:
        for r in mismatches:
            out.append(f"| {r.site.site_id} | {r.site.stratum} | {r.site.plot_area:.0f} | "
                       f"{r.site.road_width:.1f} | "
                       f"{_verdict(r.truth_compliant)} ({', '.join(r.truth) or 'none'}) | "
                       f"{_verdict(r.app_compliant)} | {r.app_score:.0f} | "
                       f"{', '.join(_short(c) for c in r.critical_codes) or 'none'} |")
    else:
        out.append("| — | — | — | — | — | — | — | — |")

    out += ["", "### Table 6 — Per-site record", "",
            "| Site | Stratum | Perturbation | Mathematics | Application | Score | AI recommendations |",
            "|---|---|---|---|---|---:|---:|"]
    for r in results:
        out.append(f"| {r.site.site_id} | {r.site.stratum} | `{r.site.perturbed_rule}` | "
                   f"{_verdict(r.truth_compliant)} | {_verdict(r.app_compliant)} | "
                   f"{r.app_score:.0f} | {len(r.recommendations)} |")
    return "\n".join(out) + "\n"


def write_results_csv(results: list[AppResult], path: str = RESULTS_CSV) -> None:
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["site_id", "stratum", "perturbed_rule", "plot_area", "plot_width",
                    "plot_depth", "road_width", "proposed_height", "proposed_floors",
                    "proposed_footprint_area", "proposed_built_up_area",
                    "front_setback", "rear_setback", "side1_setback", "side2_setback",
                    "math_compliant", "math_violations",
                    "app_compliant", "app_score", "app_critical_violations",
                    "app_warnings", "verdict_matches_math", "ai_recommendation_count"])
        for r in results:
            s = r.site
            w.writerow([s.site_id, s.stratum, s.perturbed_rule, s.plot_area, s.plot_width,
                        s.plot_depth, s.road_width, s.proposed_height, s.proposed_floors,
                        s.proposed_footprint_area, s.proposed_built_up_area,
                        s.provided_front_setback, s.provided_rear_setback,
                        s.provided_side1_setback, s.provided_side2_setback,
                        r.truth_compliant, "|".join(r.truth),
                        r.app_compliant, r.app_score, "|".join(_short(c) for c in r.critical_codes),
                        "|".join(_short(c) for c in r.warning_codes),
                        r.verdict_correct, len(r.recommendations)])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL)
    ap.add_argument("--sites", default=OUTPUT_CSV)
    ap.add_argument("--delay", type=float, default=DEFAULT_DELAY_S,
                    help="seconds between requests (app allows 15/min)")
    args = ap.parse_args()

    sites = load_sites(args.sites)
    print(f"Submitting {len(sites)} sites to {args.base_url}/api/bim/compliance ...")
    results = run(sites, args.base_url, args.delay)

    report = build_report(results, args.base_url)
    with open(REPORT_MD, "w", encoding="utf-8") as fh:
        fh.write(report)
    write_results_csv(results)
    with open(RAW_JSON, "w", encoding="utf-8") as fh:
        json.dump({r.site.site_id: r.raw for r in results}, fh, indent=2)

    print()
    print(report)
    print(f"[written] {RESULTS_CSV}, {REPORT_MD}, {RAW_JSON}")


if __name__ == "__main__":
    main()

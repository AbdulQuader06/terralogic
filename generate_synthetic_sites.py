"""Hyderabad Synthetic Case Study — stratified synthetic site generator.

Standalone research tool for the Terralogic "hybrid deterministic code compliance
checking" study. It does two things:

1. Encodes the Hyderabad residential regulatory framework (GHMC / TS-bPASS /
   G.O. Ms. No. 168 of 2012) as an explicit, auditable rule module, restricted to
   PRE-DESIGN MACRO CONSTRAINTS only: Floor Area Ratio, ground coverage,
   setbacks, permissible height and the maximum building envelope. No interior,
   fire, plumbing or room-level logic is modelled.
2. Emits a stratified synthetic dataset (20 compliant / 20 borderline /
   20 non-compliant) to ``terralogic_test_sites.csv`` with ground-truth labels
   derived from the rule module.

Every regulatory constant lives in the REGULATORY FRAMEWORK block below so that
figures can be checked line-by-line against the gazette before publication.

Run:  python3 generate_synthetic_sites.py
"""

from __future__ import annotations

import csv
import math
import random
from dataclasses import dataclass, asdict, field
from typing import Iterable

# ─────────────────────────────────────────────────────────────────────────────
# REGULATORY FRAMEWORK — GHMC / TS-bPASS / G.O. Ms. No. 168 (residential)
# ─────────────────────────────────────────────────────────────────────────────
# Each table is (upper_bound_exclusive, value). Bounds are in metres / sq.m.
# Verify against: G.O. Ms. No. 168 MA&UD dt. 07-04-2012 (Telangana Building
# Rules) Annexure III/IV, as amended, read with TS-bPASS self-certification
# schedules and GHMC zoning regulations.

# Table 1 — Plot-area-based setbacks for buildings up to 10 m height (metres).
#   plot area bracket (sq.m)        front  rear  side (each)
SETBACK_BY_PLOT_AREA: list[tuple[float, dict[str, float]]] = [
    (100.0,   {"front": 1.5, "rear": 1.0, "side": 0.0}),
    (200.0,   {"front": 1.5, "rear": 1.5, "side": 1.0}),
    (300.0,   {"front": 2.0, "rear": 2.0, "side": 1.5}),
    (400.0,   {"front": 3.0, "rear": 2.0, "side": 2.0}),
    (500.0,   {"front": 3.0, "rear": 3.0, "side": 2.0}),
    (750.0,   {"front": 3.0, "rear": 3.0, "side": 2.5}),
    (1000.0,  {"front": 3.5, "rear": 3.0, "side": 3.0}),
    (math.inf,{"front": 4.5, "rear": 3.5, "side": 3.5}),
]

# Table 2 — Front setback governed by the abutting road width (metres).
FRONT_SETBACK_BY_ROAD_WIDTH: list[tuple[float, float]] = [
    (9.0,      1.5),
    (12.0,     3.0),
    (18.0,     4.5),
    (24.0,     6.0),
    (math.inf, 9.0),
]

# Table 3 — Side/rear setback escalation with building height (metres).
SIDE_REAR_SETBACK_BY_HEIGHT: list[tuple[float, float]] = [
    (10.0,     0.0),   # governed solely by the plot-area bracket
    (12.0,     3.0),
    (15.0,     3.5),
    (18.0,     4.0),
    (21.0,     5.0),
    (24.0,     6.0),
    (27.0,     7.0),
    (30.0,     8.0),
    (math.inf, 9.0),
]

# Table 4 — Maximum permissible height by abutting road width (metres).
MAX_HEIGHT_BY_ROAD_WIDTH: list[tuple[float, float]] = [
    (9.0,      10.0),
    (12.0,     15.0),
    (18.0,     18.0),
    (24.0,     24.0),
    (30.0,     30.0),
    (math.inf, 45.0),
]

# Table 5 — Permissible ground coverage by plot area (percent of plot).
GROUND_COVERAGE_BY_PLOT_AREA: list[tuple[float, float]] = [
    (100.0,    75.0),
    (200.0,    70.0),
    (300.0,    65.0),
    (500.0,    60.0),
    (1000.0,   55.0),
    (math.inf, 50.0),
]

# Table 6 — Permissible FAR by abutting road width (residential).
FAR_BY_ROAD_WIDTH: list[tuple[float, float]] = [
    (9.0,      1.75),
    (12.0,     2.00),
    (18.0,     2.50),
    (24.0,     3.00),
    (math.inf, 3.50),
]

# Clause — height must not exceed 1.5 x (abutting road width + front setback
# actually provided) for non-high-rise development.
HEIGHT_ANGLE_FACTOR = 1.5

# Numerical slack used when deciding GROUND TRUTH. Kept tiny: it only absorbs
# floating point noise, not regulatory discretion.
EPS_LEN = 1e-6     # metres
EPS_AREA = 1e-6    # sq.m
EPS_RATIO = 1e-9


def _lookup(table: Iterable[tuple[float, object]], value: float):
    for upper, payload in table:
        if value < upper:
            return payload
    raise ValueError("table has no terminal bracket")


# ─────────────────────────────────────────────────────────────────────────────
# Derived limits
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class SiteLimits:
    """Macro pre-design envelope permitted on a given plot."""

    front_setback: float
    rear_setback: float
    side_setback: float
    max_height: float
    coverage_pct: float
    far: float
    max_footprint_area: float          # min(coverage cap, setback envelope)
    coverage_cap_area: float
    setback_envelope_area: float
    max_built_up_area: float
    max_envelope_volume: float


def compute_limits(plot_area: float, plot_width: float, plot_depth: float,
                   road_width: float, proposed_height: float) -> SiteLimits:
    """Permissible macro envelope for a residential plot in the GHMC area."""
    bracket = _lookup(SETBACK_BY_PLOT_AREA, plot_area)
    road_front = _lookup(FRONT_SETBACK_BY_ROAD_WIDTH, road_width)
    height_side = _lookup(SIDE_REAR_SETBACK_BY_HEIGHT, proposed_height)

    front = max(bracket["front"], road_front)
    rear = max(bracket["rear"], height_side)
    side = max(bracket["side"], height_side)

    max_height = _lookup(MAX_HEIGHT_BY_ROAD_WIDTH, road_width)
    coverage_pct = _lookup(GROUND_COVERAGE_BY_PLOT_AREA, plot_area)
    far = _lookup(FAR_BY_ROAD_WIDTH, road_width)

    coverage_cap = plot_area * coverage_pct / 100.0
    envelope_w = max(0.0, plot_width - 2 * side)
    envelope_d = max(0.0, plot_depth - front - rear)
    envelope_area = envelope_w * envelope_d

    max_footprint = min(coverage_cap, envelope_area)
    return SiteLimits(
        front_setback=front,
        rear_setback=rear,
        side_setback=side,
        max_height=max_height,
        coverage_pct=coverage_pct,
        far=far,
        max_footprint_area=max_footprint,
        coverage_cap_area=coverage_cap,
        setback_envelope_area=envelope_area,
        max_built_up_area=plot_area * far,
        max_envelope_volume=max_footprint * max_height,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Site record + ground-truth evaluation
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Site:
    site_id: str
    stratum: str
    plot_area: float
    plot_width: float
    plot_depth: float
    road_width: float
    proposed_height: float
    proposed_floors: int
    proposed_footprint_area: float
    proposed_built_up_area: float
    provided_front_setback: float
    provided_rear_setback: float
    provided_side1_setback: float
    provided_side2_setback: float
    perturbed_rule: str = ""
    ground_truth_compliant: bool = field(default=False)
    ground_truth_violations: str = field(default="")


def evaluate(site: Site,
             far_tolerance: float = 0.0,
             coverage_tolerance: float = 0.0,
             setback_tolerance: float = 0.0,
             apply_height_angle_rule: bool = True) -> list[str]:
    """Deterministic Hyderabad rule check. Returns violation codes (empty = pass).

    The tolerance arguments exist so that the same engine can be run either as
    the exact regulatory reference (all tolerances zero, used for ground truth)
    or as a practical implementation with documented slack.
    """
    limits = compute_limits(site.plot_area, site.plot_width, site.plot_depth,
                            site.road_width, site.proposed_height)
    v: list[str] = []

    far = site.proposed_built_up_area / site.plot_area
    if far > limits.far * (1 + far_tolerance) + EPS_RATIO:
        v.append("FAR_EXCEEDED")

    coverage = 100.0 * site.proposed_footprint_area / site.plot_area
    if coverage > limits.coverage_pct * (1 + coverage_tolerance) + EPS_RATIO:
        v.append("COVERAGE_EXCEEDED")

    slack = setback_tolerance
    if site.provided_front_setback < limits.front_setback - slack - EPS_LEN:
        v.append("SETBACK_FRONT")
    if site.provided_rear_setback < limits.rear_setback - slack - EPS_LEN:
        v.append("SETBACK_REAR")
    if min(site.provided_side1_setback, site.provided_side2_setback) < limits.side_setback - slack - EPS_LEN:
        v.append("SETBACK_SIDE")

    if site.proposed_height > limits.max_height + EPS_LEN:
        v.append("HEIGHT_EXCEEDS_ROAD_WIDTH_LIMIT")

    if apply_height_angle_rule:
        angle_cap = HEIGHT_ANGLE_FACTOR * (site.road_width + site.provided_front_setback)
        if site.proposed_height > angle_cap + EPS_LEN:
            v.append("HEIGHT_EXCEEDS_ROAD_ANGLE_CAP")

    provided_envelope = (max(0.0, site.plot_width - site.provided_side1_setback - site.provided_side2_setback)
                         * max(0.0, site.plot_depth - site.provided_front_setback - site.provided_rear_setback))
    if site.proposed_footprint_area > provided_envelope + EPS_AREA:
        v.append("FOOTPRINT_OUTSIDE_SETBACK_ENVELOPE")

    if site.proposed_built_up_area > site.proposed_footprint_area * site.proposed_floors + EPS_AREA:
        v.append("BUILTUP_EXCEEDS_FOOTPRINT_X_FLOORS")

    return v


# ─────────────────────────────────────────────────────────────────────────────
# Stratified generation
# ─────────────────────────────────────────────────────────────────────────────

SEED = 20260907
PLOT_AREA_BRACKETS = [(60, 100), (100, 200), (200, 300), (300, 500), (500, 1000), (1000, 2000)]
# Abutting road widths plausible for each plot size: a 90 sq.m plot fronting a
# 30 m arterial road is not a realistic Hyderabad layout, and its statutory
# 9 m front setback would leave no buildable envelope at all.
ROAD_WIDTHS_BY_PLOT_AREA: list[tuple[float, list[float]]] = [
    (200.0,    [6.0, 7.5, 9.0, 12.0]),
    (500.0,    [7.5, 9.0, 12.0, 15.0]),
    (1000.0,   [9.0, 12.0, 15.0, 18.0]),
    (math.inf, [12.0, 15.0, 18.0, 24.0, 30.0]),
]

# A generated proposal must retain at least this share of the coverage cap as
# buildable footprint, otherwise the height is stepped down.
MIN_USABLE_ENVELOPE_RATIO = 0.5
FLOOR_HEIGHT = 3.0

# A "borderline" case sits inside this relative/absolute band around a limit.
# The band is deliberately tighter than the practical tolerances a production
# checker applies, so the stratum probes tolerance design as well as calibration.
BORDERLINE_REL = 0.005   # 0.5 % of a ratio/area limit
BORDERLINE_ABS_M = 0.02  # 20 mm on a setback
BORDERLINE_ABS_H = 0.10  # 100 mm on a height limit


def _plot_shape(rng: random.Random, area: float) -> tuple[float, float]:
    ratio = rng.uniform(1.1, 1.9)          # depth : width
    width = math.sqrt(area / ratio)
    return round(width, 2), round(area / round(width, 2), 2)


def _base_site(rng: random.Random, stratum: str, idx: int) -> Site:
    lo, hi = PLOT_AREA_BRACKETS[idx % len(PLOT_AREA_BRACKETS)]
    plot_area = round(rng.uniform(lo, hi), 1)
    plot_width, plot_depth = _plot_shape(rng, plot_area)
    road_width = rng.choice(_lookup(ROAD_WIDTHS_BY_PLOT_AREA, plot_area))

    # Start from a comfortably compliant proposal, then perturb per stratum.
    probe = compute_limits(plot_area, plot_width, plot_depth, road_width, 9.0)
    height = min(probe.max_height * 0.8,
                 HEIGHT_ANGLE_FACTOR * (road_width + probe.front_setback) * 0.8)
    height = max(6.0, round(height / FLOOR_HEIGHT) * FLOOR_HEIGHT)
    limits = compute_limits(plot_area, plot_width, plot_depth, road_width, height)
    while height > FLOOR_HEIGHT and (
            limits.max_footprint_area < MIN_USABLE_ENVELOPE_RATIO * limits.coverage_cap_area
            or height > limits.max_height
            or height > HEIGHT_ANGLE_FACTOR * (road_width + limits.front_setback)):
        height -= FLOOR_HEIGHT
        limits = compute_limits(plot_area, plot_width, plot_depth, road_width, height)

    floors = max(1, int(round(height / FLOOR_HEIGHT)))
    footprint = round(limits.max_footprint_area * rng.uniform(0.80, 0.92), 2)
    built_up = round(min(limits.max_built_up_area * rng.uniform(0.80, 0.92),
                         footprint * floors * 0.95), 2)

    return Site(
        site_id="",
        stratum=stratum,
        plot_area=plot_area,
        plot_width=plot_width,
        plot_depth=plot_depth,
        road_width=road_width,
        proposed_height=round(height, 2),
        proposed_floors=floors,
        proposed_footprint_area=footprint,
        proposed_built_up_area=built_up,
        provided_front_setback=round(limits.front_setback + rng.uniform(0.3, 1.0), 2),
        provided_rear_setback=round(limits.rear_setback + rng.uniform(0.3, 1.0), 2),
        provided_side1_setback=round(limits.side_setback + rng.uniform(0.3, 1.0), 2),
        provided_side2_setback=round(limits.side_setback + rng.uniform(0.3, 1.0), 2),
    )


def _fit_footprint(site: Site) -> None:
    """Shrink the footprint so it always fits the setbacks actually provided."""
    envelope = (max(0.0, site.plot_width - site.provided_side1_setback - site.provided_side2_setback)
                * max(0.0, site.plot_depth - site.provided_front_setback - site.provided_rear_setback))
    if site.proposed_footprint_area > envelope:
        site.proposed_footprint_area = round(max(0.0, envelope * 0.98), 2)
    site.proposed_built_up_area = round(
        min(site.proposed_built_up_area, site.proposed_footprint_area * site.proposed_floors), 2)


def _make_compliant(rng: random.Random, idx: int) -> Site:
    site = _base_site(rng, "compliant", idx)
    _fit_footprint(site)
    site.perturbed_rule = "none"
    return site


BORDERLINE_RULES = ["FAR", "COVERAGE", "SETBACK_SIDE", "SETBACK_FRONT", "HEIGHT"]


def _apply_statutory_setbacks(site: Site, margin: float = 0.3) -> SiteLimits:
    """Provide exactly the setbacks the current height/plot demand, plus margin."""
    limits = compute_limits(site.plot_area, site.plot_width, site.plot_depth,
                            site.road_width, site.proposed_height)
    site.provided_front_setback = round(limits.front_setback + margin, 2)
    site.provided_rear_setback = round(limits.rear_setback + margin, 2)
    site.provided_side1_setback = round(limits.side_setback + margin, 2)
    site.provided_side2_setback = round(limits.side_setback + margin, 2)
    return limits


def _borderline_feasible(site: Site, rule: str) -> bool:
    """True when `rule` is the binding constraint on this plot."""
    limits = compute_limits(site.plot_area, site.plot_width, site.plot_depth,
                            site.road_width, site.proposed_height)
    if rule == "FAR":
        # FAR must bind before the physical footprint x floors ceiling
        return (limits.max_footprint_area * 0.99 * site.proposed_floors
                >= limits.far * site.plot_area * 1.05)
    if rule == "COVERAGE":
        # coverage percentage must bind before the setback envelope
        return limits.setback_envelope_area >= limits.coverage_cap_area * 1.05
    if rule == "HEIGHT":
        tall = compute_limits(site.plot_area, site.plot_width, site.plot_depth,
                             site.road_width, limits.max_height + BORDERLINE_ABS_H)
        return tall.max_footprint_area > 0.15 * site.plot_area
    return True


def _make_borderline(rng: random.Random, idx: int) -> Site:
    rule = BORDERLINE_RULES[idx % len(BORDERLINE_RULES)]
    inside = idx % 2 == 0            # alternate just-inside / just-outside
    sign = -1.0 if inside else 1.0

    feasible = False
    for _ in range(500):
        site = _base_site(rng, "borderline", idx)
        if _borderline_feasible(site, rule):
            feasible = True
            break

    limits = compute_limits(site.plot_area, site.plot_width, site.plot_depth,
                            site.road_width, site.proposed_height)

    if rule == "FAR":
        _apply_statutory_setbacks(site, margin=0.0)
        site.proposed_footprint_area = round(limits.max_footprint_area * 0.99, 2)
        site.proposed_built_up_area = round(
            limits.far * (1 + sign * BORDERLINE_REL) * site.plot_area, 2)
    elif rule == "COVERAGE":
        # On many Hyderabad plots the setback envelope, not the coverage
        # percentage, is the binding footprint constraint. Perturb whichever
        # of the two actually governs so the case stays a single-rule test.
        _apply_statutory_setbacks(site, margin=0.0)
        governing = min(limits.coverage_cap_area, limits.setback_envelope_area)
        site.proposed_footprint_area = round(governing * (1 + sign * BORDERLINE_REL), 2)
        site.proposed_built_up_area = round(
            min(site.proposed_built_up_area, limits.max_built_up_area * 0.9), 2)
        rule = "COVERAGE" if feasible else "COVERAGE_VIA_SETBACK_ENVELOPE"
    elif rule in ("SETBACK_SIDE", "SETBACK_FRONT"):
        delta = sign * BORDERLINE_ABS_M
        if rule == "SETBACK_SIDE":
            site.provided_side1_setback = round(max(0.0, limits.side_setback - delta), 2)
        else:
            site.provided_front_setback = round(max(0.0, limits.front_setback - delta), 2)
        _fit_footprint(site)
    else:  # HEIGHT — breach (or just clear) the road-width height ceiling only
        site.proposed_height = round(limits.max_height + sign * BORDERLINE_ABS_H, 2)
        site.proposed_floors = max(1, int(site.proposed_height // FLOOR_HEIGHT))
        tall = _apply_statutory_setbacks(site)
        site.provided_front_setback = round(
            max(site.provided_front_setback,
                site.proposed_height / HEIGHT_ANGLE_FACTOR - site.road_width + 0.2), 2)
        site.proposed_footprint_area = round(tall.max_footprint_area * 0.9, 2)
        site.proposed_built_up_area = round(
            min(tall.max_built_up_area * 0.9,
                site.proposed_footprint_area * site.proposed_floors * 0.95), 2)
        _fit_footprint(site)

    site.perturbed_rule = f"{rule}:{'inside' if inside else 'outside'}"
    return site


NONCOMPLIANT_RULES = ["FAR", "COVERAGE", "SETBACK", "HEIGHT", "ENVELOPE"]


def _make_non_compliant(rng: random.Random, idx: int) -> Site:
    rule = NONCOMPLIANT_RULES[idx % len(NONCOMPLIANT_RULES)]
    feasibility = {"FAR": "FAR", "COVERAGE": "COVERAGE"}.get(rule, "")
    for _ in range(500):
        site = _base_site(rng, "non_compliant", idx)
        if not feasibility or _borderline_feasible(site, feasibility):
            break
    limits = compute_limits(site.plot_area, site.plot_width, site.plot_depth,
                            site.road_width, site.proposed_height)

    if rule == "FAR":
        _apply_statutory_setbacks(site, margin=0.0)
        site.proposed_footprint_area = round(limits.max_footprint_area * 0.99, 2)
        site.proposed_built_up_area = round(site.plot_area * limits.far * rng.uniform(1.15, 1.45), 2)
        site.proposed_floors = max(site.proposed_floors,
                                   math.ceil(site.proposed_built_up_area / site.proposed_footprint_area))
    elif rule == "COVERAGE":
        _apply_statutory_setbacks(site, margin=0.0)
        site.proposed_footprint_area = round(
            site.plot_area * limits.coverage_pct / 100.0 * rng.uniform(1.12, 1.35), 2)
        site.proposed_built_up_area = round(
            min(site.proposed_built_up_area, limits.max_built_up_area * 0.9), 2)
    elif rule == "SETBACK":
        site.provided_side1_setback = round(max(0.0, limits.side_setback * rng.uniform(0.2, 0.6)), 2)
        site.provided_rear_setback = round(max(0.0, limits.rear_setback * rng.uniform(0.2, 0.6)), 2)
        _fit_footprint(site)
    elif rule == "HEIGHT":
        # Overshoot the road-width height ceiling as far as the plot still
        # allows a usable envelope at the (larger) setbacks that height demands,
        # so the height rule stays the sole cause of non-compliance.
        original_setbacks = (site.provided_front_setback, site.provided_rear_setback,
                             site.provided_side1_setback, site.provided_side2_setback)
        base_height = site.proposed_height
        chosen = None
        for multiplier in (1.6, 1.5, 1.4, 1.3, 1.2, 1.1, 1.05):
            candidate = round(limits.max_height * multiplier, 2)
            tall = compute_limits(site.plot_area, site.plot_width, site.plot_depth,
                                  site.road_width, candidate)
            if tall.max_footprint_area >= 0.3 * tall.coverage_cap_area:
                chosen = (candidate, tall)
                break
        if chosen is None:
            # No usable envelope at any excess height: keep the compliant-height
            # setbacks, so this site breaches the height ceiling and, as a
            # consequence, the setbacks that the excess height would require.
            site.proposed_height = round(limits.max_height * 1.2, 2)
            site.proposed_floors = max(1, int(site.proposed_height // FLOOR_HEIGHT))
            (site.provided_front_setback, site.provided_rear_setback,
             site.provided_side1_setback, site.provided_side2_setback) = original_setbacks
            site.proposed_height = max(site.proposed_height, base_height)
            _fit_footprint(site)
        else:
            site.proposed_height, tall = chosen
            site.proposed_floors = max(1, int(site.proposed_height // FLOOR_HEIGHT))
            _apply_statutory_setbacks(site)
            site.proposed_footprint_area = round(tall.max_footprint_area * 0.9, 2)
            site.proposed_built_up_area = round(
                min(tall.max_built_up_area * 0.9,
                    site.proposed_footprint_area * site.proposed_floors * 0.95), 2)
            _fit_footprint(site)
    else:  # ENVELOPE — footprint spills past the setbacks actually provided
        envelope = ((site.plot_width - site.provided_side1_setback - site.provided_side2_setback)
                    * (site.plot_depth - site.provided_front_setback - site.provided_rear_setback))
        site.proposed_footprint_area = round(max(envelope, 1.0) * rng.uniform(1.15, 1.4), 2)
        site.proposed_built_up_area = round(
            min(site.proposed_built_up_area, site.proposed_footprint_area * site.proposed_floors), 2)

    site.perturbed_rule = f"{rule}:violated"
    return site


def generate(n_per_stratum: int = 20) -> list[Site]:
    rng = random.Random(SEED)
    sites: list[Site] = []
    builders = [("CMP", _make_compliant), ("BRD", _make_borderline), ("NCP", _make_non_compliant)]
    for prefix, build in builders:
        for i in range(n_per_stratum):
            site = build(rng, i)
            site.site_id = f"HYD-{prefix}-{i + 1:02d}"
            violations = evaluate(site)
            site.ground_truth_compliant = not violations
            site.ground_truth_violations = "|".join(violations)
            _assert_meaningful(site)
            sites.append(site)
    return sites


def _assert_meaningful(site: Site) -> None:
    """Guard against degenerate scenarios that would not test anything."""
    if site.proposed_footprint_area < 0.1 * site.plot_area:
        raise RuntimeError(
            f"{site.site_id}: degenerate footprint "
            f"{site.proposed_footprint_area:.2f} sq.m on a {site.plot_area:.1f} sq.m plot")
    if site.proposed_built_up_area <= 0 or site.proposed_height <= 0:
        raise RuntimeError(f"{site.site_id}: non-positive built-up area or height")


OUTPUT_CSV = "terralogic_test_sites.csv"


def write_csv(sites: list[Site], path: str = OUTPUT_CSV) -> None:
    rows = [asdict(s) for s in sites]
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    sites = generate()
    write_csv(sites)
    print(f"Wrote {len(sites)} synthetic Hyderabad sites to {OUTPUT_CSV}\n")
    header = f"{'stratum':<14}{'n':>4}{'compliant':>11}{'non-compliant':>15}"
    print(header)
    print("-" * len(header))
    for stratum in ("compliant", "borderline", "non_compliant"):
        subset = [s for s in sites if s.stratum == stratum]
        ok = sum(1 for s in subset if s.ground_truth_compliant)
        print(f"{stratum:<14}{len(subset):>4}{ok:>11}{len(subset) - ok:>15}")


if __name__ == "__main__":
    main()

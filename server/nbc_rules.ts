/**
 * NBC 2016 Rule Engine
 * National Building Code of India 2016 + GHMC Development Control Regulations
 * Reference: NBC 2016 Part 3 (DCR), Part 4 (Fire), Part 8 (Services), Annex B (Parking)
 *            GHMC GO Ms. No. 168 (2012) — plot-area-based coverage limits
 *            GHMC GO Ms. No. 670 (2007) — FAR schedule
 *
 * Rules are DETERMINISTIC. AI must NOT override violations or final score.
 */

export interface NbcViolation {
  code: string;
  description: string;
  severity: "critical" | "warning" | "info";
}

export interface NbcRuleResult {
  violations: NbcViolation[];
  score: number;
  compliant: boolean;
  solarExposure: number;
  zoningSummary: string;
  rulesSummary: string;
}

// ─── NBC 2016 Part 3 + GHMC GO 168: Height vs Setbacks (metres) ──────────────
// Source: NBC 2016 Appendix H read with GHMC Hyderabad regulations
const SETBACK_TABLE = [
  { maxHeight:  7, front: 1.5, rearSide: 1.5 },
  { maxHeight: 10, front: 3.0, rearSide: 1.5 },
  { maxHeight: 12, front: 4.5, rearSide: 3.0 },
  { maxHeight: 15, front: 5.0, rearSide: 3.0 },
  { maxHeight: 18, front: 5.0, rearSide: 5.0 },
  { maxHeight: 21, front: 6.0, rearSide: 5.0 },
  { maxHeight: 24, front: 7.0, rearSide: 5.0 },
  { maxHeight: 30, front: 8.0, rearSide: 7.0 },
  { maxHeight: 999, front: 9.0, rearSide: 9.0 },
];

function getRequiredSetbacks(heightM: number): { front: number; rearSide: number } {
  for (const row of SETBACK_TABLE) {
    if (heightM <= row.maxHeight) return { front: row.front, rearSide: row.rearSide };
  }
  return { front: 9.0, rearSide: 9.0 };
}

// ─── GHMC GO 168: Plot-area-based Ground Coverage limits ──────────────────────
function getGroundCoverageLimit(siteArea: number, type: string): number {
  if (type === "commercial" || type === "office" || type === "hotel") return 60;
  if (type === "industrial") return 50;
  // Residential / mixed-use — GHMC plot-size schedule
  if (siteArea < 100)  return 75;
  if (siteArea < 300)  return 70;
  if (siteArea < 500)  return 60;
  if (siteArea < 1000) return 55;
  return 50;
}

// ─── GHMC GO 670: FAR schedule by use ─────────────────────────────────────────
// (road-width-based FAR not computed here as road width isn't in the input;
//  conservative site-level defaults are used)
function getFarLimit(type: string, siteArea: number): number {
  if (type === "commercial" || type === "office") return 3.0;
  if (type === "industrial") return 1.5;
  if (type === "hotel") return 2.5;
  if (type === "mixed_use") return 2.5;
  // Residential
  if (siteArea >= 5000) return 2.25; // group housing
  return 2.0;
}

export interface ComplianceInput {
  siteArea: number;
  siteDimensions?: { width: number; depth: number }; // metres, from polygon bounding box
  massings: Array<{
    type: string;
    width: number;
    depth: number;
    height: number;
    floors: number;
    footprint: number;
    builtUp: number;
  }>;
  metrics: {
    far: number;
    groundCoverage: number;
    openSpace: number;
    totalBuiltUp: number;
    maxHeight: number;
    massingCount: number;
  };
  sunHour?: number;
}

export function runNbcRuleEngine(input: ComplianceInput): NbcRuleResult {
  const { siteArea, siteDimensions, massings, metrics } = input;
  const violations: NbcViolation[] = [];
  let deductions = 0;

  const dominantType = getDominantType(massings);
  const farLimit = getFarLimit(dominantType, siteArea);
  const coverageLimit = getGroundCoverageLimit(siteArea, dominantType);

  // ─── 1. FAR CHECK ──────────────────────────────────────────────────────────
  // NBC 2016 Part 3 §4.1 | GHMC GO 670
  if (metrics.far > farLimit + 0.01) {
    const overBy = (metrics.far - farLimit).toFixed(2);
    violations.push({
      code: "NBC 2016 Pt.3 §4.1 / GHMC GO 670 — FAR Exceeded",
      description: `FAR ${metrics.far.toFixed(2)} exceeds the ${farLimit} limit for ${dominantType} use (plot ${Math.round(siteArea)} sqm) by ${overBy}. ` +
        `Formula: Total Covered Area ÷ Plot Area. Basement parking, staircases, and ducts are excluded. ` +
        `Reduce built-up area by ${Math.round((metrics.far - farLimit) * siteArea).toLocaleString()} sqm or apply for FAR variance.`,
      severity: "critical",
    });
    deductions += 25;
  } else if (metrics.far > farLimit * 0.9) {
    violations.push({
      code: "NBC 2016 Pt.3 §4.1 — FAR Near Limit",
      description: `FAR ${metrics.far.toFixed(2)} is within 10% of the ${farLimit} limit. ` +
        `Note: Basement parking, open stilt floors, and utility shafts may be excluded from FAR per GHMC GO 168.`,
      severity: "info",
    });
    deductions += 3;
  }

  // ─── 2. GROUND COVERAGE ────────────────────────────────────────────────────
  // NBC 2016 Part 3 §4.2 | GHMC GO 168 (plot-size-based)
  if (metrics.groundCoverage > coverageLimit + 0.5) {
    const overBy = (metrics.groundCoverage - coverageLimit).toFixed(1);
    violations.push({
      code: "NBC 2016 Pt.3 §4.2 / GHMC GO 168 — Ground Coverage Exceeded",
      description: `Ground coverage ${metrics.groundCoverage.toFixed(1)}% exceeds the ${coverageLimit}% GHMC limit for a ${Math.round(siteArea)} sqm ${dominantType} plot by ${overBy}%. ` +
        `Reduce footprint area by ${Math.round((metrics.groundCoverage - coverageLimit) / 100 * siteArea).toLocaleString()} sqm. ` +
        `Open-to-sky courtyards, podium gardens, and stilts count as open space.`,
      severity: "critical",
    });
    deductions += 20;
  } else if (metrics.groundCoverage > coverageLimit - 5) {
    violations.push({
      code: "NBC 2016 Pt.3 §4.2 — Ground Coverage Advisory",
      description: `Ground coverage ${metrics.groundCoverage.toFixed(1)}% is near the ${coverageLimit}% limit for this plot size. Adequate open-to-sky areas and ventilation shafts are recommended.`,
      severity: "info",
    });
    deductions += 2;
  }

  // ─── 3. OPEN SPACE ─────────────────────────────────────────────────────────
  // NBC 2016 Part 3 §4.3: Minimum 30% open space on any plot
  if (metrics.openSpace < 30 - 0.5) {
    violations.push({
      code: "NBC 2016 Pt.3 §4.3 — Insufficient Open Space",
      description: `Open space ${metrics.openSpace.toFixed(1)}% is below the mandatory 30% minimum (${Math.round(0.3 * siteArea).toLocaleString()} sqm required). ` +
        `Open-to-sky courts, pools, landscape areas at grade, and roof gardens (up to 50% credit) may be included in this calculation.`,
      severity: "critical",
    });
    deductions += 15;
  } else if (metrics.openSpace < 35) {
    violations.push({
      code: "NBC 2016 Pt.3 §4.3 — Open Space Advisory",
      description: `Open space ${metrics.openSpace.toFixed(1)}% meets the 30% minimum but is below the recommended 35% for comfortable habitable density. Consider additional courtyards or landscape buffers.`,
      severity: "info",
    });
    deductions += 2;
  }

  // ─── 4. SETBACK CHECK (HEIGHT-BASED) ───────────────────────────────────────
  // NBC 2016 Part 3 Table 1 + GHMC GO 168
  // Only flag a CLEAR violation when site dimensions show the massing cannot physically
  // accommodate the required setbacks even if centred optimally.
  const maxH = metrics.maxHeight;
  const { front: reqFront, rearSide: reqRear } = getRequiredSetbacks(maxH);
  let setbackViolated = false;

  if (siteDimensions && siteDimensions.width > 0 && siteDimensions.depth > 0) {
    // Check each massing against available clearance given site bounding box
    for (const m of massings) {
      const { front: mReqFront, rearSide: mReqRear } = getRequiredSetbacks(m.height);
      const clearW = (siteDimensions.width - m.width) / 2;
      const clearD = (siteDimensions.depth - m.depth) / 2;

      if (clearW < mReqRear || clearD < mReqFront) {
        const minClear = Math.min(clearW, clearD).toFixed(1);
        violations.push({
          code: `NBC 2016 Pt.3 Table 1 — Setback Violation (${m.height.toFixed(0)}m massing)`,
          description: `A ${m.width.toFixed(0)}m × ${m.depth.toFixed(0)}m × ${m.height.toFixed(0)}m block leaves only ~${minClear}m of clearance on the tightest side ` +
            `but requires front ≥ ${mReqFront}m and rear/side ≥ ${mReqRear}m. ` +
            `Reduce massing width/depth or move it inward. ` +
            `Site bounding box: ${siteDimensions.width.toFixed(0)}m × ${siteDimensions.depth.toFixed(0)}m.`,
          severity: "critical",
        });
        deductions += 15;
        setbackViolated = true;
        break; // report once
      }
    }
    if (!setbackViolated) {
      violations.push({
        code: `NBC 2016 Pt.3 Table 1 — Setback Requirement`,
        description: `For the tallest massing (${maxH.toFixed(0)}m): front setback ≥ ${reqFront}m, rear/side ≥ ${reqRear}m. ` +
          `Site dimensions (${siteDimensions.width.toFixed(0)}m × ${siteDimensions.depth.toFixed(0)}m) appear sufficient. Verify actual position in layout.`,
        severity: "info",
      });
    }
  } else {
    violations.push({
      code: `NBC 2016 Pt.3 Table 1 — Setback Requirement`,
      description: `Buildings of ${maxH.toFixed(0)}m height require front setback ≥ ${reqFront}m and rear/side setback ≥ ${reqRear}m. Verify actual setbacks in your layout drawing.`,
      severity: "info",
    });
  }

  // ─── 5. HEIGHT CLASSIFICATION (SITE-LEVEL, PRE-DESIGN) ─────────────────────
  // This is macro zoning: 45m typical ceiling, 24m high-rise threshold.
  // NOTE: Interior elements (sprinklers, staircases, fire lifts, fire exits)
  //       are BANNED per pre-design constraint. Only macro height zoning reported.
  if (metrics.maxHeight > 24) {
    violations.push({
      code: "NBC 2016 Pt.4 §3.7 — High-Rise Threshold",
      description: `Height ${metrics.maxHeight.toFixed(1)}m classifies this as HIGH-RISE (>24m). ` +
        `At pre-design stage: confirm AAI NOC (airport proximity), structural wind analysis per IS 875 Part 3, ` +
        `and consult GHMC high-rise committee. Interior fire/life-safety details deferred to detail design.`,
      severity: "warning",
    });
    deductions += 5;
  }

  if (metrics.maxHeight > 45) {
    violations.push({
      code: "NBC 2016 — Extreme Height Advisory (Zoning Ceiling)",
      description: `Height ${metrics.maxHeight.toFixed(1)}m exceeds the typical 45m GHMC zoning ceiling. ` +
        `Pre-design actions required: (i) GHMC special approval, (ii) AAI NOC, (iii) peer-reviewed structural/wind analysis. ` +
        `Interior stair/fire/lift details are deferred to post-design.`,
      severity: "critical",
    });
    deductions += 15;
  }

  // ─── 6. LIFT PROVISION (MACRO MASSING INDICATOR ONLY) ──────────────────────
  // Pre-design: flag it only as a massing-volume impact. Lift shaft dimensions
  // themselves are interior detail; deferred. We only report capacity headroom.
  // (Kept because >15m height affects the FAR / number of storeys the user can
  //  actually reach — it's a massing constraint, not a staircase layout.)
  const maxFloors = massings.length > 0 ? Math.max(...massings.map(m => m.floors)) : 0;
  if (metrics.maxHeight > 15 || maxFloors > 4) {
    const shaftSqm = massings.length * 2.5 * 2.0; // rough: 2.5m × 2m per lift shaft
    violations.push({
      code: "NBC 2016 Pt.3 §3.15 — Lift Provision (Massing Impact)",
      description: `Building height ${metrics.maxHeight.toFixed(0)}m / ${maxFloors} floors exceeds lift threshold (>15m or >4 floors). ` +
        `Pre-design massing impact: reserve ~${shaftSqm.toFixed(0)} sqm of core footprint per block ` +
        `(exact shaft count and staircase widths deferred to detail design).`,
      severity: "info",
    });
    deductions += 2;
  }

  // ─── 7. INTER-BUILDING DISTANCE (PRE-DESIGN MASSING) ───────────────────────
  // NBC 2016 Part 3 §4.4: Distance between buildings ≥ H/2 (H = height of taller block)
  // Site-level: constrains how massings can be arranged; this is macro layout.
  if (massings.length >= 2) {
    const tallestH = Math.max(...massings.map(m => m.height));
    const minGap = tallestH / 2;
    violations.push({
      code: "NBC 2016 Pt.3 §4.4 — Inter-Building Distance",
      description: `With ${massings.length} blocks, clear distance between parallel facades must be ≥ ${minGap.toFixed(1)}m ` +
        `(= H/2 where H = ${tallestH.toFixed(0)}m tallest building). ` +
        `This is a macro massing constraint. Interior corridor widths deferred.`,
      severity: "info",
    });
  }

  // ─── 8. STAIRCASE WIDTH (DEFERRED PER PRE-DESIGN RULE) ─────────────────────
  // BANNED LOGIC: staircase widths are interior / post-design detail.
  // Code block intentionally removed. We skip this rule entirely in pre-design mode.

  // ─── 9. PARKING REQUIREMENT (PRE-DESIGN, FAR IMPACT) ────────────────────────
  // NBC 2016 Annex B: 1 ECS per 100 sqm residential, 1 ECS per 50 sqm commercial
  // Important at pre-design because basement parking area affects FAR calculation
  // and excavation volume.
  const resBuiltUp = massings.filter(m => m.type === "residential" || m.type === "mixed_use").reduce((s, m) => s + m.builtUp, 0);
  const commBuiltUp = massings.filter(m => m.type === "commercial" || m.type === "office" || m.type === "hotel").reduce((s, m) => s + m.builtUp, 0);
  const requiredECS = Math.ceil(resBuiltUp / 100) + Math.ceil(commBuiltUp / 50);

  if (requiredECS > 0) {
    const ecsArea = requiredECS * 12.5; // 2.5m × 5m per ECS
    violations.push({
      code: "NBC 2016 Annex B — Parking (ECS) — Pre-design",
      description: `Required parking: ${requiredECS} ECS — Residential: ${Math.ceil(resBuiltUp / 100)} ECS (1/100 sqm of ${Math.round(resBuiltUp).toLocaleString()} sqm) + ` +
        `Commercial: ${Math.ceil(commBuiltUp / 50)} ECS (1/50 sqm of ${Math.round(commBuiltUp).toLocaleString()} sqm). ` +
        `Pre-design massing implication: ~${Math.round(ecsArea).toLocaleString()} sqm parking footprint per level ` +
        `(basement parking excluded from FAR per GHMC GO 168).`,
      severity: requiredECS > 30 ? "warning" : "info",
    });
    if (requiredECS > 30) deductions += 5;
  }

  // ─── 10. RAINWATER HARVESTING (PRE-DESIGN SITE CONSTRAINT) ──────────────────
  // NBC 2016 Part 9 Sec.2: Mandatory for plots > 300 sqm
  // Site-level: affects open-space layout (recharge pits, tanks).
  if (siteArea > 300) {
    violations.push({
      code: "NBC 2016 Pt.9 Sec.2 — Rainwater Harvesting",
      description: `Plot area ${Math.round(siteArea).toLocaleString()} sqm exceeds 300 sqm threshold. ` +
        `Rainwater harvesting is MANDATORY. Pre-design reserve: 1 recharge pit per 100 sqm of roofed area, ` +
        `or underground storage sized for 20mm/hour rainfall. Interior plumbing deferred.`,
      severity: "warning",
    });
    deductions += 3;
  }

  // ─── 11. VENTILATION & NATURAL LIGHT (MACRO MASSING) ───────────────────────
  // NBC 2016 Part 8 §2.1: Openings ≥ 1/10th of floor area for habitable rooms
  // Pre-design: only flag when GROUND COVERAGE is so high that the per-floor
  // perimeter can't physically satisfy this. Interior room-by-room is banned.
  if (metrics.groundCoverage > 70) {
    violations.push({
      code: "NBC 2016 Pt.8 §2.1 — Ventilation Risk (Massing Level)",
      description: `Ground coverage ${metrics.groundCoverage.toFixed(1)}% leaves limited perimeter for facade openings. ` +
        `Pre-design massing action: reduce coverage or introduce internal courtyards so total facade ` +
        `perimeter can yield openings ≥ 1/10 floor area. Interior room layouts deferred.`,
      severity: "warning",
    });
    deductions += 5;
  }

  // ─── SOLAR EXPOSURE ESTIMATE ───────────────────────────────────────────────
  const solarExposure = Math.min(100, Math.max(10,
    100
    - (metrics.groundCoverage > 55 ? (metrics.groundCoverage - 55) * 1.2 : 0)
    - (metrics.massingCount > 4 ? (metrics.massingCount - 4) * 2 : 0)
    - (metrics.maxHeight > 30 ? 8 : 0)
    - (setbackViolated ? 10 : 0)
  ));

  // ─── FINAL SCORE ───────────────────────────────────────────────────────────
  const score = Math.max(0, Math.min(100, 100 - deductions));
  const criticals = violations.filter(v => v.severity === "critical");
  const compliant = criticals.length === 0 && score >= 60;

  const siteSqm = Math.round(siteArea).toLocaleString();
  const zoningSummary = compliant
    ? `COMPLIANT — FAR: ${metrics.far.toFixed(2)}/${farLimit} | Coverage: ${metrics.groundCoverage.toFixed(1)}%/${coverageLimit}% | Open: ${metrics.openSpace.toFixed(1)}% | Height: ${metrics.maxHeight.toFixed(1)}m | Plot: ${siteSqm} sqm`
    : `${criticals.length} critical violation(s) — FAR: ${metrics.far.toFixed(2)}/${farLimit} | Coverage: ${metrics.groundCoverage.toFixed(1)}%/${coverageLimit}% | Open: ${metrics.openSpace.toFixed(1)}% | Height: ${metrics.maxHeight.toFixed(1)}m | Plot: ${siteSqm} sqm`;

  const rulesSummary = `
NBC 2016 + GHMC RULES APPLIED (Site: ${siteSqm} sqm, Use: ${dominantType}):
• FAR limit: ${farLimit}  |  Actual: ${metrics.far.toFixed(2)}
• Ground coverage limit (GHMC GO 168): ${coverageLimit}%  |  Actual: ${metrics.groundCoverage.toFixed(1)}%
• Open space minimum: 30%  |  Actual: ${metrics.openSpace.toFixed(1)}%
• Setbacks for ${metrics.maxHeight.toFixed(0)}m height: Front ≥ ${reqFront}m, Rear/Side ≥ ${reqRear}m
• Fire class: ${metrics.maxHeight > 24 ? "HIGH-RISE (NBC Pt.4 §3.7)" : metrics.maxHeight > 15 ? "Medium-rise (NBC Pt.4 §3.6)" : "Low-rise (≤15m)"}
• Lift mandatory: ${metrics.maxHeight > 15 || maxFloors > 4 ? "YES (>15m / >4 floors)" : "Not required"}
• Required parking: ${requiredECS} ECS  |  Rainwater harvesting: ${siteArea > 300 ? "MANDATORY" : "Not required"}
  `.trim();

  return { violations, score, compliant, solarExposure, zoningSummary, rulesSummary };
}

function getDominantType(massings: ComplianceInput["massings"]): string {
  if (!massings.length) return "residential";
  const counts: Record<string, number> = {};
  for (const m of massings) counts[m.type] = (counts[m.type] || 0) + m.builtUp;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

// ─── MAXIMUM COMPLIANT ENVELOPE CALCULATOR (PRE-DESIGN) ─────────────────────
// Given a site, returns the theoretical maximum legally-buildable volume
// WITHOUT violating FAR, Ground Coverage, Setbacks, or Height — so the user
// knows the upper bound BEFORE placing any massings.
// STRICTLY PRE-DESIGN: no interior elements, no room layouts, no stairs/fire.

export interface MaxEnvelope {
  farLimit: number;
  groundCoverageLimit: number;
  openSpaceMinimum: number;
  maxHeightLimit: number;
  setbacks: { front: number; rearSide: number };

  maxFootprintArea: number;
  maxBuiltUpArea: number;
  minOpenSpaceArea: number;

  maxEnvelopeVolume: number;
  theoreticalFloors: number;

  useType: string;
  siteArea: number;
}

const ZONING_MAX_HEIGHT = 45; // GHMC typical ceiling; extreme advisory above this

export function computeMaxEnvelope(params: {
  siteArea: number;
  siteDimensions?: { width: number; depth: number };
  useType?: "residential" | "commercial" | "office" | "hotel" | "industrial" | "mixed_use";
  customHeightLimit?: number;
}): MaxEnvelope {
  const siteArea = Math.max(0, params.siteArea || 0);
  const useType = params.useType || "residential";

  const farLimit = getFarLimit(useType, siteArea);
  const groundCoverageLimit = getGroundCoverageLimit(siteArea, useType);
  const openSpaceMinimum = 30;
  const maxHeightLimit = params.customHeightLimit ?? ZONING_MAX_HEIGHT;
  const setbacks = getRequiredSetbacks(maxHeightLimit);

  const maxFootprintArea = (siteArea * groundCoverageLimit) / 100;
  const maxBuiltUpArea = siteArea * farLimit;
  const minOpenSpaceArea = (siteArea * openSpaceMinimum) / 100;
  const maxEnvelopeVolume = maxFootprintArea * maxHeightLimit;
  const theoreticalFloors = maxFootprintArea > 0 ? Math.floor(maxBuiltUpArea / maxFootprintArea) : 0;

  return {
    farLimit,
    groundCoverageLimit,
    openSpaceMinimum,
    maxHeightLimit,
    setbacks,
    maxFootprintArea: Math.round(maxFootprintArea * 100) / 100,
    maxBuiltUpArea: Math.round(maxBuiltUpArea * 100) / 100,
    minOpenSpaceArea: Math.round(minOpenSpaceArea * 100) / 100,
    maxEnvelopeVolume: Math.round(maxEnvelopeVolume * 100) / 100,
    theoreticalFloors,
    useType,
    siteArea: Math.round(siteArea * 100) / 100,
  };
}

/**
 * NBC 2016 Rule Engine
 * National Building Code of India 2016 + GHMC Development Control Regulations
 * Reference: NBC 2016 Part 3 (DCR), Part 4 (Fire), Part 8 (Services), Annex B (Parking)
 *            GHMC GO Ms. No. 168 (2012) — plot-area-based coverage limits, setbacks, FAR
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

// ─── Hyderabad GHMC / TS-bPASS / G.O. Ms. No. 168 (2012) Regulations ────────
// Each table is upper_bound_exclusive: value < maxArea / maxRoadWidth / maxHeight

// Table 1 — Plot-area-based setbacks for buildings up to 10 m height (metres)
const SETBACK_BY_PLOT_AREA: Array<{ maxArea: number; front: number; rear: number; side: number }> = [
  { maxArea: 100.0,   front: 1.5, rear: 1.0, side: 0.0 },
  { maxArea: 200.0,   front: 1.5, rear: 1.5, side: 1.0 },
  { maxArea: 300.0,   front: 2.0, rear: 2.0, side: 1.5 },
  { maxArea: 400.0,   front: 3.0, rear: 2.0, side: 2.0 },
  { maxArea: 500.0,   front: 3.0, rear: 3.0, side: 2.0 },
  { maxArea: 750.0,   front: 3.0, rear: 3.0, side: 2.5 },
  { maxArea: 1000.0,  front: 3.5, rear: 3.0, side: 3.0 },
  { maxArea: Infinity,front: 4.5, rear: 3.5, side: 3.5 },
];

// Table 2 — Front setback governed by the abutting road width (metres)
const FRONT_SETBACK_BY_ROAD_WIDTH: Array<{ maxRoadWidth: number; front: number }> = [
  { maxRoadWidth: 9.0,      front: 1.5 },
  { maxRoadWidth: 12.0,     front: 3.0 },
  { maxRoadWidth: 18.0,     front: 4.5 },
  { maxRoadWidth: 24.0,     front: 6.0 },
  { maxRoadWidth: Infinity, front: 9.0 },
];

// Table 3 — Side/rear setback escalation with building height (metres)
const SIDE_REAR_SETBACK_BY_HEIGHT: Array<{ maxHeight: number; setback: number }> = [
  { maxHeight: 10.0,     setback: 0.0 }, // governed solely by plot-area bracket
  { maxHeight: 12.0,     setback: 3.0 },
  { maxHeight: 15.0,     setback: 3.5 },
  { maxHeight: 18.0,     setback: 4.0 },
  { maxHeight: 21.0,     setback: 5.0 },
  { maxHeight: 24.0,     setback: 6.0 },
  { maxHeight: 27.0,     setback: 7.0 },
  { maxHeight: 30.0,     setback: 8.0 },
  { maxHeight: Infinity, setback: 9.0 },
];

// Table 4 — Maximum permissible height by abutting road width (metres)
const MAX_HEIGHT_BY_ROAD_WIDTH: Array<{ maxRoadWidth: number; height: number }> = [
  { maxRoadWidth: 9.0,      height: 10.0 },
  { maxRoadWidth: 12.0,     height: 15.0 },
  { maxRoadWidth: 18.0,     height: 18.0 },
  { maxRoadWidth: 24.0,     height: 24.0 },
  { maxRoadWidth: 30.0,     height: 30.0 },
  { maxRoadWidth: Infinity, height: 45.0 },
];

// Table 5 — Permissible ground coverage by plot area (percent of plot)
const GROUND_COVERAGE_BY_PLOT_AREA: Array<{ maxArea: number; coverage: number }> = [
  { maxArea: 100.0,    coverage: 75.0 },
  { maxArea: 200.0,    coverage: 70.0 },
  { maxArea: 300.0,    coverage: 65.0 },
  { maxArea: 500.0,    coverage: 60.0 },
  { maxArea: 1000.0,   coverage: 55.0 },
  { maxArea: Infinity, coverage: 50.0 },
];

// Table 6 — Permissible FAR by abutting road width (residential)
const FAR_BY_ROAD_WIDTH: Array<{ maxRoadWidth: number; far: number }> = [
  { maxRoadWidth: 9.0,      far: 1.75 },
  { maxRoadWidth: 12.0,     far: 2.00 },
  { maxRoadWidth: 18.0,     far: 2.50 },
  { maxRoadWidth: 24.0,     far: 3.00 },
  { maxRoadWidth: Infinity, far: 3.50 },
];

function getRequiredSetbacks(plotArea: number, roadWidth: number, heightM: number): { front: number; rear: number; side: number } {
  let bracket = SETBACK_BY_PLOT_AREA[SETBACK_BY_PLOT_AREA.length - 1];
  for (const b of SETBACK_BY_PLOT_AREA) {
    if (plotArea < b.maxArea) {
      bracket = b;
      break;
    }
  }

  let roadFront = 9.0;
  for (const r of FRONT_SETBACK_BY_ROAD_WIDTH) {
    if (roadWidth < r.maxRoadWidth) {
      roadFront = r.front;
      break;
    }
  }

  let heightSide = 9.0;
  for (const h of SIDE_REAR_SETBACK_BY_HEIGHT) {
    if (heightM < h.maxHeight) {
      heightSide = h.setback;
      break;
    }
  }

  return {
    front: Math.max(bracket.front, roadFront),
    rear: Math.max(bracket.rear, heightSide),
    side: Math.max(bracket.side, heightSide),
  };
}

function getGroundCoverageLimit(siteArea: number, type: string): number {
  if (type === "commercial" || type === "office" || type === "hotel") return 60;
  if (type === "industrial") return 50;
  // Residential / mixed-use — GHMC plot-size schedule
  for (const row of GROUND_COVERAGE_BY_PLOT_AREA) {
    if (siteArea < row.maxArea) return row.coverage;
  }
  return 50.0;
}

function getFarLimit(type: string, siteArea: number, roadWidth = 12.0): number {
  if (type === "commercial" || type === "office") return 3.0;
  if (type === "industrial") return 1.5;
  if (type === "hotel") return 2.5;
  if (type === "mixed_use") return 2.5;
  // Residential: scale by road width per GHMC G.O. Ms. 168 Table 6
  for (const row of FAR_BY_ROAD_WIDTH) {
    if (roadWidth < row.maxRoadWidth) return row.far;
  }
  return 3.5;
}

function getMaxHeightLimit(roadWidth = 12.0): number {
  for (const row of MAX_HEIGHT_BY_ROAD_WIDTH) {
    if (roadWidth < row.maxRoadWidth) return row.height;
  }
  return 45.0;
}

export interface ComplianceInput {
  siteArea: number;
  roadWidth?: number;
  siteDimensions?: {
    width: number;
    depth: number;
    roadWidth?: number;
    providedSetbacks?: {
      front?: number;
      rear?: number;
      side1?: number;
      side2?: number;
    };
  };
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
    roadWidth?: number;
  };
  sunHour?: number;
}

export function runNbcRuleEngine(input: ComplianceInput): NbcRuleResult {
  const { siteArea, siteDimensions, massings, metrics } = input;
  const violations: NbcViolation[] = [];
  let deductions = 0;

  const roadWidth = input.roadWidth ?? siteDimensions?.roadWidth ?? metrics?.roadWidth ?? 12.0;
  const dominantType = getDominantType(massings);
  const farLimit = getFarLimit(dominantType, siteArea, roadWidth);
  const coverageLimit = getGroundCoverageLimit(siteArea, dominantType);
  const minOpenSpace = Math.max(0, 100.0 - coverageLimit);

  // ─── 1. FAR CHECK ──────────────────────────────────────────────────────────
  // NBC 2016 Part 3 §4.1 | GHMC GO 168 / GO 670 (road-width calibrated)
  if (metrics.far > farLimit + 0.01) {
    const overBy = (metrics.far - farLimit).toFixed(2);
    violations.push({
      code: "NBC 2016 Pt.3 §4.1 / GHMC GO 168 — FAR Exceeded",
      description: `FAR ${metrics.far.toFixed(2)} exceeds the ${farLimit} limit for ${dominantType} use (plot ${Math.round(siteArea)} sqm, road ${roadWidth}m) by ${overBy}. ` +
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
  if (metrics.groundCoverage > coverageLimit + 0.01) {
    const overBy = (metrics.groundCoverage - coverageLimit).toFixed(2);
    violations.push({
      code: "NBC 2016 Pt.3 §4.2 / GHMC GO 168 — Ground Coverage Exceeded",
      description: `Ground coverage ${metrics.groundCoverage.toFixed(2)}% exceeds the ${coverageLimit}% GHMC limit for a ${Math.round(siteArea)} sqm ${dominantType} plot by ${overBy}%. ` +
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
  // GHMC GO 168: Open space must satisfy (100% - Ground Coverage limit)
  // Plots under 300 sqm have permissible coverage 65-75%, so open space requirement is 25-35%.
  if (metrics.openSpace < minOpenSpace - 0.01) {
    violations.push({
      code: "GHMC GO 168 — Insufficient Open Space",
      description: `Open space ${metrics.openSpace.toFixed(1)}% is below the required ${minOpenSpace}% minimum for this ${Math.round(siteArea)} sqm plot (${Math.round((minOpenSpace / 100) * siteArea).toLocaleString()} sqm required). ` +
        `Open-to-sky courts, pools, landscape areas at grade, and roof gardens (up to 50% credit) may be included in this calculation.`,
      severity: "critical",
    });
    deductions += 15;
  } else if (metrics.openSpace < minOpenSpace + 5) {
    violations.push({
      code: "GHMC GO 168 — Open Space Advisory",
      description: `Open space ${metrics.openSpace.toFixed(1)}% meets the ${minOpenSpace}% minimum but is near the limit for comfortable habitable density. Consider additional courtyards or landscape buffers.`,
      severity: "info",
    });
    deductions += 2;
  }

  // ─── 4. SETBACK CHECK (MULTI-FACTOR GHMC GO 168) ───────────────────────────
  // Evaluates front setback by road width/plot bracket, rear/side by height/plot bracket.
  const maxH = metrics.maxHeight;
  const { front: reqFront, rear: reqRear, side: reqSide } = getRequiredSetbacks(siteArea, roadWidth, maxH);
  let setbackViolated = false;

  const ps = siteDimensions?.providedSetbacks;
  if (ps) {
    for (const m of massings) {
      const { front: mReqFront, rear: mReqRear, side: mReqSide } = getRequiredSetbacks(siteArea, roadWidth, m.height);
      const minSideProvided = Math.min(ps.side1 ?? Infinity, ps.side2 ?? Infinity);

      if (ps.front !== undefined && ps.front < mReqFront - 0.001) {
        violations.push({
          code: `GHMC GO 168 — Front Setback Violation (${m.height.toFixed(0)}m massing)`,
          description: `Provided front setback ${ps.front.toFixed(2)}m is below required ${mReqFront.toFixed(2)}m for road width ${roadWidth}m on a ${Math.round(siteArea)} sqm plot.`,
          severity: "critical",
        });
        deductions += 15;
        setbackViolated = true;
      }
      if (ps.rear !== undefined && ps.rear < mReqRear - 0.001) {
        violations.push({
          code: `GHMC GO 168 — Rear Setback Violation (${m.height.toFixed(0)}m massing)`,
          description: `Provided rear setback ${ps.rear.toFixed(2)}m is below required ${mReqRear.toFixed(2)}m for height ${m.height.toFixed(0)}m on a ${Math.round(siteArea)} sqm plot.`,
          severity: "critical",
        });
        deductions += 15;
        setbackViolated = true;
      }
      if (minSideProvided !== Infinity && minSideProvided < mReqSide - 0.001) {
        violations.push({
          code: `GHMC GO 168 — Side Setback Violation (${m.height.toFixed(0)}m massing)`,
          description: `Provided side setback ${minSideProvided.toFixed(2)}m is below required ${mReqSide.toFixed(2)}m for height ${m.height.toFixed(0)}m on a ${Math.round(siteArea)} sqm plot.`,
          severity: "critical",
        });
        deductions += 15;
        setbackViolated = true;
      }
      if (setbackViolated) break;
    }

    if (siteDimensions && siteDimensions.width > 0 && siteDimensions.depth > 0) {
      const providedEnvW = Math.max(0, siteDimensions.width - (ps.side1 ?? 0) - (ps.side2 ?? 0));
      const providedEnvD = Math.max(0, siteDimensions.depth - (ps.front ?? 0) - (ps.rear ?? 0));
      const maxAllowedFootprint = providedEnvW * providedEnvD;
      for (const m of massings) {
        if (m.footprint > maxAllowedFootprint + 0.001) {
          violations.push({
            code: "GHMC GO 168 — Footprint Outside Setback Envelope",
            description: `Proposed footprint ${m.footprint.toFixed(1)} sqm exceeds buildable envelope (${maxAllowedFootprint.toFixed(1)} sqm) defined by provided setbacks.`,
            severity: "critical",
          });
          deductions += 15;
          setbackViolated = true;
          break;
        }
      }
    }
  } else if (siteDimensions && siteDimensions.width > 0 && siteDimensions.depth > 0) {
    // Clearance-based fallback for massings placed in bounding box
    for (const m of massings) {
      const { front: mReqFront, rear: mReqRear, side: mReqSide } = getRequiredSetbacks(siteArea, roadWidth, m.height);
      const totalDepthClearance = siteDimensions.depth - m.depth;
      const totalWidthClearance = siteDimensions.width - m.width;

      if (totalWidthClearance < 2 * mReqSide - 0.05 || totalDepthClearance < (mReqFront + mReqRear) - 0.05) {
        const minClear = Math.min(totalWidthClearance / 2, totalDepthClearance / 2).toFixed(1);
        violations.push({
          code: `GHMC GO 168 — Setback Violation (${m.height.toFixed(0)}m massing)`,
          description: `A ${m.width.toFixed(0)}m × ${m.depth.toFixed(0)}m × ${m.height.toFixed(0)}m block leaves insufficient clearance (leaves ~${minClear}m) ` +
            `for mandatory front ≥ ${mReqFront}m, rear ≥ ${mReqRear}m, and side ≥ ${mReqSide}m setbacks. ` +
            `Site bounding box: ${siteDimensions.width.toFixed(0)}m × ${siteDimensions.depth.toFixed(0)}m.`,
          severity: "critical",
        });
        deductions += 15;
        setbackViolated = true;
        break;
      }
    }
  }

  if (!setbackViolated) {
    violations.push({
      code: `GHMC GO 168 — Setback Requirement`,
      description: `For the tallest massing (${maxH.toFixed(0)}m) on road ${roadWidth}m: front setback ≥ ${reqFront}m, rear ≥ ${reqRear}m, side ≥ ${reqSide}m. ` +
        (siteDimensions && siteDimensions.width > 0 ? `Site dimensions (${siteDimensions.width.toFixed(0)}m × ${siteDimensions.depth.toFixed(0)}m) appear sufficient. ` : "") +
        `Verify actual position in layout.`,
      severity: "info",
    });
  }

  // ─── 5. HEIGHT CLASSIFICATION & ROAD WIDTH LIMITS ──────────────────────────
  const maxAllowedHeight = getMaxHeightLimit(roadWidth);
  if (metrics.maxHeight > maxAllowedHeight + 0.05) {
    violations.push({
      code: "GHMC GO 168 — Height Exceeds Road Width Limit",
      description: `Building height ${metrics.maxHeight.toFixed(1)}m exceeds the ${maxAllowedHeight.toFixed(1)}m statutory ceiling for an abutting road width of ${roadWidth}m.`,
      severity: "critical",
    });
    deductions += 25;
  }

  const frontProvided = ps?.front ?? (siteDimensions && massings.length ? (siteDimensions.depth - massings[0].depth) / 2 : reqFront);
  const angleCap = 1.5 * (roadWidth + frontProvided);
  if (metrics.maxHeight > angleCap + 0.05) {
    violations.push({
      code: "GHMC GO 168 — Height Exceeds Road Angle Cap",
      description: `Building height ${metrics.maxHeight.toFixed(1)}m exceeds the 1.5 × (road width + front setback) angular ceiling of ${angleCap.toFixed(1)}m.`,
      severity: "critical",
    });
    deductions += 20;
  }

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

  // ─── 8. PARKING REQUIREMENT (PRE-DESIGN, FAR IMPACT) ────────────────────────
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

  // ─── 9. RAINWATER HARVESTING (PRE-DESIGN SITE CONSTRAINT) ──────────────────
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

  // ─── 10. VENTILATION & NATURAL LIGHT (MACRO MASSING) ───────────────────────
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
    ? `COMPLIANT — FAR: ${metrics.far.toFixed(2)}/${farLimit} | Coverage: ${metrics.groundCoverage.toFixed(1)}%/${coverageLimit}% | Open: ${metrics.openSpace.toFixed(1)}% | Height: ${metrics.maxHeight.toFixed(1)}m | Road: ${roadWidth}m | Plot: ${siteSqm} sqm`
    : `${criticals.length} critical violation(s) — FAR: ${metrics.far.toFixed(2)}/${farLimit} | Coverage: ${metrics.groundCoverage.toFixed(1)}%/${coverageLimit}% | Open: ${metrics.openSpace.toFixed(1)}% | Height: ${metrics.maxHeight.toFixed(1)}m | Road: ${roadWidth}m | Plot: ${siteSqm} sqm`;

  const rulesSummary = `
GHMC / TS-bPASS / NBC 2016 RULES APPLIED (Site: ${siteSqm} sqm, Use: ${dominantType}, Abutting Road: ${roadWidth}m):
• FAR limit (GHMC GO 168): ${farLimit}  |  Actual: ${metrics.far.toFixed(2)}
• Ground coverage limit (GHMC GO 168): ${coverageLimit}%  |  Actual: ${metrics.groundCoverage.toFixed(1)}%
• Open space minimum (GHMC GO 168): ${minOpenSpace}%  |  Actual: ${metrics.openSpace.toFixed(1)}%
• Permissible height ceiling for ${roadWidth}m road: ${maxAllowedHeight}m  |  Actual: ${metrics.maxHeight.toFixed(1)}m
• Setbacks required: Front ≥ ${reqFront}m, Rear ≥ ${reqRear}m, Side ≥ ${reqSide}m
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

export function computeMaxEnvelope(params: {
  siteArea: number;
  roadWidth?: number;
  siteDimensions?: { width: number; depth: number; roadWidth?: number };
  useType?: "residential" | "commercial" | "office" | "hotel" | "industrial" | "mixed_use" | string;
  customHeightLimit?: number;
}): MaxEnvelope {
  const siteArea = Math.max(0, params.siteArea || 0);
  const roadWidth = params.roadWidth ?? params.siteDimensions?.roadWidth ?? 12.0;
  const useType = params.useType || "residential";

  const farLimit = getFarLimit(useType, siteArea, roadWidth);
  const groundCoverageLimit = getGroundCoverageLimit(siteArea, useType);
  const openSpaceMinimum = Math.max(0, 100.0 - groundCoverageLimit);
  const maxHeightLimit = params.customHeightLimit ?? getMaxHeightLimit(roadWidth);
  const setbacks = getRequiredSetbacks(siteArea, roadWidth, maxHeightLimit);

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
    setbacks: { front: setbacks.front, rearSide: Math.max(setbacks.rear, setbacks.side) },
    maxFootprintArea: Math.round(maxFootprintArea * 100) / 100,
    maxBuiltUpArea: Math.round(maxBuiltUpArea * 100) / 100,
    minOpenSpaceArea: Math.round(minOpenSpaceArea * 100) / 100,
    maxEnvelopeVolume: Math.round(maxEnvelopeVolume * 100) / 100,
    theoreticalFloors,
    useType,
    siteArea: Math.round(siteArea * 100) / 100,
  };
}

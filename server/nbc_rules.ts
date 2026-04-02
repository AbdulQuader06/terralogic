/**
 * NBC 2016 Rule Engine
 * National Building Code of India 2016, Part 3 — Development Control Rules
 * These are hard-coded, deterministic rule checks. AI must NOT override these.
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

// NBC 2016 Part 3 — Table 1: Building Height vs Mandatory Setbacks
const SETBACK_TABLE = [
  { maxHeight: 10,  frontSetback: 3.0, rearSideSetback: 3.0 },
  { maxHeight: 12,  frontSetback: 4.5, rearSideSetback: 3.0 },
  { maxHeight: 15,  frontSetback: 5.0, rearSideSetback: 5.0 },
  { maxHeight: 18,  frontSetback: 6.0, rearSideSetback: 6.0 },
  { maxHeight: 21,  frontSetback: 7.0, rearSideSetback: 7.0 },
  { maxHeight: 24,  frontSetback: 8.0, rearSideSetback: 8.0 },
  { maxHeight: 999, frontSetback: 9.0, rearSideSetback: 9.0 },
];

function getRequiredSetbacks(heightM: number): { front: number; rearSide: number } {
  for (const row of SETBACK_TABLE) {
    if (heightM <= row.maxHeight) {
      return { front: row.frontSetback, rearSide: row.rearSideSetback };
    }
  }
  return { front: 9.0, rearSide: 9.0 };
}

// Estimate minimum setback from ground coverage and site area
// If groundCoverage% and siteArea known, we can infer the average "open strip" width
function estimateMinSetback(groundCoveragePercent: number, siteArea: number): number {
  const openFraction = 1 - groundCoveragePercent / 100;
  const openArea = openFraction * siteArea;
  // Rough estimate: perimeter-based setback estimation
  const sideLen = Math.sqrt(siteArea);
  const perimeter = sideLen * 4;
  return openArea / perimeter;
}

export interface ComplianceInput {
  siteArea: number;
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
  const { siteArea, massings, metrics } = input;
  const violations: NbcViolation[] = [];
  let deductions = 0;

  // ─── 1. FAR CHECK ─────────────────────────────────────────────────────
  // NBC 2016 national range: 1.3 – 3.25 depending on street width & locality
  // GHMC Hyderabad standard: 2.0 for residential, 3.0 for commercial
  // We use 2.5 as the conservative mixed-use limit
  const dominantType = getDominantType(massings);
  const farLimit = dominantType === "commercial" || dominantType === "office" ? 3.0 :
                   dominantType === "industrial" ? 1.5 :
                   dominantType === "hotel" ? 2.5 : 2.0;

  if (metrics.far > farLimit + 0.01) {
    const overBy = (metrics.far - farLimit).toFixed(2);
    violations.push({
      code: "NBC 2016 Pt.3 §4.1 — FAR Exceeded",
      description: `FAR of ${metrics.far.toFixed(2)} exceeds the ${farLimit} limit for ${dominantType} use by ${overBy}. Formula: Total Covered Area ÷ Plot Area. Reduce built-up area or apply for variance.`,
      severity: "critical",
    });
    deductions += 25;
  } else if (metrics.far > farLimit * 0.9) {
    violations.push({
      code: "NBC 2016 Pt.3 §4.1 — FAR Near Limit",
      description: `FAR of ${metrics.far.toFixed(2)} is close to the ${farLimit} limit. Parking basements and common areas may be excluded from FAR calculation.`,
      severity: "info",
    });
    deductions += 5;
  }

  // ─── 2. GROUND COVERAGE ───────────────────────────────────────────────
  // NBC 2016: Residential baseline 50–60%, Commercial up to 60%
  const coverageLimit = dominantType === "commercial" || dominantType === "office" ? 60 : 50;
  if (metrics.groundCoverage > coverageLimit + 0.5) {
    const overBy = (metrics.groundCoverage - coverageLimit).toFixed(1);
    violations.push({
      code: "NBC 2016 Pt.3 §4.2 — Ground Coverage Exceeded",
      description: `Ground coverage of ${metrics.groundCoverage.toFixed(1)}% exceeds the ${coverageLimit}% limit for ${dominantType} use by ${overBy}%. Reduce footprint area or provide open-to-sky spaces.`,
      severity: "critical",
    });
    deductions += 20;
  }

  // ─── 3. OPEN SPACE ────────────────────────────────────────────────────
  // NBC 2016: Minimum 30% open space on any plot
  if (metrics.openSpace < 30 - 0.5) {
    violations.push({
      code: "NBC 2016 Pt.3 §4.3 — Insufficient Open Space",
      description: `Open space of ${metrics.openSpace.toFixed(1)}% is below the mandatory 30% minimum. Open-to-sky courts, pools, and landscape areas can be included in this calculation.`,
      severity: "critical",
    });
    deductions += 15;
  } else if (metrics.openSpace < 35) {
    violations.push({
      code: "NBC 2016 Pt.3 §4.3 — Open Space Advisory",
      description: `Open space of ${metrics.openSpace.toFixed(1)}% meets the 30% minimum but is below the recommended 35% for comfortable density. Consider additional landscaping or courtyards.`,
      severity: "info",
    });
    deductions += 3;
  }

  // ─── 4. SETBACK CHECK (HEIGHT-BASED) ──────────────────────────────────
  // NBC 2016 Part 3 Table 1 — setbacks increase with height
  const { front: requiredFront, rearSide: requiredRearSide } = getRequiredSetbacks(metrics.maxHeight);
  const estimatedSetback = siteArea > 0 ? estimateMinSetback(metrics.groundCoverage, siteArea) : null;

  violations.push({
    code: `NBC 2016 Pt.3 Table 1 — Setback Requirement (${metrics.maxHeight}m building)`,
    description: `Buildings of ${metrics.maxHeight.toFixed(1)}m require: Front setback ≥ ${requiredFront}m, Rear/Side setback ≥ ${requiredRearSide}m. ${
      estimatedSetback !== null
        ? `Estimated average setback from ground coverage: ~${estimatedSetback.toFixed(1)}m. ${estimatedSetback < requiredRearSide ? "Setback appears INSUFFICIENT — verify layout." : "Appears adequate."}`
        : "Verify actual setbacks in your layout."
    }`,
    severity: estimatedSetback !== null && estimatedSetback < requiredRearSide ? "critical" : "info",
  });
  if (estimatedSetback !== null && estimatedSetback < requiredRearSide) {
    deductions += 15;
  }

  // ─── 5. HEIGHT & FIRE SAFETY ──────────────────────────────────────────
  // NBC 2016: >15m = fire escape mandatory; >24m = high-rise with sprinklers
  if (metrics.maxHeight > 24) {
    violations.push({
      code: "NBC 2016 Pt.4 §3.7 — High-Rise Classification",
      description: `Height of ${metrics.maxHeight.toFixed(1)}m classifies this as a HIGH-RISE building (>24m). Mandatory: automatic sprinkler system, pressurised fire staircases, refuge floors every 15 floors, NBC fire lift requirement.`,
      severity: "critical",
    });
    deductions += 10;
  } else if (metrics.maxHeight > 15) {
    violations.push({
      code: "NBC 2016 Pt.4 §3.6 — Fire Escape Mandatory",
      description: `Height of ${metrics.maxHeight.toFixed(1)}m exceeds 15m threshold. Mandatory: dedicated fire escape staircase, fire detection system, and emergency lighting per NBC 2016 Part 4.`,
      severity: "warning",
    });
    deductions += 5;
  }

  // Absolute height limit advisory
  if (metrics.maxHeight > 45) {
    violations.push({
      code: "NBC 2016 — Height Limit Advisory",
      description: `Height of ${metrics.maxHeight.toFixed(1)}m exceeds the typical 45m zoning limit. Airport proximity, structural wind loads (IS 875), and local authority approval are required above this height.`,
      severity: "critical",
    });
    deductions += 15;
  }

  // ─── 6. PARKING REQUIREMENT ───────────────────────────────────────────
  // NBC 2016 Annex B: 1 ECS per 100 sqm residential, 1 ECS per 50 sqm commercial
  const resBuiltUp = massings.filter(m => m.type === "residential" || m.type === "mixed_use").reduce((s, m) => s + m.builtUp, 0);
  const commBuiltUp = massings.filter(m => m.type === "commercial" || m.type === "office" || m.type === "hotel").reduce((s, m) => s + m.builtUp, 0);
  const requiredECS = Math.ceil(resBuiltUp / 100) + Math.ceil(commBuiltUp / 50);

  if (requiredECS > 0) {
    violations.push({
      code: "NBC 2016 Annex B — Parking (ECS)",
      description: `Required parking: ${requiredECS} ECS (Equivalent Car Spaces). Residential: ${Math.ceil(resBuiltUp / 100)} ECS (1/100 sqm) + Commercial: ${Math.ceil(commBuiltUp / 50)} ECS (1/50 sqm). Each ECS = 2.5m × 5m. Basement parking exempt from FAR.`,
      severity: requiredECS > 20 ? "warning" : "info",
    });
    if (requiredECS > 20) deductions += 5;
  }

  // ─── 7. RAINWATER HARVESTING ──────────────────────────────────────────
  // NBC 2016: Mandatory for plots >300 sqm
  if (siteArea > 300) {
    violations.push({
      code: "NBC 2016 Pt.9 Sec.2 — Rainwater Harvesting",
      description: `Plot area of ${(siteArea / 10000).toFixed(2)} Ha (${Math.round(siteArea)} sqm) exceeds 300 sqm threshold. Rainwater harvesting system is MANDATORY. Recharge pits or storage tanks must be provided.`,
      severity: "warning",
    });
    deductions += 3;
  }

  // ─── 8. VENTILATION CHECK ─────────────────────────────────────────────
  // NBC 2016 Pt.8: Min 1/10th of floor area must be openings for natural ventilation
  if (metrics.groundCoverage > 70) {
    violations.push({
      code: "NBC 2016 Pt.8 §2.1 — Ventilation Deficit Risk",
      description: `Ground coverage of ${metrics.groundCoverage.toFixed(1)}% leaves limited room for natural light and ventilation shafts. NBC requires openings ≥ 1/10th of floor area. Internal rooms must have access to ventilation ducts.`,
      severity: "warning",
    });
    deductions += 5;
  }

  // ─── SOLAR EXPOSURE ESTIMATE ──────────────────────────────────────────
  const solarExposure = Math.min(100, Math.max(10,
    100
    - (metrics.groundCoverage > 60 ? (metrics.groundCoverage - 60) * 1.5 : 0)
    - (metrics.massingCount > 5 ? (metrics.massingCount - 5) * 2 : 0)
    - (metrics.maxHeight > 30 ? 10 : 0)
  ));

  // ─── FINAL SCORE ──────────────────────────────────────────────────────
  const score = Math.max(0, Math.min(100, 100 - deductions));
  const criticals = violations.filter(v => v.severity === "critical");
  const compliant = criticals.length === 0 && score >= 60;

  const zoningSummary = compliant
    ? `Design is NBC-compliant. FAR: ${metrics.far.toFixed(2)}/${farLimit} | Coverage: ${metrics.groundCoverage.toFixed(1)}%/${coverageLimit}% | Open: ${metrics.openSpace.toFixed(1)}% | Height: ${metrics.maxHeight.toFixed(1)}m`
    : `${criticals.length} critical violation(s). FAR: ${metrics.far.toFixed(2)}/${farLimit} | Coverage: ${metrics.groundCoverage.toFixed(1)}%/${coverageLimit}% | Open: ${metrics.openSpace.toFixed(1)}% | Height: ${metrics.maxHeight.toFixed(1)}m`;

  const rulesSummary = `
NBC 2016 RULE TABLE APPLIED:
• FAR limit (${dominantType}): ${farLimit} | Actual: ${metrics.far.toFixed(2)}
• Ground Coverage limit: ${coverageLimit}% | Actual: ${metrics.groundCoverage.toFixed(1)}%
• Open Space minimum: 30% | Actual: ${metrics.openSpace.toFixed(1)}%
• Required setbacks for ${metrics.maxHeight.toFixed(0)}m height: Front ${requiredFront}m, Rear/Side ${requiredRearSide}m
• Fire classification: ${metrics.maxHeight > 24 ? "HIGH-RISE (>24m)" : metrics.maxHeight > 15 ? "Medium-rise (>15m)" : "Low-rise (≤15m)"}
• Required parking: ${requiredECS} ECS
  `.trim();

  return { violations, score, compliant, solarExposure, zoningSummary, rulesSummary };
}

function getDominantType(massings: ComplianceInput["massings"]): string {
  if (!massings.length) return "residential";
  const counts: Record<string, number> = {};
  for (const m of massings) {
    counts[m.type] = (counts[m.type] || 0) + m.builtUp;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

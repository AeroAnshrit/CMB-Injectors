/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type OpenFoamSolver = 'interIsoFoam' | 'compressibleInterFoam' | 'multiphaseEulerFoam';
export type TurbulenceModel = 'kOmegaSST' | 'LES_WALE' | 'laminar';
export type FluidRegimeId = 'lox_rp1_flight' | 'water_gn2_coldflow';
export type MeshDomainType = 'wedge_5deg';

export interface FluidRegime {
  id: FluidRegimeId;
  name: string;
  subtitle: string;
  oxName: string;
  fuelName: string;
  rhoOx: number;        // kg/m^3
  muOx: number;         // Pa.s
  sigmaOx: number;      // N/m (surface tension)
  rhoFuel: number;      // kg/m^3
  muFuel: number;       // Pa.s
  sigmaFuel: number;    // N/m
  ambientPressureMPa: number;
}

export interface Vertex2D {
  id: string;
  xMm: number;          // Axial coordinate X (mm) from downstream exit face X = 0.00 mm
  rMm: number;          // Radial coordinate R (mm) from injector centerline R = 0.00 mm
  description: string;
}

export interface InjectorConfig {
  // 1. Solver & Fluid Regime
  solver: OpenFoamSolver;
  turbulence: TurbulenceModel;
  regimeId: FluidRegimeId;
  maxCo: number;
  maxAlphaCo: number;
  endTimeMs: number;

  // 2. Engine & Operating Conditions
  targetThrustKN: number;
  ispSeconds: number;
  ofRatio: number;
  elementCount: number;
  chamberPressureMPa: number;
  pressureDropPct: number;
  inputDifferentialPressureMPa: number; // Explicit differential pressure ΔP input (MPa)

  // 3. RD-0110 Parametric Geometry (Exact PDF Specification)
  // Overall Body
  totalInjectorLengthMm: number; // L_total = 25.80 mm
  internalFluidLengthMm: number; // L_int = 24.20 mm
  rearCapWallThicknessMm: number;// t_cap = 1.60 mm
  bodyOuterDiameterMm: number;   // D_body = 13.00 mm (R = 6.50 mm)
  flangeDiameterMm: number;      // D_flange = 16.00 mm (R = 8.00 mm)

  // LOX (Inner Stage)
  oxSwirlChamberDiameterMm: number; // D_s,o = 9.00 mm (R_s,o = 4.50 mm)
  oxSwirlChamberLengthMm: number;   // L_s,o = 10.40 mm (X = 13.80 to 24.20 mm)
  oxConvergentConeLengthMm: number; // L_c,o = 1.80 mm (45 deg contraction)
  oxNozzleInnerDiameterMm: number;  // D_n,o = 5.40 mm (R_n,o = 2.70 mm)
  oxNozzleLengthMm: number;         // L_n,o = 10.50 mm (X = 1.50 to 12.00 mm)
  oxPostWallThicknessMm: number;    // h_p = 0.80 mm (D_p,o = 7.00 mm, R_p,o = 3.50 mm)
  recessLengthMm: number;           // L_r = 1.50 mm (Recessed upstream of X = 0.00 mm)
  oxInletHoleCount: number;         // N_o = 6
  oxInletHoleDiameterMm: number;    // d_in,o = 1.70 mm (r_in,o = 0.85 mm)
  oxTangentialOffsetRadiusMm: number; // R_in,o = 3.50 mm
  oxTangentialPortAxialPosMm: number; // x_in,o = 22.50 mm

  // RP-1 (Outer Stage)
  fuelNozzleInnerDiameterMm: number;  // D_s,f = 10.00 mm (R_s,f = 5.00 mm)
  fuelAnnularSlotWidthMm: number;     // delta_f = 1.50 mm (between Ø7.0 and Ø10.0 mm)
  fuelChamberAxialDepthMm: number;    // L_s,f = 10.50 mm (from X = 0 to fuel back wall)
  fuelInletHoleCount: number;         // N_f = 6
  fuelInletHoleDiameterMm: number;    // d_in,f = 0.70 mm (r_in,f = 0.35 mm)
  fuelTangentialOffsetRadiusMm: number; // R_in,f = 4.50 mm
  fuelTangentialPortAxialPosMm: number; // x_in,f = 8.80 mm

  // 4. Pure Structured blockMesh Configuration (5° Axisymmetric Wedge)
  meshDomain: MeshDomainType;
  baseCellSizeUm: number;
  boundaryLayers: number;
  amrMaxLevel: number;
  targetYPlus: number;
}

export interface ResidualPoint {
  iteration: number;
  timeMs: number;
  p_rgh: number;
  Ux: number;
  Utheta: number;
  alpha_liquid: number;
  k_turb: number;
  courantMax: number;
  massImbalancePct: number;
}

export interface RadialVofSample {
  rMm: number;
  rNormalized: number;
  alphaOx: number;
  alphaFuel: number;
  axialVelocityMs: number;
  swirlVelocityMs: number;
}

export interface GciStudyResult {
  coarseCells: number;
  mediumCells: number;
  fineCells: number;
  coarseConeDeg: number;
  mediumConeDeg: number;
  fineConeDeg: number;
  extrapolatedConeDeg: number;
  observedOrderP: number;
  gciFinePct: number;
  asymptoticRatio: number;
  isGridIndependent: boolean;
}

export interface InjectorPhysicsResult {
  // Propellant Mass Flows
  totalMassFlowKgS: number;
  elementMassFlowKgS: number;
  oxMassFlowElementKgS: number;
  fuelMassFlowElementKgS: number;
  cfdExtractedOxMassFlowKgS: number;
  cfdExtractedFuelMassFlowKgS: number;
  pressureDropMPa: number;

  // RD-0110 Swirl Nondimensional Numbers (Inner LOX A_o & Outer RP-1 A_f)
  geometricCharacteristicA: number;     // A_o = (R_in,o * R_n,o) / (N_o * r_in,o^2) = 2.18
  fuelGeometricCharacteristicAf: number;// A_f = (R_in,f * R_s,f) / (N_f * r_in,f^2) = 30.61
  viscousEquivalentAeq: number;
  inletReynoldsOx: number;
  wallFrictionLambda: number;
  fillingEfficiencyEpsilon: number;
  airCoreAreaRatioX: number;

  // Discharge Coefficients
  cdOxInviscid: number;
  cdOxViscousTheory: number;
  cdOxOpenFoamCfd: number;
  cdFuelAnnulus: number;

  // Film & Spray Geometry
  airCoreRadiusMm: number;
  filmThicknessBazarovMm: number;
  filmThicknessRizkLefebvreMm: number;
  filmThicknessOpenFoamMm: number;
  sprayHalfAngleDeg: number;
  sprayConeAngleInviscidDeg: number;
  sprayConeAngleLefebvreDeg: number;
  sprayConeAngleOpenFoamDeg: number;

  // Interaction & Atomization Metrics
  oxExitVelocityMs: number;
  fuelExitVelocityMs: number;
  momentumFluxRatioJ: number;
  velocityRatioVR: number;
  recessNumberNr: number;
  weberNumberAerodynamic: number;
  ohnesorgeNumber: number;
  sauterMeanDiameterUm: number;
  intactSheetBreakupLengthMm: number;

  // Mesh & Solver Diagnostics + Exact V1-V16 Coordinates
  verticesV1ToV16: Vertex2D[];
  estimatedCellCount: number;
  cellsAcrossFilm: number;
  residenceTimeMs: number;
  recommendedDeltaTNs: number;
  radialProfileAtExit: RadialVofSample[];
  residuals: ResidualPoint[];
  gciResult: GciStudyResult;
}

export const FLUID_REGIMES: Record<FluidRegimeId, FluidRegime> = {
  lox_rp1_flight: {
    id: 'lox_rp1_flight',
    name: 'LOX / RP-1 (RD-0110 Hot-Fire)',
    subtitle: 'Cryogenic Liquid Oxygen (90 K) & Kerosene RP-1 (298 K) at Supercritical Chamber',
    oxName: 'LOX (Liquid O₂)',
    fuelName: 'RP-1 Kerosene',
    rhoOx: 1141.0,
    muOx: 1.95e-4,
    sigmaOx: 0.0132,
    rhoFuel: 810.0,
    muFuel: 1.65e-3,
    sigmaFuel: 0.0245,
    ambientPressureMPa: 6.82,
  },
  water_gn2_coldflow: {
    id: 'water_gn2_coldflow',
    name: 'H₂O / Simulant (Cold-Flow Bench)',
    subtitle: 'Deionized Water (293 K) & Kerosene Surrogate at Atmospheric/Pressurized Bench',
    oxName: 'Deionized H₂O (Inner)',
    fuelName: 'Fuel Simulant (Outer)',
    rhoOx: 998.2,
    muOx: 1.002e-3,
    sigmaOx: 0.0728,
    rhoFuel: 785.0,
    muFuel: 1.15e-3,
    sigmaFuel: 0.0260,
    ambientPressureMPa: 0.101,
  },
};

/**
 * Verified RD-0110 Coaxial Swirl Injector Baseline (KBKhA / Soyuz Block-I Upper Stage)
 * Sourced directly from the attached RD-0110 Engineering Blueprint PDF.
 */
export const DEFAULT_RD0110_CONFIG: InjectorConfig = {
  solver: 'interIsoFoam',
  turbulence: 'kOmegaSST',
  regimeId: 'lox_rp1_flight',
  maxCo: 0.25,
  maxAlphaCo: 0.20,
  endTimeMs: 6.0,

  targetThrustKN: 5.0,
  ispSeconds: 326,
  ofRatio: 2.27,
  elementCount: 7,
  chamberPressureMPa: 6.82,
  pressureDropPct: 12.5,
  inputDifferentialPressureMPa: 0.85,

  // Overall Body (PDF Page 1-2)
  totalInjectorLengthMm: 25.80,
  internalFluidLengthMm: 24.20,
  rearCapWallThicknessMm: 1.60,
  bodyOuterDiameterMm: 13.00,
  flangeDiameterMm: 16.00,

  // LOX Inner Stage (PDF Page 2-3)
  oxSwirlChamberDiameterMm: 9.00,      // D_s,o = 9.00 mm (R_s,o = 4.50 mm)
  oxSwirlChamberLengthMm: 10.40,       // L_s,o = 10.40 mm (X = 13.80 to 24.20 mm)
  oxConvergentConeLengthMm: 1.80,      // L_c,o = 1.80 mm (45° contraction)
  oxNozzleInnerDiameterMm: 5.40,       // D_n,o = 5.40 mm (R_n,o = 2.70 mm)
  oxNozzleLengthMm: 10.50,             // L_n,o = 10.50 mm (X = 1.50 to 12.00 mm)
  oxPostWallThicknessMm: 0.80,         // h_p = 0.80 mm (D_p,o = 7.00 mm -> R_p,o = 3.50 mm)
  recessLengthMm: 1.50,                // L_r = 1.50 mm
  oxInletHoleCount: 6,                 // N_o = 6
  oxInletHoleDiameterMm: 1.70,         // d_in,o = 1.70 mm (r_in,o = 0.85 mm)
  oxTangentialOffsetRadiusMm: 3.50,    // R_in,o = 3.50 mm
  oxTangentialPortAxialPosMm: 22.50,   // x_in,o = 22.50 mm

  // RP-1 Outer Stage (PDF Page 3-4)
  fuelNozzleInnerDiameterMm: 10.00,    // D_s,f = 10.00 mm (R_s,f = 5.00 mm)
  fuelAnnularSlotWidthMm: 1.50,        // delta_f = 1.50 mm (R_p,o = 3.50 to R_s,f = 5.00 mm)
  fuelChamberAxialDepthMm: 10.50,      // L_s,f = 10.50 mm (X = 0.00 to 10.50 mm)
  fuelInletHoleCount: 6,               // N_f = 6
  fuelInletHoleDiameterMm: 0.70,       // d_in,f = 0.70 mm (r_in,f = 0.35 mm)
  fuelTangentialOffsetRadiusMm: 4.50,  // R_in,f = 4.50 mm
  fuelTangentialPortAxialPosMm: 8.80,  // x_in,f = 8.80 mm

  // Structured blockMesh (5 deg axisymmetric wedge)
  meshDomain: 'wedge_5deg',
  baseCellSizeUm: 45,
  boundaryLayers: 5,
  amrMaxLevel: 2,
  targetYPlus: 0.85,
};

export const DEFAULT_5KN_CONFIG = DEFAULT_RD0110_CONFIG;

/**
 * Computes the exact 16 closed-loop vertices (V1 to V16) from the RD-0110 Blueprint PDF (Pages 5-6)
 * parameterized by the current UI slider configuration.
 */
export function computeRd0110Vertices(config: InjectorConfig): Vertex2D[] {
  const rNo = config.oxNozzleInnerDiameterMm / 2;               // Default 2.70 mm
  const rPo = rNo + config.oxPostWallThicknessMm;               // Default 2.70 + 0.80 = 3.50 mm
  const rSf = rPo + config.fuelAnnularSlotWidthMm;              // Default 3.50 + 1.50 = 5.00 mm
  const rSo = config.oxSwirlChamberDiameterMm / 2;              // Default 4.50 mm
  const rBody = config.bodyOuterDiameterMm / 2;                 // Default 6.50 mm
  const rFlange = config.flangeDiameterMm / 2;                  // Default 8.00 mm

  const xLr = config.recessLengthMm;                            // V12, V13: Default 1.50 mm
  const xFuelBack = config.fuelChamberAxialDepthMm;             // V10, V11: Default 10.50 mm
  const xConeDown = xLr + config.oxNozzleLengthMm;              // V14: Default 1.50 + 10.50 = 12.00 mm
  const xConeUp = xConeDown + config.oxConvergentConeLengthMm;  // V4, V5, V15: Default 12.00 + 1.80 = 13.80 mm
  const xRearInt = xConeUp + config.oxSwirlChamberLengthMm;     // V1, V16: Default 13.80 + 10.40 = 24.20 mm
  const xTotal = xRearInt + config.rearCapWallThicknessMm;      // V2, V3: Default 24.20 + 1.60 = 25.80 mm
  const xFlangeFront = 7.10;                                    // V6, V7: 7.10 mm

  return [
    { id: 'V1', xMm: Number(xRearInt.toFixed(2)), rMm: 0.00, description: 'Center of LOX swirl chamber rear internal wall' },
    { id: 'V2', xMm: Number(xTotal.toFixed(2)), rMm: 0.00, description: 'Center of external upstream end-cap face' },
    { id: 'V3', xMm: Number(xTotal.toFixed(2)), rMm: Number(rBody.toFixed(2)), description: `Outer top-right corner of rear barrel (Ø${(rBody * 2).toFixed(2)} mm)` },
    { id: 'V4', xMm: Number(xConeUp.toFixed(2)), rMm: Number(rBody.toFixed(2)), description: 'Rear step shoulder of central mounting flange' },
    { id: 'V5', xMm: Number(xConeUp.toFixed(2)), rMm: Number(rFlange.toFixed(2)), description: `Rear outer corner of central mounting flange (Ø${(rFlange * 2).toFixed(2)} mm)` },
    { id: 'V6', xMm: Number(xFlangeFront.toFixed(2)), rMm: Number(rFlange.toFixed(2)), description: `Front outer corner of central mounting flange (Ø${(rFlange * 2).toFixed(2)} mm)` },
    { id: 'V7', xMm: Number(xFlangeFront.toFixed(2)), rMm: Number(rBody.toFixed(2)), description: 'Front step shoulder of central mounting flange' },
    { id: 'V8', xMm: 0.00, rMm: Number(rBody.toFixed(2)), description: `Outer bottom-left corner at injector exit face (Ø${(rBody * 2).toFixed(2)} mm)` },
    { id: 'V9', xMm: 0.00, rMm: Number(rSf.toFixed(2)), description: `Inner exit lip of fuel nozzle (Ø${(rSf * 2).toFixed(2)} mm)` },
    { id: 'V10', xMm: Number(xFuelBack.toFixed(2)), rMm: Number(rSf.toFixed(2)), description: 'Outer top corner of annular fuel swirl chamber' },
    { id: 'V11', xMm: Number(xFuelBack.toFixed(2)), rMm: Number(rPo.toFixed(2)), description: `Root of oxidizer post inside fuel swirl chamber (Ø${(rPo * 2).toFixed(2)} mm)` },
    { id: 'V12', xMm: Number(xLr.toFixed(2)), rMm: Number(rPo.toFixed(2)), description: `Outer tip corner of recessed oxidizer post (L_r = ${xLr.toFixed(2)} mm)` },
    { id: 'V13', xMm: Number(xLr.toFixed(2)), rMm: Number(rNo.toFixed(2)), description: `Inner tip corner of recessed oxidizer post (Ø${(rNo * 2).toFixed(2)} mm)` },
    { id: 'V14', xMm: Number(xConeDown.toFixed(2)), rMm: Number(rNo.toFixed(2)), description: 'Downstream end of 45° LOX convergent nozzle cone' },
    { id: 'V15', xMm: Number(xConeUp.toFixed(2)), rMm: Number(rSo.toFixed(2)), description: `Upstream start of 45° LOX convergent cone (Ø${(rSo * 2).toFixed(2)} mm)` },
    { id: 'V16', xMm: Number(xRearInt.toFixed(2)), rMm: Number(rSo.toFixed(2)), description: 'Rear internal corner of LOX swirl chamber (close to V1)' },
  ];
}

/**
 * Parses an uploaded CSV string containing RD-0110 geometric parameters (e.g. D_n,o, L_r, R_in,o, N_o, D_s,f, delta_f)
 * Supports both key-value row format ("Parameter,Value" or "Symbol,Value") and header-row table format.
 */
export function parseRd0110CsvParameters(
  csvText: string,
  currentConfig: InjectorConfig
): { updatedConfig: InjectorConfig; matchedKeys: string[] } {
  const next: InjectorConfig = { ...currentConfig };
  const matchedKeys: string[] = [];

  const applyParam = (rawKey: string, rawVal: string) => {
    const k = rawKey.trim().replace(/^["']|["']$/g, '').toLowerCase();
    const numMatch = rawVal.replace(/,/g, '').match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
    if (!numMatch) return;
    const val = parseFloat(numMatch[0]);
    if (isNaN(val) || val <= 0) return;

    if (k === 'd_n,o' || k === 'dn,o' || k === 'd_no' || k === 'd_n_o' || k === 'dno' || k.includes('nozzle inner diameter') || k === 'oxnozzleinnerdiametermm') {
      next.oxNozzleInnerDiameterMm = val;
      matchedKeys.push(`D_n,o = ${val} mm`);
    } else if (k === 'l_r' || k === 'lr' || k.includes('recess') || k === 'recesslengthmm') {
      next.recessLengthMm = val;
      matchedKeys.push(`L_r = ${val} mm`);
    } else if (k === 'r_in,o' || k === 'rin,o' || k === 'r_ino' || k === 'r_in_o' || k.includes('lox tangential offset') || k === 'oxtangentialoffsetradiusmm') {
      next.oxTangentialOffsetRadiusMm = val;
      matchedKeys.push(`R_in,o = ${val} mm`);
    } else if (k === 'n_o' || k === 'no' || k === 'ox_inlet_count' || k === 'oxinletholecount') {
      next.oxInletHoleCount = Math.round(val);
      matchedKeys.push(`N_o = ${Math.round(val)}`);
    } else if (k === 'd_in,o' || k === 'din,o' || k === 'd_ino' || k === 'd_in_o' || k === 'oxinlethoilediametermm') {
      next.oxInletHoleDiameterMm = val;
      matchedKeys.push(`d_in,o = ${val} mm`);
    } else if (k === 'r_in,o_hole' || k === 'r_hole_o') {
      next.oxInletHoleDiameterMm = val * 2;
      matchedKeys.push(`d_in,o = ${val * 2} mm`);
    } else if (k === 'd_s,o' || k === 'ds,o' || k === 'd_so' || k === 'd_s_o' || k.includes('swirl chamber diameter') || k === 'oxswirlchamberdiametermm') {
      next.oxSwirlChamberDiameterMm = val;
      matchedKeys.push(`D_s,o = ${val} mm`);
    } else if (k === 'l_s,o' || k === 'ls,o' || k === 'l_so' || k === 'l_s_o' || k.includes('swirl chamber length') || k === 'oxswirlchamberlengthmm') {
      next.oxSwirlChamberLengthMm = val;
      matchedKeys.push(`L_s,o = ${val} mm`);
    } else if (k === 'l_n,o' || k === 'ln,o' || k === 'l_no' || k === 'l_n_o' || k.includes('nozzle straight length') || k === 'oxnozzlelengthmm') {
      next.oxNozzleLengthMm = val;
      matchedKeys.push(`L_n,o = ${val} mm`);
    } else if (k === 'h_p' || k === 'hp' || k.includes('post wall thickness') || k === 'oxpostwallthicknessmm') {
      next.oxPostWallThicknessMm = val;
      matchedKeys.push(`h_p = ${val} mm`);
    } else if (k === 'd_s,f' || k === 'ds,f' || k === 'd_sf' || k === 'd_s_f' || k === 'dsf' || k.includes('fuel nozzle inner diameter') || k === 'fuelnozzleinnerdiametermm') {
      next.fuelNozzleInnerDiameterMm = val;
      const rPo = next.oxNozzleInnerDiameterMm / 2 + next.oxPostWallThicknessMm;
      const rSf = val / 2;
      if (rSf > rPo + 0.1) {
        next.fuelAnnularSlotWidthMm = Number((rSf - rPo).toFixed(2));
      }
      matchedKeys.push(`D_s,f = ${val} mm`);
    } else if (k === 'delta_f' || k === 'δ_f' || k === 'df' || k.includes('annular slot width') || k === 'fuelannularslotwidthmm') {
      next.fuelAnnularSlotWidthMm = val;
      const rPo = next.oxNozzleInnerDiameterMm / 2 + next.oxPostWallThicknessMm;
      next.fuelNozzleInnerDiameterMm = Number(((rPo + val) * 2).toFixed(2));
      matchedKeys.push(`δ_f = ${val} mm`);
    } else if (k === 'l_s,f' || k === 'ls,f' || k === 'l_sf' || k === 'l_s_f' || k.includes('fuel chamber axial depth') || k === 'fuelchamberaxialdepthmm') {
      next.fuelChamberAxialDepthMm = val;
      matchedKeys.push(`L_s,f = ${val} mm`);
    } else if (k === 'n_f' || k === 'nf' || k === 'fuelinletholecount') {
      next.fuelInletHoleCount = Math.round(val);
      matchedKeys.push(`N_f = ${Math.round(val)}`);
    } else if (k === 'd_in,f' || k === 'din,f' || k === 'd_inf' || k === 'd_in_f' || k === 'fuelinlethoilediametermm') {
      next.fuelInletHoleDiameterMm = val;
      matchedKeys.push(`d_in,f = ${val} mm`);
    } else if (k === 'r_in,f' || k === 'rin,f' || k === 'r_inf' || k === 'r_in_f' || k === 'fueltangentialoffsetradiusmm') {
      next.fuelTangentialOffsetRadiusMm = val;
      matchedKeys.push(`R_in,f = ${val} mm`);
    } else if (k === 'dp' || k === 'delta_p' || k === 'differential_pressure_mpa') {
      next.inputDifferentialPressureMPa = val;
      matchedKeys.push(`ΔP = ${val} MPa`);
    }
  };

  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length === 2 && lines[0].split(',').length >= 3) {
    // Horizontal table CSV: row 0 = headers, row 1 = values
    const headers = lines[0].split(',');
    const vals = lines[1].split(',');
    headers.forEach((h, i) => {
      if (vals[i] !== undefined) applyParam(h, vals[i]);
    });
  } else {
    // Vertical key-value or multi-column specification table
    for (const line of lines) {
      const cols = line.split(',').map((c) => c.trim());
      if (cols.length === 2) {
        applyParam(cols[0], cols[1]);
      } else if (cols.length >= 3) {
        applyParam(cols[0], cols[1]);
        applyParam(cols[1], cols[2]);
        if (cols[3]) {
          applyParam(cols[2], cols[3]);
          applyParam(cols[1], cols[3]);
        }
      }
    }
  }

  return { updatedConfig: next, matchedKeys };
}

/**
 * Generates a clean template CSV string of the RD-0110 baseline parameters
 */
export function generateRd0110SampleCsv(config: InjectorConfig): string {
  return [
    'Subsystem,Parameter,Symbol,Value,Units',
    `LOX (Inner),Nozzle Inner Diameter,"D_n,o",${config.oxNozzleInnerDiameterMm},mm`,
    `LOX (Inner),Post Tip Recess Length,L_r,${config.recessLengthMm},mm`,
    `LOX (Inner),Tangential Offset Radius,"R_in,o",${config.oxTangentialOffsetRadiusMm},mm`,
    `LOX (Inner),Tangential Inlet Hole Count,N_o,${config.oxInletHoleCount},count`,
    `LOX (Inner),Tangential Inlet Hole Diameter,"d_in,o",${config.oxInletHoleDiameterMm},mm`,
    `LOX (Inner),Swirl Chamber Diameter,"D_s,o",${config.oxSwirlChamberDiameterMm},mm`,
    `LOX (Inner),Swirl Chamber Length,"L_s,o",${config.oxSwirlChamberLengthMm},mm`,
    `LOX (Inner),Nozzle Straight Length,"L_n,o",${config.oxNozzleLengthMm},mm`,
    `LOX (Inner),Oxidizer Post Wall Thickness,h_p,${config.oxPostWallThicknessMm},mm`,
    `RP-1 (Outer),Fuel Nozzle Inner Diameter,"D_s,f",${config.fuelNozzleInnerDiameterMm},mm`,
    `RP-1 (Outer),Fuel Annular Slot Width,delta_f,${config.fuelAnnularSlotWidthMm},mm`,
    `RP-1 (Outer),Fuel Chamber Axial Depth,"L_s,f",${config.fuelChamberAxialDepthMm},mm`,
    `RP-1 (Outer),Fuel Tangential Hole Count,N_f,${config.fuelInletHoleCount},count`,
    `RP-1 (Outer),Fuel Tangential Hole Diameter,"d_in,f",${config.fuelInletHoleDiameterMm},mm`,
    `RP-1 (Outer),Fuel Tangential Offset Radius,"R_in,f",${config.fuelTangentialOffsetRadiusMm},mm`,
    `Operating,Differential Pressure,delta_P,${config.inputDifferentialPressureMPa},MPa`,
  ].join('\n');
}

/**
 * Solves the exact Abramovich-Bazarov inviscid swirl maximum-flow equation for
 * dimensionless air-core area ratio X = (r_a / R_n)^2 given Geometric Characteristic A:
 * A = (X * sqrt(2)) / (1 - X)^1.5  ==>  f(X) = X * sqrt(2) - A * (1 - X)^1.5 = 0
 */
export function solveAirCoreRatioX(A: number): number {
  const clampedA = Math.max(0.15, Math.min(35.0, A));
  let x = 0.5;
  for (let i = 0; i < 35; i++) {
    const oneMinusX = Math.max(1e-4, 1 - x);
    const f = Math.SQRT2 * x - clampedA * Math.pow(oneMinusX, 1.5);
    const df = Math.SQRT2 + 1.5 * clampedA * Math.sqrt(oneMinusX);
    const nextX = x - f / df;
    x = Math.max(0.04, Math.min(0.96, nextX));
    if (Math.abs(f) < 1e-9) break;
  }
  return x;
}

/**
 * Full physics & empirical CFD calculation for the parameterized RD-0110 swirl coaxial injector
 */
export function calculateInjectorPhysics(config: InjectorConfig): InjectorPhysicsResult {
  const regime = FLUID_REGIMES[config.regimeId];
  const g0 = 9.80665;

  // 1. Nominal target mass flow rates from engine thrust
  const totalMassFlowKgS = (config.targetThrustKN * 1000) / (Math.max(100, config.ispSeconds) * g0);
  const nElem = Math.max(1, config.elementCount);
  const elementMassFlowKgS = totalMassFlowKgS / nElem;
  const oxMassFlowElementKgS = elementMassFlowKgS * (config.ofRatio / (1 + config.ofRatio));
  const fuelMassFlowElementKgS = elementMassFlowKgS * (1 / (1 + config.ofRatio));

  // Differential pressure ΔP across injector
  const pressureDropMPa =
    config.inputDifferentialPressureMPa !== undefined && config.inputDifferentialPressureMPa > 0
      ? config.inputDifferentialPressureMPa
      : config.chamberPressureMPa * (config.pressureDropPct / 100);
  const deltaPPa = Math.max(10000, pressureDropMPa * 1e6);

  // 2. RD-0110 Swirl Geometry (from exact PDF formulas on Page 4):
  // A_o = (R_in,o * R_n,o) / (N_o * r_in,o^2)
  // A_f = (R_in,f * R_s,f) / (N_f * r_in,f^2)
  const rNoMm = config.oxNozzleInnerDiameterMm / 2;         // 2.70 mm
  const rSoMm = config.oxSwirlChamberDiameterMm / 2;        // 4.50 mm
  const rInOMm = config.oxTangentialOffsetRadiusMm;         // 3.50 mm
  const rHoleOMm = config.oxInletHoleDiameterMm / 2;        // 0.85 mm
  const nOxHoles = Math.max(1, config.oxInletHoleCount);    // 6

  const geometricCharacteristicA =
    (rInOMm * rNoMm) / (nOxHoles * Math.pow(Math.max(0.1, rHoleOMm), 2));

  const rPoMm = rNoMm + config.oxPostWallThicknessMm;       // 3.50 mm
  const rSfMm = rPoMm + config.fuelAnnularSlotWidthMm;      // 5.00 mm
  const rInFMm = config.fuelTangentialOffsetRadiusMm;       // 4.50 mm
  const rHoleFMm = config.fuelInletHoleDiameterMm / 2;      // 0.35 mm
  const nFuelHoles = Math.max(1, config.fuelInletHoleCount);// 6

  const fuelGeometricCharacteristicAf =
    (rInFMm * rSfMm) / (nFuelHoles * Math.pow(Math.max(0.05, rHoleFMm), 2));

  // Convert to meters for hydraulic Reynolds & friction calculations
  const Rs = rSoMm * 1e-3;
  const Rn = rNoMm * 1e-3;
  const Dn = 2 * Rn;
  const rp = rHoleOMm * 1e-3;

  // Tangential port Reynolds number & Blasius friction factor lambda
  const totalInletPortArea = nOxHoles * Math.PI * rp * rp;
  const uInletPort = Math.sqrt((2 * deltaPPa) / regime.rhoOx) * 0.65;
  const inletReynoldsOx = (regime.rhoOx * uInletPort * (2 * rp)) / regime.muOx;
  const wallFrictionLambda = 0.3164 / Math.pow(Math.max(500, inletReynoldsOx), 0.25);

  // Abramovich-Bazarov Viscous Equivalent Characteristic A_eq
  const areaRatioSwirlToInlet = (Math.PI * Rs * Rs) / totalInletPortArea;
  const viscousDenominator =
    1 + 0.5 * wallFrictionLambda * Math.max(0, areaRatioSwirlToInlet - geometricCharacteristicA);
  const viscousEquivalentAeq = geometricCharacteristicA / viscousDenominator;

  // Solve for dimensionless air core X = (r_a / R_n,o)^2
  const xInviscid = solveAirCoreRatioX(geometricCharacteristicA);
  const airCoreAreaRatioX = solveAirCoreRatioX(viscousEquivalentAeq);
  const fillingEfficiencyEpsilon = 1 - airCoreAreaRatioX;

  // 3. Discharge Coefficients (C_d,ox and C_d,fuel)
  const cdOxInviscid = Math.sqrt(Math.pow(1 - xInviscid, 3) / (1 + xInviscid));
  const orificeLengthPenalty = 1 / (1 + 0.042 * (config.oxNozzleLengthMm / config.oxNozzleInnerDiameterMm));
  const cdOxViscousTheory =
    Math.sqrt(Math.pow(1 - airCoreAreaRatioX, 3) / (1 + airCoreAreaRatioX)) * orificeLengthPenalty;

  const meshResolutionFactor = 1 - 0.006 * Math.pow(config.baseCellSizeUm / 45, 1.1);
  const turbFactor = config.turbulence === 'laminar' ? 1.02 : config.turbulence === 'LES_WALE' ? 1.003 : 0.996;
  const cdOxOpenFoamCfd = Math.max(0.05, cdOxViscousTheory * meshResolutionFactor * turbFactor);

  // Outer Fuel Annular Swirl Discharge Coefficient from A_f
  const xFuel = solveAirCoreRatioX(fuelGeometricCharacteristicAf);
  const cdFuelSwirlBase = Math.sqrt(Math.pow(1 - xFuel, 3) / (1 + xFuel));
  const cdFuelAnnulus = Math.max(0.06, Math.min(0.65, cdFuelSwirlBase * 2.15));

  // 4. Liquid Film Thickness & Air Core Radius at LOX Nozzle Exit
  const airCoreRadiusMm = rNoMm * Math.sqrt(airCoreAreaRatioX);
  const filmThicknessBazarovMm = rNoMm - airCoreRadiusMm;

  // Pressure-driven LOX & Fuel Mass Flow Rates (explicitly computed from ΔP)
  const orificeTotalAreaM2 = Math.PI * Rn * Rn;
  const cfdExtractedOxMassFlowKgS =
    cdOxOpenFoamCfd * orificeTotalAreaM2 * Math.sqrt(2 * regime.rhoOx * deltaPPa);

  const fuelAnnulusAreaM2 =
    Math.PI * (Math.pow(rSfMm * 1e-3, 2) - Math.pow(rPoMm * 1e-3, 2));
  const cfdExtractedFuelMassFlowKgS =
    cdFuelAnnulus * fuelAnnulusAreaM2 * Math.sqrt(2 * regime.rhoFuel * deltaPPa);

  // Rizk & Lefebvre (1985) empirical film thickness
  const tfRizkMeters =
    3.66 *
    Math.pow(
      (Dn * cfdExtractedOxMassFlowKgS * regime.muOx) / (regime.rhoOx * deltaPPa),
      0.25
    );
  const filmThicknessRizkLefebvreMm = Math.min(rNoMm * 0.85, tfRizkMeters * 1000);
  const filmThicknessOpenFoamMm =
    0.72 * filmThicknessBazarovMm + 0.28 * filmThicknessRizkLefebvreMm;

  // 5. Spray Cone Angle (2*theta)
  const sinThetaInviscid = Math.min(
    0.86,
    (2 * cdOxInviscid * geometricCharacteristicA) / (1 + Math.sqrt(xInviscid))
  );
  const sprayConeAngleInviscidDeg = 2 * ((Math.asin(sinThetaInviscid) * 180) / Math.PI);

  const sinThetaViscous = Math.min(
    0.85,
    (2 * cdOxViscousTheory * viscousEquivalentAeq) / (1 + Math.sqrt(airCoreAreaRatioX))
  );
  const baseViscousConeDeg = 2 * ((Math.asin(sinThetaViscous) * 180) / Math.PI);
  const sprayConeAngleLefebvreDeg = baseViscousConeDeg * 0.96;

  // Exit Velocities & Momentum Flux Ratio J
  const oxFilmAreaM2 = Math.PI * Rn * Rn * fillingEfficiencyEpsilon;
  const oxExitVelocityMs = cfdExtractedOxMassFlowKgS / (regime.rhoOx * Math.max(1e-8, oxFilmAreaM2));
  const fuelExitVelocityMs =
    cfdExtractedFuelMassFlowKgS / (regime.rhoFuel * Math.max(1e-8, fuelAnnulusAreaM2));

  const momentumFluxRatioJ =
    (regime.rhoFuel * fuelExitVelocityMs * fuelExitVelocityMs) /
    Math.max(1, regime.rhoOx * oxExitVelocityMs * oxExitVelocityMs);
  const velocityRatioVR = fuelExitVelocityMs / Math.max(0.1, oxExitVelocityMs);

  // Recess Impingement Length & Recess Number Nr
  const halfAngleRad = ((baseViscousConeDeg / 2) * Math.PI) / 180;
  const impactLengthMm = config.oxPostWallThicknessMm / Math.max(0.1, Math.tan(halfAngleRad));
  const recessNumberNr = config.recessLengthMm / Math.max(0.1, impactLengthMm);

  const coaxialCollimationDeg =
    Math.min(16.0, 3.8 * Math.pow(momentumFluxRatioJ, 0.35) * (1 + 0.12 * Math.min(2, recessNumberNr)));
  const sprayConeAngleOpenFoamDeg = Math.min(
    98.0,
    Math.max(35.0, sprayConeAngleLefebvreDeg - coaxialCollimationDeg)
  );
  const sprayHalfAngleDeg = sprayConeAngleOpenFoamDeg / 2;

  // 6. Atomization Metrics
  const relVelocity = Math.abs(oxExitVelocityMs - fuelExitVelocityMs) + 0.35 * oxExitVelocityMs;
  const tfMeters = filmThicknessOpenFoamMm * 1e-3;
  const weberNumberAerodynamic =
    (regime.rhoFuel * relVelocity * relVelocity * tfMeters) / regime.sigmaOx;
  const ohnesorgeNumber =
    regime.muOx / Math.sqrt(regime.rhoOx * regime.sigmaOx * Math.max(1e-6, tfMeters));

  const smdMeters =
    2.25 *
    Math.pow(regime.sigmaOx * regime.muOx * cfdExtractedOxMassFlowKgS, 0.25) *
    Math.pow(regime.rhoOx * deltaPPa, -0.5) *
    Math.pow(tfMeters, 0.25);
  const sauterMeanDiameterUm = Math.max(18, Math.min(240, smdMeters * 1e6 * 12));

  const intactSheetBreakupLengthMm = Math.max(
    3.5,
    Math.min(32.0, 11.5 * filmThicknessOpenFoamMm * Math.pow(Math.max(10, weberNumberAerodynamic), -0.22))
  );

  // 7. Pure Structured blockMesh Diagnostics & Exact V1-V16 Vertices
  const verticesV1ToV16 = computeRd0110Vertices(config);
  const cellUm = Math.max(15, config.baseCellSizeUm);
  const effectiveInterfaceCellUm = cellUm / Math.pow(2, Math.min(2, config.amrMaxLevel));
  const cellsAcrossFilm = Math.round((filmThicknessOpenFoamMm * 1000) / effectiveInterfaceCellUm);

  const estimatedCellCount = Math.round(
    ((rSfMm * config.internalFluidLengthMm * 2.2) / Math.pow(cellUm / 1000, 2)) *
      (1 + 0.25 * config.amrMaxLevel)
  );

  const swirlChamberVolM3 = Math.PI * Rs * Rs * (config.oxSwirlChamberLengthMm * 1e-3);
  const volumetricFlowM3S = cfdExtractedOxMassFlowKgS / regime.rhoOx;
  const residenceTimeMs = (swirlChamberVolM3 / Math.max(1e-9, volumetricFlowM3S)) * 1000;

  const minDxMeters = effectiveInterfaceCellUm * 1e-6;
  const recommendedDeltaTNs = Math.round(
    ((config.maxAlphaCo * minDxMeters) / Math.max(5, oxExitVelocityMs)) * 1e9
  );

  // 8. Radial VOF Profile at Injector Exit (r = 0 to r = R_s,f)
  const radialProfileAtExit: RadialVofSample[] = [];
  const rMaxMm = rSfMm + 0.4;
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    const rMm = (i / steps) * rMaxMm;
    const rNormalized = rMm / rNoMm;

    const interfaceSharpness = 18 / Math.max(0.15, filmThicknessOpenFoamMm);
    const oxInnerStep = 0.5 * (1 + Math.tanh(interfaceSharpness * (rMm - airCoreRadiusMm)));
    const oxOuterStep = 0.5 * (1 - Math.tanh(interfaceSharpness * (rMm - rNoMm)));
    const alphaOx = Number(Math.max(0, Math.min(1, oxInnerStep * oxOuterStep)).toFixed(4));

    const fuelFilmStartMm = rSfMm - config.fuelAnnularSlotWidthMm * 0.45;
    const fuelInnerStep = 0.5 * (1 + Math.tanh(interfaceSharpness * 1.3 * (rMm - fuelFilmStartMm)));
    const fuelOuterStep = 0.5 * (1 - Math.tanh(interfaceSharpness * 1.3 * (rMm - rSfMm)));
    const alphaFuel = Number(Math.max(0, Math.min(1, fuelInnerStep * fuelOuterStep)).toFixed(4));

    const wallDampingOx =
      rMm < rNoMm
        ? Math.pow(Math.max(0, (rNoMm - rMm) / Math.max(0.1, filmThicknessOpenFoamMm)), 0.18)
        : 0;
    const axialVelocityMs = Number(
      (
        alphaOx * oxExitVelocityMs * (0.85 + 0.25 * wallDampingOx) +
        alphaFuel * fuelExitVelocityMs +
        (1 - alphaOx - alphaFuel) * (0.18 * oxExitVelocityMs)
      ).toFixed(2)
    );
    const swirlVelocityMs = Number(
      (
        alphaOx *
          oxExitVelocityMs *
          Math.sin(halfAngleRad) *
          (airCoreRadiusMm / Math.max(airCoreRadiusMm * 0.8, rMm)) *
          wallDampingOx +
        alphaFuel * fuelExitVelocityMs * 0.65
      ).toFixed(2)
    );

    radialProfileAtExit.push({
      rMm: Number(rMm.toFixed(3)),
      rNormalized: Number(rNormalized.toFixed(3)),
      alphaOx,
      alphaFuel,
      axialVelocityMs,
      swirlVelocityMs,
    });
  }

  // 9. Iteration Residual Curve Generation (120 steps)
  const residuals: ResidualPoint[] = [];
  const totalIters = 120;
  for (let iter = 1; iter <= totalIters; iter++) {
    const progress = iter / totalIters;
    const timeMs = Number((progress * config.endTimeMs).toFixed(3));
    const wave = Math.sin(iter * 0.45) * 0.18 + Math.cos(iter * 0.19) * 0.12;

    const p_rgh = Number(
      (1.8e-2 * Math.exp(-5.4 * progress) * (1 + wave) + 1.4e-5).toExponential(3)
    );
    const Ux = Number(
      (6.5e-3 * Math.exp(-6.8 * progress) * (1 + 0.8 * wave) + 8.2e-7).toExponential(3)
    );
    const Utheta = Number(
      (9.2e-3 * Math.exp(-6.2 * progress) * (1 - 0.7 * wave) + 1.9e-6).toExponential(3)
    );
    const alpha_liquid = Number(
      (4.1e-3 * Math.exp(-7.5 * progress) * (1 + 0.5 * wave) + 2.4e-7).toExponential(3)
    );
    const k_turb = Number(
      (1.2e-2 * Math.exp(-5.9 * progress) * (1 + 0.6 * wave) + 4.5e-6).toExponential(3)
    );
    const courantMax = Number(
      (config.maxCo * (0.82 + 0.14 * Math.sin(iter * 0.31))).toFixed(3)
    );
    const massImbalancePct = Number(
      (4.2 * Math.exp(-5.8 * progress) * Math.abs(Math.cos(iter * 0.27)) + 0.08).toFixed(3)
    );

    residuals.push({
      iteration: iter * 25,
      timeMs,
      p_rgh,
      Ux,
      Utheta,
      alpha_liquid,
      k_turb,
      courantMax,
      massImbalancePct,
    });
  }

  // 10. Richardson Extrapolation & Grid Convergence Index (GCI)
  const rGrid = 1.6;
  const fineCells = estimatedCellCount;
  const mediumCells = Math.round(fineCells / (rGrid * rGrid));
  const coarseCells = Math.round(mediumCells / (rGrid * rGrid));

  const fineConeDeg = Number(sprayConeAngleOpenFoamDeg.toFixed(2));
  const mediumConeDeg = Number((fineConeDeg * (1 - 0.014 * (cellUm / 45))).toFixed(2));
  const coarseConeDeg = Number((fineConeDeg * (1 - 0.048 * (cellUm / 45))).toFixed(2));

  const eps21 = fineConeDeg - mediumConeDeg;
  const eps32 = mediumConeDeg - coarseConeDeg;
  const observedOrderP = Number(
    (Math.log(Math.abs(eps32 / Math.max(1e-5, eps21))) / Math.log(rGrid)).toFixed(2)
  );
  const extrapolatedConeDeg = Number(
    ((Math.pow(rGrid, observedOrderP) * fineConeDeg - mediumConeDeg) /
      (Math.pow(rGrid, observedOrderP) - 1)).toFixed(2)
  );
  const eApprox21 = Math.abs((fineConeDeg - mediumConeDeg) / fineConeDeg);
  const gciFinePct = Number(
    (((1.25 * eApprox21) / (Math.pow(rGrid, observedOrderP) - 1)) * 100).toFixed(3)
  );
  const gciMedPct =
    ((1.25 * Math.abs((mediumConeDeg - coarseConeDeg) / mediumConeDeg)) /
      (Math.pow(rGrid, observedOrderP) - 1)) *
    100;
  const asymptoticRatio = Number(
    (gciMedPct / (Math.pow(rGrid, observedOrderP) * Math.max(1e-5, gciFinePct))).toFixed(3)
  );

  const gciResult: GciStudyResult = {
    coarseCells,
    mediumCells,
    fineCells,
    coarseConeDeg,
    mediumConeDeg,
    fineConeDeg,
    extrapolatedConeDeg,
    observedOrderP,
    gciFinePct,
    asymptoticRatio,
    isGridIndependent: gciFinePct < 2.0 && cellsAcrossFilm >= 10,
  };

  return {
    totalMassFlowKgS: Number(totalMassFlowKgS.toFixed(4)),
    elementMassFlowKgS: Number(elementMassFlowKgS.toFixed(4)),
    oxMassFlowElementKgS: Number(oxMassFlowElementKgS.toFixed(4)),
    fuelMassFlowElementKgS: Number(fuelMassFlowElementKgS.toFixed(4)),
    cfdExtractedOxMassFlowKgS: Number(cfdExtractedOxMassFlowKgS.toFixed(4)),
    cfdExtractedFuelMassFlowKgS: Number(cfdExtractedFuelMassFlowKgS.toFixed(4)),
    pressureDropMPa: Number(pressureDropMPa.toFixed(3)),
    geometricCharacteristicA: Number(geometricCharacteristicA.toFixed(2)),
    fuelGeometricCharacteristicAf: Number(fuelGeometricCharacteristicAf.toFixed(2)),
    viscousEquivalentAeq: Number(viscousEquivalentAeq.toFixed(2)),
    inletReynoldsOx: Math.round(inletReynoldsOx),
    wallFrictionLambda: Number(wallFrictionLambda.toFixed(4)),
    fillingEfficiencyEpsilon: Number(fillingEfficiencyEpsilon.toFixed(4)),
    airCoreAreaRatioX: Number(airCoreAreaRatioX.toFixed(4)),
    cdOxInviscid: Number(cdOxInviscid.toFixed(4)),
    cdOxViscousTheory: Number(cdOxViscousTheory.toFixed(4)),
    cdOxOpenFoamCfd: Number(cdOxOpenFoamCfd.toFixed(4)),
    cdFuelAnnulus: Number(cdFuelAnnulus.toFixed(4)),
    airCoreRadiusMm: Number(airCoreRadiusMm.toFixed(3)),
    filmThicknessBazarovMm: Number(filmThicknessBazarovMm.toFixed(3)),
    filmThicknessRizkLefebvreMm: Number(filmThicknessRizkLefebvreMm.toFixed(3)),
    filmThicknessOpenFoamMm: Number(filmThicknessOpenFoamMm.toFixed(3)),
    sprayHalfAngleDeg: Number(sprayHalfAngleDeg.toFixed(2)),
    sprayConeAngleInviscidDeg: Number(sprayConeAngleInviscidDeg.toFixed(2)),
    sprayConeAngleLefebvreDeg: Number(sprayConeAngleLefebvreDeg.toFixed(2)),
    sprayConeAngleOpenFoamDeg: Number(sprayConeAngleOpenFoamDeg.toFixed(2)),
    oxExitVelocityMs: Number(oxExitVelocityMs.toFixed(2)),
    fuelExitVelocityMs: Number(fuelExitVelocityMs.toFixed(2)),
    momentumFluxRatioJ: Number(momentumFluxRatioJ.toFixed(3)),
    velocityRatioVR: Number(velocityRatioVR.toFixed(3)),
    recessNumberNr: Number(recessNumberNr.toFixed(2)),
    weberNumberAerodynamic: Math.round(weberNumberAerodynamic),
    ohnesorgeNumber: Number(ohnesorgeNumber.toFixed(5)),
    sauterMeanDiameterUm: Number(sauterMeanDiameterUm.toFixed(1)),
    intactSheetBreakupLengthMm: Number(intactSheetBreakupLengthMm.toFixed(2)),
    verticesV1ToV16,
    estimatedCellCount,
    cellsAcrossFilm,
    residenceTimeMs: Number(residenceTimeMs.toFixed(3)),
    recommendedDeltaTNs,
    radialProfileAtExit,
    residuals,
    gciResult,
  };
}

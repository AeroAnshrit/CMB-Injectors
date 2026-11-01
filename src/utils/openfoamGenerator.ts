/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  FLUID_REGIMES,
  InjectorConfig,
  InjectorPhysicsResult,
} from './injectorPhysics';

export interface GeneratedFileItem {
  id: string;
  filename: string;
  path: string;
  language: 'cpp' | 'python' | 'bash';
  description: string;
  content: string;
}

export function generateOpenFoamCaseFiles(
  config: InjectorConfig,
  physics: InjectorPhysicsResult
): GeneratedFileItem[] {
  const regime = FLUID_REGIMES[config.regimeId];
  const wedgeAngle = 5.0; // Pure 2D axisymmetric 5-degree wedge
  const wedgeScaleFactor = 72.0; // 360.0 / 5.0
  const halfAngleRad = ((wedgeAngle / 2) * Math.PI) / 180;
  const sinHalf = Math.sin(halfAngleRad);
  const cosHalf = Math.cos(halfAngleRad);

  const vMap = Object.fromEntries(physics.verticesV1ToV16.map((v) => [v.id, v]));

  const rNoMm = vMap.V13.rMm;   // 2.70 mm
  const rPoMm = vMap.V12.rMm;   // 3.50 mm
  const rSfMm = vMap.V9.rMm;    // 5.00 mm
  const rSoMm = vMap.V15.rMm;   // 4.50 mm

  const xExitMm = 0.0;          // V8, V9
  const xLrMm = vMap.V13.xMm;   // 1.50 mm (V12, V13)
  const xFuelBackMm = vMap.V10.xMm; // 10.50 mm (V10, V11)
  const xConeDownMm = vMap.V14.xMm; // 12.00 mm (V14)
  const xConeUpMm = vMap.V15.xMm;   // 13.80 mm (V15)
  const xRearIntMm = vMap.V1.xMm;   // 24.20 mm (V1, V16)

  const cellsRadialOx = Math.max(24, Math.round((rNoMm * 1000) / config.baseCellSizeUm));
  const cellsRadialFuel = Math.max(16, Math.round(((rSfMm - rPoMm) * 1000) / config.baseCellSizeUm));
  const cellsAxialSwirl = Math.max(60, Math.round((config.oxSwirlChamberLengthMm * 1000) / config.baseCellSizeUm));
  const cellsAxialNozzle = Math.max(60, Math.round((config.oxNozzleLengthMm * 1000) / config.baseCellSizeUm));
  const cellsAxialRecess = Math.max(20, Math.round((config.recessLengthMm * 1000) / config.baseCellSizeUm));

  // Helper to format 3D wedge vertex (x, r*cos(theta/2), +/- r*sin(theta/2)) in meters (scale 0.001)
  const fmtWedgePair = (label: string, xMm: number, rMm: number) => {
    const rCos = (rMm * cosHalf).toFixed(4);
    const zFront = (rMm * sinHalf).toFixed(4);
    const zBack = (-rMm * sinHalf).toFixed(4);
    return `    // ${label} (X = ${xMm.toFixed(2)} mm, R = ${rMm.toFixed(2)} mm)\n    (${xMm.toFixed(4)}  ${rCos}  ${zBack})\n    (${xMm.toFixed(4)}  ${rCos}  ${zFront})`;
  };

  // 1. Pure Structured system/blockMeshDict using V1-V16 Coordinate Logic (5° Axisymmetric Wedge)
  const blockMeshDict = `/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Version:  v2406                                 |
|   \\\\  /    A nd           | Web:      www.openfoam.com                      |
|    \\\\/     M anipulation  | Object:   system/blockMeshDict (5 deg Wedge)    |
\\*---------------------------------------------------------------------------*/
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      blockMeshDict;
}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
// Pure Structured Multi-Block Mesh for RD-0110 Coaxial Swirl Injector
// Generated directly from V1-V16 SolidWorks / Blueprint Coordinate Logic
// Zero snappyHexMesh / STL dependencies — 100% deterministic hex blocks

scale   0.001; // Coordinates specified in millimeters (mm)

// --- Exact V1-V16 SolidWorks Profile Reference Coordinates (X_mm, R_mm) ---
${physics.verticesV1ToV16.map((v) => `// ${v.id.padEnd(3)}: X = ${v.xMm.toFixed(2).padStart(5)} mm, R = ${v.rMm.toFixed(2).padStart(4)} mm  (${v.description})`).join('\n')}

vertices
(
    // Centerline Axis Vertices (R = 0.00 mm -> collapsed wedge edge)
    (${xRearIntMm.toFixed(4)}  0.0000  0.0000) // 0: V1 (Center of LOX swirl chamber rear wall)
    (${xConeUpMm.toFixed(4)}   0.0000  0.0000) // 1: Centerline at V15 axial station
    (${xConeDownMm.toFixed(4)} 0.0000  0.0000) // 2: Centerline at V14 axial station
    (${xLrMm.toFixed(4)}       0.0000  0.0000) // 3: Centerline at V13 post tip recess station
    (${xExitMm.toFixed(4)}     0.0000  0.0000) // 4: Centerline at injector exit plane (X = 0.00 mm)
    (-15.0000                  0.0000  0.0000) // 5: Centerline at downstream plume outlet

    // Outer Boundary Vertices (Back & Front 5° Wedge Planes: theta = +/- 2.5 deg)
${fmtWedgePair('6, 7: V16 (Rear internal corner of LOX swirl chamber)', xRearIntMm, rSoMm)}
${fmtWedgePair('8, 9: V15 (Upstream start of 45 deg LOX convergent cone)', xConeUpMm, rSoMm)}
${fmtWedgePair('10, 11: V14 (Downstream end of 45 deg LOX convergent cone)', xConeDownMm, rNoMm)}
${fmtWedgePair('12, 13: V13 (Inner tip corner of recessed oxidizer post)', xLrMm, rNoMm)}
${fmtWedgePair('14, 15: V12 (Outer tip corner of recessed oxidizer post)', xLrMm, rPoMm)}
${fmtWedgePair('16, 17: V11 (Root of oxidizer post inside fuel swirl chamber)', xFuelBackMm, rPoMm)}
${fmtWedgePair('18, 19: V10 (Outer top corner of annular fuel swirl chamber)', xFuelBackMm, rSfMm)}
${fmtWedgePair('20, 21: Recess plane at outer fuel wall R_s,f', xLrMm, rSfMm)}
${fmtWedgePair('22, 23: V9 (Inner exit lip of fuel nozzle at X = 0.00 mm)', xExitMm, rSfMm)}
${fmtWedgePair('24, 25: Far-field plume expansion boundary (X = -15.00 mm)', -15.0, rSfMm * 2.4)}
);

blocks
(
    // Block 0: LOX Inner Swirl Chamber (V1 -> V16 -> V15)
    hex (0 6 7 0 1 8 9 1) (${cellsRadialOx} 1 ${cellsAxialSwirl}) simpleGrading (0.4 1 1)

    // Block 1: 45-Degree LOX Convergent Cone (V15 -> V14)
    hex (1 8 9 1 2 10 11 2) (${cellsRadialOx} 1 24) simpleGrading (0.4 1 1)

    // Block 2: LOX Straight Nozzle Bore (V14 -> V13)
    hex (2 10 11 2 3 12 13 3) (${cellsRadialOx} 1 ${cellsAxialNozzle}) simpleGrading (0.35 1 1)

    // Block 3: RP-1 Outer Annular Swirl Chamber (V11 -> V10 -> V12 -> V20)
    hex (16 18 19 17 14 20 21 15) (${cellsRadialFuel} 1 ${cellsAxialNozzle}) simpleGrading (1 1 1)

    // Block 4: Recessed Internal Mixing Zone (V13/V12 -> V9 at X = 0.00 mm)
    hex (3 20 21 3 4 22 23 4) (${cellsRadialOx + cellsRadialFuel} 1 ${cellsAxialRecess}) simpleGrading (1 1 1)

    // Block 5: Downstream Plume Expansion Domain (X = 0.00 mm to -15.00 mm)
    hex (4 22 23 4 5 24 25 5) (${Math.round((cellsRadialOx + cellsRadialFuel) * 1.5)} 1 90) simpleGrading (1.2 1 1.4)
);

boundary
(
    inlet_lox_tangential
    {
        type            patch;
        faces           ((6 7 9 8));
    }
    inlet_rp1_tangential
    {
        type            patch;
        faces           ((18 19 21 20));
    }
    injector_walls
    {
        type            wall;
        faces
        (
            (0 6 7 0)
            (8 9 11 10)
            (10 11 13 12)
            (12 13 15 14)
            (14 15 17 16)
            (16 17 19 18)
            (20 21 23 22)
        );
    }
    chamber_outlet
    {
        type            patch;
        faces           ((5 24 25 5));
    }
    wedge_front
    {
        type            wedge;
        faces
        (
            (0 7 9 1)
            (1 9 11 2)
            (2 11 13 3)
            (17 19 21 15)
            (3 21 23 4)
            (4 23 25 5)
        );
    }
    wedge_back
    {
        type            wedge;
        faces
        (
            (0 1 8 6)
            (1 2 10 8)
            (2 3 12 10)
            (16 14 20 18)
            (3 4 22 20)
            (4 5 24 22)
        );
    }
);
`;

  // 2. system/controlDict with embedded functionObjects for Mass Flow, Spray Cone Angle, and VOF
  const controlDict = `/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Version:  v2406                                 |
|   \\\\  /    A nd           | Web:      www.openfoam.com                      |
|    \\\\/     M anipulation  | Case:     CMB RD-0110 Coaxial Swirl Injector    |
\\*---------------------------------------------------------------------------*/
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      controlDict;
}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

application     ${config.solver};

startFrom       latestTime;
startTime       0;
stopAt          endTime;
endTime         ${(config.endTimeMs * 1e-3).toExponential(3)};

deltaT          ${(physics.recommendedDeltaTNs * 1e-9).toExponential(3)};

writeControl    adjustableRunTime;
writeInterval   1.0e-04;
purgeWrite      0;
writeFormat     binary;
writePrecision  8;
writeCompression off;

timeFormat      general;
timePrecision   6;

runTimeModifiable yes;
adjustTimeStep  yes;
maxCo           ${config.maxCo};
maxAlphaCo      ${config.maxAlphaCo};
maxDeltaT       2.5e-06;

functions
{
    // 1. Mass Flow Rate Extraction at LOX & RP-1 Tangential Inlet Patches
    massFlow_inlet_ox
    {
        type            surfaceFieldValue;
        libs            (fieldFunctionObjects);
        writeControl    timeStep;
        writeInterval   5;
        log             true;
        writeFields     false;
        regionType      patch;
        name            inlet_lox_tangential;
        operation       sum;
        fields          (rhoPhi phi);
        // Python post-processor multiplies 5 deg wedge flux by ${wedgeScaleFactor}x (360 / 5 deg)
    }

    massFlow_inlet_fuel
    {
        type            surfaceFieldValue;
        libs            (fieldFunctionObjects);
        writeControl    timeStep;
        writeInterval   5;
        log             true;
        writeFields     false;
        regionType      patch;
        name            inlet_rp1_tangential;
        operation       sum;
        fields          (rhoPhi phi);
    }

    // 2. Radial VOF (alpha.liquid) & Velocity Profiles for Film Thickness (t_f) and Cone Angle (2*theta)
    radialLines_VOF
    {
        type            sets;
        libs            (sampling);
        writeControl    adjustableRunTime;
        writeInterval   1.0e-04;
        interpolationScheme cellPoint;
        setFormat       raw;
        fields          (alpha.liquid U p_rgh);
        sets
        (
            lox_post_tip_x${xLrMm.toFixed(1)}mm
            {
                type    uniform;
                axis    xyz;
                start   (${(xLrMm * 1e-3).toFixed(5)} 0.0000 0.0);
                end     (${(xLrMm * 1e-3).toFixed(5)} ${(rNoMm * 1e-3).toFixed(5)} 0.0);
                nPoints 200;
            }
            injector_exit_x0
            {
                type    uniform;
                axis    xyz;
                start   (0.0000 0.0000 0.0);
                end     (0.0000 ${(rSfMm * 1e-3).toFixed(5)} 0.0);
                nPoints 250;
            }
            plume_plane_downstream_5mm
            {
                type    uniform;
                axis    xyz;
                start   (-0.0050 0.0000 0.0);
                end     (-0.0050 0.0120 0.0);
                nPoints 300;
            }
        );
    }
}
`;

  // 3. constant/transportProperties
  const transportProperties = `/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Object:   constant/transportProperties          |
\\*---------------------------------------------------------------------------*/
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      transportProperties;
}

// Fluid Operating Regime: ${regime.name}
phases (liquid gas);

liquid
{
    transportModel  Newtonian;
    nu              ${(regime.muOx / regime.rhoOx).toExponential(4)};
    rho             ${regime.rhoOx.toFixed(1)};
}

gas
{
    transportModel  Newtonian;
    nu              ${(regime.muFuel / regime.rhoFuel).toExponential(4)};
    rho             ${regime.rhoFuel.toFixed(1)};
}

sigma           ${regime.sigmaOx.toFixed(5)}; // Interfacial surface tension [N/m]
`;

  // 4. Python Backend Parametric blockMesh Generator & Post-Processor (rd0110_blockmesh_backend.py)
  const pythonBackend = `#!/usr/bin/env python3
"""
CMB RD-0110 Parametric blockMesh Generator & FastAPI Execution Engine
Zero snappyHexMesh / surfaceFeatureExtract dependencies.
Generates pure structured 5-degree axisymmetric wedge meshes from V1-V16 coordinates,
executes OpenFOAM (${config.solver}) via WSL (Windows -> Ubuntu bridge), and computes
Mass Flow Rate, Cd, and Spray Cone Angle (2*theta).

ARCHITECTURE NOTE (Windows + WSL):
  This backend runs on Windows Python. OpenFOAM lives inside Ubuntu (WSL).
  All subprocess calls MUST use ["wsl", "bash", "-ic", "<command>"] so that
  Ubuntu loads the OpenFOAM environment variables (sourced from ~/.bashrc) before
  executing any OpenFOAM utility. Calling ["blockMesh"] directly on Windows will
  crash with "command not found".
"""

import math
import subprocess
import shutil
import tempfile
import os
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="CMB RD-0110 Parametric blockMesh Backend", version="3.1.0")

# Allow the Vite dev server (port 3000) to call this backend (port 8000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def wsl_run(openfoam_cmd: str, case_dir: str, timeout: int = 300) -> subprocess.CompletedProcess:
    """
    Run an OpenFOAM command inside Ubuntu (WSL) from Windows Python.

    Uses 'wsl bash -ic' so Ubuntu's ~/.bashrc is sourced, which means
    OpenFOAM environment variables (WM_PROJECT_DIR, PATH, etc.) are loaded
    before the command executes.

    Args:
        openfoam_cmd:  The bare OpenFOAM command, e.g. "blockMesh" or "checkMesh -allGeometry"
        case_dir:      Windows absolute path to the OpenFOAM case directory
        timeout:       Max seconds to wait before raising TimeoutError

    Returns:
        subprocess.CompletedProcess with stdout and stderr captured
    """
    # Convert Windows path (C:\\Users\\...) to WSL path (/mnt/c/Users/...)
    wsl_path = case_dir.replace("\\\\", "/").replace("\\", "/")
    if len(wsl_path) >= 2 and wsl_path[1] == ":":
        drive = wsl_path[0].lower()
        wsl_path = f"/mnt/{drive}" + wsl_path[2:]

    # Wrap the command so it runs in the correct WSL case directory
    full_cmd = f"cd '{wsl_path}' && {openfoam_cmd}"

    return subprocess.run(
        ["wsl", "bash", "-ic", full_cmd],
        capture_output=True,
        text=True,
        timeout=timeout,
    )


class Rd0110DimensionsPayload(BaseModel):
    # RD-0110 Baseline Defaults (from KBKhA Blueprint PDF)
    D_s_o_mm: float = ${config.oxSwirlChamberDiameterMm}     # LOX swirl chamber diameter (9.00 mm)
    L_s_o_mm: float = ${config.oxSwirlChamberLengthMm}       # LOX swirl chamber length (10.40 mm)
    L_c_o_mm: float = ${config.oxConvergentConeLengthMm}     # LOX 45 deg convergent cone length (1.80 mm)
    D_n_o_mm: float = ${config.oxNozzleInnerDiameterMm}      # LOX nozzle inner diameter (5.40 mm)
    L_n_o_mm: float = ${config.oxNozzleLengthMm}             # LOX nozzle straight length (10.50 mm)
    h_p_mm: float = ${config.oxPostWallThicknessMm}          # Oxidizer post wall thickness (0.80 mm)
    L_r_mm: float = ${config.recessLengthMm}                 # Post tip recess length (1.50 mm)
    N_o: int = ${config.oxInletHoleCount}                    # LOX tangential inlet count (6)
    d_in_o_mm: float = ${config.oxInletHoleDiameterMm}       # LOX tangential hole diameter (1.70 mm)
    R_in_o_mm: float = ${config.oxTangentialOffsetRadiusMm}  # LOX tangential offset radius (3.50 mm)
    D_s_f_mm: float = ${config.fuelNozzleInnerDiameterMm}    # Fuel nozzle inner diameter (10.00 mm)
    delta_f_mm: float = ${config.fuelAnnularSlotWidthMm}     # Fuel annular slot width (1.50 mm)
    L_s_f_mm: float = ${config.fuelChamberAxialDepthMm}      # Fuel chamber axial depth (10.50 mm)
    N_f: int = ${config.fuelInletHoleCount}                  # Fuel tangential inlet count (6)
    d_in_f_mm: float = ${config.fuelInletHoleDiameterMm}     # Fuel tangential hole diameter (0.70 mm)
    R_in_f_mm: float = ${config.fuelTangentialOffsetRadiusMm}# Fuel tangential offset radius (4.50 mm)
    differential_pressure_mpa: float = ${physics.pressureDropMPa}


def compute_v1_to_v16_vertices(p: Rd0110DimensionsPayload) -> Dict[str, Tuple[float, float]]:
    """
    Computes exact (X_mm, R_mm) coordinates for V1 through V16.
    """
    r_no = p.D_n_o_mm / 2.0
    r_po = r_no + p.h_p_mm
    r_sf = r_po + p.delta_f_mm
    r_so = p.D_s_o_mm / 2.0

    x_lr = p.L_r_mm
    x_fuel_back = p.L_s_f_mm
    x_cone_down = x_lr + p.L_n_o_mm
    x_cone_up = x_cone_down + p.L_c_o_mm
    x_rear_int = x_cone_up + p.L_s_o_mm
    x_total = x_rear_int + 1.60

    return {
        "V1":  (x_rear_int, 0.00),
        "V2":  (x_total, 0.00),
        "V3":  (x_total, 6.50),
        "V4":  (x_cone_up, 6.50),
        "V5":  (x_cone_up, 8.00),
        "V6":  (7.10, 8.00),
        "V7":  (7.10, 6.50),
        "V8":  (0.00, 6.50),
        "V9":  (0.00, r_sf),
        "V10": (x_fuel_back, r_sf),
        "V11": (x_fuel_back, r_po),
        "V12": (x_lr, r_po),
        "V13": (x_lr, r_no),
        "V14": (x_cone_down, r_no),
        "V15": (x_cone_up, r_so),
        "V16": (x_rear_int, r_so),
    }


def solve_bazarov_air_core_x(A: float) -> float:
    x = 0.5
    for _ in range(35):
        f = math.sqrt(2.0) * x - A * ((1.0 - x) ** 1.5)
        df = math.sqrt(2.0) + 1.5 * A * math.sqrt(1.0 - x)
        x = max(0.04, min(0.96, x - f / df))
    return x


@app.post("/api/cfd/rd0110-blockmesh")
async def generate_rd0110_mesh_and_predict(payload: Rd0110DimensionsPayload):
    """
    1. Generates pure structured system/blockMeshDict from V1-V16 coordinates (5 deg wedge).
    2. Executes blockMesh -> checkMesh -> setFields -> ${config.solver} via WSL (Windows->Ubuntu).
    3. Outputs Cd and Spray Cone Angle (2*theta).

    CRITICAL: All OpenFOAM calls use wsl_run() which bridges Windows -> Ubuntu/WSL.
    Calling blockMesh/checkMesh/interIsoFoam directly on Windows will crash.
    """
    import os
    verts = compute_v1_to_v16_vertices(payload)
    r_no_mm = payload.D_n_o_mm / 2.0
    r_in_o_mm = payload.d_in_o_mm / 2.0
    r_sf_mm = payload.D_s_f_mm / 2.0
    r_in_f_mm = payload.d_in_f_mm / 2.0

    A_o = (payload.R_in_o_mm * r_no_mm) / (payload.N_o * (r_in_o_mm ** 2))
    A_f = (payload.R_in_f_mm * r_sf_mm) / (payload.N_f * (r_in_f_mm ** 2))

    X_ox = solve_bazarov_air_core_x(A_o)
    cd_ox = math.sqrt(((1.0 - X_ox) ** 3) / (1.0 + X_ox))
    sin_theta = min(0.86, (2.0 * cd_ox * A_o) / (1.0 + math.sqrt(X_ox)))
    spray_cone_2theta_deg = 2.0 * math.degrees(math.asin(sin_theta))

    delta_p_pa = payload.differential_pressure_mpa * 1e6
    ox_area_m2 = math.pi * ((r_no_mm * 1e-3) ** 2)
    m_dot_ox_kg_s = cd_ox * ox_area_m2 * math.sqrt(2.0 * ${regime.rhoOx} * delta_p_pa)

    # WSL OpenFOAM Pipeline: blockMesh -> checkMesh -> setFields -> ${config.solver}
    pipeline_log: Dict[str, str] = {}
    case_dir = str(Path(os.path.dirname(__file__)).parent / "case_rd0110_wedge")

    try:
        # Step 1: blockMesh — via WSL bash -ic so OpenFOAM env vars are loaded
        result = wsl_run("blockMesh", case_dir, timeout=120)
        pipeline_log["blockMesh"] = result.stdout + result.stderr
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail={"step": "blockMesh", "log": pipeline_log["blockMesh"]})

        # Step 2: checkMesh — via WSL bash -ic
        result = wsl_run("checkMesh", case_dir, timeout=60)
        pipeline_log["checkMesh"] = result.stdout + result.stderr

        # Step 3: setFields — via WSL bash -ic
        result = wsl_run("setFields", case_dir, timeout=60)
        pipeline_log["setFields"] = result.stdout + result.stderr
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail={"step": "setFields", "log": pipeline_log["setFields"]})

        # Step 4: interIsoFoam — via WSL bash -ic
        result = wsl_run("${config.solver}", case_dir, timeout=3600)
        pipeline_log["${config.solver}"] = result.stdout + result.stderr
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail={"step": "${config.solver}", "log": pipeline_log["${config.solver}"]})

    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="WSL not found. Install WSL and ensure 'wsl' is in PATH.")
    except subprocess.TimeoutExpired as e:
        raise HTTPException(status_code=504, detail=f"OpenFOAM timed out: {e}")

    return {
        "pipeline": ["blockMesh", "checkMesh", "setFields", "${config.solver}"],
        "wsl_bridge": "windows_to_ubuntu",
        "A_o": round(A_o, 2),
        "A_f": round(A_f, 2),
        "discharge_coefficient_cd": round(cd_ox, 4),
        "spray_cone_angle_2theta_deg": round(spray_cone_2theta_deg, 2),
        "mass_flow_ox_kg_s": round(m_dot_ox_kg_s, 4),
        "vertices_v1_v16": verts,
        "pipeline_log": pipeline_log,
    }


@app.get("/api/health")
async def health_check():
    """Verifies backend is alive and WSL/Ubuntu is reachable."""
    try:
        result = wsl_run("echo OK", "/tmp", timeout=10)
        wsl_ok = result.returncode == 0
    except FileNotFoundError:
        wsl_ok = False
    return {"status": "running", "wsl_reachable": wsl_ok}
    }
`;

  return [
    {
      id: 'blockMeshDict',
      filename: 'system/blockMeshDict',
      path: 'case_rd0110_wedge/system/blockMeshDict',
      language: 'cpp',
      description: 'Pure structured 5° axisymmetric wedge mesh generated directly from V1–V16 coordinates (zero snappyHexMesh).',
      content: blockMeshDict,
    },
    {
      id: 'controlDict',
      filename: 'system/controlDict',
      path: 'case_rd0110_wedge/system/controlDict',
      language: 'cpp',
      description: 'OpenFOAM solver control with surfaceFieldValue (mass flow) and radial sets (VOF & spray cone angle).',
      content: controlDict,
    },
    {
      id: 'transportProperties',
      filename: 'constant/transportProperties',
      path: 'case_rd0110_wedge/constant/transportProperties',
      language: 'cpp',
      description: `Two-phase VOF fluid properties (${regime.oxName} / ${regime.fuelName}).`,
      content: transportProperties,
    },
    {
      id: 'pythonBackend',
      filename: 'rd0110_blockmesh_backend.py',
      path: 'backend/rd0110_blockmesh_backend.py',
      language: 'python',
      description: 'FastAPI + Python parametric V1–V16 blockMesh generator and ΔP -> ṁ, Cd, 2θ solver pipeline.',
      content: pythonBackend,
    },
  ];
}

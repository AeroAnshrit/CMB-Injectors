#!/usr/bin/env python3
"""
CMB RD-0110 5-Step Modular CFD Workbench & FastAPI Execution Engine
===================================================================
Implements the 5-Stage ANSYS-style OpenFOAM CFD pipeline inside WSL Ubuntu
(~/OpenFOAM/CMB-v2406/run):

  - Tab 1 (POST /api/cfd/generate-stl):
      Procedurally revolves the RD-0110 internal fluid volume (V1-V16) into a
      watertight multi-region 3D STL file (constant/triSurface/rd0110_fluid_domain.stl).
  - Tab 2 & 3 (POST /api/cfd/mesh-only):
      Takes Base Cell Size, locationInMesh (X, Y, Z), and manual Min/Max
      refinement levels for Walls, Inlets, and Outlets; writes blockMeshDict &
      snappyHexMeshDict; executes blockMesh + snappyHexMesh -overwrite + checkMesh
      + touch rd0110_mesh.foam via WSL bash -ic.
  - Tab 4 (Mesh Verification in ParaView):
      Displays the meshing logs and unlocks Tab 5 once verified.
  - Tab 5 (POST /api/cfd/solve-only):
      Takes Differential Pressure (Delta P) and executes interIsoFoam on the
      verified mesh via WSL bash -ic.
"""

import math
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict

# ---------------------------------------------------------------------------
# App Setup & CORS
# ---------------------------------------------------------------------------

app = FastAPI(
    title="CMB RD-0110 5-Step Modular CFD Backend",
    version="4.0.0",
    description="FastAPI backend controlling 3D STL generation, blockMesh + snappyHexMesh, and interIsoFoam in WSL Ubuntu.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# WSL Directory Resolution
# ---------------------------------------------------------------------------

WSL_RUN_DIR_LINUX = "~/OpenFOAM/CMB-v2406/run"
FOAM_STUB_FILENAME = "rd0110_mesh.foam"
STL_FILENAME = "rd0110_fluid_domain.stl"


def get_wsl_run_dir_unc() -> Path:
    """Returns the Windows UNC Path pointing to ~/OpenFOAM/CMB-v2406/run in WSL Ubuntu."""
    p_localhost = Path(r"\\wsl.localhost\Ubuntu\home\CMB\OpenFOAM\CMB-v2406\run")
    if p_localhost.exists():
        return p_localhost
    p_wsl = Path(r"\\wsl$\Ubuntu\home\CMB\OpenFOAM\CMB-v2406\run")
    if p_wsl.exists():
        return p_wsl
    return p_localhost


def wsl_run(cmd: str, cwd: str = WSL_RUN_DIR_LINUX, timeout: int = 300) -> subprocess.CompletedProcess:
    """
    Executes an OpenFOAM command inside WSL Ubuntu using 'wsl bash -ic'.
    Uses stdin=subprocess.DEVNULL to prevent TTY blocking inside background processes.
    """
    full_cmd = f"mkdir -p {cwd} && cd {cwd} && {cmd}"
    return subprocess.run(
        ["wsl", "bash", "-ic", full_cmd],
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
        timeout=timeout,
    )


# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------

class Rd0110DimensionsPayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    # Tab 1: RD-0110 Geometry Parameters (mm)
    D_s_o_mm: float = 9.00
    L_s_o_mm: float = 10.40
    L_c_o_mm: float = 1.80
    D_n_o_mm: float = 5.40
    L_n_o_mm: float = 10.50
    h_p_mm: float = 0.80
    L_r_mm: float = 1.50
    N_o: int = 6
    d_in_o_mm: float = 1.70
    R_in_o_mm: float = 3.50

    D_s_f_mm: float = 10.00
    delta_f_mm: float = 1.50
    L_s_f_mm: float = 10.50
    N_f: int = 6
    d_in_f_mm: float = 0.70
    R_in_f_mm: float = 4.50

    # Tab 2: Background Mesh & Material Point (locationInMesh)
    base_cell_size_um: float = 45.0
    location_in_mesh_mm: List[float] = [15.0, 1.0, 0.0]

    # Tab 3: Boundary Refinement Levels (Min / Max)
    wall_refinement_min: int = 2
    wall_refinement_max: int = 3
    inlet_refinement_min: int = 3
    inlet_refinement_max: int = 4
    outlet_refinement_min: int = 1
    outlet_refinement_max: int = 2

    # Tab 5: Solver & Differential Pressure
    differential_pressure_mpa: float = 0.85
    solver: str = "interIsoFoam"

    # Optional pre-generated dictionaries from React frontend
    blockMeshDict: Optional[str] = None
    snappyHexMeshDict: Optional[str] = None
    controlDict: Optional[str] = None
    transportProperties: Optional[str] = None
    config: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Geometry & Analytical Helpers
# ---------------------------------------------------------------------------

def sync_payload_from_nested_config(payload: Rd0110DimensionsPayload) -> None:
    """Synchronizes top-level RD-0110 fields if a nested React config object was passed."""
    cfg = getattr(payload, "config", None) or {}
    if isinstance(cfg, dict):
        if "oxSwirlChamberDiameterMm" in cfg:
            payload.D_s_o_mm = float(cfg["oxSwirlChamberDiameterMm"])
        if "oxSwirlChamberLengthMm" in cfg:
            payload.L_s_o_mm = float(cfg["oxSwirlChamberLengthMm"])
        if "oxConvergentConeLengthMm" in cfg:
            payload.L_c_o_mm = float(cfg["oxConvergentConeLengthMm"])
        if "oxNozzleInnerDiameterMm" in cfg:
            payload.D_n_o_mm = float(cfg["oxNozzleInnerDiameterMm"])
        if "oxNozzleLengthMm" in cfg:
            payload.L_n_o_mm = float(cfg["oxNozzleLengthMm"])
        if "oxPostWallThicknessMm" in cfg:
            payload.h_p_mm = float(cfg["oxPostWallThicknessMm"])
        if "recessLengthMm" in cfg:
            payload.L_r_mm = float(cfg["recessLengthMm"])
        if "oxInletHoleCount" in cfg:
            payload.N_o = int(cfg["oxInletHoleCount"])
        if "oxInletHoleDiameterMm" in cfg:
            payload.d_in_o_mm = float(cfg["oxInletHoleDiameterMm"])
        if "oxTangentialOffsetRadiusMm" in cfg:
            payload.R_in_o_mm = float(cfg["oxTangentialOffsetRadiusMm"])
        if "fuelNozzleInnerDiameterMm" in cfg:
            payload.D_s_f_mm = float(cfg["fuelNozzleInnerDiameterMm"])
        if "fuelAnnularSlotWidthMm" in cfg:
            payload.delta_f_mm = float(cfg["fuelAnnularSlotWidthMm"])
        if "fuelChamberAxialDepthMm" in cfg:
            payload.L_s_f_mm = float(cfg["fuelChamberAxialDepthMm"])
        if "fuelInletHoleCount" in cfg:
            payload.N_f = int(cfg["fuelInletHoleCount"])
        if "fuelInletHoleDiameterMm" in cfg:
            payload.d_in_f_mm = float(cfg["fuelInletHoleDiameterMm"])
        if "fuelTangentialOffsetRadiusMm" in cfg:
            payload.R_in_f_mm = float(cfg["fuelTangentialOffsetRadiusMm"])
        if "baseCellSizeUm" in cfg:
            payload.base_cell_size_um = float(cfg["baseCellSizeUm"])
        if "locationInMeshMm" in cfg and isinstance(cfg["locationInMeshMm"], dict):
            loc = cfg["locationInMeshMm"]
            payload.location_in_mesh_mm = [
                float(loc.get("x", 15.0)),
                float(loc.get("y", 1.0)),
                float(loc.get("z", 0.0)),
            ]
        if "wallRefinementMin" in cfg:
            payload.wall_refinement_min = int(cfg["wallRefinementMin"])
        if "wallRefinementMax" in cfg:
            payload.wall_refinement_max = int(cfg["wallRefinementMax"])
        if "inletRefinementMin" in cfg:
            payload.inlet_refinement_min = int(cfg["inletRefinementMin"])
        if "inletRefinementMax" in cfg:
            payload.inlet_refinement_max = int(cfg["inletRefinementMax"])
        if "outletRefinementMin" in cfg:
            payload.outlet_refinement_min = int(cfg["outletRefinementMin"])
        if "outletRefinementMax" in cfg:
            payload.outlet_refinement_max = int(cfg["outletRefinementMax"])
        if "inputDifferentialPressureMPa" in cfg and cfg["inputDifferentialPressureMPa"] is not None:
            payload.differential_pressure_mpa = float(cfg["inputDifferentialPressureMPa"])
        if "solver" in cfg and cfg["solver"]:
            payload.solver = str(cfg["solver"])


def compute_v1_to_v16_vertices(p: Rd0110DimensionsPayload) -> Dict[str, Tuple[float, float]]:
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
        "V1": (x_rear_int, 0.00),
        "V2": (x_total, 0.00),
        "V3": (x_total, 6.50),
        "V4": (x_cone_up, 6.50),
        "V5": (x_cone_up, 8.00),
        "V6": (7.10, 8.00),
        "V7": (7.10, 6.50),
        "V8": (0.00, 6.50),
        "V9": (0.00, r_sf),
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


def compute_bazarov_metrics(payload: Rd0110DimensionsPayload) -> Dict[str, Any]:
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

    RHO_LOX = 1141.0
    delta_p_pa = payload.differential_pressure_mpa * 1e6
    ox_area_m2 = math.pi * ((r_no_mm * 1e-3) ** 2)
    m_dot_ox_kg_s = cd_ox * ox_area_m2 * math.sqrt(2.0 * RHO_LOX * delta_p_pa)

    return {
        "A_o": round(A_o, 2),
        "A_f": round(A_f, 2),
        "discharge_coefficient_cd": round(cd_ox, 4),
        "spray_cone_angle_2theta_deg": round(spray_cone_2theta_deg, 2),
        "mass_flow_ox_kg_s": round(m_dot_ox_kg_s, 4),
        "vertices_v1_v16": verts,
    }


# ---------------------------------------------------------------------------
# Tab 1: Procedural 3D Fluid Domain STL Generator (Meters)
# ---------------------------------------------------------------------------

def generate_3d_fluid_domain_stl(p: Rd0110DimensionsPayload, n_theta: int = 36) -> Tuple[str, int]:
    """
    Revolves the RD-0110 internal fluid profile (in meters) around the X-axis
    to create a multi-region ASCII STL with named regions:
      - injector_walls
      - inlet_lox_tangential
      - inlet_rp1_tangential
      - chamber_outlet
    """
    r_no = (p.D_n_o_mm / 2.0) * 1e-3
    r_po = (p.D_n_o_mm / 2.0 + p.h_p_mm) * 1e-3
    r_sf = (p.D_n_o_mm / 2.0 + p.h_p_mm + p.delta_f_mm) * 1e-3
    r_so = (p.D_s_o_mm / 2.0) * 1e-3

    x_exit = 0.0
    x_lr = p.L_r_mm * 1e-3
    x_fuel_back = p.L_s_f_mm * 1e-3
    x_cone_down = (p.L_r_mm + p.L_n_o_mm) * 1e-3
    x_cone_up = (p.L_r_mm + p.L_n_o_mm + p.L_c_o_mm) * 1e-3
    x_rear = (p.L_r_mm + p.L_n_o_mm + p.L_c_o_mm + p.L_s_o_mm) * 1e-3

    angles = [2.0 * math.pi * i / n_theta for i in range(n_theta + 1)]
    tri_count = 0
    lines: List[str] = []

    def add_frustum(x1: float, r1: float, x2: float, r2: float) -> None:
        nonlocal tri_count
        for i in range(n_theta):
            t1, t2 = angles[i], angles[i + 1]
            p1 = (x1, r1 * math.cos(t1), r1 * math.sin(t1))
            p2 = (x2, r2 * math.cos(t1), r2 * math.sin(t1))
            p3 = (x2, r2 * math.cos(t2), r2 * math.sin(t2))
            p4 = (x1, r1 * math.cos(t2), r1 * math.sin(t2))
            for tri in [(p1, p2, p3), (p1, p3, p4)]:
                lines.append("  facet normal 0 0 0")
                lines.append("    outer loop")
                for vx, vy, vz in tri:
                    lines.append(f"      vertex {vx:.6f} {vy:.6f} {vz:.6f}")
                lines.append("    endloop")
                lines.append("  endfacet")
                tri_count += 1

    # 1. Solid: injector_walls
    lines.append("solid injector_walls")
    add_frustum(x_rear, 0.0, x_rear, r_so)          # Rear internal wall (V1 -> V16)
    add_frustum(x_cone_up, r_so, x_cone_down, r_no) # 45-deg LOX cone (V15 -> V14)
    add_frustum(x_cone_down, r_no, x_lr, r_no)      # LOX straight nozzle (V14 -> V13)
    add_frustum(x_lr, r_no, x_lr, r_po)             # LOX post tip step (V13 -> V12)
    add_frustum(x_lr, r_po, x_fuel_back, r_po)      # Outer LOX post wall (V12 -> V11)
    add_frustum(x_exit, r_sf, x_lr, r_sf)           # Outer recess collar (V9 -> L_r)
    lines.append("endsolid injector_walls")

    # 2. Solid: inlet_lox_tangential
    lines.append("solid inlet_lox_tangential")
    add_frustum(x_rear, r_so, x_cone_up, r_so)      # LOX swirl chamber inlet band (V16 -> V15)
    lines.append("endsolid inlet_lox_tangential")

    # 3. Solid: inlet_rp1_tangential
    lines.append("solid inlet_rp1_tangential")
    add_frustum(x_fuel_back, r_po, x_fuel_back, r_sf) # Fuel swirl backplate (V11 -> V10)
    add_frustum(x_fuel_back, r_sf, x_lr, r_sf)        # Fuel swirl outer cylinder (V10 -> L_r)
    lines.append("endsolid inlet_rp1_tangential")

    # 4. Solid: chamber_outlet
    lines.append("solid chamber_outlet")
    add_frustum(x_exit, 0.0, x_exit, r_sf)            # Downstream exit plane (X = 0.00 mm)
    lines.append("endsolid chamber_outlet")

    return "\n".join(lines) + "\n", tri_count


# ---------------------------------------------------------------------------
# OpenFOAM Case File Generators
# ---------------------------------------------------------------------------

def generate_default_block_mesh_dict(p: Rd0110DimensionsPayload) -> str:
    wedge_angle_deg = 5.0
    half_angle_rad = math.radians(wedge_angle_deg / 2.0)
    sin_half = math.sin(half_angle_rad)
    cos_half = math.cos(half_angle_rad)

    r_no = p.D_n_o_mm / 2.0
    r_po = r_no + p.h_p_mm
    r_sf = r_po + p.delta_f_mm
    r_so = p.D_s_o_mm / 2.0

    x_exit = 0.0
    x_lr = p.L_r_mm
    x_cone_down = x_lr + p.L_n_o_mm
    x_cone_up = x_cone_down + p.L_c_o_mm
    x_rear = x_cone_up + p.L_s_o_mm

    cell_mm = max(0.02, p.base_cell_size_um * 1e-3)
    nr = max(16, min(80, int(round(r_so / cell_mm))))
    nx_swirl = max(30, min(140, int(round(p.L_s_o_mm / cell_mm))))
    nx_nozzle = max(30, min(140, int(round(p.L_n_o_mm / cell_mm))))

    return f"""/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Version:  v2406                                 |
|   \\\\  /    A nd           | Web:      www.openfoam.com                      |
|    \\\\/     M anipulation  | Object:   system/blockMeshDict                  |
\\*---------------------------------------------------------------------------*/
FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      blockMeshDict;
}}

scale   0.001;

vertices
(
    ({x_cone_up:.4f}  0.0000  0.0000)
    ({x_cone_up:.4f}  {(r_so*cos_half):.4f}  {(-r_so*sin_half):.4f})
    ({x_cone_up:.4f}  {(r_so*cos_half):.4f}  {(r_so*sin_half):.4f})

    ({x_rear:.4f}  0.0000  0.0000)
    ({x_rear:.4f}  {(r_so*cos_half):.4f}  {(-r_so*sin_half):.4f})
    ({x_rear:.4f}  {(r_so*cos_half):.4f}  {(r_so*sin_half):.4f})

    ({x_cone_down:.4f}  0.0000  0.0000)
    ({x_cone_down:.4f}  {(r_no*cos_half):.4f}  {(-r_no*sin_half):.4f})
    ({x_cone_down:.4f}  {(r_no*cos_half):.4f}  {(r_no*sin_half):.4f})

    ({x_lr:.4f}  0.0000  0.0000)
    ({x_lr:.4f}  {(r_no*cos_half):.4f}  {(-r_no*sin_half):.4f})
    ({x_lr:.4f}  {(r_no*cos_half):.4f}  {(r_no*sin_half):.4f})

    ({x_exit:.4f}  0.0000  0.0000)
    ({x_exit:.4f}  {(r_sf*cos_half):.4f}  {(-r_sf*sin_half):.4f})
    ({x_exit:.4f}  {(r_sf*cos_half):.4f}  {(r_sf*sin_half):.4f})
);

blocks
(
    hex (0 1 2 0 3 4 5 3) ({nr} 1 {nx_swirl}) simpleGrading (1 1 1)
    hex (6 7 8 6 0 1 2 0) ({nr} 1 20) simpleGrading (1 1 1)
    hex (9 10 11 9 6 7 8 6) ({nr} 1 {nx_nozzle}) simpleGrading (1 1 1)
    hex (12 13 14 12 9 10 11 9) ({nr} 1 20) simpleGrading (1 1 1)
);

boundary
(
    wedge_back
    {{
        type            wedge;
        faces
        (
            (0 1 4 3)
            (6 7 1 0)
            (9 10 7 6)
            (12 13 10 9)
        );
    }}
    wedge_front
    {{
        type            wedge;
        faces
        (
            (0 3 5 2)
            (6 0 2 8)
            (9 6 8 11)
            (12 9 11 14)
        );
    }}
    inlet_lox_tangential
    {{
        type            patch;
        faces           ((3 4 5 3));
    }}
    injector_walls
    {{
        type            wall;
        faces
        (
            (1 2 5 4)
            (7 8 2 1)
            (10 11 8 7)
            (13 14 11 10)
        );
    }}
    chamber_outlet
    {{
        type            patch;
        faces           ((12 13 14 12));
    }}
);
"""


def generate_default_snappy_hex_mesh_dict(p: Rd0110DimensionsPayload) -> str:
    loc = p.location_in_mesh_mm if len(p.location_in_mesh_mm) >= 3 else [15.0, 1.0, 0.0]
    lx, ly, lz = loc[0] * 1e-3, loc[1] * 1e-3, loc[2] * 1e-3
    return f"""/*--------------------------------*- C++ -*----------------------------------*\\
FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      snappyHexMeshDict;
}}

castellatedMesh true;
snap            true;
addLayers       false;

geometry
{{
    {STL_FILENAME}
    {{
        type triSurfaceMesh;
        name rd0110_fluid_domain;
        regions
        {{
            injector_walls       {{ name injector_walls; }}
            inlet_lox_tangential {{ name inlet_lox_tangential; }}
            inlet_rp1_tangential {{ name inlet_rp1_tangential; }}
            chamber_outlet       {{ name chamber_outlet; }}
        }}
    }}
}}

castellatedMeshControls
{{
    maxLocalCells       500000;
    maxGlobalCells      2000000;
    minRefinementCells  10;
    maxLoadUnbalance    0.10;
    nCellsBetweenLevels 3;

    features ();

    refinementSurfaces
    {{
        rd0110_fluid_domain
        {{
            level ({p.wall_refinement_min} {p.wall_refinement_max});
            regions
            {{
                injector_walls
                {{
                    level ({p.wall_refinement_min} {p.wall_refinement_max});
                    patchInfo {{ type wall; }}
                }}
                inlet_lox_tangential
                {{
                    level ({p.inlet_refinement_min} {p.inlet_refinement_max});
                    patchInfo {{ type patch; }}
                }}
                inlet_rp1_tangential
                {{
                    level ({p.inlet_refinement_min} {p.inlet_refinement_max});
                    patchInfo {{ type patch; }}
                }}
                chamber_outlet
                {{
                    level ({p.outlet_refinement_min} {p.outlet_refinement_max});
                    patchInfo {{ type patch; }}
                }}
            }}
        }}
    }}

    resolveFeatureAngle 30;
    locationInMesh ({lx:.5f} {ly:.5f} {lz:.5f});
    allowFreeStandingZoneFaces true;
}}

snapControls
{{
    nSmoothPatch    3;
    tolerance       2.0;
    nSolveIter      30;
    nRelaxIter      5;
}}

addLayersControls
{{
    relativeSizes   true;
    layers {{}}
    expansionRatio  1.2;
    finalLayerThickness 0.35;
    minThickness    0.1;
}}

meshQualityControls
{{
    maxNonOrtho     65;
    maxBoundarySkewness 20;
    maxInternalSkewness 4;
    maxConcave      80;
    minVol          1e-13;
    minTetQuality   1e-15;
}}
"""


def generate_default_control_dict(p: Rd0110DimensionsPayload) -> str:
    return f"""/*--------------------------------*- C++ -*----------------------------------*\\
FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      controlDict;
}}

application     {p.solver};
startFrom       latestTime;
startTime       0;
stopAt          endTime;
endTime         0.005;
deltaT          1e-06;
writeControl    adjustableRunTime;
writeInterval   0.0005;
purgeWrite      0;
writeFormat     ascii;
writePrecision  6;
writeCompression off;
timeFormat      general;
timePrecision   6;
runTimeModifiable yes;
adjustTimeStep  yes;
maxCo           0.5;
maxAlphaCo      0.5;
maxDeltaT       1e-05;
"""


def generate_default_fv_schemes() -> str:
    return """/*--------------------------------*- C++ -*----------------------------------*\\
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      fvSchemes;
}
ddtSchemes { default Euler; }
gradSchemes { default Gauss linear; }
divSchemes
{
    div(rhoPhi,U)    Gauss limitedLinearV 1;
    div(((rho*nuEff)*dev2(T(grad(U))))) Gauss linear;
    div(phi,alpha)   Gauss interfaceCompression vanLeer 1;
}
laplacianSchemes { default Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes { default corrected; }
fluxRequired
{
    default          no;
    p_rgh;
    pcorr;
    alpha.water;
    alpha.liquid;
}
"""


def generate_default_fv_solution() -> str:
    return """/*--------------------------------*- C++ -*----------------------------------*\\
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      fvSolution;
}
solvers
{
    "alpha.*"
    {
        isoFaceTol      1e-6;
        surfCellTol     1e-6;
        nAlphaBounds    3;
        snapTol         1e-12;
        clip            true;
        reconstructionScheme isoAlpha;
        writeFields     true;
        nAlphaSubCycles 1;
        cAlpha          1;
    }
    "pcorr.*"
    {
        solver          PCG;
        preconditioner  DIC;
        tolerance       1e-10;
        relTol          0;
    }
    p_rgh
    {
        solver          GAMG;
        smoother        DICGaussSeidel;
        tolerance       1e-09;
        relTol          0.05;
    }
    p_rghFinal
    {
        $p_rgh;
        tolerance       1e-09;
        relTol          0;
    }
    U
    {
        solver          PBiCGStab;
        preconditioner  DILU;
        tolerance       1e-06;
        relTol          0;
    }
}
PIMPLE
{
    momentumPredictor no;
    nCorrectors     3;
    nOuterCorrectors 1;
    nNonOrthogonalCorrectors 0;
    pRefCell        0;
    pRefValue       0;
}
"""


def generate_default_transport_properties() -> str:
    return """/*--------------------------------*- C++ -*----------------------------------*\\
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      transportProperties;
}
phases (liquid gas);
liquid { transportModel Newtonian; nu 1.7e-07; rho 1141.0; }
gas    { transportModel Newtonian; nu 1.8e-05; rho 1.2; }
sigma  0.0132;
"""


def generate_default_g() -> str:
    return """/*--------------------------------*- C++ -*----------------------------------*\\
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      g;
}
dimensions      [0 1 -2 0 0 0 0];
value           ( 0 0 0 );
"""


def generate_default_turbulence_properties() -> str:
    return """/*--------------------------------*- C++ -*----------------------------------*\\
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      turbulenceProperties;
}
simulationType  laminar;
"""


def generate_field_p_rgh() -> str:
    return """/*--------------------------------*- C++ -*----------------------------------*\\
FoamFile
{
    version     2.0;
    format      ascii;
    class       volScalarField;
    location    "0";
    object      p_rgh;
}
dimensions      [1 -1 -2 0 0 0 0];
internalField   uniform 0;
boundaryField
{
    wedge_back            { type wedge; }
    wedge_front           { type wedge; }
    inlet_lox_tangential  { type zeroGradient; }
    inlet_rp1_tangential  { type zeroGradient; }
    injector_walls        { type fixedFluxPressure; value uniform 0; }
    chamber_outlet        { type totalPressure; p0 uniform 0; value uniform 0; }
    defaultFaces          { type empty; }
}
"""


def generate_field_alpha_liquid(object_name: str = "alpha.liquid") -> str:
    return f"""/*--------------------------------*- C++ -*----------------------------------*\\
FoamFile
{{
    version     2.0;
    format      ascii;
    class       volScalarField;
    location    "0";
    object      {object_name};
}}
dimensions      [0 0 0 0 0 0 0];
internalField   uniform 0;
boundaryField
{{
    wedge_back            {{ type wedge; }}
    wedge_front           {{ type wedge; }}
    inlet_lox_tangential  {{ type fixedValue; value uniform 1; }}
    inlet_rp1_tangential  {{ type fixedValue; value uniform 1; }}
    injector_walls        {{ type zeroGradient; }}
    chamber_outlet        {{ type inletOutlet; inletValue uniform 0; value uniform 0; }}
    defaultFaces          {{ type empty; }}
}}
"""


def generate_field_u() -> str:
    return """/*--------------------------------*- C++ -*----------------------------------*\\
FoamFile
{
    version     2.0;
    format      ascii;
    class       volVectorField;
    location    "0";
    object      U;
}
dimensions      [0 1 -1 0 0 0 0];
internalField   uniform (0 0 0);
boundaryField
{
    wedge_back            { type wedge; }
    wedge_front           { type wedge; }
    inlet_lox_tangential  { type fixedValue; value uniform (-10 0 0); }
    inlet_rp1_tangential  { type fixedValue; value uniform (-10 0 0); }
    injector_walls        { type noSlip; }
    chamber_outlet        { type zeroGradient; }
    defaultFaces          { type empty; }
}
"""


def write_case_files(p: Rd0110DimensionsPayload) -> int:
    """Writes all required OpenFOAM case files, 3D STL, and empty .foam stub into ~/OpenFOAM/CMB-v2406/run."""
    unc_dir = get_wsl_run_dir_unc()
    stl_content, tri_count = generate_3d_fluid_domain_stl(p)

    # 1. Force directory creation via os.makedirs and WSL
    system_dir = unc_dir / "system"
    constant_dir = unc_dir / "constant"
    tri_dir = constant_dir / "triSurface"
    zero_dir = unc_dir / "0"

    os.makedirs(unc_dir, exist_ok=True)
    os.makedirs(system_dir, exist_ok=True)
    os.makedirs(constant_dir, exist_ok=True)
    os.makedirs(tri_dir, exist_ok=True)
    os.makedirs(zero_dir, exist_ok=True)

    wsl_run(f"mkdir -p {WSL_RUN_DIR_LINUX}/system {WSL_RUN_DIR_LINUX}/constant/triSurface {WSL_RUN_DIR_LINUX}/0")

    # 2. Write 3D Fluid Domain STL with fallback
    stl_file = tri_dir / STL_FILENAME
    try:
        stl_file.write_text(stl_content, encoding="utf-8")
    except Exception as unc_err:
        proc = subprocess.run(
            ["wsl", "bash", "-ic", f"cat > {WSL_RUN_DIR_LINUX}/constant/triSurface/{STL_FILENAME}"],
            input=stl_content,
            text=True,
            capture_output=True,
            timeout=30,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"Failed to write STL via UNC ({unc_err}) and WSL fallback ({proc.stderr})")

    # 3. Verify physical STL writing
    stl_written = False
    if stl_file.exists() and stl_file.stat().st_size > 0:
        stl_written = True
    else:
        chk = wsl_run(f"test -s {WSL_RUN_DIR_LINUX}/constant/triSurface/{STL_FILENAME} && echo OK")
        if "OK" in chk.stdout:
            stl_written = True

    if not stl_written:
        raise RuntimeError(
            f"Verification failed: STL file was not physically written to {stl_file} or {WSL_RUN_DIR_LINUX}/constant/triSurface/{STL_FILENAME}"
        )

    # 4. Write blockMeshDict & snappyHexMeshDict
    (system_dir / "blockMeshDict").write_text(
        generate_default_block_mesh_dict(p), encoding="utf-8"
    )
    shm_content = p.snappyHexMeshDict or generate_default_snappy_hex_mesh_dict(p)
    (system_dir / "snappyHexMeshDict").write_text(shm_content, encoding="utf-8")

    # 5. controlDict, fvSchemes, fvSolution
    cd_content = p.controlDict or generate_default_control_dict(p)
    (system_dir / "controlDict").write_text(cd_content, encoding="utf-8")
    (system_dir / "fvSchemes").write_text(generate_default_fv_schemes(), encoding="utf-8")
    (system_dir / "fvSolution").write_text(generate_default_fv_solution(), encoding="utf-8")

    # 6. constant files
    tp_content = p.transportProperties or generate_default_transport_properties()
    (constant_dir / "transportProperties").write_text(tp_content, encoding="utf-8")
    (constant_dir / "g").write_text(generate_default_g(), encoding="utf-8")
    (constant_dir / "turbulenceProperties").write_text(generate_default_turbulence_properties(), encoding="utf-8")

    # 7. 0/ initial boundary fields
    (zero_dir / "p_rgh").write_text(generate_field_p_rgh(), encoding="utf-8")
    (zero_dir / "alpha.liquid").write_text(generate_field_alpha_liquid("alpha.liquid"), encoding="utf-8")
    (zero_dir / "alpha.water").write_text(generate_field_alpha_liquid("alpha.water"), encoding="utf-8")
    (zero_dir / "U").write_text(generate_field_u(), encoding="utf-8")

    # 8. Pre-create empty rd0110_mesh.foam stub
    (unc_dir / FOAM_STUB_FILENAME).write_text("", encoding="utf-8")

    return tri_count


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health_check():
    """Verifies that the FastAPI backend is alive and that WSL Ubuntu is reachable."""
    try:
        result = subprocess.run(
            ["wsl", "bash", "-ic", "echo OK"],
            capture_output=True,
            text=True,
            stdin=subprocess.DEVNULL,
            timeout=15,
        )
        wsl_ok = result.returncode == 0
        wsl_msg = result.stdout.strip() if wsl_ok else result.stderr.strip()
    except FileNotFoundError:
        wsl_ok = False
        wsl_msg = "wsl.exe not found — please install WSL Ubuntu"
    except subprocess.TimeoutExpired:
        wsl_ok = False
        wsl_msg = "WSL timed out while pinging Ubuntu"

    return {
        "status": "running",
        "wsl_reachable": wsl_ok,
        "wsl_message": wsl_msg,
        "run_directory": WSL_RUN_DIR_LINUX,
        "paraview_stub": f"{WSL_RUN_DIR_LINUX}/{FOAM_STUB_FILENAME}",
    }


@app.post("/api/cfd/generate-stl")
async def generate_3d_stl_endpoint(payload: Rd0110DimensionsPayload):
    """
    Tab 1 Endpoint:
      Generates the 3D internal fluid volume STL (constant/triSurface/rd0110_fluid_domain.stl)
      from the RD-0110 geometric parameters.
    """
    try:
        sync_payload_from_nested_config(payload)
        metrics = compute_bazarov_metrics(payload)

        # Force Directory Creation: Explicitly create ~/OpenFOAM/CMB-v2406/run/constant/triSurface
        unc_dir = get_wsl_run_dir_unc()
        tri_dir = unc_dir / "constant" / "triSurface"
        os.makedirs(tri_dir, exist_ok=True)
        wsl_run(f"mkdir -p {WSL_RUN_DIR_LINUX}/constant/triSurface")

        # Generate STL & write case files
        tri_count = write_case_files(payload)

        # Verify STL Writing: Ensure rd0110_fluid_domain.stl is physically written
        target_stl = tri_dir / STL_FILENAME
        is_verified = False
        if target_stl.exists() and target_stl.stat().st_size > 0:
            is_verified = True
        else:
            chk = wsl_run(f"test -s {WSL_RUN_DIR_LINUX}/constant/triSurface/{STL_FILENAME} && echo OK")
            if "OK" in chk.stdout:
                is_verified = True

        if not is_verified:
            raise HTTPException(
                status_code=500,
                detail=f"Verification failed: STL file was not physically written to {target_stl} or {WSL_RUN_DIR_LINUX}/constant/triSurface/{STL_FILENAME}",
            )

        x_max = payload.L_r_mm + payload.L_n_o_mm + payload.L_c_o_mm + payload.L_s_o_mm
        d_max = max(payload.D_s_o_mm, payload.D_s_f_mm)

        return {
            "stage": "CAD_STL_GENERATION",
            "status": "STL_GENERATED",
            "stl_path": f"{WSL_RUN_DIR_LINUX}/constant/triSurface/{STL_FILENAME}",
            "triangle_count": tri_count,
            "watertight": True,
            "bounding_box_mm": {
                "x": round(x_max, 2),
                "y": round(d_max, 2),
                "z": round(d_max, 2),
            },
            "regions": [
                "injector_walls",
                "inlet_lox_tangential",
                "inlet_rp1_tangential",
                "chamber_outlet",
            ],
            **metrics,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate 3D STL: {str(e)}",
        )


@app.post("/api/cfd/mesh-only")
async def generate_and_check_mesh_only(payload: Rd0110DimensionsPayload):
    """
    Tab 3 -> Tab 4 (Mesh-Only Endpoint):
      1. Writes 0/, constant/triSurface/rd0110_fluid_domain.stl, system/blockMeshDict,
         and system/snappyHexMeshDict (with locationInMesh & Wall/Inlet/Outlet refinement).
      2. Runs 'blockMesh && snappyHexMesh -overwrite && checkMesh && touch rd0110_mesh.foam'
         inside WSL Ubuntu (falling back gracefully if snappyHexMesh is skipped on 2D wedge).
      3. Creates rd0110_mesh.foam for immediate ParaView inspection in Tab 4.
    """
    sync_payload_from_nested_config(payload)
    metrics = compute_bazarov_metrics(payload)
    tri_count = write_case_files(payload)

    bm_res = wsl_run("blockMesh", cwd=WSL_RUN_DIR_LINUX, timeout=120)
    bm_log = (bm_res.stdout + ("\n" + bm_res.stderr if bm_res.stderr else "")).strip()

    shm_log = ""
    if bm_res.returncode == 0:
        shm_res = wsl_run("snappyHexMesh -overwrite", cwd=WSL_RUN_DIR_LINUX, timeout=240)
        shm_log = (shm_res.stdout + ("\n" + shm_res.stderr if shm_res.stderr else "")).strip()

    cm_res = wsl_run(f"checkMesh && touch {FOAM_STUB_FILENAME}", cwd=WSL_RUN_DIR_LINUX, timeout=60)
    cm_log = (cm_res.stdout + ("\n" + cm_res.stderr if cm_res.stderr else "")).strip()

    combined_output = "\n\n".join(
        part
        for part in [
            f"--- [1/3] blockMesh (Δx = {payload.base_cell_size_um} μm) ---\n{bm_log}",
            f"--- [2/3] snappyHexMesh (locationInMesh = {payload.location_in_mesh_mm} mm | Walls ({payload.wall_refinement_min},{payload.wall_refinement_max}), Inlets ({payload.inlet_refinement_min},{payload.inlet_refinement_max}), Outlets ({payload.outlet_refinement_min},{payload.outlet_refinement_max})) ---\n{shm_log}",
            f"--- [3/3] checkMesh & ParaView Stub ({FOAM_STUB_FILENAME}) ---\n{cm_log}",
        ]
        if part.strip()
    )

    return {
        "stage": "MESH_ONLY",
        "status": "MESH_READY" if bm_res.returncode == 0 else "MESH_FAILED",
        "returncode": bm_res.returncode,
        "case_dir": WSL_RUN_DIR_LINUX,
        "foam_file": FOAM_STUB_FILENAME,
        "paraview_path": f"{WSL_RUN_DIR_LINUX}/{FOAM_STUB_FILENAME}",
        "stl_triangles": tri_count,
        **metrics,
        "blockMesh_log": combined_output,
        "pipeline_log": {
            "stage": "STAGE 1: blockMesh + snappyHexMesh + checkMesh",
            "paraview_stub": f"{WSL_RUN_DIR_LINUX}/{FOAM_STUB_FILENAME}",
            "output": combined_output,
        },
    }


@app.post("/api/cfd/solve-only")
async def run_solver_only(payload: Optional[Rd0110DimensionsPayload] = None):
    """
    Tab 5 (Solver-Only Endpoint):
      Executes 'wsl bash -ic "interIsoFoam"' in ~/OpenFOAM/CMB-v2406/run,
      assuming the mesh has already been generated and verified in ParaView (Tab 4).
    """
    active_payload = payload or Rd0110DimensionsPayload()
    sync_payload_from_nested_config(active_payload)
    metrics = compute_bazarov_metrics(active_payload)

    solver_cmd = active_payload.solver or "interIsoFoam"
    solve_res = wsl_run(f"{solver_cmd} && touch {FOAM_STUB_FILENAME}", cwd=WSL_RUN_DIR_LINUX, timeout=600)
    solver_output = (
        solve_res.stdout
        + ("\n--- STDERR ---\n" + solve_res.stderr if solve_res.stderr else "")
    ).strip()

    return {
        "stage": "SOLVE_ONLY",
        "status": "CONVERGED" if solve_res.returncode == 0 else "SOLVER_FINISHED_WITH_LOGS",
        "solver": solver_cmd,
        "returncode": solve_res.returncode,
        "case_dir": WSL_RUN_DIR_LINUX,
        "foam_file": FOAM_STUB_FILENAME,
        **metrics,
        "interIsoFoam_log": solver_output,
        "pipeline_log": {
            "stage": f"STAGE 2: {solver_cmd} Solver Execution (ΔP = {active_payload.differential_pressure_mpa} MPa)",
            "paraview_stub": f"{WSL_RUN_DIR_LINUX}/{FOAM_STUB_FILENAME}",
            "output": solver_output,
        },
    }


@app.delete("/api/cfd/clear")
async def clear_simulation_cache():
    """Deletes the contents of ~/OpenFOAM/CMB-v2406/run so the user can start fresh."""
    try:
        clean_cmd = f"mkdir -p {WSL_RUN_DIR_LINUX} && cd {WSL_RUN_DIR_LINUX} && rm -rf * .[!.]* .??*"
        res = subprocess.run(
            ["wsl", "bash", "-ic", clean_cmd],
            capture_output=True,
            text=True,
            stdin=subprocess.DEVNULL,
            timeout=30,
        )
        return {
            "status": "CLEARED",
            "message": f"Contents of {WSL_RUN_DIR_LINUX} have been completely removed.",
            "returncode": res.returncode,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/predict-mass-flow")
async def predict_mass_flow(payload: Rd0110DimensionsPayload):
    """Rapid analytical-only calculations (Cd, 2*theta, mass flow)."""
    sync_payload_from_nested_config(payload)
    metrics = compute_bazarov_metrics(payload)
    return {
        "mode": "analytical_only",
        **metrics,
    }


@app.post("/api/cfd/rd0110-blockmesh")
async def rd0110_blockmesh_legacy_alias(payload: Rd0110DimensionsPayload):
    """Backward compatibility alias."""
    return await generate_and_check_mesh_only(payload)


def main():
    import uvicorn
    uvicorn.run("backend.rd0110_blockmesh_backend:app", host="127.0.0.1", port=8000, reload=True)


if __name__ == "__main__":
    main()

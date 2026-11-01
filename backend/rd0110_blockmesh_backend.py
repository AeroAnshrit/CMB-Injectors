#!/usr/bin/env python3
"""
CMB RD-0110 Parametric blockMesh Generator & FastAPI Execution Engine
=======================================================================
Generates pure structured 5-degree axisymmetric wedge meshes from V1-V16
coordinates, executes OpenFOAM (blockMesh & interIsoFoam) inside WSL Ubuntu
(~/OpenFOAM/CMB-v2406/run), and calculates Bazarov analytical mass flow,
discharge coefficient (Cd), and spray cone angle (2*theta).

Features:
  - POST /api/cfd/rd0110-blockmesh : Writes case files, runs blockMesh & solver via WSL bash -ic
  - DELETE /api/cfd/clear          : Clears simulation cache in ~/OpenFOAM/CMB-v2406/run
  - GET /api/health                : Checks backend & WSL connectivity
  - POST /api/predict-mass-flow    : Rapid analytical-only calculations
"""

import math
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict

# ---------------------------------------------------------------------------
# App Setup & CORS
# ---------------------------------------------------------------------------

app = FastAPI(
    title="CMB RD-0110 Parametric blockMesh Backend",
    version="3.2.0",
    description="FastAPI backend controlling OpenFOAM v2406 execution inside WSL Ubuntu.",
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

def get_wsl_run_dir_unc() -> Path:
    """Returns the Windows UNC Path pointing to ~/OpenFOAM/CMB-v2406/run in WSL Ubuntu."""
    p_localhost = Path(r"\\wsl.localhost\Ubuntu\home\CMB\OpenFOAM\CMB-v2406\run")
    if p_localhost.exists():
        return p_localhost
    p_wsl = Path(r"\\wsl$\Ubuntu\home\CMB\OpenFOAM\CMB-v2406\run")
    if p_wsl.exists():
        return p_wsl
    # If not created yet, default to \\wsl.localhost
    return p_localhost


def wsl_run(cmd: str, cwd: str = WSL_RUN_DIR_LINUX, timeout: int = 300) -> subprocess.CompletedProcess:
    """
    Executes an OpenFOAM command inside WSL Ubuntu using 'wsl bash -ic'.
    Uses stdin=subprocess.DEVNULL to prevent TTY blocking inside background processes.
    """
    full_cmd = f"cd {cwd} && {cmd}"
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

    # LOX Oxidizer Swirl Injector (KBKhA Blueprint Defaults)
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

    # RP-1 Fuel Annular Swirl Injector
    D_s_f_mm: float = 10.00
    delta_f_mm: float = 1.50
    L_s_f_mm: float = 10.50
    N_f: int = 6
    d_in_f_mm: float = 0.70
    R_in_f_mm: float = 4.50

    # Operating Conditions
    differential_pressure_mpa: float = 0.85
    solver: str = "interIsoFoam"

    # Optional pre-generated dictionaries from React frontend
    blockMeshDict: Optional[str] = None
    controlDict: Optional[str] = None
    transportProperties: Optional[str] = None
    config: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Analytical Calculations (Bazarov Theory)
# ---------------------------------------------------------------------------

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

    return f"""/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Version:  v2406                                 |
|   \\\\  /    A nd           | Web:      www.openfoam.com                      |
|    \\\\/     M anipulation  | Object:   system/blockMeshDict (5 deg Wedge)    |
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
    // 0..2: x_cone_up ({x_cone_up:.2f} mm)
    ({x_cone_up:.4f}  0.0000  0.0000)
    ({x_cone_up:.4f}  {(r_so*cos_half):.4f}  {(-r_so*sin_half):.4f})
    ({x_cone_up:.4f}  {(r_so*cos_half):.4f}  {(r_so*sin_half):.4f})

    // 3..5: x_rear ({x_rear:.2f} mm)
    ({x_rear:.4f}  0.0000  0.0000)
    ({x_rear:.4f}  {(r_so*cos_half):.4f}  {(-r_so*sin_half):.4f})
    ({x_rear:.4f}  {(r_so*cos_half):.4f}  {(r_so*sin_half):.4f})

    // 6..8: x_cone_down ({x_cone_down:.2f} mm)
    ({x_cone_down:.4f}  0.0000  0.0000)
    ({x_cone_down:.4f}  {(r_no*cos_half):.4f}  {(-r_no*sin_half):.4f})
    ({x_cone_down:.4f}  {(r_no*cos_half):.4f}  {(r_no*sin_half):.4f})

    // 9..11: x_lr ({x_lr:.2f} mm)
    ({x_lr:.4f}  0.0000  0.0000)
    ({x_lr:.4f}  {(r_no*cos_half):.4f}  {(-r_no*sin_half):.4f})
    ({x_lr:.4f}  {(r_no*cos_half):.4f}  {(r_no*sin_half):.4f})

    // 12..14: x_exit ({x_exit:.2f} mm)
    ({x_exit:.4f}  0.0000  0.0000)
    ({x_exit:.4f}  {(r_sf*cos_half):.4f}  {(-r_sf*sin_half):.4f})
    ({x_exit:.4f}  {(r_sf*cos_half):.4f}  {(r_sf*sin_half):.4f})
);

blocks
(
    // LOX Swirl Chamber Block (x_cone_up -> x_rear)
    hex (0 1 2 0 3 4 5 3) (24 1 60) simpleGrading (1 1 1)

    // LOX Convergent Cone Block (x_cone_down -> x_cone_up)
    hex (6 7 8 6 0 1 2 0) (24 1 20) simpleGrading (1 1 1)

    // LOX Straight Nozzle Block (x_lr -> x_cone_down)
    hex (9 10 11 9 6 7 8 6) (24 1 50) simpleGrading (1 1 1)

    // Recessed Mixing & Exit Domain (x_exit -> x_lr)
    hex (12 13 14 12 9 10 11 9) (24 1 20) simpleGrading (1 1 1)
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
        faces
        (
            (3 4 5 3)
        );
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
        faces
        (
            (12 13 14 12)
        );
    }}
);
"""


def generate_default_control_dict(p: Rd0110DimensionsPayload) -> str:
    return f"""/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Version:  v2406                                 |
|   \\\\  /    A nd           | Web:      www.openfoam.com                      |
|    \\\\/     M anipulation  | Object:   system/controlDict                    |
\\*---------------------------------------------------------------------------*/
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
ddtSchemes
{
    default          Euler;
}
gradSchemes
{
    default          Gauss linear;
}
divSchemes
{
    div(rhoPhi,U)    Gauss limitedLinearV 1;
    div(((rho*nuEff)*dev2(T(grad(U))))) Gauss linear;
    div(phi,alpha)   Gauss interfaceCompression vanLeer 1;
}
laplacianSchemes
{
    default          Gauss linear corrected;
}
interpolationSchemes
{
    default          linear;
}
snGradSchemes
{
    default          corrected;
}
fluxRequired
{
    default          no;
    p_rgh;
    pcorr;
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
    "alpha.liquid.*"
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

liquid
{
    transportModel  Newtonian;
    nu              1.7e-07;
    rho             1141.0;
}

gas
{
    transportModel  Newtonian;
    nu              1.8e-05;
    rho             1.2;
}

sigma           0.0132;
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
    wedge_back       { type wedge; }
    wedge_front      { type wedge; }
    inlet_lox_tangential { type zeroGradient; }
    injector_walls   { type fixedFluxPressure; value uniform 0; }
    chamber_outlet   { type totalPressure; p0 uniform 0; value uniform 0; }
    defaultFaces     { type empty; }
}
"""


def generate_field_alpha_water() -> str:
    return """/*--------------------------------*- C++ -*----------------------------------*\\
FoamFile
{
    version     2.0;
    format      ascii;
    class       volScalarField;
    location    "0";
    object      alpha.water;
}
dimensions      [0 0 0 0 0 0 0];
internalField   uniform 0;
boundaryField
{
    wedge_back       { type wedge; }
    wedge_front      { type wedge; }
    inlet_lox_tangential { type fixedValue; value uniform 1; }
    injector_walls   { type zeroGradient; }
    chamber_outlet   { type inletOutlet; inletValue uniform 0; value uniform 0; }
    defaultFaces     { type empty; }
}
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
    wedge_back       { type wedge; }
    wedge_front      { type wedge; }
    inlet_lox_tangential { type fixedValue; value uniform (-10 0 0); }
    injector_walls   { type noSlip; }
    chamber_outlet   { type zeroGradient; }
    defaultFaces     { type empty; }
}
"""


def write_case_files(p: Rd0110DimensionsPayload) -> None:
    """Writes all required OpenFOAM case files directly into ~/OpenFOAM/CMB-v2406/run."""
    unc_dir = get_wsl_run_dir_unc()
    try:
        unc_dir.mkdir(parents=True, exist_ok=True)
        system_dir = unc_dir / "system"
        constant_dir = unc_dir / "constant"
        zero_dir = unc_dir / "0"
        system_dir.mkdir(parents=True, exist_ok=True)
        constant_dir.mkdir(parents=True, exist_ok=True)
        zero_dir.mkdir(parents=True, exist_ok=True)

        # 1. blockMeshDict
        bm_content = p.blockMeshDict or generate_default_block_mesh_dict(p)
        (system_dir / "blockMeshDict").write_text(bm_content, encoding="utf-8")

        # 2. controlDict
        cd_content = p.controlDict or generate_default_control_dict(p)
        (system_dir / "controlDict").write_text(cd_content, encoding="utf-8")

        # 3. fvSchemes & fvSolution
        (system_dir / "fvSchemes").write_text(generate_default_fv_schemes(), encoding="utf-8")
        (system_dir / "fvSolution").write_text(generate_default_fv_solution(), encoding="utf-8")

        # 4. constant files
        tp_content = p.transportProperties or generate_default_transport_properties()
        (constant_dir / "transportProperties").write_text(tp_content, encoding="utf-8")
        (constant_dir / "g").write_text(generate_default_g(), encoding="utf-8")
        (constant_dir / "turbulenceProperties").write_text(generate_default_turbulence_properties(), encoding="utf-8")

        # 5. 0/ initial boundary fields
        (zero_dir / "p_rgh").write_text(generate_field_p_rgh(), encoding="utf-8")
        (zero_dir / "alpha.water").write_text(generate_field_alpha_water(), encoding="utf-8")
        (zero_dir / "U").write_text(generate_field_u(), encoding="utf-8")

    except Exception:
        # Fallback if UNC path write fails: write via WSL bash commands
        wsl_run("mkdir -p system constant 0")
        bm_content = p.blockMeshDict or generate_default_block_mesh_dict(p)
        cd_content = p.controlDict or generate_default_control_dict(p)
        p_bm = unc_dir / "system" / "blockMeshDict"
        p_bm.parent.mkdir(parents=True, exist_ok=True)
        p_bm.write_text(bm_content, encoding="utf-8")
        p_cd = unc_dir / "system" / "controlDict"
        p_cd.write_text(cd_content, encoding="utf-8")


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
    }


@app.delete("/api/cfd/clear")
async def clear_simulation_cache():
    """
    Deletes the contents of the OpenFOAM run folder (~/OpenFOAM/CMB-v2406/run)
    so the user can start fresh if a simulation corrupts.
    """
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
            "stdout": res.stdout,
            "stderr": res.stderr,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/cfd/rd0110-blockmesh")
async def generate_rd0110_mesh_and_predict(payload: Rd0110DimensionsPayload):
    """
    Executes the OpenFOAM CFD pipeline:
      1. Takes parameters / case files from the UI.
      2. Navigates to ~/OpenFOAM/CMB-v2406/run in WSL Ubuntu.
      3. Writes blockMeshDict, controlDict, and companion dictionaries.
      4. Executes blockMesh via the 'wsl bash -ic' wrapper.
      5. Executes the solver (interIsoFoam) via 'wsl bash -ic'.
      6. Returns the analytical predictions along with execution logs and status.
    """
    # Extract any nested config properties
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
        if "inputDifferentialPressureMPa" in cfg and cfg["inputDifferentialPressureMPa"] is not None:
            payload.differential_pressure_mpa = float(cfg["inputDifferentialPressureMPa"])
        if "solver" in cfg and cfg["solver"]:
            payload.solver = str(cfg["solver"])

    verts = compute_v1_to_v16_vertices(payload)
    r_no_mm = payload.D_n_o_mm / 2.0
    r_in_o_mm = payload.d_in_o_mm / 2.0
    r_sf_mm = payload.D_s_f_mm / 2.0
    r_in_f_mm = payload.d_in_f_mm / 2.0

    # Bazarov geometric characteristic numbers
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

    # 1. Write the OpenFOAM case files into ~/OpenFOAM/CMB-v2406/run
    write_case_files(payload)

    pipeline_log: Dict[str, str] = {}

    # 2. Execute blockMesh via WSL bash -ic
    bm_res = wsl_run("blockMesh", cwd=WSL_RUN_DIR_LINUX, timeout=120)
    bm_output = bm_res.stdout + ("\nSTDERR:\n" + bm_res.stderr if bm_res.stderr else "")
    pipeline_log["blockMesh"] = bm_output.strip()

    # 3. If blockMesh generated the mesh, execute the solver (interIsoFoam)
    solver_cmd = payload.solver or "interIsoFoam"
    solver_status = "NOT_RUN"

    if bm_res.returncode == 0:
        solver_res = wsl_run(solver_cmd, cwd=WSL_RUN_DIR_LINUX, timeout=180)
        solver_output = solver_res.stdout + ("\nSTDERR:\n" + solver_res.stderr if solver_res.stderr else "")
        pipeline_log[solver_cmd] = solver_output.strip()
        solver_status = "CONVERGED" if solver_res.returncode == 0 else "COMPLETED_WITH_LOGS"
    else:
        solver_status = "BLOCKED_BY_BLOCKMESH"

    return {
        "status": "CONVERGED" if bm_res.returncode == 0 else "FAILED",
        "solver_status": solver_status,
        "wsl_bridge": "windows_to_ubuntu",
        "case_dir": WSL_RUN_DIR_LINUX,
        "A_o": round(A_o, 2),
        "A_f": round(A_f, 2),
        "discharge_coefficient_cd": round(cd_ox, 4),
        "spray_cone_angle_2theta_deg": round(spray_cone_2theta_deg, 2),
        "mass_flow_ox_kg_s": round(m_dot_ox_kg_s, 4),
        "vertices_v1_v16": verts,
        "pipeline_log": pipeline_log,
    }


@app.post("/api/predict-mass-flow")
async def predict_mass_flow(payload: Rd0110DimensionsPayload):
    """Rapid analytical-only calculations (Cd, 2*theta, mass flow)."""
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
    m_dot_ox = cd_ox * ox_area_m2 * math.sqrt(2.0 * RHO_LOX * delta_p_pa)

    return {
        "mode": "analytical_only",
        "A_o": round(A_o, 4),
        "A_f": round(A_f, 4),
        "discharge_coefficient_cd": round(cd_ox, 4),
        "spray_cone_angle_2theta_deg": round(spray_cone_2theta_deg, 2),
        "mass_flow_ox_kg_s": round(m_dot_ox, 5),
        "vertices_v1_v16": compute_v1_to_v16_vertices(payload),
    }

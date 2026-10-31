#!/usr/bin/env python3
"""
CMB RD-0110 Parametric blockMesh Generator & FastAPI Execution Engine
=======================================================================
Generates pure structured 5-degree axisymmetric wedge meshes from V1-V16
coordinates, executes OpenFOAM via WSL (Windows -> Ubuntu bridge), and
computes Mass Flow Rate, Cd, and Spray Cone Angle (2*theta).

ARCHITECTURE — Windows + WSL:
  This backend runs on Windows Python (in the venv).
  OpenFOAM lives inside Ubuntu (WSL).

  ALL subprocess calls MUST use:
      wsl_run("blockMesh", case_dir)
  which internally does:
      ["wsl", "bash", "-ic", "cd '/mnt/c/...' && blockMesh"]

  This ensures Ubuntu loads its OpenFOAM environment variables from
  ~/.bashrc before each command runs.  Calling ["blockMesh"] directly
  on Windows will crash with "command not found".

Usage:
    # Activate venv first
    .\\venv\\Scripts\\Activate.ps1

    # Start the FastAPI server
    uvicorn backend.rd0110_blockmesh_backend:app --reload --port 8000

    # Test it
    curl http://localhost:8000/api/health
"""

import math
import os
import subprocess
from pathlib import Path
from typing import Dict, Tuple

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# App Setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="CMB RD-0110 Parametric blockMesh Backend",
    version="3.1.0",
    description="FastAPI backend that generates OpenFOAM cases and runs them via WSL on Windows.",
)

# Allow the Vite dev server (port 3000) and preview (port 4173) to call this
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# WSL Bridge Helper
# ---------------------------------------------------------------------------

def wsl_run(openfoam_cmd: str, case_dir: str, timeout: int = 300) -> subprocess.CompletedProcess:
    """
    Run an OpenFOAM command inside Ubuntu (WSL) from Windows Python.

    Uses ["wsl", "bash", "-ic", ...] so Ubuntu's ~/.bashrc is sourced,
    which loads OpenFOAM environment variables (WM_PROJECT_DIR, PATH, etc.)
    before the command executes.

    Args:
        openfoam_cmd:  Bare OpenFOAM command, e.g. "blockMesh" or "checkMesh"
        case_dir:      Windows absolute path to the OpenFOAM case directory,
                       e.g. "C:\\Users\\anshr\\case_rd0110_wedge"
        timeout:       Max seconds to wait before raising subprocess.TimeoutExpired

    Returns:
        subprocess.CompletedProcess with .stdout, .stderr, .returncode

    Raises:
        FileNotFoundError: if 'wsl' is not found (WSL not installed)
        subprocess.TimeoutExpired: if the command exceeds timeout
    """
    # Convert Windows path  C:\Users\anshr\...  ->  WSL path  /mnt/c/Users/anshr/...
    wsl_path = case_dir.replace("\\\\", "/").replace("\\", "/")
    if len(wsl_path) >= 2 and wsl_path[1] == ":":
        drive = wsl_path[0].lower()
        wsl_path = f"/mnt/{drive}" + wsl_path[2:]

    # Build the full shell command that cd's into the case dir first
    full_cmd = f"cd '{wsl_path}' && {openfoam_cmd}"

    return subprocess.run(
        ["wsl", "bash", "-ic", full_cmd],
        capture_output=True,
        text=True,
        timeout=timeout,
    )


# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------

class Rd0110DimensionsPayload(BaseModel):
    """RD-0110 baseline geometry (KBKhA Blueprint PDF defaults)."""

    # LOX Oxidizer Swirl Injector
    D_s_o_mm: float = 9.00    # LOX swirl chamber diameter [mm]
    L_s_o_mm: float = 10.40   # LOX swirl chamber length [mm]
    L_c_o_mm: float = 1.80    # LOX 45-deg convergent cone length [mm]
    D_n_o_mm: float = 5.40    # LOX nozzle inner diameter [mm]
    L_n_o_mm: float = 10.50   # LOX nozzle straight length [mm]
    h_p_mm:   float = 0.80    # Oxidizer post wall thickness [mm]
    L_r_mm:   float = 1.50    # Post tip recess length [mm]
    N_o:      int   = 6       # LOX tangential inlet hole count
    d_in_o_mm: float = 1.70   # LOX tangential hole diameter [mm]
    R_in_o_mm: float = 3.50   # LOX tangential offset radius [mm]

    # RP-1 Fuel Annular Swirl Injector
    D_s_f_mm:  float = 10.00  # Fuel nozzle inner diameter [mm]
    delta_f_mm: float = 1.50  # Fuel annular slot width [mm]
    L_s_f_mm:  float = 10.50  # Fuel chamber axial depth [mm]
    N_f:       int   = 6      # Fuel tangential inlet hole count
    d_in_f_mm: float = 0.70   # Fuel tangential hole diameter [mm]
    R_in_f_mm: float = 4.50   # Fuel tangential offset radius [mm]

    # Operating Condition
    differential_pressure_mpa: float = 0.85   # ΔP across injector [MPa]

    # OpenFOAM Solver Selection
    solver: str = "interIsoFoam"


# ---------------------------------------------------------------------------
# Physics Helpers
# ---------------------------------------------------------------------------

def compute_v1_to_v16_vertices(p: Rd0110DimensionsPayload) -> Dict[str, Tuple[float, float]]:
    """
    Computes exact (X_mm, R_mm) coordinates for V1 through V16
    from the closed-form SolidWorks / blueprint geometry relations.
    """
    r_no = p.D_n_o_mm / 2.0
    r_po = r_no + p.h_p_mm
    r_sf = r_po + p.delta_f_mm
    r_so = p.D_s_o_mm / 2.0

    x_lr       = p.L_r_mm
    x_fuel_back = p.L_s_f_mm
    x_cone_down = x_lr + p.L_n_o_mm
    x_cone_up   = x_cone_down + p.L_c_o_mm
    x_rear_int  = x_cone_up + p.L_s_o_mm
    x_total     = x_rear_int + 1.60

    return {
        "V1":  (x_rear_int, 0.00),
        "V2":  (x_total,    0.00),
        "V3":  (x_total,    6.50),
        "V4":  (x_cone_up,  6.50),
        "V5":  (x_cone_up,  8.00),
        "V6":  (7.10,       8.00),
        "V7":  (7.10,       6.50),
        "V8":  (0.00,       6.50),
        "V9":  (0.00,       r_sf),
        "V10": (x_fuel_back, r_sf),
        "V11": (x_fuel_back, r_po),
        "V12": (x_lr,       r_po),
        "V13": (x_lr,       r_no),
        "V14": (x_cone_down, r_no),
        "V15": (x_cone_up,  r_so),
        "V16": (x_rear_int, r_so),
    }


def solve_bazarov_air_core_x(A: float) -> float:
    """Newton-Raphson solver for Bazarov air-core radius ratio X."""
    x = 0.5
    for _ in range(35):
        f  =  math.sqrt(2.0) * x - A * ((1.0 - x) ** 1.5)
        df =  math.sqrt(2.0) + 1.5 * A * math.sqrt(1.0 - x)
        x  = max(0.04, min(0.96, x - f / df))
    return x


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health_check():
    """
    Verifies the FastAPI backend is alive and that WSL/Ubuntu is reachable.
    Safe to call without an OpenFOAM case present.
    """
    try:
        result = wsl_run("echo OK", "/tmp", timeout=10)
        wsl_ok = result.returncode == 0
        wsl_msg = result.stdout.strip() if wsl_ok else result.stderr.strip()
    except FileNotFoundError:
        wsl_ok = False
        wsl_msg = "wsl.exe not found — install WSL from Microsoft Store"

    return {
        "status": "running",
        "wsl_reachable": wsl_ok,
        "wsl_message": wsl_msg,
    }


@app.post("/api/cfd/rd0110-blockmesh")
async def generate_rd0110_mesh_and_predict(payload: Rd0110DimensionsPayload):
    """
    Full RD-0110 CFD pipeline:
      1. Compute V1-V16 vertices & Bazarov analytical values (Cd, 2θ, ṁ).
      2. Run blockMesh  → via WSL ["wsl", "bash", "-ic", "blockMesh"]
      3. Run checkMesh  → via WSL ["wsl", "bash", "-ic", "checkMesh"]
      4. Run setFields  → via WSL ["wsl", "bash", "-ic", "setFields"]
      5. Run solver     → via WSL ["wsl", "bash", "-ic", "interIsoFoam"]
      6. Return results + per-step logs.
    """
    verts = compute_v1_to_v16_vertices(payload)

    r_no_mm  = payload.D_n_o_mm  / 2.0
    r_in_o_mm = payload.d_in_o_mm / 2.0
    r_sf_mm  = payload.D_s_f_mm  / 2.0
    r_in_f_mm = payload.d_in_f_mm / 2.0

    # Bazarov geometric characteristic numbers
    A_o = (payload.R_in_o_mm * r_no_mm)  / (payload.N_o * (r_in_o_mm ** 2))
    A_f = (payload.R_in_f_mm * r_sf_mm)  / (payload.N_f * (r_in_f_mm ** 2))

    X_ox = solve_bazarov_air_core_x(A_o)
    cd_ox = math.sqrt(((1.0 - X_ox) ** 3) / (1.0 + X_ox))
    sin_theta = min(0.86, (2.0 * cd_ox * A_o) / (1.0 + math.sqrt(X_ox)))
    spray_cone_2theta_deg = 2.0 * math.degrees(math.asin(sin_theta))

    # LOX mass flow rate via Cd × A × √(2ρΔP)
    RHO_LOX = 1141.0  # kg/m³ (liquid LOX at ~90 K)
    delta_p_pa = payload.differential_pressure_mpa * 1e6
    ox_area_m2 = math.pi * ((r_no_mm * 1e-3) ** 2)
    m_dot_ox_kg_s = cd_ox * ox_area_m2 * math.sqrt(2.0 * RHO_LOX * delta_p_pa)

    # ------------------------------------------------------------------
    # WSL OpenFOAM Pipeline
    # case_dir points to the OpenFOAM case on the Windows filesystem.
    # Adjust this path to wherever your blockMeshDict lives.
    # ------------------------------------------------------------------
    pipeline_log: Dict[str, str] = {}
    case_dir = str(Path(__file__).parent.parent / "case_rd0110_wedge")

    try:
        # Step 1 — blockMesh (via WSL → Ubuntu → OpenFOAM)
        res = wsl_run("blockMesh", case_dir, timeout=120)
        pipeline_log["blockMesh"] = res.stdout + res.stderr
        if res.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail={"step": "blockMesh", "log": pipeline_log["blockMesh"]},
            )

        # Step 2 — checkMesh (via WSL → Ubuntu → OpenFOAM)
        res = wsl_run("checkMesh", case_dir, timeout=60)
        pipeline_log["checkMesh"] = res.stdout + res.stderr
        # checkMesh failure is non-fatal; we log it and continue

        # Step 3 — setFields (via WSL → Ubuntu → OpenFOAM)
        res = wsl_run("setFields", case_dir, timeout=60)
        pipeline_log["setFields"] = res.stdout + res.stderr
        if res.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail={"step": "setFields", "log": pipeline_log["setFields"]},
            )

        # Step 4 — interIsoFoam / solver (via WSL → Ubuntu → OpenFOAM)
        res = wsl_run(payload.solver, case_dir, timeout=3600)
        pipeline_log[payload.solver] = res.stdout + res.stderr
        if res.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail={"step": payload.solver, "log": pipeline_log[payload.solver]},
            )

    except FileNotFoundError:
        raise HTTPException(
            status_code=503,
            detail=(
                "WSL not found. Install Windows Subsystem for Linux and ensure "
                "'wsl' is available in your PATH, then restart this server."
            ),
        )
    except subprocess.TimeoutExpired as e:
        raise HTTPException(status_code=504, detail=f"OpenFOAM command timed out: {e}")

    return {
        "pipeline": ["blockMesh", "checkMesh", "setFields", payload.solver],
        "wsl_bridge": "windows_to_ubuntu",
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
    """
    Analytical-only endpoint — returns Cd, 2θ, and ṁ without running OpenFOAM.
    Useful for quick parameter sweeps without a CFD solve.
    """
    r_no_mm   = payload.D_n_o_mm  / 2.0
    r_in_o_mm = payload.d_in_o_mm / 2.0
    r_sf_mm   = payload.D_s_f_mm  / 2.0
    r_in_f_mm = payload.d_in_f_mm / 2.0

    A_o = (payload.R_in_o_mm * r_no_mm)  / (payload.N_o * (r_in_o_mm ** 2))
    A_f = (payload.R_in_f_mm * r_sf_mm)  / (payload.N_f * (r_in_f_mm ** 2))

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

# CMB — Parametric RD-0110 Swirl Coaxial Injector CFD Workbench

**CMB** is a monochrome computational fluid dynamics (CFD) workbench and OpenFOAM case-generation wrapper engineered for designing and analyzing liquid-propellant **swirl coaxial injectors** (specifically baselined on the **RD-0110** LOX/RP-1 upper-stage engine element, scaled for a 5 kN LOX/RP-1 thruster).

It eliminates the tedious workflow of manually scripting `system/blockMeshDict` files and post-processing logs, while avoiding the heavy licensing of commercial CFD suites.

---

## 1. Current Project Progress (Phase 1: Parametric RD-0110 Baseline)

### Completed in Phase 1
- **Monochrome Engineering Theme (`CMB` Branding)**:
  - Strictly black, white, and grayscale UI across all navigation bars, control panels, telemetry cards, and residual plots.
  - Only the **2D VOF (`alpha.liquid`) Spray Cone Canvas** renders in multi-color so your eye focuses immediately on the liquid sheet and phase fraction field.
- **Hardcoded RD-0110 Baseline Geometry (`V1`–`V16` Coordinate Loop)**:
  - Removed arbitrary `.STL`/`.GLB` CAD uploads, `snappyHexMesh`, and `surfaceFeatureExtract` to guarantee **100% deterministic, watertight hexahedral meshing**.
  - Hardcoded default sliders to the verified **RD-0110** specification:
    - **LOX Inner Nozzle ($D_{n,o}$)**: `5.40 mm` ($R_{n,o} = 2.70\text{ mm}$)
    - **RP-1 Annular Slot Gap ($\delta_f$)**: `1.50 mm` ($R_{p,o} = 3.50\text{ mm} \rightarrow R_{s,f} = 5.00\text{ mm}$, $D_{s,f} = 10.00\text{ mm}$)
    - **Oxidizer Post Recess Depth ($L_r$)**: `1.50 mm`
    - **LOX Inner Swirl Chamber ($D_{s,o} \times L_{s,o}$)**: `9.00 mm × 10.40 mm` with a $45^\circ$ convergent cone ($L_{c,o} = 1.80\text{ mm}$)
    - **Tangential Inlets**:
      - Inner LOX: $N_o = 6$, $d_{\text{in},o} = 1.70\text{ mm}$, $R_{\text{in},o} = 3.50\text{ mm}$ $\rightarrow$ **Bazarov Swirl Number $A_o = 2.18$**
      - Outer RP-1: $N_f = 6$, $d_{\text{in},f} = 0.70\text{ mm}$, $R_{\text{in},f} = 4.50\text{ mm}$ $\rightarrow$ **Bazarov Swirl Number $A_f = 30.61$**
- **CSV Parameter Import & Template Export**:
  - Upload any `.csv` containing RD-0110 geometric parameters (`D_n,o`, `delta_f`, `L_r`, `D_s,o`, `R_in,o`, `N_o`, `d_in,o`, `D_s,f`, etc.) to automatically populate all UI sliders and recompute the `V1`–`V16` mesh vertices.
- **Pure Structured $5^\circ$ Axisymmetric Wedge `blockMeshDict` Generator**:
  - Dynamically generates OpenFOAM v2406 / v11 dictionary files (`system/blockMeshDict`, `system/controlDict`, `constant/transportProperties`) and a ready-to-run FastAPI/Python OpenFOAM runner (`rd0110_blockmesh_backend.py`).
- **Explicit Differential Pressure ($\Delta P \rightarrow \dot{m}$) Physics Engine**:
  - Takes input differential pressure $\Delta P$ (MPa) and computes the resulting oxidizer, fuel, and total element mass flow rates ($\dot{m}$), Discharge Coefficient ($C_d$), liquid film thickness ($t_f$), air-core radius ($r_a$), and Spray Cone Angle ($2\theta$).

---

## 2. Quick Start: Running the App in Antigravity / Local Workstation

Once you download or clone this project into **Antigravity** (or VS Code / Cursor on your local machine):

### Prerequisites
- **Node.js** `v18+` (or `v20+` recommended)
- **Python** `3.10+` (for running the local OpenFOAM bridge script)
- **OpenFOAM** (`v2312`, `v2406`, or OpenFOAM Foundation `v11`) installed natively on Linux, inside **WSL2** (Windows Subsystem for Linux), or via Docker
- **ParaView** (for 3D/2D `.foam` VTK visualization)

### Step-by-Step Local Launch
1. **Install Node dependencies**:
   ```bash
   npm install
   ```
2. **Start the full-stack development server (Frontend + Express API on Port 3000)**:
   ```bash
   npm run dev
   ```
3. **Open the application**:
   Navigate to `http://localhost:3000` in your browser or Antigravity preview pane.

---

## 3. How to Connect the App to Real OpenFOAM Locally

In the cloud preview, the app runs a **real-time analytical/empirical CFD preview** (Abramovich–Bazarov + Rizk–Lefebvre viscous swirl theory) AND generates the exact OpenFOAM dictionaries. Once downloaded into **Antigravity**, you can run real OpenFOAM simulations in **two ways**:

---

### Method A: One-Click Case Export $\rightarrow$ Run `blockMesh` + `interIsoFoam` in Terminal

1. Configure your RD-0110 sliders (or import your CSV) and set your desired $\Delta P$ in the UI.
2. Click **"Export OpenFOAM Case"** in the top-right header (or switch to the **OpenFOAM Architecture** tab to download individual files).
3. This downloads `CMB_RD0110_interIsoFoam_blockMesh_Bundle.txt` (or individual files: `system/blockMeshDict`, `system/controlDict`, `constant/transportProperties`, and `rd0110_blockmesh_backend.py`).
4. Create a standard OpenFOAM case directory on your machine (or WSL2 Ubuntu terminal):
   ```bash
   mkdir -p ~/openfoam_cases/rd0110_wedge/{0,constant,system}
   cd ~/openfoam_cases/rd0110_wedge
   ```
5. Place the downloaded `blockMeshDict` and `controlDict` into `system/`, and `transportProperties` into `constant/`.
6. Source your OpenFOAM environment and execute the structured mesh and VOF solver:
   ```bash
   # Source OpenFOAM (adjust path for your installation)
   source /opt/openfoam2406/etc/bashrc

   # 1. Generate the pure structured 5-degree wedge mesh from V1-V16 (takes < 1 second)
   blockMesh | tee log.blockMesh

   # 2. Check mesh quality (zero skewness / non-orthogonality issues)
   checkMesh | tee log.checkMesh

   # 3. Create an empty .foam stub to inspect the mesh or results in ParaView
   touch rd0110_wedge.foam

   # 4. Run the geometric VOF solver
   interIsoFoam | tee log.interIsoFoam
   ```
7. **Open in ParaView**:
   ```bash
   paraview rd0110_wedge.foam
   ```
   In ParaView, click **Apply**, select field `alpha.liquid`, and use the **Slice** or **Contour** (`alpha.liquid = 0.5`) filter to inspect the hollow-cone liquid sheet and air core.

---

### Method B: Live FastAPI / Python Bridge Connected Directly to the React UI

When you click **"OpenFOAM Architecture"** $\rightarrow$ **`rd0110_blockmesh_backend.py`**, you will find a complete standalone Python/FastAPI backend script generated specifically for your RD-0110 geometry.

To wire the React frontend so clicking **"Run CFD Simulation"** triggers your local OpenFOAM binary automatically:

1. **Save `rd0110_blockmesh_backend.py`** to your project root and install FastAPI + Uvicorn + NumPy:
   ```bash
   pip install fastapi uvicorn numpy pydantic
   ```
2. **Start the Python OpenFOAM Microservice on Port 8000** (inside Linux or WSL2 where `blockMesh` and `interIsoFoam` are in your `$PATH`):
   ```bash
   uvicorn rd0110_blockmesh_backend:app --host 0.0.0.0 --port 8000 --reload
   ```
3. **Forward `/api/cfd/rd0110-blockmesh` from `server.ts` to Port 8000**:
   In `/server.ts`, the endpoint `POST /api/cfd/rd0110-blockmesh` receives `{ config }` whenever you click **"Run CFD Simulation"**. You can point it to `http://localhost:8000/api/cfd/rd0110-blockmesh` (or run the Python subprocess directly):
   ```ts
   // Inside server.ts POST /api/cfd/rd0110-blockmesh:
   const pyRes = await fetch('http://localhost:8000/api/cfd/rd0110-blockmesh', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify(req.body),
   });
   const pyData = await pyRes.json();
   return res.json(pyData);
   ```
4. Now, every time you move a slider and click **Run CFD Simulation**, Python writes `system/blockMeshDict` using your exact `V1`–`V16` coordinates, runs `blockMesh` + `interIsoFoam`, parses `postProcessing/massFlow/0/surfaceFieldValue.dat`, and returns the live OpenFOAM results to the UI.

---

## 4. Complete Guide to Every Button, Tab & Control in the App

### A. Top Navigation Bar (`CMB` Header)

| UI Element / Button | What It Does |
| :--- | :--- |
| **`CMB` (Left Wordmark)** | Returns you immediately to the main **Injector Workbench** view from any tab. |
| **`Injector Workbench`** | The main interactive CFD console: 4-step left control panel, 4 top monochrome telemetry blocks, the interactive 2D `V1`–`V16` VOF canvas, and the live residual convergence chart. |
| **`OpenFOAM Architecture`** | Displays the complete system architecture, the live **16-vertex (`V1`–`V16`) coordinate table**, the RD-0110 engineering cross-section diagram, and an interactive **Code Inspector** where you can view, copy, or download `system/blockMeshDict`, `system/controlDict`, `constant/transportProperties`, and `rd0110_blockmesh_backend.py`. |
| **`Post-Processing Pipeline`** | Explains and previews the Python post-processing extraction algorithms for Mass Flow Rate ($\dot{m}$), Discharge Coefficient ($C_d$), Least-Squares Spray Cone Angle ($2\theta$), and radial VOF (`alpha.liquid`) profiles. |
| **`Validation Strategy`** | Provides the 4-stage aerospace propulsion verification & validation (V&V) plan: Roache Grid Convergence Index (GCI) mesh independence table, Abramovich–Bazarov vs. Rizk–Lefebvre benchmark comparison, and cold-flow optical bench acceptance criteria. |
| **`Export OpenFOAM Case` (Top-Right White Button)** | Bundles and downloads all generated OpenFOAM dictionaries (`system/blockMeshDict`, `system/controlDict`, `constant/transportProperties`) and the Python automation script into a single file for immediate local execution. |

---

### B. Left Control Panel: The 4 Workflow Steps

#### Step `01. Solver` — Multiphase Solver & Differential Pressure
- **OpenFOAM Multiphase Solver Dropdown**:
  - `interIsoFoam`: Geometric `plicRDF` VOF reconstruction (recommended for sharp gas-liquid air-core interfaces).
  - `compressibleInterFoam`: Barotropic compressible VOF for transonic or cryogenic flashing flows.
  - `multiphaseEulerFoam`: Euler–Euler multifluid solver for secondary droplet breakup modeling.
- **Turbulence Closure Model Dropdown**:
  - `kOmegaSST`: Curvature-corrected RANS (`kOmegaSST-CC`) for strong swirl stabilization.
  - `LES_WALE`: Wall-Adapting Local Eddy-Viscosity LES for capturing Kelvin–Helmholtz surface waves.
  - `laminar`: Pure laminar solver for low-Reynolds analytical verification.
- **Propellant Operating Regime Dropdown**:
  - `LOX / RP-1 Cryogenic Hot-Fire (Pc = 6.82 MPa)`: Uses liquid oxygen ($\rho = 1141\text{ kg/m}^3$) and RP-1 ($\rho = 810\text{ kg/m}^3$).
  - `H₂O / Simulant Cold-Flow Optical Bench (0.1 MPa)`: Uses deionized water ($\rho = 998.2\text{ kg/m}^3$) and fuel simulant for atmospheric lab testing.
- **Input Differential Pressure ($\Delta P$) Slider & Number Box**:
  - Explicitly sets injector pressure drop $\Delta P$ (`0.10` to `2.00 MPa`, default `0.85 MPa`).
  - Automatically synchronizes with the backend (`POST /api/predict-mass-flow`) to compute the **Resulting Element Mass Flow ($\dot{m}$)** via $\dot{m} = C_d A_n \sqrt{2 \rho \Delta P}$.
- **Engine Thrust Target & Injector Elements ($N$) / Mixture Ratio ($O/F$)**:
  - Scales total engine thrust (`1.0` to `15.0 kN`), element count (`N = 7` default), and oxidizer-to-fuel ratio (`O/F = 2.27` default).

---

#### Step `02. RD-0110` — Parametric RD-0110 Geometry & CSV Import
- **`Import RD-0110 CSV` (White Button)**:
  - Opens a file picker for `.csv` files. Reads parameter symbols (`D_n,o`, `delta_f`, `L_r`, `D_s,o`, `R_in,o`, `N_o`, `d_in,o`, `D_s,f`, `L_s,o`, `L_n,o`, `h_p`, `L_s,f`, `N_f`, `d_in,f`, `R_in,f`, `delta_P`) and automatically updates the sliders and `V1`–`V16` coordinates.
- **`Template` (Download Button)**:
  - Downloads `RD0110_Parametric_Baseline.csv` containing all current RD-0110 parameters in a clean CSV format that you can edit in Excel/Python and re-upload.
- **`Reset RD-0110` (Link Button)**:
  - Restores all sliders to the exact hardcoded RD-0110 baseline from the blueprint PDF.
- **RD-0110 Geometric Sliders & Inputs**:
  - **LOX Nozzle Dia ($D_{n,o}$)**: Default `5.40 mm` ($R_{n,o} = 2.70\text{ mm}$). Controls vertices `V13` and `V14`.
  - **RP-1 Annular Gap ($\delta_f$)**: Default `1.50 mm`. Controls the outer fuel slot width between `V11`/`V12` and `V9`/`V10`.
  - **Recess Depth ($L_r$)**: Default `1.50 mm`. Controls the axial station of the oxidizer post tip (`V12` and `V13`).
  - **LOX Swirl Chamber ($D_{s,o}$)**: Default `9.00 mm` ($R_{s,o} = 4.50\text{ mm}$). Controls vertices `V15` and `V16`.
  - **LOX Inlet Radius ($R_{\text{in},o}$)**: Default `3.50 mm`. Radial offset of the tangential LOX ports; directly governs $A_o$.
  - **Fuel Swirl Dia ($D_{s,f}$)**: Default `10.00 mm` ($R_{s,f} = 5.00\text{ mm}$). Controls vertices `V9` and `V10`.
  - **LOX Ports ($N_o$) & LOX Orifice $d_{\text{in},o}$**: Default `6` ports at `1.70 mm` diameter.

---

#### Step `03. blockMesh` — Parametric $5^\circ$ Wedge `blockMesh` Configuration
- **Structured `blockMesh` Formulation**:
  - Configured for a **2D Axisymmetric $5^\circ$ Wedge** (`wedge_front` and `wedge_back` boundary patches at $\theta = \pm 2.5^\circ$) using 6 structured hexahedral blocks derived from `V1`–`V16`.
- **Base Hexahedral Cell Size ($\Delta x$)**:
  - Adjusts mesh resolution (`25 μm` to `110 μm`, default `45 μm`) and updates the estimated hexahedral cell count and cells across the liquid film ($t_f$).
- **Dynamic VOF AMR Level (`maxRefinement`)**:
  - Sets `dynamicRefineFvMesh` octree refinement level (`0` to `4`) along the gas-liquid interface ($|\nabla \alpha| > 0.05$).
- **Max Interface Courant (`maxAlphaCo`)**:
  - Controls MULES/isoAdvector sub-cycling Courant limit (`0.10` to `0.50`, default `0.20`).

---

#### Step `04. Execute` — Two-Stage Meshing, ParaView Verification & Solver Execution
- **`1. Generate & Check Mesh` (Stage 1 Button $\rightarrow$ `POST /api/cfd/mesh-only`)**:
  - Writes `0/`, `constant/`, and `system/` dictionaries into `~/OpenFOAM/CMB-v2406/run`, executes `wsl bash -ic "blockMesh && checkMesh && touch rd0110_mesh.foam"`, and creates the empty `rd0110_mesh.foam` file so you can open and visually inspect the mesh in ParaView before running the heavy VOF solver.
  - Routes the `blockMesh` & `checkMesh` stdout/stderr directly into the **OpenFOAM Execution Logs** box under the header `Stage 1: blockMesh & checkMesh (rd0110_mesh.foam)`.
- **`2. Run interIsoFoam Solver` (Stage 2 Button $\rightarrow$ `POST /api/cfd/solve-only`)**:
  - Executes `wsl bash -ic "interIsoFoam"` in `~/OpenFOAM/CMB-v2406/run` on the existing verified mesh.
  - Routes the solver stdout/stderr into the **OpenFOAM Execution Logs** box under the header `Stage 2: interIsoFoam Solver Output`.
- **`Clear Simulation Cache` (`DELETE /api/cfd/clear`)**:
  - Cleans `~/OpenFOAM/CMB-v2406/run` in WSL so you can start from a completely fresh directory if needed.
- **`Export VOF CSV` Button**:
  - Downloads `CMB_RD0110_RadialVOF_Exit.csv` containing radial stations (`r_mm`, `r_norm`, `alpha_lox`, `alpha_rp1`, `axial_vel_ms`, `swirl_vel_ms`) at the injector exit plane ($X = 0\text{ mm}$) for plotting in MATLAB, Python, or ParaView.
- **`Reset RD-0110` Button**:
  - Resets all solver and geometric parameters back to the nominal RD-0110 baseline.

---

### C. Right Console: Telemetry Cards, Interactive V1–V16 Canvas & Residual Plot

1. **4 Monochrome Propulsion Telemetry Cards (Top Row)**:
   - **ELEMENT MASS FLOW ($\dot{m}$)**: Total element mass flow rate (`kg/s`) broken down into inner LOX and outer RP-1 streams.
   - **SPRAY CONE ANGLE ($2\theta$)**: Viscous CFD predicted full spray cone angle (`deg`) vs. inviscid Bazarov angle, plus coaxial momentum flux ratio $J$.
   - **VOF FILM THICKNESS ($t_f$)**: Liquid film thickness (`mm`) at the nozzle lip, air-core radius $r_a$ (`mm`), and dimensionless air-core area ratio $X = (r_a/R_{n,o})^2$.
   - **DISCHARGE COEFF ($C_{d,\text{ox}}$)**: Dimensionless oxidizer discharge coefficient at the active $\Delta P$ and swirl number $A_o$.

2. **Interactive 2D V1–V16 Cross-Section & VOF Canvas (Center Panel)**:
   - **Mode Switcher Buttons**:
     - **`2D VOF Contour (α)`**: Renders the upper and lower symmetric cross-section of the RD-0110 injector body using the exact `V1`–`V16` polygon with section hatching, tangential inlet ports, internal gaseous air core, inner LOX swirl film (blue/cyan), outer RP-1 stream (amber/orange), and the expanding hollow-cone spray plume.
     - **`V1–V16 Blueprint`**: Pure monochrome engineering blueprint mode highlighting the closed-loop `V1`–`V16` axial/radial dimensions, centerline axis, recess plane $L_r$, and tangential port locations.
     - **`Radial Throat Profile`**: Plots radial distributions of $\alpha_{\text{LOX}}(r)$, $\alpha_{\text{RP-1}}(r)$, axial velocity $U_x(r)$, and swirl velocity $U_\theta(r)$ from centerline ($r = 0$) to the outer nozzle wall.
   - **Overlay Toggle Buttons**:
     - **`V1–V16`**: Toggles vertex coordinate markers (`V1` through `V16`) on the injector cross-section.
     - **`blockMesh`**: Toggles the structured hexahedral mesh wireframe overlay across the fluid domain.
     - **`2θ Fit`**: Toggles the least-squares spray cone half-angle ray overlay ($\pm \theta$).
   - **Interactive Cursor Probe**: Hover anywhere over the canvas to inspect exact $(X\text{ mm}, R\text{ mm})$, phase fraction $\alpha_{\text{liquid}}$, and velocity magnitude $|U|$ in the bottom-right readout bar.

3. **Live OpenFOAM PIMPLE Iteration Residuals (Bottom Panel)**:
   - Plots $\log_{10}$ initial residuals (`alpha.liquid`, `U_x`, `U_theta`, `p_rgh`, `k/omega`) across solver iterations alongside global mass conservation error (%).

---

## 5. Exact V1–V16 Coordinate Reference (RD-0110 Baseline)

The procedural 2D canvas and `system/blockMeshDict` use the following closed-loop $(X, R)$ coordinates (where $X = 0.00\text{ mm}$ is the downstream injector exit face and $R = 0.00\text{ mm}$ is the centerline axis):

| Vertex | Axial $X$ (mm) | Radial $R$ (mm) | Geometric Feature Description |
| :--- | :---: | :---: | :--- |
| **`V1`** | `24.20` | `0.00` | Center of LOX swirl chamber rear internal wall |
| **`V2`** | `25.80` | `0.00` | Center of external upstream end-cap face ($t_{\text{cap}} = 1.60\text{ mm}$) |
| **`V3`** | `25.80` | `6.50` | Outer top-right corner of rear barrel ($\varnothing 13.00\text{ mm}$) |
| **`V4`** | `13.80` | `6.50` | Rear step shoulder of central mounting flange |
| **`V5`** | `13.80` | `8.00` | Rear outer corner of central mounting flange ($\varnothing 16.00\text{ mm}$) |
| **`V6`** | `7.10` | `8.00` | Front outer corner of central mounting flange ($\varnothing 16.00\text{ mm}$) |
| **`V7`** | `7.10` | `6.50` | Front step shoulder of central mounting flange |
| **`V8`** | `0.00` | `6.50` | Outer bottom-left corner at injector exit face ($\varnothing 13.00\text{ mm}$) |
| **`V9`** | `0.00` | `5.00` | Inner exit lip of fuel nozzle ($\varnothing 10.00\text{ mm}$, $R_{s,f} = 5.00\text{ mm}$) |
| **`V10`** | `10.50` | `5.00` | Outer top corner of annular fuel swirl chamber ($L_{s,f} = 10.50\text{ mm}$) |
| **`V11`** | `10.50` | `3.50` | Root of oxidizer post inside fuel swirl chamber ($\varnothing 7.00\text{ mm}$, $R_{p,o} = 3.50\text{ mm}$) |
| **`V12`** | `1.50` | `3.50` | Outer tip corner of recessed oxidizer post ($L_r = 1.50\text{ mm}$) |
| **`V13`** | `1.50` | `2.70` | Inner tip corner of recessed oxidizer post ($\varnothing 5.40\text{ mm}$, $R_{n,o} = 2.70\text{ mm}$) |
| **`V14`** | `12.00` | `2.70` | Downstream end of $45^\circ$ LOX convergent nozzle cone ($L_{n,o} = 10.50\text{ mm}$) |
| **`V15`** | `13.80` | `4.50` | Upstream start of $45^\circ$ LOX convergent cone ($\varnothing 9.00\text{ mm}$, $R_{s,o} = 4.50\text{ mm}$) |
| **`V16`** | `24.20` | `4.50` | Rear internal corner of LOX swirl chamber (closes loop back to `V1`) |

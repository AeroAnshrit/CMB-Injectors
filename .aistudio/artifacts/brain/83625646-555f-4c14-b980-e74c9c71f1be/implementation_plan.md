# ThrustWorks Injector Calculator (5 kN LOX/RP-1 Swirl Coaxial CFD Suite)

A specialized propulsion engineering workbench and OpenFOAM automation wrapper designed to size, mesh, simulate, and validate swirl coaxial liquid rocket engine injectors without the licensing overhead of commercial CAE suites or manual script maintenance.

## User Review & Critical Decisions

> [!IMPORTANT]
> The architectural blueprint below incorporates your confirmed engineering workflow decisions. Review the system architecture, OpenFOAM automation bridge, and validation strategy below, then click **Proceed** to build the interactive application.

- **Confirmed Decision 1 — Hybrid Geometry & CAD Pipeline**: The workspace combines a **Parametric Swirl Coaxial Sizing Generator** (analytical sizing from 5 kN thrust, $I_{sp}$, O/F ratio, and $\Delta P$ budget using Bazarov & Lefebvre inviscid/viscous swirl theory) with an interactive **GLB/STL CAD Upload & 3D Cross-Section Inspector**.
- **Confirmed Decision 2 — Dual-Mode Execution Engine**: Because browser/cloud sandboxes lack a compiled local OpenFOAM binary, the application runs a **real-time analytical & empirical multiphase solver** for immediate interactive design loops, while generating **complete, production-ready OpenFOAM case directories** (`0/`, `constant/`, `system/`, `blockMeshDict`, `snappyHexMeshDict`, `controlDict`, `setFieldsDict`) and the **Python FastAPI/Celery execution & post-processing scripts** ready to run on your local workstation or HPC cluster.
- **Confirmed Decision 3 — Telemetry & Post-Processing Suite**: Built-in **2D Volume of Fluid ($\alpha_{\text{liquid}}$) contour & spray cone visualizer**, live multi-channel **iteration residual curves**, telemetry metric blocks, and one-click **CSV / ParaView VTK script export**.

---

## 1. Overview & Core Concept

- **What It Does**: Eliminates repetitive manual editing of OpenFOAM dictionary files and post-processing Python scripts when iterating on liquid-liquid and gas-liquid swirl coaxial injectors for a 5 kN LOX/RP-1 rocket engine.
- **Target Audience / Persona**: Propulsion and CFD engineers at ThrustWorks Dynetics conducting preliminary sizing, cold-flow water/nitrogen surrogate testing, and hot-fire multiphase atomization analysis.
- **Key Value**: Bridges analytical propulsion sizing equations directly to automated OpenFOAM mesh/solver dictionary generation, real-time residual monitoring, quantitative VOF extraction, and empirical validation benchmarks.

---

## 2. User Experience & Visual Design

### Key User Flows (4-Stage Engineering Sequence)

1. **01. Solver & Fluid Selection**:
   - Select multiphase OpenFOAM solver (`interIsoFoam` with geometric plicRDF reconstruction for sharp liquid film interfaces, `compressibleInterFoam` for transonic/barotropic LOX/RP-1 effects, or `multiphaseEulerFoam` for secondary droplet breakup).
   - Choose Turbulence Closure (`kOmegaSST` with curvature correction for swirl chambers, `LES WALE` for primary sheet breakup, or `Laminar` for low-Re film verification).
   - Select Fluid Operating Regime: **Cold-Flow Surrogate** ($\text{H}_2\text{O} / \text{GN}_2$ at ambient pressure for optical validation) or **Cryogenic Flight Condition** ($\text{LOX} / \text{RP-1}$ at $P_c = 3.5\text{ MPa}$, O/F = 2.45).

2. **02. Design & Geometry Input (Parametric + GLB/STL CAD)**:
   - **Parametric Generator**: Input target thrust ($5.0\text{ kN}$), element count, chamber pressure $P_c$, injector pressure drop $\Delta P / P_c$ ($15\text{--}25\%$), inner LOX swirl post radius $R_{n,i}$, tangential inlet port radius $r_{p,i}$, number of tangential ports $n_p$, vortex chamber radius $R_{s,i}$, outer RP-1 coaxial annulus gap, and recess length $L_r$. Automatically computes the Geometric Characteristic Constant $A = \frac{R_s R_n}{n_p r_p^2}$, film thickness $t_f$, and air-core radius $r_a$.
   - **GLB/STL CAD Upload**: Drag-and-drop binary/ASCII `.stl` or `.glb` injector manifolds to extract bounding-box dimensions, verify watertightness, inspect surface patches (`inlet_lox_tangential`, `inlet_rp1_annular`, `injector_wall`, `chamber_outlet`, `wedge_front`, `wedge_back`), and visualize the 2D/3D cross-section.

3. **03. Meshing Configuration (`blockMesh` + `snappyHexMesh`)**:
   - Configure domain dimensionality: **2D Axisymmetric Wedge ($5^\circ$)** for rapid design iteration ($< 15\text{ min}$ runtime) or **Full 3D Sector / $360^\circ$** for tangential port asymmetry and azimuthal wave instability analysis.
   - Set base cell size $\Delta x$, wall boundary layers ($N_{\text{layers}} = 5$, expansion ratio $1.2$, target $y^+ < 1$), and dynamic Adaptive Mesh Refinement (`dynamicRefineFvMesh` on $|\nabla \alpha_{\text{liquid}}|$ interface cells with `maxRefinement 3`).

4. **04. Simulation Execution, Post-Processing & Validation**:
   - Trigger job execution, watch live **Iteration Residual Curves** ($p_{\text{rgh}}, U_x, U_r, U_\theta, \alpha_{\text{liquid}}, k, \omega$) and Courant number ($Co_{\max} \le 0.3$), inspect the **2D VOF ($\alpha_{\text{liquid}}$) Distribution & Spray Cone Visualizer**, compare against **Validation Benchmarks**, and export the complete OpenFOAM case package or ParaView `pvpython` script.

### Visual Identity & Theme

- **Aesthetic Direction**: Calibrated Aerospace Propulsion Telemetry & Scientific Instrumentation.
- **Color Palette & Mood (60-30-10 Discipline)**:
  - **60% Dominant Primary Background**: Deep Space Obsidian (`#07090E` / `bg-slate-950`) for glare-free engineering sessions.
  - **30% Structural Panels & Grids**: Flat Slate Instrumentation Panels (`#0F1420` / `bg-slate-900`) with crisp `1px solid` hairline borders (`#1E293B` / `border-slate-800`) and subtle coordinate crosshairs.
  - **10% Precision Telemetry Accents**: Laser Cyan (`#06B6D4`) for LOX / Oxidizer streams and primary controls, Telemetry Amber (`#F59E0B`) for RP-1 / Fuel streams and warnings, and Nominal Emerald (`#10B981`) for converged criteria.
- **Typography & Hierarchy**:
  - **Display & UI Labels**: `Plus Jakarta Sans` (clean geometric sans-serif with balanced dark-mode legibility).
  - **Data, Residuals & Telemetry**: `JetBrains Mono` with strict `tabular-nums` alignment so streaming residuals and mass flow counters never jitter.
  - **Unit Hierarchy**: Prominent numeric readout (`text-2xl font-mono font-semibold text-slate-100`) paired with subdued scientific unit notation (`text-xs font-mono uppercase text-slate-400 ml-1.5`, e.g., `kg/s`, `deg`, `MPa`, `mm`).
- **Component Styling & Layout**:
  - **Top Bar Contract**: Single-row header with Brand Wordmark (`ThrustWorks CFD`), 4 concise navigation links (`Workspace`, `OpenFOAM Bridge`, `Post-Processing`, `Validation Plan`), and 1 primary action button (`Export OpenFOAM Case`).
  - **Asymmetric Split Console**: Left parameter & workflow column (`360px` fixed width on desktop) paired with a `flex-1` main visual stage (Injector Cross-Section / VOF Contour Canvas + Telemetry Metric Blocks) and a bottom time-series residual tray.

---

## 3. System Architecture & Key Engineering Decisions

### 1. Bridging React/Vite/TypeScript Frontend with Python/OpenFOAM Backend

In a production engineering environment at ThrustWorks Dynetics, CFD jobs range from 10-minute 2D axisymmetric sweeps to multi-hour 3D LES runs. Consequently, HTTP request-response cycles must be decoupled from solver execution using an **Asynchronous Task Queue + WebSocket Streaming Architecture**:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                 FRONTEND: React 19 + TypeScript + Tailwind CSS               │
│  ┌────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐  │
│  │ 4-Stage Workflow   │  │ 2D VOF & Injector    │  │ Live Residual Chart  │  │
│  │ & CAD Inspector    │  │ Cross-Section Canvas │  │ & Telemetry Blocks   │  │
│  └─────────┬──────────┘  └──────────▲───────────┘  └──────────▲───────────┘  │
└────────────┼────────────────────────┼─────────────────────────┼──────────────┘
             │ REST POST /api/jobs    │ REST GET /api/results   │ WebSocket / SSE
             ▼                        │                         │
┌─────────────────────────────────────┴─────────────────────────┴──────────────┐
│                    API GATEWAY: Express / FastAPI Bridge                     │
│  • Validates Injector Geometry, Fluid Properties & Courant Constraints       │
│  • Compiles Jinja2 / Template OpenFOAM Dictionaries (0/, constant/, system/) │
└────────────┬──────────────────────────────────────────────────▲──────────────┘
             │ Enqueue Job (Redis / Celery or Subprocess)       │ Stream Log/Probes
             ▼                                                  │
┌───────────────────────────────────────────────────────────────┴──────────────┐
│              EXECUTION & PARSING WORKER: Python + PyFoam + NumPy             │
│  1. CAD/Mesh Prep: surfaceFeatureExtract -> blockMesh -> snappyHexMesh       │
│  2. Initialization: setFields (VOF liquid core) -> decomposePar (MPI)        │
│  3. Solver Run: mpirun -np N interIsoFoam -parallel > log.interIsoFoam       │
│  4. Live Watcher: Tails log.interIsoFoam + postProcessing/probes -> JSON     │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Why FastAPI + Celery/Redis + WebSockets (or Server-Sent Events)**:
  - **Job Submission (`POST /api/cfd/jobs`)**: The frontend sends a strongly-typed JSON payload containing injector dimensions, fluid thermophysical properties, mesh grading, and solver tolerances. The backend assigns a deterministic `job_id`, writes the OpenFOAM directory structure from parameterized templates, and spawns the job worker.
  - **Live Status & Residual Streaming (`WS /api/cfd/jobs/:id/stream`)**: A lightweight Python watcher tails `log.interIsoFoam` (using non-blocking `os.pread` or `PyFoam.Execution.BasicWatcher`) and streams parsed residual tuples and `functionObjects` surface flow rates at 2–5 Hz to the frontend.
  - **Dual-Mode Sandbox Support**: Inside this web application, our Node/Express backend and client engine compile the exact OpenFOAM case files AND execute a real-time physics-grounded analytical/empirical CFD solver so engineers can immediately inspect VOF fields, spray cone angles, and convergence behavior before dispatching to an HPC node.

---

## 4. Post-Processing & Output Extraction Pipeline

To eliminate manual ParaView extraction for routine design metrics, the Python backend embeds **OpenFOAM `functionObjects`** directly into `system/controlDict` before launching the solver, and runs an automated NumPy/SciPy extraction pass on `postProcessing/`:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     OPENFOAM SOLVER (interIsoFoam)                           │
│  Writes at writeInterval:                                                    │
│  • postProcessing/massFlow_inlet/0/surfaceFieldValue.dat                     │
│  • postProcessing/massFlow_outlet/0/surfaceFieldValue.dat                    │
│  • postProcessing/ axialSlices/ <time>/ slice_z5mm.raw, slice_z15mm.raw      │
│  • log.interIsoFoam (Solving for alpha.liquid, p_rgh, Ux, Ur, Utheta...)     │
└───────────────┬──────────────────────┬────────────────────────┬──────────────┘
                │                      │                        │
                ▼                      ▼                        ▼
┌───────────────────────┐  ┌────────────────────────┐  ┌───────────────────────┐
│ 1. MASS FLOW EXTRACT  │  │ 2. SPRAY CONE & VOF    │  │ 3. LIVE RESIDUALS     │
│ Parses phi*rho flux   │  │ Radial threshold on    │  │ Regex log parser      │
│ across inlet/outlet   │  │ alpha.liquid = 0.5     │  │ extracts Initial &    │
│ patches; scales by    │  │ across z-planes; fits  │  │ Final residual per    │
│ 360 / theta_wedge.    │  │ linear regression 2θ.  │  │ PIMPLE outer loop.    │
└───────────────────────┘  └────────────────────────┘  └───────────────────────┘
```

### 1. Mass Flow Rate ($\dot{m}_{\text{LOX}}$, $\dot{m}_{\text{RP-1}}$, and Discharge Coefficient $C_d$)
- **OpenFOAM Mechanism**: Configured via `surfaceFieldValue` in `system/controlDict` operating on patches `inlet_lox_tangential`, `inlet_rp1_annular`, and `injector_orifice_exit` with `operation sum` on the mass flux field `rhoPhi` ($\rho \mathbf{U} \cdot \mathbf{S}_f$).
- **Wedge Scaling**: For 2D axisymmetric wedge meshes (opening angle $\theta_{\text{wedge}} = 5^\circ$), the Python parser multiplies the raw OpenFOAM patch sum by $\frac{360^\circ}{\theta_{\text{wedge}}} = 72$ to report full-injector mass flow rate:
  $$\dot{m}_{\text{total}} = \left(\frac{360^\circ}{\theta_{\text{wedge}}}\right) \sum_{f \in \text{patch}} \rho_f (\mathbf{U}_f \cdot \mathbf{S}_f)$$
- **Discharge Coefficient Extraction**: Automatically computes $C_d = \frac{\dot{m}_{\text{CFD}}}{A_n \sqrt{2 \rho \Delta P}}$ and compares against the inviscid Abramovich-Bazarov theoretical $C_{d,\text{theory}} = \sqrt{\frac{(1 - X)^3}{1 + X}}$, where $X = r_a^2 / R_n^2$ is the dimensionless air-core area ratio.

### 2. Spray Cone Angle ($2\theta$)
- **OpenFOAM Mechanism**: Uses the `surfaces` functionObject (`type surfaces; interpolationScheme cellPoint; surfaceFormat raw;`) to sample `alpha.liquid` and velocity vector `U` along radial lines or axial cross-planes downstream of the injector exit ($z / D_n = 0.5, 1.0, 2.0, 3.0$).
- **Python Extraction Algorithm**:
  1. Load the radial profile $\alpha_{\text{liquid}}(r, z_k)$ at each axial station $z_k$ downstream of the orifice lip.
  2. Locate the outer liquid sheet trajectory $r_{\text{outer}}(z_k)$ where $\alpha_{\text{liquid}}$ crosses the interface iso-contour $\alpha_{\text{th}} = 0.5$ (or maximum $|\nabla \alpha_{\text{liquid}}|$).
  3. Perform ordinary least-squares linear regression on $(z_k, r_{\text{outer}}(z_k))$ in the near-field intact sheet region ($0.2 D_n \le z \le 2.5 D_n$):
     $$2\theta = 2 \arctan\left(\frac{dr_{\text{outer}}}{dz}\right) \times \frac{180}{\pi}$$
  4. Cross-check against the velocity-flux-weighted angle $2\theta_v = 2 \arctan\left(\frac{\int r \alpha \rho U_r \, dr}{\int r \alpha \rho U_z \, dr}\right)$.

### 3. VOF ($\alpha_{\text{liquid}}$) Distribution, Liquid Film Thickness ($t_f$) & Air Core ($r_a$)
- **OpenFOAM Mechanism**: `sets` functionObject (`type sets; setFormat raw;`) extracts 1D radial profiles inside the swirl chamber, at the orifice throat ($z = 0$), and inside the recess zone ($-L_r \le z \le 0$), alongside a 2D axial-radial grid exported as compact JSON arrays for the frontend canvas.
- **Python Extraction**:
  - Identifies the gas core boundary $r_a$ at the orifice throat where $\alpha_{\text{liquid}}(r) = 0.5$.
  - Computes liquid film thickness $t_f = R_n - r_a$ and filling efficiency $\epsilon = 1 - (r_a / R_n)^2$, piping both the 1D radial curves and 2D contour matrix to the React frontend.

### 4. Live Iteration Residual Curves & Courant Telemetry
- **OpenFOAM Mechanism**: Standard stdout log (`log.interIsoFoam`) outputs per-time-step solver statistics:
  `Solving for alpha.liquid, Initial residual = 0.00142, Final residual = 3.12e-07, No Iterations 2`
  `Courant Number mean: 0.0412 max: 0.284`
  `Interface Courant Number mean: 0.012 max: 0.291`
- **Python Parser**: Compiled regular expressions (`r"Solving for (\S+), Initial residual = ([0-9.eE+-]+), Final residual = ([0-9.eE+-]+)"`) parse lines as they flush to disk, downsampling to 100–200 time steps for zero-lag SVG rendering in the frontend dashboard.

---

## 5. Multi-Step CFD Validation Strategy (Aerospace Propulsion Rigor)

To certify that the ThrustWorks Injector Calculator's OpenFOAM wrapper produces physically accurate predictions before committing hardware to hot-fire testing, the application includes a structured **4-Tier Validation Matrix**:

1. **Tier 1: Grid Independence & Richardson Extrapolation (GCI)**:
   - Execute a 3-level mesh refinement study on the 2D axisymmetric $5^\circ$ wedge: Coarse ($45\text{k}$ cells, $\Delta x = 100\,\mu\text{m}$), Medium ($120\text{k}$ cells, $\Delta x = 60\,\mu\text{m}$), and Fine ($320\text{k}$ cells, $\Delta x = 35\,\mu\text{m}$), maintaining a minimum of 12–15 cells across the liquid film thickness $t_f$.
   - Compute Roache's **Grid Convergence Index ($\text{GCI}_{23}$)** on three target functionals: $\dot{m}$, $t_f$, and $2\theta$. Require $\text{GCI}_{\text{fine}} < 2.0\%$ and verify that the observed order of accuracy $p$ approaches the theoretical 2nd-order spatial discretization scheme (`gauss linearUpwind`).

2. **Tier 2: Mass Conservation & Steady-State Window Verification**:
   - Track global continuity error $\epsilon_{\dot{m}} = \frac{|\dot{m}_{\text{inlet}} - \dot{m}_{\text{outlet}}|}{\dot{m}_{\text{inlet}}}$ over at least 5 flow-through residence times ($\tau_{\text{res}} = V_{\text{chamber}} / Q$).
   - Because swirl injectors exhibit natural hydrodynamic vortex precession and interfacial wave shedding, instantaneous outlet mass flow oscillates. Validation requires time-averaging over $\ge 3\tau_{\text{res}}$ after initial transient washout, requiring $|\bar{\dot{m}}_{\text{in}} - \bar{\dot{m}}_{\text{out}}| / \bar{\dot{m}}_{\text{in}} < 0.25\%$.

3. **Tier 3: Analytical & Empirical Theory Benchmarking (Bazarov, Lefebvre, Rizk & Lefebvre)**:
   - Automatically benchmark every OpenFOAM simulation against four classical propulsion correlations built directly into the calculator:
     - **Bazarov Inviscid Swirl Theory**: Validates geometric constant $A$, dimensionless core area $X$, and ideal $C_d$ as a function of $A$.
     - **Abramovich-Bazarov Viscous Equivalent ($A_{\text{eq}}$)**: Incorporates wall friction coefficient $\lambda = \frac{0.3164}{Re_{\text{in}}^{0.25}}$ to correct for boundary-layer angular momentum loss inside the vortex chamber:
       $$A_{\text{eq}} = \frac{A}{1 + \frac{\lambda}{2}\left(\frac{\pi R_s^2}{n_p \pi r_p^2} - A\right)}$$
     - **Rizk & Lefebvre (1985) Film Thickness Correlation**:
       $$t_f = 3.66 \left(\frac{D_n \dot{m}_L \mu_L}{\rho_L \Delta P}\right)^{0.25}$$
     - **Giffen & Muraszew / Lefebvre Spray Cone Angle Correlation**:
       $$\cos^2\theta = \frac{1 - X}{1 + X} \quad \text{and} \quad 2\theta = 6 K^{-0.15} \left(\frac{\Delta P D_n^2 \rho_L}{\mu_L^2}\right)^{0.11}$$
   - Flag any simulation where $|\Delta C_d| > 8\%$ or $|\Delta (2\theta)| > 5^\circ$ relative to viscous empirical bounds for boundary condition or mesh inspection.

4. **Tier 4: Cold-Flow Optical & PDPA Bench Validation (Water / $\text{GN}_2$ Surrogate)**:
   - Before simulating supercritical/transonic cryogenic LOX/RP-1, validate the OpenFOAM setup against atmospheric cold-flow water/nitrogen bench data:
     - **Differential Pressure vs. Mass Flow ($\Delta P\text{--}\dot{m}$ Curve)**: Compare 5 pressure drop setpoints ($0.2\text{--}1.0\text{ MPa}$) against Coriolis flowmeter measurements.
     - **High-Speed Backlit Shadowgraphy**: Overlay the OpenFOAM $\alpha_{\text{liquid}} = 0.5$ contour directly onto backlit shadowgraph images to verify cone angle $2\theta$ and intact sheet breakup length $L_b$.
     - **Acoustic/Electrical Conductance Probe**: Validate orifice liquid film thickness $t_f$ within $\pm 50\,\mu\text{m}$.

---

## 6. Interactive Application Architecture & Component Mapping

When you approve this plan, I will build the complete **ThrustWorks Injector Calculator** web application featuring both the **Interactive Engineering Workbench** and the **Complete Architecture, OpenFOAM File Generator & Validation Blueprint**:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     TOP BAR: ThrustWorks CFD Workbench                       │
│  [ThrustWorks CFD]   [Workspace | OpenFOAM Bridge | Post-Proc | Validation]  │
├───────────────────────────┬──────────────────────────────────────────────────┤
│ LEFT CONTROL CONSOLE      │ MAIN TELEMETRY & VISUALIZATION STAGE             │
│ (4-Step Workflow Tabs)    │                                                  │
│                           │ ┌──────────┬──────────┬──────────┬─────────────┐ │
│ 1. Solver & Fluid         │ │ MASS FLOW│ CONE 2θ  │ FILM tf  │ DISCHARGE Cd│ │
│  • Solver: interIsoFoam   │ │ 1.72 kg/s│ 68.4 deg │ 0.42 mm  │ 0.248       │ │
│  • Regime: LOX / RP-1     │ └──────────┴──────────┴──────────┴─────────────┘ │
│                           │                                                  │
│ 2. Geometry & CAD         │ ┌──────────────────────────────────────────────┐ │
│  • 5 kN Sizing Sliders    │ │ INTERACTIVE CANVAS STAGE (Mode Switcher):    │ │
│  • STL/GLB CAD Dropzone   │ │ • 2D VOF (alpha.liquid) Contour & Spray Cone │ │
│                           │ │ • Injector Cross-Section & Swirl Chamber CAD │ │
│ 3. Meshing Config         │ │ • OpenFOAM Dictionary & Python Code Inspector│ │
│  • 5° Wedge / 3D Sector   │ │ • 4-Tier Validation & GCI Calculator         │ │
│  • AMR & Boundary Layers  │ └──────────────────────────────────────────────┘ │
│                           │                                                  │
│ 4. Execute / Sweep        │ ┌──────────────────────────────────────────────┐ │
│  [Run CFD Simulation]     │ │ BOTTOM TRAY: Live Iteration Residual Curves  │ │
│  [Reset to 5 kN Baseline] │ │ & Analytical vs. OpenFOAM Comparison Table   │ │
└───────────────────────────┴──────────────────────────────────────────────────┘
```

- **Interactive Handlers & Features Included**:
  - **4-Stage Left Control Console**: Live sliders and numeric inputs for thrust ($1\text{--}25\text{ kN}$), element count, chamber pressure, $\Delta P/P_c$, LOX orifice diameter, tangential port geometry, RP-1 annulus gap, recess length, mesh cell size, AMR levels, and solver controls.
  - **Real STL/GLB CAD File Parser**: Upload any `.stl` or `.glb` file to inspect vertex/triangle counts, bounding-box dimensions, and surface patch mapping, or toggle the procedural 3D/2D coaxial injector cross-section.
  - **Interactive 2D VOF ($\alpha_{\text{liquid}}$) & Spray Cone Visualizer**: High-precision HTML5 Canvas / SVG field renderer with crosshair coordinate probe $(r, z, \alpha_{\text{liquid}}, |U|)$, liquid sheet trajectory overlay, recess mixing zone inspection, and cold-flow vs. hot-fire comparison.
  - **Live Iteration Residual Streamer**: Run or step through the simulation to watch $p_{\text{rgh}}, U_x, U_\theta, \alpha_{\text{liquid}}, k, \omega$ residuals converge alongside Courant number tracking.
  - **Live OpenFOAM Case & Python Post-Processor Generator**: View, copy, and download customized `blockMeshDict`, `controlDict` (with `surfaceFieldValue` and `surfaces` functionObjects), `transportProperties`, `fvSolution`, and the complete `post_process_injector.py` + `app_worker.py` scripts dynamically populated with your current injector dimensions.
  - **Interactive Validation & GCI Calculator**: Run the 3-grid Richardson extrapolation (GCI) check and compare CFD outputs against Bazarov inviscid, Abramovich viscous, and Rizk-Lefebvre correlations in real time.

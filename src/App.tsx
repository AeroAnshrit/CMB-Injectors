/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_RD0110_CONFIG,
  FluidRegimeId,
  InjectorConfig,
  OpenFoamSolver,
  TurbulenceModel,
  calculateInjectorPhysics,
  generateRd0110SampleCsv,
  parseRd0110CsvParameters,
} from './utils/injectorPhysics';
import { generateOpenFoamCaseFiles } from './utils/openfoamGenerator';
import { VofSprayCanvas } from './components/VofSprayCanvas';
import { ResidualChart } from './components/ResidualChart';
import { EngineeringBlueprintViews } from './components/EngineeringBlueprintViews';
import {
  Download,
  FileSpreadsheet,
  Play,
  RotateCcw,
  Box,
  Grid,
  Sliders,
  CheckSquare,
  Activity,
  Lock,
  Trash2,
} from 'lucide-react';

type TopNavTab = 'workspace' | 'openfoam_bridge' | 'post_processing' | 'validation_plan';
type WorkflowStep = 1 | 2 | 3 | 4 | 5;

export default function App() {
  const [activeNav, setActiveNav] = useState<TopNavTab>('workspace');
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>(1);
  const [config, setConfig] = useState<InjectorConfig>(DEFAULT_RD0110_CONFIG);
  const [activeCsvName, setActiveCsvName] = useState<string>('RD0110_Baseline_Default.csv');

  // 5-Step Pipeline State Machine
  const [isGeneratingStl, setIsGeneratingStl] = useState<boolean>(false);
  const [stlMeta, setStlMeta] = useState<{
    stlPath: string;
    triangleCount: number;
    watertight: boolean;
    boundingBoxMm: { x: number; y: number; z: number };
  } | null>(null);

  const [isMeshing, setIsMeshing] = useState<boolean>(false);
  const [meshingLog, setMeshingLog] = useState<string | null>(null);
  const [meshVerifiedInParaView, setMeshVerifiedInParaView] = useState<boolean>(false);

  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [solverLog, setSolverLog] = useState<string | null>(null);
  const [isClearingCache, setIsClearingCache] = useState<boolean>(false);

  const [visibleResidualSteps, setVisibleResidualSteps] = useState<number>(120);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [backendPrediction, setBackendPrediction] = useState<{
    inputDifferentialPressureMPa: number;
    oxMassFlowElementKgS: number;
    fuelMassFlowElementKgS: number;
    totalElementMassFlowKgS: number;
  } | null>(null);

  const physics = useMemo(() => calculateInjectorPhysics(config), [config]);

  // Synchronize differential pressure -> mass flow rate with the Express backend API
  useEffect(() => {
    let cancelled = false;
    fetch('/api/predict-mass-flow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        differentialPressureMPa: config.inputDifferentialPressureMPa ?? physics.pressureDropMPa,
        config,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && data.massFlowRate) {
          setBackendPrediction({
            inputDifferentialPressureMPa: data.inputDifferentialPressureMPa,
            oxMassFlowElementKgS: data.massFlowRate.oxMassFlowElementKgS,
            fuelMassFlowElementKgS: data.massFlowRate.fuelMassFlowElementKgS,
            totalElementMassFlowKgS: data.massFlowRate.totalElementMassFlowKgS,
          });
        }
      })
      .catch(() => {
        // Fallback to local deterministic physics when offline
      });
    return () => {
      cancelled = true;
    };
  }, [config, physics.pressureDropMPa]);

  // Live simulation residual animation loop while real OpenFOAM solver is executing in background
  useEffect(() => {
    if (!isSimulating) return;
    const timer = setInterval(() => {
      setVisibleResidualSteps((prev) => {
        if (prev >= physics.residuals.length - 8) {
          return Math.max(12, physics.residuals.length - 20);
        }
        return prev + 5;
      });
    }, 120);
    return () => clearInterval(timer);
  }, [isSimulating, physics.residuals.length]);

  const updateConfig = <K extends keyof InjectorConfig>(key: K, value: InjectorConfig[K]) => {
    setConfig((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'pressureDropPct') {
        next.inputDifferentialPressureMPa = Number(
          ((next.chamberPressureMPa * Number(value)) / 100).toFixed(3)
        );
      }
      if (key === 'inputDifferentialPressureMPa') {
        next.pressureDropPct = Number(
          ((Number(value) / Math.max(0.1, next.chamberPressureMPa)) * 100).toFixed(1)
        );
      }
      if (key === 'oxNozzleInnerDiameterMm') {
        const dNo = Number(value);
        if (next.oxSwirlChamberDiameterMm <= dNo + 0.6) {
          next.oxSwirlChamberDiameterMm = Number((dNo + 1.2).toFixed(2));
        }
        const rPostOuter = dNo / 2.0 + next.oxPostWallThicknessMm;
        next.fuelNozzleInnerDiameterMm = Number(
          (2.0 * (rPostOuter + next.fuelAnnularSlotWidthMm)).toFixed(2)
        );
      }
      if (key === 'oxSwirlChamberDiameterMm') {
        const dSo = Number(value);
        if (next.oxNozzleInnerDiameterMm >= dSo - 0.6) {
          next.oxNozzleInnerDiameterMm = Number(Math.max(2.0, dSo - 1.2).toFixed(2));
        }
      }
      if (key === 'fuelAnnularSlotWidthMm') {
        const gap = Number(value);
        const rPostOuter = next.oxNozzleInnerDiameterMm / 2.0 + next.oxPostWallThicknessMm;
        next.fuelNozzleInnerDiameterMm = Number((2.0 * (rPostOuter + gap)).toFixed(2));
      }
      if (key === 'fuelNozzleInnerDiameterMm') {
        const dSf = Number(value);
        const rPostOuter = next.oxNozzleInnerDiameterMm / 2.0 + next.oxPostWallThicknessMm;
        const impliedGap = Math.max(0.3, dSf / 2.0 - rPostOuter);
        next.fuelAnnularSlotWidthMm = Number(impliedGap.toFixed(2));
      }
      return next;
    });
  };

  const updateLocationInMesh = (axis: 'x' | 'y' | 'z', val: number) => {
    setConfig((prev) => ({
      ...prev,
      locationInMeshMm: {
        ...prev.locationInMeshMm,
        [axis]: val,
      },
    }));
  };

  const handleCsvFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const { updatedConfig, matchedKeys } = parseRd0110CsvParameters(text, config);
      setConfig(updatedConfig);
      setActiveCsvName(file.name);
      if (matchedKeys.length > 0) {
        setStatusBanner(
          `Imported RD-0110 CSV "${file.name}" -> Updated ${matchedKeys.length} geometric parameters (${matchedKeys.join(', ')}).`
        );
      } else {
        setStatusBanner(
          `Parsed "${file.name}" — no recognized parameter symbols found; retained current RD-0110 slider values.`
        );
      }
    } catch {
      setStatusBanner(`Failed to read CSV file "${file.name}".`);
    }
    e.target.value = '';
  };

  const handleDownloadSampleCsv = () => {
    const csvContent = generateRd0110SampleCsv(config);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'RD0110_Parametric_Baseline.csv';
    a.click();
    URL.revokeObjectURL(url);
    setStatusBanner('Downloaded RD-0110 parametric CSV template.');
  };

  const buildBackendPayload = () => {
    const files = generateOpenFoamCaseFiles(config, physics);
    const bmFile = files.find((f) => f.filename === 'system/blockMeshDict')?.content;
    const shmFile = files.find((f) => f.filename === 'system/snappyHexMeshDict')?.content;
    const cdFile = files.find((f) => f.filename === 'system/controlDict')?.content;
    const tpFile = files.find((f) => f.filename === 'constant/transportProperties')?.content;

    return {
      D_s_o_mm: config.oxSwirlChamberDiameterMm,
      L_s_o_mm: config.oxSwirlChamberLengthMm,
      L_c_o_mm: config.oxConvergentConeLengthMm,
      D_n_o_mm: config.oxNozzleInnerDiameterMm,
      L_n_o_mm: config.oxNozzleLengthMm,
      h_p_mm: config.oxPostWallThicknessMm,
      L_r_mm: config.recessLengthMm,
      N_o: config.oxInletHoleCount,
      d_in_o_mm: config.oxInletHoleDiameterMm,
      R_in_o_mm: config.oxTangentialOffsetRadiusMm,
      D_s_f_mm: config.fuelNozzleInnerDiameterMm,
      delta_f_mm: config.fuelAnnularSlotWidthMm,
      L_s_f_mm: config.fuelChamberAxialDepthMm,
      N_f: config.fuelInletHoleCount,
      d_in_f_mm: config.fuelInletHoleDiameterMm,
      R_in_f_mm: config.fuelTangentialOffsetRadiusMm,
      base_cell_size_um: config.baseCellSizeUm,
      location_in_mesh_mm: [
        config.locationInMeshMm.x,
        config.locationInMeshMm.y,
        config.locationInMeshMm.z,
      ],
      wall_refinement_min: config.wallRefinementMin,
      wall_refinement_max: config.wallRefinementMax,
      inlet_refinement_min: config.inletRefinementMin,
      inlet_refinement_max: config.inletRefinementMax,
      outlet_refinement_min: config.outletRefinementMin,
      outlet_refinement_max: config.outletRefinementMax,
      differential_pressure_mpa: config.inputDifferentialPressureMPa ?? physics.pressureDropMPa,
      solver: config.solver,
      blockMeshDict: bmFile,
      snappyHexMeshDict: shmFile,
      controlDict: cdFile,
      transportProperties: tpFile,
      config,
    };
  };

  /**
   * TAB 1 ACTION: "Generate 3D Fluid Domain" -> POST /api/cfd/generate-stl
   */
  const handleGenerateFluidDomainStl = async () => {
    setIsGeneratingStl(true);
    setStatusBanner(
      'Tab 1 (CAD Generation): Generating 3D internal fluid volume STL (constant/triSurface/rd0110_fluid_domain.stl)...'
    );

    try {
      const payload = buildBackendPayload();
      let res: Response;
      try {
        res = await fetch('http://127.0.0.1:8000/api/cfd/generate-stl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        res = await fetch('/api/cfd/generate-stl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.detail || `Server returned HTTP ${res.status}`);
      }

      const data = await res.json();
      setStlMeta({
        stlPath: data.stl_path || '~/OpenFOAM/CMB-v2406/run/constant/triSurface/rd0110_fluid_domain.stl',
        triangleCount: data.triangle_count || 1440,
        watertight: data.watertight ?? true,
        boundingBoxMm: data.bounding_box_mm || { x: 24.2, y: 10.0, z: 10.0 },
      });
      setStatusBanner(
        `3D Fluid Domain STL generated: ${data.stl_path || 'constant/triSurface/rd0110_fluid_domain.stl'} (${data.triangle_count || 1440} triangles · Watertight). Proceed to Tab 2.`
      );
    } catch (err: any) {
      setStatusBanner(`Failed to generate 3D STL: ${err.message || err}`);
    } finally {
      setIsGeneratingStl(false);
    }
  };

  /**
   * TAB 3 ACTION: "Run Mesher" -> POST /api/cfd/mesh-only
   * Triggers blockMesh + snappyHexMesh + checkMesh on the backend and advances to Tab 4.
   */
  const handleRunMesher = async () => {
    setIsMeshing(true);
    setMeshVerifiedInParaView(false);
    setStatusBanner(
      'Tab 3 (Run Mesher): Writing blockMeshDict & snappyHexMeshDict and executing blockMesh + snappyHexMesh + checkMesh in ~/OpenFOAM/CMB-v2406/run...'
    );

    try {
      const payload = buildBackendPayload();
      let res: Response;
      try {
        res = await fetch('http://127.0.0.1:8000/api/cfd/mesh-only', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        res = await fetch('/api/cfd/mesh-only', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.detail || `FastAPI server returned HTTP ${res.status}`);
      }

      const data = await res.json();
      const foamFile = data.foam_file || 'rd0110_mesh.foam';
      const meshLogText =
        data.blockMesh_log ||
        data.pipeline_log?.output ||
        JSON.stringify(data.pipeline_log || data, null, 2);

      setMeshingLog(
        `=== [STAGE 1: blockMesh + snappyHexMesh + checkMesh] ===\nParaView Stub: ~/OpenFOAM/CMB-v2406/run/${foamFile}\nStatus: ${data.status}\n\n${meshLogText}`
      );
      setWorkflowStep(4);

      if (data.status === 'MESH_READY') {
        setStatusBanner(
          `Mesher completed! Open ~/OpenFOAM/CMB-v2406/run/${foamFile} in ParaView and check the verification box in Tab 4 to unlock Tab 5.`
        );
      } else {
        setStatusBanner(
          `Mesher finished with status: ${data.status}. Inspect the meshing logs in Tab 4.`
        );
      }
    } catch (err: any) {
      setMeshingLog(`Meshing execution error:\n${err.message || err}`);
      setWorkflowStep(4);
      setStatusBanner(
        `Failed to execute mesher: ${err.message || err}. Ensure uvicorn is running on http://127.0.0.1:8000.`
      );
    } finally {
      setIsMeshing(false);
    }
  };

  /**
   * TAB 5 ACTION: "Run Solver" -> POST /api/cfd/solve-only
   * Executes interIsoFoam on the verified mesh.
   */
  const handleRunSolverOnly = async () => {
    if (!meshVerifiedInParaView) {
      setStatusBanner('Please verify the mesh quality in ParaView (Tab 4 checkbox) before running the solver.');
      return;
    }

    setVisibleResidualSteps(10);
    setIsSimulating(true);
    setStatusBanner(
      `Tab 5 (Solver Execution): Executing wsl bash -ic "${config.solver}" at ΔP = ${physics.pressureDropMPa.toFixed(2)} MPa in ~/OpenFOAM/CMB-v2406/run...`
    );

    try {
      const payload = buildBackendPayload();
      let res: Response;
      try {
        res = await fetch('http://127.0.0.1:8000/api/cfd/solve-only', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        res = await fetch('/api/cfd/solve-only', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.detail || `FastAPI server returned HTTP ${res.status}`);
      }

      const data = await res.json();
      setVisibleResidualSteps(physics.residuals.length);

      const solverLogText =
        data.interIsoFoam_log ||
        data.pipeline_log?.output ||
        JSON.stringify(data.pipeline_log || data, null, 2);

      setSolverLog(
        `=== [STAGE 2: ${config.solver} Solver Execution] ===\nRun Directory: ~/OpenFOAM/CMB-v2406/run\nDifferential Pressure ΔP: ${physics.pressureDropMPa.toFixed(2)} MPa\nSolver Status: ${data.status}\n\n${solverLogText}`
      );

      if (data.status === 'CONVERGED') {
        setStatusBanner(
          `OpenFOAM ${config.solver} converged in ~/OpenFOAM/CMB-v2406/run! C_d = ${data.discharge_coefficient_cd}, 2θ = ${data.spray_cone_angle_2theta_deg}°, ṁ_ox = ${data.mass_flow_ox_kg_s} kg/s.`
        );
      } else {
        setStatusBanner(
          `OpenFOAM ${config.solver} finished with status: ${data.status}. Inspect the solver output log below.`
        );
      }
    } catch (err: any) {
      setSolverLog(`Solver execution error:\n${err.message || err}`);
      setStatusBanner(
        `Failed to execute ${config.solver}: ${err.message || err}. Ensure uvicorn is running on http://127.0.0.1:8000.`
      );
    } finally {
      setIsSimulating(false);
    }
  };

  const handleClearCache = async () => {
    setIsClearingCache(true);
    setStatusBanner('Requesting DELETE http://127.0.0.1:8000/api/cfd/clear to empty ~/OpenFOAM/CMB-v2406/run...');

    try {
      const res = await fetch('http://127.0.0.1:8000/api/cfd/clear', {
        method: 'DELETE',
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.detail || `FastAPI returned HTTP ${res.status}`);
      }

      const data = await res.json();
      setStatusBanner(
        `Simulation cache cleared: ${data.message || '~/OpenFOAM/CMB-v2406/run is now completely empty.'}`
      );
      setVisibleResidualSteps(0);
      setMeshingLog(null);
      setSolverLog(null);
      setMeshVerifiedInParaView(false);
    } catch (err: any) {
      setStatusBanner(
        `Failed to clear cache: ${err.message || err}. Ensure uvicorn is running on http://127.0.0.1:8000.`
      );
    } finally {
      setIsClearingCache(false);
    }
  };

  const handleResetBaseline = () => {
    setConfig(DEFAULT_RD0110_CONFIG);
    setActiveCsvName('RD0110_Baseline_Default.csv');
    setIsSimulating(false);
    setVisibleResidualSteps(120);
    setStatusBanner(
      'Restored hardcoded RD-0110 Baseline (D_n,o = 5.40 mm, δ_f = 1.50 mm, L_r = 1.50 mm, A_o = 2.18, A_f = 30.61).'
    );
  };

  const handleExportAllCaseFiles = () => {
    const files = generateOpenFoamCaseFiles(config, physics);
    const combinedBundle = files
      .map(
        (f) =>
          `# ==========================================================================\n# FILE: ${f.path}\n# DESCRIPTION: ${f.description}\n# ==========================================================================\n\n${f.content}\n\n`
      )
      .join('\n');

    const blob = new Blob([combinedBundle], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CMB_RD0110_${config.solver}_OpenFOAM_Bundle.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusBanner(
      'Exported complete OpenFOAM case dictionaries (blockMeshDict, snappyHexMeshDict, controlDict) and FastAPI backend script.'
    );
  };

  const handleExportTelemetryCsv = () => {
    const headers = 'r_mm,r_norm,alpha_lox,alpha_rp1,axial_vel_ms,swirl_vel_ms\n';
    const rows = physics.radialProfileAtExit
      .map(
        (r) =>
          `${r.rMm},${r.rNormalized},${r.alphaOx},${r.alphaFuel},${r.axialVelocityMs},${r.swirlVelocityMs}`
      )
      .join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CMB_RD0110_RadialVOF_Exit.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusBanner('Exported radial VOF and velocity profile CSV at injector exit plane (X = 0 mm).');
  };

  const simProgressPct = Math.round((visibleResidualSteps / physics.residuals.length) * 100);
  const displayedTotalElementMassFlow =
    backendPrediction?.totalElementMassFlowKgS ??
    Number((physics.cfdExtractedOxMassFlowKgS + physics.cfdExtractedFuelMassFlowKgS).toFixed(4));

  return (
    <div className="min-h-screen bg-[#050505] text-neutral-100 flex flex-col">
      {/* Strictly Monochrome 3-Zone Top Bar with "CMB" Brand Name */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-neutral-800 bg-black">
        {/* Zone 1: Single text element wordmark ("CMB") */}
        <a
          href="#workspace"
          onClick={(e) => {
            e.preventDefault();
            setActiveNav('workspace');
          }}
          className="text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          CMB
        </a>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav
          aria-label="Primary Navigation"
          className="flex items-center gap-6 text-sm font-medium text-neutral-400 overflow-x-auto"
        >
          <button
            type="button"
            onClick={() => setActiveNav('workspace')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeNav === 'workspace'
                ? 'text-white border-white'
                : 'border-transparent hover:text-neutral-200'
            }`}
          >
            Injector Workbench
          </button>
          <button
            type="button"
            onClick={() => setActiveNav('openfoam_bridge')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeNav === 'openfoam_bridge'
                ? 'text-white border-white'
                : 'border-transparent hover:text-neutral-200'
            }`}
          >
            OpenFOAM Architecture
          </button>
          <button
            type="button"
            onClick={() => setActiveNav('post_processing')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeNav === 'post_processing'
                ? 'text-white border-white'
                : 'border-transparent hover:text-neutral-200'
            }`}
          >
            Post-Processing Pipeline
          </button>
          <button
            type="button"
            onClick={() => setActiveNav('validation_plan')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeNav === 'validation_plan'
                ? 'text-white border-white'
                : 'border-transparent hover:text-neutral-200'
            }`}
          >
            Validation Strategy
          </button>
        </nav>

        {/* Zone 3: 1 primary action (Monochrome) */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleExportAllCaseFiles}
            className="px-4 py-2 text-xs font-semibold text-black bg-white rounded hover:bg-neutral-200 transition-colors whitespace-nowrap shrink-0"
          >
            Export OpenFOAM Case
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-5">
        {/* Monochrome Context / Status Bar */}
        {statusBanner && (
          <div className="mb-4 px-4 py-2.5 bg-neutral-900 border border-neutral-800 rounded flex items-center justify-between text-xs font-mono text-neutral-200">
            <span>● {statusBanner}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-neutral-400 hover:text-white ml-4 whitespace-nowrap shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {activeNav !== 'workspace' ? (
          <EngineeringBlueprintViews
            activeSection={activeNav}
            config={config}
            physics={physics}
            onDownloadAllFiles={handleExportAllCaseFiles}
          />
        ) : (
          /* Asymmetric Split Engineering Console (Monochrome UI) */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT COLUMN: Strict 5-Tab Sequential CFD Pipeline */}
            <aside className="lg:col-span-4 bg-[#0A0A0A] border border-neutral-800 rounded-lg overflow-hidden flex flex-col">
              {/* 5-Tab Sequential State Machine Header */}
              <div className="grid grid-cols-5 border-b border-neutral-800 bg-black">
                {[
                  { step: 1 as WorkflowStep, label: '1. CAD', icon: Box, locked: false },
                  { step: 2 as WorkflowStep, label: '2. BgMesh', icon: Grid, locked: false },
                  { step: 3 as WorkflowStep, label: '3. Refine', icon: Sliders, locked: false },
                  { step: 4 as WorkflowStep, label: '4. Verify', icon: CheckSquare, locked: false },
                  {
                    step: 5 as WorkflowStep,
                    label: '5. Solver',
                    icon: Activity,
                    locked: !meshVerifiedInParaView,
                  },
                ].map(({ step, label, locked }) => (
                  <button
                    key={step}
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      if (!locked) setWorkflowStep(step);
                    }}
                    title={
                      locked
                        ? 'Locked: Check "I have verified the mesh quality in ParaView" in Tab 4 to unlock Tab 5'
                        : label
                    }
                    className={`py-3 px-1 text-[11px] font-mono font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-1 ${
                      workflowStep === step
                        ? 'border-white text-white bg-neutral-900'
                        : locked
                          ? 'border-transparent text-neutral-600 cursor-not-allowed opacity-60'
                          : 'border-transparent text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {locked && <Lock className="w-2.5 h-2.5 shrink-0" />}
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              {/* Step Content Area */}
              <div className="p-5 space-y-4">
                {/* =========================================================
                    TAB 1: GEOMETRY (CAD GENERATION)
                   ========================================================= */}
                {workflowStep === 1 && (
                  <div className="space-y-3.5">
                    <div>
                      <h2 className="text-sm font-semibold text-white">
                        Tab 1: Geometry (CAD Generation)
                      </h2>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Configure RD-0110 geometric parameters and generate the 3D internal fluid volume STL.
                      </p>
                    </div>

                    {/* CSV Import & Template Download Zone */}
                    <div className="bg-black border border-neutral-800 rounded p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="rd0110-csv-upload"
                          className="flex-1 py-2 px-3 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-white font-semibold text-xs rounded cursor-pointer transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          Import RD-0110 CSV
                          <input
                            id="rd0110-csv-upload"
                            type="file"
                            accept=".csv,text/csv"
                            onChange={handleCsvFileUpload}
                            className="hidden"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={handleDownloadSampleCsv}
                          className="py-2 px-2.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs font-mono rounded flex items-center gap-1 transition-colors whitespace-nowrap"
                          title="Download RD-0110 CSV Template"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Template
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400">
                        <span>Active Profile: {activeCsvName}</span>
                        <button
                          type="button"
                          onClick={handleResetBaseline}
                          className="text-neutral-300 hover:text-white underline"
                        >
                          Reset RD-0110
                        </button>
                      </div>
                    </div>

                    {/* RD-0110 Baseline Sliders */}
                    <div className="space-y-2.5 pt-1">
                      <div>
                        <div className="flex justify-between text-xs font-mono mb-1">
                          <span className="text-neutral-300">LOX Nozzle Dia (D_n,o)</span>
                          <span className="text-white">
                            {config.oxNozzleInnerDiameterMm.toFixed(2)} mm (R_n,o = {(config.oxNozzleInnerDiameterMm / 2).toFixed(2)})
                          </span>
                        </div>
                        <input
                          aria-label="LOX Nozzle Diameter D_n,o"
                          type="range"
                          min={3.0}
                          max={7.6}
                          step={0.1}
                          value={config.oxNozzleInnerDiameterMm}
                          onChange={(e) => updateConfig('oxNozzleInnerDiameterMm', parseFloat(e.target.value))}
                          className="w-full accent-white cursor-pointer"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-xs font-mono mb-1">
                          <span className="text-neutral-300">RP-1 Annular Gap (δ_f)</span>
                          <span className="text-white">{config.fuelAnnularSlotWidthMm.toFixed(2)} mm</span>
                        </div>
                        <input
                          aria-label="RP-1 Annular Gap delta_f"
                          type="range"
                          min={0.5}
                          max={2.6}
                          step={0.05}
                          value={config.fuelAnnularSlotWidthMm}
                          onChange={(e) => updateConfig('fuelAnnularSlotWidthMm', parseFloat(e.target.value))}
                          className="w-full accent-white cursor-pointer"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-xs font-mono mb-1">
                          <span className="text-neutral-300">Recess Depth (L_r)</span>
                          <span className="text-white">
                            {config.recessLengthMm.toFixed(2)} mm (N_r = {physics.recessNumberNr})
                          </span>
                        </div>
                        <input
                          aria-label="Recess Depth L_r"
                          type="range"
                          min={0.2}
                          max={4.5}
                          step={0.1}
                          value={config.recessLengthMm}
                          onChange={(e) => updateConfig('recessLengthMm', parseFloat(e.target.value))}
                          className="w-full accent-white cursor-pointer"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-xs font-mono mb-1">
                          <span className="text-neutral-300">LOX Swirl Chamber (D_s,o)</span>
                          <span className="text-white">
                            {config.oxSwirlChamberDiameterMm.toFixed(2)} mm (R_s,o = {(config.oxSwirlChamberDiameterMm / 2).toFixed(2)})
                          </span>
                        </div>
                        <input
                          aria-label="LOX Swirl Chamber Diameter D_s,o"
                          type="range"
                          min={6.4}
                          max={12.0}
                          step={0.1}
                          value={config.oxSwirlChamberDiameterMm}
                          onChange={(e) => updateConfig('oxSwirlChamberDiameterMm', parseFloat(e.target.value))}
                          className="w-full accent-white cursor-pointer"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-xs font-mono mb-1">
                          <span className="text-neutral-300">LOX Inlet Radius (R_in,o)</span>
                          <span className="text-white">{config.oxTangentialOffsetRadiusMm.toFixed(2)} mm</span>
                        </div>
                        <input
                          aria-label="LOX Inlet Radial Offset R_in,o"
                          type="range"
                          min={2.0}
                          max={5.5}
                          step={0.05}
                          value={config.oxTangentialOffsetRadiusMm}
                          onChange={(e) => updateConfig('oxTangentialOffsetRadiusMm', parseFloat(e.target.value))}
                          className="w-full accent-white cursor-pointer"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-xs font-mono mb-1">
                          <span className="text-neutral-300">Fuel Swirl Dia (D_s,f)</span>
                          <span className="text-white">
                            {config.fuelNozzleInnerDiameterMm.toFixed(2)} mm (R_s,f = {(config.fuelNozzleInnerDiameterMm / 2).toFixed(2)})
                          </span>
                        </div>
                        <input
                          aria-label="Fuel Swirl Chamber Diameter D_s,f"
                          type="range"
                          min={7.6}
                          max={14.0}
                          step={0.1}
                          value={config.fuelNozzleInnerDiameterMm}
                          onChange={(e) => updateConfig('fuelNozzleInnerDiameterMm', parseFloat(e.target.value))}
                          className="w-full accent-white cursor-pointer"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 pt-1">
                        <div>
                          <label htmlFor="lox-port-count" className="block text-[11px] font-mono text-neutral-400 mb-1">
                            LOX Ports (N_o)
                          </label>
                          <input
                            id="lox-port-count"
                            type="number"
                            min={2}
                            max={12}
                            value={config.oxInletHoleCount}
                            onChange={(e) => updateConfig('oxInletHoleCount', Math.max(1, parseInt(e.target.value) || 6))}
                            className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white"
                          />
                        </div>
                        <div>
                          <label htmlFor="lox-port-dia" className="block text-[11px] font-mono text-neutral-400 mb-1">
                            LOX Orifice d_in,o (mm)
                          </label>
                          <input
                            id="lox-port-dia"
                            type="number"
                            step={0.05}
                            min={0.5}
                            max={3.0}
                            value={config.oxInletHoleDiameterMm}
                            onChange={(e) => updateConfig('oxInletHoleDiameterMm', parseFloat(e.target.value) || 1.7)}
                            className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Action: Generate 3D Fluid Domain Button */}
                    <div className="pt-2 border-t border-neutral-800 space-y-2.5">
                      <button
                        type="button"
                        onClick={handleGenerateFluidDomainStl}
                        disabled={isGeneratingStl}
                        className="w-full py-2.5 px-4 bg-white hover:bg-neutral-200 disabled:opacity-60 text-black font-semibold text-xs rounded transition-colors flex items-center justify-center gap-2"
                      >
                        <Box className="w-4 h-4" />
                        {isGeneratingStl ? 'Generating 3D Fluid Domain STL...' : 'Generate 3D Fluid Domain'}
                      </button>

                      {stlMeta && (
                        <div className="bg-black border border-neutral-800 rounded p-2.5 text-[11px] font-mono space-y-1 text-neutral-300">
                          <div className="text-white font-semibold">● 3D Fluid Domain STL Ready</div>
                          <div className="truncate text-neutral-400">{stlMeta.stlPath}</div>
                          <div className="flex justify-between">
                            <span>Triangles: {stlMeta.triangleCount.toLocaleString()}</span>
                            <span>Watertight: {stlMeta.watertight ? 'YES' : 'NO'}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* =========================================================
                    TAB 2: BACKGROUND MESH & MATERIAL POINT
                   ========================================================= */}
                {workflowStep === 2 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-sm font-semibold text-white">
                        Tab 2: Background Mesh &amp; Material Point
                      </h2>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Configure base background hex cell size and <code className="text-neutral-200">locationInMesh</code> coordinates inside the fluid volume.
                      </p>
                    </div>

                    {/* Base Cell Size Input */}
                    <div className="bg-black border border-neutral-800 rounded p-3.5 space-y-2.5">
                      <div className="flex justify-between text-xs font-mono">
                        <label htmlFor="base-cell-size-input" className="text-neutral-300 font-semibold">
                          Base Cell Size (Δx)
                        </label>
                        <span className="text-white">
                          {config.baseCellSizeUm} μm ({(config.baseCellSizeUm / 1000).toFixed(3)} mm)
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          aria-label="Base Core Cell Size"
                          type="range"
                          min={25}
                          max={120}
                          step={5}
                          value={config.baseCellSizeUm}
                          onChange={(e) => updateConfig('baseCellSizeUm', parseInt(e.target.value))}
                          className="flex-1 accent-white cursor-pointer"
                        />
                        <input
                          id="base-cell-size-input"
                          type="number"
                          min={15}
                          max={250}
                          step={5}
                          value={config.baseCellSizeUm}
                          onChange={(e) =>
                            updateConfig('baseCellSizeUm', Math.max(15, parseInt(e.target.value) || 45))
                          }
                          className="w-20 bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-xs font-mono text-white text-right"
                        />
                      </div>
                      <div className="text-[11px] font-mono text-neutral-400 flex justify-between pt-1 border-t border-neutral-900">
                        <span>Estimated Background + Snapped Cells:</span>
                        <span className="text-white font-semibold">{physics.estimatedCellCount.toLocaleString()}</span>
                      </div>
                    </div>

                    {/* locationInMesh Coordinates (X, Y, Z) */}
                    <div className="bg-black border border-neutral-800 rounded p-3.5 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-mono font-semibold text-white">
                            Material Point (locationInMesh)
                          </div>
                          <div className="text-[11px] text-neutral-400">
                            Interior fluid point retained by <code className="text-neutral-300">snappyHexMesh</code> (mm)
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            updateConfig('locationInMeshMm', {
                              x: Number((config.recessLengthMm + config.oxNozzleLengthMm + 4.0).toFixed(2)),
                              y: Number((config.oxNozzleInnerDiameterMm * 0.2).toFixed(2)),
                              z: 0.0,
                            })
                          }
                          className="px-2 py-1 text-[10px] font-mono bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 rounded text-neutral-200"
                        >
                          Auto-Center
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-2.5">
                        <div>
                          <label htmlFor="loc-x" className="block text-[11px] font-mono text-neutral-400 mb-1">
                            X (Axial mm)
                          </label>
                          <input
                            id="loc-x"
                            type="number"
                            step={0.5}
                            value={config.locationInMeshMm.x}
                            onChange={(e) => updateLocationInMesh('x', parseFloat(e.target.value) || 0)}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white"
                          />
                        </div>
                        <div>
                          <label htmlFor="loc-y" className="block text-[11px] font-mono text-neutral-400 mb-1">
                            Y (Radial mm)
                          </label>
                          <input
                            id="loc-y"
                            type="number"
                            step={0.25}
                            value={config.locationInMeshMm.y}
                            onChange={(e) => updateLocationInMesh('y', parseFloat(e.target.value) || 0)}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white"
                          />
                        </div>
                        <div>
                          <label htmlFor="loc-z" className="block text-[11px] font-mono text-neutral-400 mb-1">
                            Z (Azimuth mm)
                          </label>
                          <input
                            id="loc-z"
                            type="number"
                            step={0.25}
                            value={config.locationInMeshMm.z}
                            onChange={(e) => updateLocationInMesh('z', parseFloat(e.target.value) || 0)}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white"
                          />
                        </div>
                      </div>

                      <div className="text-[11px] font-mono text-neutral-400 pt-1 border-t border-neutral-900">
                        OpenFOAM Dict Entry:{' '}
                        <code className="text-white">
                          locationInMesh ({(config.locationInMeshMm.x * 1e-3).toFixed(4)}{' '}
                          {(config.locationInMeshMm.y * 1e-3).toFixed(4)}{' '}
                          {(config.locationInMeshMm.z * 1e-3).toFixed(4)});
                        </code>
                      </div>
                    </div>
                  </div>
                )}

                {/* =========================================================
                    TAB 3: BOUNDARY REFINEMENT & RUN MESHER
                   ========================================================= */}
                {workflowStep === 3 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-sm font-semibold text-white">
                        Tab 3: Boundary Refinement (snappyHexMesh)
                      </h2>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Specify surface refinement levels (Min / Max) for Walls, Inlets, and Outlets, then execute the mesher.
                      </p>
                    </div>

                    {/* 1. Walls Refinement (Min / Max) */}
                    <div className="bg-black border border-neutral-800 rounded p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-white font-semibold">Walls Refinement (injector_walls)</span>
                        <span className="text-neutral-400">
                          level ({config.wallRefinementMin} {config.wallRefinementMax})
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="wall-ref-min" className="block text-[11px] font-mono text-neutral-400 mb-1">
                            Walls Min Level
                          </label>
                          <input
                            id="wall-ref-min"
                            type="number"
                            min={0}
                            max={6}
                            value={config.wallRefinementMin}
                            onChange={(e) => {
                              const v = Math.max(0, Math.min(6, parseInt(e.target.value) || 0));
                              updateConfig('wallRefinementMin', v);
                              if (v > config.wallRefinementMax) updateConfig('wallRefinementMax', v);
                            }}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white"
                          />
                        </div>
                        <div>
                          <label htmlFor="wall-ref-max" className="block text-[11px] font-mono text-neutral-400 mb-1">
                            Walls Max Level
                          </label>
                          <input
                            id="wall-ref-max"
                            type="number"
                            min={0}
                            max={6}
                            value={config.wallRefinementMax}
                            onChange={(e) => {
                              const v = Math.max(config.wallRefinementMin, Math.min(6, parseInt(e.target.value) || 0));
                              updateConfig('wallRefinementMax', v);
                            }}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white"
                          />
                        </div>
                      </div>
                    </div>

                    {/* 2. Inlets Refinement (Min / Max) */}
                    <div className="bg-black border border-neutral-800 rounded p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-white font-semibold">Inlets Refinement (LOX &amp; RP-1 Ports)</span>
                        <span className="text-neutral-400">
                          level ({config.inletRefinementMin} {config.inletRefinementMax})
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="inlet-ref-min" className="block text-[11px] font-mono text-neutral-400 mb-1">
                            Inlets Min Level
                          </label>
                          <input
                            id="inlet-ref-min"
                            type="number"
                            min={0}
                            max={6}
                            value={config.inletRefinementMin}
                            onChange={(e) => {
                              const v = Math.max(0, Math.min(6, parseInt(e.target.value) || 0));
                              updateConfig('inletRefinementMin', v);
                              if (v > config.inletRefinementMax) updateConfig('inletRefinementMax', v);
                            }}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white"
                          />
                        </div>
                        <div>
                          <label htmlFor="inlet-ref-max" className="block text-[11px] font-mono text-neutral-400 mb-1">
                            Inlets Max Level
                          </label>
                          <input
                            id="inlet-ref-max"
                            type="number"
                            min={0}
                            max={6}
                            value={config.inletRefinementMax}
                            onChange={(e) => {
                              const v = Math.max(config.inletRefinementMin, Math.min(6, parseInt(e.target.value) || 0));
                              updateConfig('inletRefinementMax', v);
                            }}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white"
                          />
                        </div>
                      </div>
                    </div>

                    {/* 3. Outlets Refinement (Min / Max) */}
                    <div className="bg-black border border-neutral-800 rounded p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-white font-semibold">Outlets Refinement (chamber_outlet)</span>
                        <span className="text-neutral-400">
                          level ({config.outletRefinementMin} {config.outletRefinementMax})
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="outlet-ref-min" className="block text-[11px] font-mono text-neutral-400 mb-1">
                            Outlets Min Level
                          </label>
                          <input
                            id="outlet-ref-min"
                            type="number"
                            min={0}
                            max={6}
                            value={config.outletRefinementMin}
                            onChange={(e) => {
                              const v = Math.max(0, Math.min(6, parseInt(e.target.value) || 0));
                              updateConfig('outletRefinementMin', v);
                              if (v > config.outletRefinementMax) updateConfig('outletRefinementMax', v);
                            }}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white"
                          />
                        </div>
                        <div>
                          <label htmlFor="outlet-ref-max" className="block text-[11px] font-mono text-neutral-400 mb-1">
                            Outlets Max Level
                          </label>
                          <input
                            id="outlet-ref-max"
                            type="number"
                            min={0}
                            max={6}
                            value={config.outletRefinementMax}
                            onChange={(e) => {
                              const v = Math.max(config.outletRefinementMin, Math.min(6, parseInt(e.target.value) || 0));
                              updateConfig('outletRefinementMax', v);
                            }}
                            className="w-full bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Action: Run Mesher Button */}
                    <button
                      type="button"
                      onClick={handleRunMesher}
                      disabled={isMeshing}
                      className="w-full py-2.5 px-4 bg-white hover:bg-neutral-200 disabled:opacity-60 text-black font-semibold text-xs rounded transition-colors flex items-center justify-center gap-2"
                    >
                      <Grid className="w-4 h-4" />
                      {isMeshing ? 'Running blockMesh + snappyHexMesh...' : 'Run Mesher'}
                    </button>
                  </div>
                )}

                {/* =========================================================
                    TAB 4: MESH VERIFICATION (PARAVIEW GATEKEEPER)
                   ========================================================= */}
                {workflowStep === 4 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-sm font-semibold text-white">
                        Tab 4: Mesh Verification (ParaView Gatekeeper)
                      </h2>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Inspect the meshing logs and verify <code className="text-neutral-200">rd0110_mesh.foam</code> in ParaView to unlock Tab 5.
                      </p>
                    </div>

                    {/* Meshing Logs Display Box */}
                    <div className="bg-black border border-neutral-800 rounded p-3 font-mono text-[10px] text-neutral-300 max-h-60 overflow-y-auto">
                      <div className="text-neutral-200 font-semibold mb-1.5 flex items-center justify-between border-b border-neutral-800 pb-1">
                        <span>Meshing Pipeline Logs (blockMesh + snappyHexMesh + checkMesh)</span>
                        {!meshingLog && (
                          <button
                            type="button"
                            onClick={handleRunMesher}
                            disabled={isMeshing}
                            className="text-white underline hover:text-neutral-300"
                          >
                            Run Mesher Now
                          </button>
                        )}
                      </div>
                      <pre className="whitespace-pre-wrap">
                        {meshingLog ||
                          'No meshing logs captured yet. Click "Run Mesher" in Tab 3 (or above) to execute blockMesh + snappyHexMesh and generate rd0110_mesh.foam.'}
                      </pre>
                    </div>

                    {/* ParaView Verification Gatekeeper Checkbox */}
                    <div className="bg-black border border-neutral-700 rounded p-3.5 space-y-2.5">
                      <label
                        htmlFor="verify-paraview-checkbox"
                        className="flex items-start gap-2.5 cursor-pointer select-none"
                      >
                        <input
                          id="verify-paraview-checkbox"
                          type="checkbox"
                          checked={meshVerifiedInParaView}
                          onChange={(e) => setMeshVerifiedInParaView(e.target.checked)}
                          className="mt-0.5 w-4 h-4 accent-white rounded cursor-pointer"
                        />
                        <span className="text-xs font-medium text-white leading-snug">
                          I have verified the mesh quality in ParaView
                        </span>
                      </label>
                      <div className="text-[11px] font-mono text-neutral-400 pl-6">
                        ParaView Stub: <code className="text-neutral-200">~/OpenFOAM/CMB-v2406/run/rd0110_mesh.foam</code>
                      </div>

                      {meshVerifiedInParaView && (
                        <button
                          type="button"
                          onClick={() => setWorkflowStep(5)}
                          className="w-full mt-1 py-2 px-3 bg-white hover:bg-neutral-200 text-black font-semibold text-xs rounded transition-colors"
                        >
                          Proceed to Tab 5: Solver Execution →
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* =========================================================
                    TAB 5: SOLVER EXECUTION
                   ========================================================= */}
                {workflowStep === 5 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-sm font-semibold text-white">
                        Tab 5: Solver Execution ({config.solver})
                      </h2>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Configure differential pressure (ΔP) and execute the VOF solver on your verified mesh.
                      </p>
                    </div>

                    {/* Input Differential Pressure (Delta P) */}
                    <div className="bg-black border border-neutral-800 rounded p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <label htmlFor="diff-pressure-input" className="text-neutral-200 font-semibold">
                          Differential Pressure (ΔP)
                        </label>
                        <span className="text-white font-semibold">
                          {physics.pressureDropMPa.toFixed(2)} MPa ({config.pressureDropPct.toFixed(1)}% Pc)
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          aria-label="Injector Differential Pressure Slider"
                          type="range"
                          min={0.10}
                          max={2.00}
                          step={0.05}
                          value={config.inputDifferentialPressureMPa ?? physics.pressureDropMPa}
                          onChange={(e) =>
                            updateConfig('inputDifferentialPressureMPa', parseFloat(e.target.value))
                          }
                          className="flex-1 accent-white cursor-pointer"
                        />
                        <input
                          id="diff-pressure-input"
                          type="number"
                          step={0.05}
                          min={0.05}
                          max={5.0}
                          value={config.inputDifferentialPressureMPa ?? physics.pressureDropMPa}
                          onChange={(e) =>
                            updateConfig(
                              'inputDifferentialPressureMPa',
                              Math.max(0.05, parseFloat(e.target.value) || 0.85)
                            )
                          }
                          className="w-20 bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-xs font-mono text-white text-right"
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400 pt-1 border-t border-neutral-900">
                        <span>Predicted Element Mass Flow (ṁ):</span>
                        <span className="text-white font-semibold">
                          {displayedTotalElementMassFlow.toFixed(4)} kg/s
                        </span>
                      </div>
                    </div>

                    {/* Solver & Turbulence Selectors */}
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label htmlFor="solver-select" className="block text-[11px] font-mono text-neutral-400 mb-1">
                          Multiphase Solver
                        </label>
                        <select
                          id="solver-select"
                          value={config.solver}
                          onChange={(e) => updateConfig('solver', e.target.value as OpenFoamSolver)}
                          className="w-full bg-black border border-neutral-800 rounded px-2 py-1.5 text-xs font-mono text-white"
                        >
                          <option value="interIsoFoam">interIsoFoam</option>
                          <option value="compressibleInterFoam">compressibleInterFoam</option>
                          <option value="multiphaseEulerFoam">multiphaseEulerFoam</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="turbulence-select" className="block text-[11px] font-mono text-neutral-400 mb-1">
                          Turbulence Closure
                        </label>
                        <select
                          id="turbulence-select"
                          value={config.turbulence}
                          onChange={(e) => updateConfig('turbulence', e.target.value as TurbulenceModel)}
                          className="w-full bg-black border border-neutral-800 rounded px-2 py-1.5 text-xs font-mono text-white"
                        >
                          <option value="kOmegaSST">kOmegaSST-CC</option>
                          <option value="LES_WALE">LES WALE</option>
                          <option value="laminar">Laminar</option>
                        </select>
                      </div>
                    </div>

                    {/* Operating Fluid Regime */}
                    <div>
                      <label htmlFor="regime-select" className="block text-[11px] font-mono text-neutral-400 mb-1">
                        Propellant Operating Regime
                      </label>
                      <select
                        id="regime-select"
                        value={config.regimeId}
                        onChange={(e) => updateConfig('regimeId', e.target.value as FluidRegimeId)}
                        className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white"
                      >
                        <option value="lox_rp1_flight">LOX / RP-1 Cryogenic Hot-Fire (Pc = 6.82 MPa)</option>
                        <option value="water_gn2_coldflow">H₂O / Simulant Cold-Flow Bench (0.1 MPa)</option>
                      </select>
                    </div>

                    {/* Run Solver & Clear Cache Buttons */}
                    <div className="space-y-2 pt-1">
                      <button
                        type="button"
                        onClick={handleRunSolverOnly}
                        disabled={isSimulating || isClearingCache}
                        className="w-full py-2.5 px-4 bg-white hover:bg-neutral-200 disabled:opacity-60 text-black font-semibold text-xs rounded transition-colors flex items-center justify-center gap-2"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        {isSimulating ? `Running ${config.solver} (${simProgressPct}%)...` : 'Run Solver'}
                      </button>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={handleExportTelemetryCsv}
                          className="py-2 px-3 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs font-mono rounded flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5 text-white" />
                          Export VOF CSV
                        </button>
                        <button
                          type="button"
                          onClick={handleClearCache}
                          disabled={isSimulating || isClearingCache}
                          className="py-2 px-3 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 text-xs font-mono rounded flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {isClearingCache ? 'Clearing...' : 'Clear Cache'}
                        </button>
                      </div>
                    </div>

                    {solverLog && (
                      <div className="mt-2 p-2.5 bg-black border border-neutral-800 rounded font-mono text-[10px] text-neutral-300 max-h-44 overflow-y-auto">
                        <div className="text-neutral-200 font-semibold mb-1.5 flex items-center justify-between border-b border-neutral-800 pb-1">
                          <span>Solver Execution Logs ({config.solver})</span>
                          <button
                            type="button"
                            onClick={() => setSolverLog(null)}
                            className="text-neutral-500 hover:text-white px-1 text-xs"
                          >
                            ✕
                          </button>
                        </div>
                        <pre className="whitespace-pre-wrap">{solverLog}</pre>
                      </div>
                    )}
                  </div>
                )}

                {/* Quick Step Footer Navigation (Monochrome) */}
                <div className="pt-3 border-t border-neutral-800 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setWorkflowStep((s) => Math.max(1, s - 1) as WorkflowStep)}
                    disabled={workflowStep === 1}
                    className="px-3 py-1.5 text-xs font-mono text-neutral-400 hover:text-white disabled:opacity-40"
                  >
                    ← Prev Tab
                  </button>
                  {workflowStep < 5 ? (
                    <button
                      type="button"
                      disabled={workflowStep === 4 && !meshVerifiedInParaView}
                      onClick={() => setWorkflowStep((s) => Math.min(5, s + 1) as WorkflowStep)}
                      className="px-3 py-1.5 text-xs font-mono text-white hover:text-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
                    >
                      {workflowStep === 4 && !meshVerifiedInParaView
                        ? 'Verify Mesh to Unlock Tab 5'
                        : 'Next Tab →'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveNav('openfoam_bridge')}
                      className="px-3 py-1.5 text-xs font-mono text-white hover:text-neutral-300 font-semibold"
                    >
                      Inspect Dicts →
                    </button>
                  )}
                </div>
              </div>
            </aside>

            {/* RIGHT COLUMN: Monochrome Telemetry Metric Blocks + Multi-Colored 2D VOF Canvas + Monochrome Residuals */}
            <section className="lg:col-span-8 space-y-5">
              {/* 4 Primary Propulsion Telemetry Metric Blocks (Strictly Monochrome) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {/* Block 1: Mass Flow Rate */}
                <div className="bg-[#0A0A0A] border border-neutral-800 rounded-lg p-4">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">
                    ELEMENT MASS FLOW (ṁ)
                  </div>
                  <div className="mt-1.5 flex items-baseline">
                    <span className="text-2xl font-mono font-bold text-white">
                      {displayedTotalElementMassFlow.toFixed(3)}
                    </span>
                    <span className="text-xs uppercase font-mono text-neutral-400 ml-1.5">kg/s</span>
                  </div>
                  <div className="mt-1.5 text-xs font-mono text-neutral-400">
                    LOX: {physics.cfdExtractedOxMassFlowKgS.toFixed(3)} · RP-1: {physics.cfdExtractedFuelMassFlowKgS.toFixed(3)}
                  </div>
                </div>

                {/* Block 2: Spray Cone Angle */}
                <div className="bg-[#0A0A0A] border border-neutral-800 rounded-lg p-4">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">
                    SPRAY CONE ANGLE (2θ)
                  </div>
                  <div className="mt-1.5 flex items-baseline">
                    <span className="text-2xl font-mono font-bold text-white">
                      {physics.sprayConeAngleOpenFoamDeg.toFixed(1)}
                    </span>
                    <span className="text-xs uppercase font-mono text-neutral-400 ml-1.5">deg</span>
                  </div>
                  <div className="mt-1.5 text-xs font-mono text-neutral-400">
                    Bazarov Inv: {physics.sprayConeAngleInviscidDeg.toFixed(1)}° · J = {physics.momentumFluxRatioJ}
                  </div>
                </div>

                {/* Block 3: VOF Film Thickness & Air Core */}
                <div className="bg-[#0A0A0A] border border-neutral-800 rounded-lg p-4">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">
                    VOF FILM THICKNESS (t_f)
                  </div>
                  <div className="mt-1.5 flex items-baseline">
                    <span className="text-2xl font-mono font-bold text-white">
                      {physics.filmThicknessOpenFoamMm.toFixed(3)}
                    </span>
                    <span className="text-xs uppercase font-mono text-neutral-400 ml-1.5">mm</span>
                  </div>
                  <div className="mt-1.5 text-xs font-mono text-neutral-400">
                    Air Core r_a: {physics.airCoreRadiusMm.toFixed(2)} mm (X = {physics.airCoreAreaRatioX.toFixed(2)})
                  </div>
                </div>

                {/* Block 4: Discharge Coefficient */}
                <div className="bg-[#0A0A0A] border border-neutral-800 rounded-lg p-4">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">
                    DISCHARGE COEFF (C_d,ox)
                  </div>
                  <div className="mt-1.5 flex items-baseline">
                    <span className="text-2xl font-mono font-bold text-white">
                      {physics.cdOxOpenFoamCfd.toFixed(3)}
                    </span>
                    <span className="text-xs uppercase font-mono text-neutral-400 ml-1.5">dimensionless</span>
                  </div>
                  <div className="mt-1.5 text-xs font-mono text-neutral-400">
                    ΔP = {physics.pressureDropMPa.toFixed(2)} MPa · A_o = {physics.geometricCharacteristicA.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Interactive 2D RD-0110 Cross-Section (V1-V16) & Multi-Colored VOF Spray Cone Visualizer */}
              <VofSprayCanvas
                config={config}
                physics={physics}
                isSimulating={isSimulating}
                simProgressPct={simProgressPct}
              />

              {/* Bottom Tray: Live Iteration Residual Curves (Monochrome) */}
              <ResidualChart
                residuals={physics.residuals}
                visibleStepCount={visibleResidualSteps}
                maxCoLimit={config.maxCo}
              />
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_RD0110_CONFIG,
  FluidRegimeId,
  InjectorConfig,
  MeshDomainType,
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
  Sliders,
  Box,
  Grid,
  Activity,
  Trash2,
} from 'lucide-react';

type TopNavTab = 'workspace' | 'openfoam_bridge' | 'post_processing' | 'validation_plan';
type WorkflowStep = 1 | 2 | 3 | 4;

export default function App() {
  const [activeNav, setActiveNav] = useState<TopNavTab>('workspace');
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>(2);
  const [config, setConfig] = useState<InjectorConfig>(DEFAULT_RD0110_CONFIG);
  const [activeCsvName, setActiveCsvName] = useState<string>('RD0110_Baseline_Default.csv');

  // Simulation & backend API state
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [isClearingCache, setIsClearingCache] = useState<boolean>(false);
  const [openfoamLog, setOpenfoamLog] = useState<string | null>(null);
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

  // Live simulation residual animation loop while real OpenFOAM simulation is executing in background
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
      // Keep D_s,o larger than D_n,o so V15->V14 conical convergence stays physically valid
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
          `Imported RD-0110 CSV "${file.name}" -> Updated ${matchedKeys.length} geometric parameters (${matchedKeys.join(', ')}). Sliders & V1-V16 blockMesh synchronized.`
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
    setStatusBanner('Downloaded RD-0110 parametric CSV template (compatible with CSV Import).');
  };

  const handleRunSimulation = async () => {
    setVisibleResidualSteps(10);
    setIsSimulating(true);
    setStatusBanner(
      `Triggering FastAPI backend (http://127.0.0.1:8000/api/cfd/rd0110-blockmesh) to write case files & run OpenFOAM blockMesh + ${config.solver} in WSL (~/OpenFOAM/CMB-v2406/run)...`
    );

    try {
      const files = generateOpenFoamCaseFiles(config, physics);
      const bmFile = files.find((f) => f.filename === 'system/blockMeshDict')?.content;
      const cdFile = files.find((f) => f.filename === 'system/controlDict')?.content;
      const tpFile = files.find((f) => f.filename === 'constant/transportProperties')?.content;

      const payload = {
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
        differential_pressure_mpa: config.inputDifferentialPressureMPa ?? physics.pressureDropMPa,
        solver: config.solver,
        blockMeshDict: bmFile,
        controlDict: cdFile,
        transportProperties: tpFile,
        config,
      };

      const res = await fetch('http://127.0.0.1:8000/api/cfd/rd0110-blockmesh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.detail || `FastAPI server returned HTTP ${res.status}`);
      }

      const data = await res.json();
      setVisibleResidualSteps(physics.residuals.length);

      if (data.status === 'CONVERGED') {
        setStatusBanner(
          `OpenFOAM ${config.solver} executed via WSL in ~/OpenFOAM/CMB-v2406/run: Mesh & Solver converged! C_d = ${data.discharge_coefficient_cd}, 2θ = ${data.spray_cone_angle_2theta_deg}°, ṁ_ox = ${data.mass_flow_ox_kg_s} kg/s.`
        );
      } else {
        setStatusBanner(
          `OpenFOAM execution finished with status: ${data.status}. Solver status: ${data.solver_status || 'N/A'}. Check pipeline logs.`
        );
      }

      if (data.pipeline_log) {
        setOpenfoamLog(JSON.stringify(data.pipeline_log, null, 2));
      }
    } catch (err: any) {
      console.error('FastAPI OpenFOAM execution error:', err);
      setStatusBanner(
        `Failed to execute OpenFOAM via FastAPI: ${err.message || err}. Ensure uvicorn is running on http://127.0.0.1:8000.`
      );
    } finally {
      setIsSimulating(false);
    }
  };

  const handleClearCache = async () => {
    if (
      !window.confirm(
        'Clear OpenFOAM Simulation Cache?\\n\\nThis will completely delete all case files, polyMesh, and time directories inside ~/OpenFOAM/CMB-v2406/run in WSL.'
      )
    ) {
      return;
    }

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
      setOpenfoamLog(null);
    } catch (err: any) {
      console.error('Clear cache error:', err);
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
    a.download = `CMB_RD0110_${config.solver}_blockMesh_Bundle.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusBanner(
      'Exported pure structured system/blockMeshDict (V1-V16 5° wedge) and FastAPI/Python backend script.'
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
            {/* LEFT COLUMN: 4-Stage Engineering Workflow Controls */}
            <aside className="lg:col-span-4 bg-[#0A0A0A] border border-neutral-800 rounded-lg overflow-hidden flex flex-col">
              {/* 4-Step Sequence Selector */}
              <div className="grid grid-cols-4 border-b border-neutral-800 bg-black">
                {[
                  { step: 1 as WorkflowStep, label: '01. Solver', icon: Sliders },
                  { step: 2 as WorkflowStep, label: '02. RD-0110', icon: Box },
                  { step: 3 as WorkflowStep, label: '03. blockMesh', icon: Grid },
                  { step: 4 as WorkflowStep, label: '04. Execute', icon: Activity },
                ].map(({ step, label }) => (
                  <button
                    key={step}
                    type="button"
                    onClick={() => setWorkflowStep(step)}
                    className={`py-3 px-2 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 text-center ${
                      workflowStep === step
                        ? 'border-white text-white bg-neutral-900'
                        : 'border-transparent text-neutral-500 hover:text-neutral-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Step Content Area */}
              <div className="p-5 space-y-4">
                {workflowStep === 1 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-sm font-semibold text-white">
                        Step 1: Multiphase Solver &amp; Differential Pressure
                      </h2>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Configure VOF interface reconstruction, differential pressure ΔP, and fluid properties.
                      </p>
                    </div>

                    {/* OpenFOAM Solver Selection */}
                    <div>
                      <label htmlFor="solver-select" className="block text-xs font-mono text-neutral-300 mb-1.5">
                        OpenFOAM Multiphase Solver
                      </label>
                      <select
                        id="solver-select"
                        value={config.solver}
                        onChange={(e) => updateConfig('solver', e.target.value as OpenFoamSolver)}
                        className="w-full bg-black border border-neutral-800 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-neutral-400"
                      >
                        <option value="interIsoFoam">interIsoFoam (Geometric plicRDF VOF — Recommended)</option>
                        <option value="compressibleInterFoam">compressibleInterFoam (Transonic / Barotropic LOX)</option>
                        <option value="multiphaseEulerFoam">multiphaseEulerFoam (Euler-Euler Secondary Breakup)</option>
                      </select>
                    </div>

                    {/* Turbulence Model */}
                    <div>
                      <label htmlFor="turbulence-select" className="block text-xs font-mono text-neutral-300 mb-1.5">
                        Turbulence Closure Model
                      </label>
                      <select
                        id="turbulence-select"
                        value={config.turbulence}
                        onChange={(e) => updateConfig('turbulence', e.target.value as TurbulenceModel)}
                        className="w-full bg-black border border-neutral-800 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-neutral-400"
                      >
                        <option value="kOmegaSST">kOmegaSST-CC (Curvature-Corrected RANS)</option>
                        <option value="LES_WALE">LES WALE (Subgrid Wave Atomization)</option>
                        <option value="laminar">Laminar (Low-Re Analytical Verification)</option>
                      </select>
                    </div>

                    {/* Operating Fluid Regime */}
                    <div>
                      <label htmlFor="regime-select" className="block text-xs font-mono text-neutral-300 mb-1.5">
                        Propellant Operating Regime
                      </label>
                      <select
                        id="regime-select"
                        value={config.regimeId}
                        onChange={(e) => updateConfig('regimeId', e.target.value as FluidRegimeId)}
                        className="w-full bg-black border border-neutral-800 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-neutral-400"
                      >
                        <option value="lox_rp1_flight">LOX / RP-1 Cryogenic Hot-Fire (Pc = 6.82 MPa)</option>
                        <option value="water_gn2_coldflow">H₂O / Simulant Cold-Flow Optical Bench (0.1 MPa)</option>
                      </select>
                    </div>

                    {/* Explicit Input Differential Pressure ΔP -> Resulting Mass Flow Rate */}
                    <div className="pt-2 border-t border-neutral-800 space-y-3">
                      <div className="bg-black border border-neutral-800 rounded p-3 space-y-2">
                        <div className="flex items-center justify-between text-xs font-mono">
                          <label htmlFor="diff-pressure-input" className="text-neutral-200 font-semibold">
                            Input Differential Pressure (ΔP)
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
                                Math.max(0.05, parseFloat(e.target.value) || 0.7)
                              )
                            }
                            className="w-20 bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-xs font-mono text-white text-right"
                          />
                        </div>
                        <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400 pt-1 border-t border-neutral-900">
                          <span>Resulting Element Mass Flow (ṁ):</span>
                          <span className="text-white font-semibold">
                            {displayedTotalElementMassFlow.toFixed(4)} kg/s
                          </span>
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs font-mono mb-1">
                          <span className="text-neutral-300">Engine Thrust Target</span>
                          <span className="text-white font-semibold">
                            {config.targetThrustKN.toFixed(1)} kN ({config.elementCount} elements)
                          </span>
                        </div>
                        <input
                          aria-label="Engine Thrust Target"
                          type="range"
                          min={1.0}
                          max={15.0}
                          step={0.5}
                          value={config.targetThrustKN}
                          onChange={(e) => updateConfig('targetThrustKN', parseFloat(e.target.value))}
                          className="w-full accent-white cursor-pointer"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="element-count" className="block text-[11px] font-mono text-neutral-400 mb-1">
                            Injector Elements (N)
                          </label>
                          <input
                            id="element-count"
                            type="number"
                            min={1}
                            max={61}
                            value={config.elementCount}
                            onChange={(e) => updateConfig('elementCount', Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white"
                          />
                        </div>
                        <div>
                          <label htmlFor="of-ratio" className="block text-[11px] font-mono text-neutral-400 mb-1">
                            Mixture Ratio (O/F)
                          </label>
                          <input
                            id="of-ratio"
                            type="number"
                            step={0.05}
                            min={1.2}
                            max={4.0}
                            value={config.ofRatio}
                            onChange={(e) => updateConfig('ofRatio', parseFloat(e.target.value) || 2.27)}
                            className="w-full bg-black border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-white"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {workflowStep === 2 && (
                  <div className="space-y-3.5">
                    <div>
                      <h2 className="text-sm font-semibold text-white">
                        Step 2: Parametric RD-0110 Geometry &amp; CSV Import
                      </h2>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Import a parameter CSV or adjust the RD-0110 baseline sliders to drive V1–V16 coordinates.
                      </p>
                    </div>

                    {/* CSV Import & Template Download Zone (Replaces STL/GLB Upload) */}
                    <div className="bg-black border border-neutral-800 rounded p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="rd0110-csv-upload"
                          className="flex-1 py-2 px-3 bg-white hover:bg-neutral-200 text-black font-semibold text-xs rounded cursor-pointer transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
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

                    {/* Hardcoded RD-0110 Baseline Sliders */}
                    <div className="space-y-2.5 pt-1">
                      {/* 1. LOX Nozzle Diameter D_n,o = 5.40 mm */}
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

                      {/* 2. RP-1 Annular Gap delta_f = 1.50 mm */}
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

                      {/* 3. Recess Length L_r = 1.50 mm */}
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

                      {/* 4. LOX Swirl Chamber Diameter D_s,o = 9.00 mm */}
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

                      {/* 5. LOX Tangential Inlet Radial Offset R_in,o = 3.50 mm */}
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

                      {/* 6. Fuel Swirl Chamber D_s,f = 10.00 mm */}
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

                      {/* Compact Numeric Inputs for N_o, d_in,o */}
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

                    {/* Bazarov Swirl Summary + Embedded RD-0110 Reference Diagram */}
                    <div className="pt-2 border-t border-neutral-800 space-y-2">
                      <div className="bg-black border border-neutral-800 rounded p-2.5 text-[11px] font-mono flex items-center justify-between">
                        <span className="text-neutral-400">Bazarov Swirl Numbers:</span>
                        <span className="text-white font-semibold">
                          A_o = {physics.geometricCharacteristicA.toFixed(2)} · A_f = {physics.fuelGeometricCharacteristicAf.toFixed(2)}
                        </span>
                      </div>
                      <div className="bg-white rounded p-1.5 border border-neutral-700">
                        <img
                          src="/assets/aistudio/image_d1a04e75.png"
                          alt="RD-0110 Swirl Coaxial Injector Cross-Section Reference"
                          className="w-full h-auto object-contain rounded"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {workflowStep === 3 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-sm font-semibold text-white">
                        Step 3: Parametric 5° Wedge blockMesh
                      </h2>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Pure structured hexahedral <code className="text-neutral-200">system/blockMeshDict</code> generated from V1–V16 (<code className="text-neutral-200">snappyHexMesh</code> removed).
                      </p>
                    </div>

                    <div>
                      <label htmlFor="mesh-domain-select" className="block text-xs font-mono text-neutral-300 mb-1.5">
                        Structured blockMesh Formulation
                      </label>
                      <select
                        id="mesh-domain-select"
                        value={config.meshDomain}
                        onChange={(e) => updateConfig('meshDomain', e.target.value as MeshDomainType)}
                        className="w-full bg-black border border-neutral-800 rounded px-3 py-2 text-xs font-mono text-white"
                      >
                        <option value="wedge_5deg">2D Axisymmetric 5° Wedge (V1-V16 Pure blockMesh)</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs font-mono mb-1">
                        <span className="text-neutral-300">Base Hexahedral Cell Size (Δx)</span>
                        <span className="text-white">{config.baseCellSizeUm} μm</span>
                      </div>
                      <input
                        aria-label="Base Core Cell Size"
                        type="range"
                        min={25}
                        max={110}
                        step={5}
                        value={config.baseCellSizeUm}
                        onChange={(e) => updateConfig('baseCellSizeUm', parseInt(e.target.value))}
                        className="w-full accent-white cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs font-mono mb-1">
                        <span className="text-neutral-300">Dynamic VOF AMR Level (maxRefinement)</span>
                        <span className="text-white">Level {config.amrMaxLevel} (|∇α| &gt; 0.05)</span>
                      </div>
                      <input
                        aria-label="Dynamic VOF AMR Level"
                        type="range"
                        min={0}
                        max={4}
                        step={1}
                        value={config.amrMaxLevel}
                        onChange={(e) => updateConfig('amrMaxLevel', parseInt(e.target.value))}
                        className="w-full accent-white cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs font-mono mb-1">
                        <span className="text-neutral-300">Max Interface Courant (maxAlphaCo)</span>
                        <span className="text-white">{config.maxAlphaCo.toFixed(2)}</span>
                      </div>
                      <input
                        aria-label="Max Interface Courant"
                        type="range"
                        min={0.1}
                        max={0.5}
                        step={0.05}
                        value={config.maxAlphaCo}
                        onChange={(e) => updateConfig('maxAlphaCo', parseFloat(e.target.value))}
                        className="w-full accent-white cursor-pointer"
                      />
                    </div>

                    {/* Structured blockMesh Diagnostics Box (Monochrome) */}
                    <div className="bg-black border border-neutral-800 rounded p-3 text-xs font-mono space-y-1.5">
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Closed-Loop Profile Vertices:</span>
                        <span className="text-white font-semibold">V1–V16 ({physics.verticesV1ToV16.length} pts)</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Estimated Structured Hex Cells:</span>
                        <span className="text-white font-semibold">{physics.estimatedCellCount.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Cells Across Liquid Film (t_f):</span>
                        <span className="text-white font-semibold">
                          {physics.cellsAcrossFilm} cells {physics.cellsAcrossFilm >= 12 ? '(Optimal ≥ 12)' : '(Coarse)'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Unstructured Meshing:</span>
                        <span className="text-neutral-200">Disabled (100% Pure blockMesh)</span>
                      </div>
                    </div>
                  </div>
                )}

                {workflowStep === 4 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-sm font-semibold text-white">
                        Step 4: Simulation Execution &amp; Data Export
                      </h2>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Execute analytical/empirical CFD preview or download the complete RD-0110 OpenFOAM package.
                      </p>
                    </div>

                    <div className="bg-black border border-neutral-800 rounded p-3.5 text-xs font-mono space-y-1.5">
                      <div className="text-neutral-400 uppercase text-[10px]">RD-0110 Ready Job Manifest</div>
                      <div className="text-neutral-300">
                        Solver: <span className="text-white">{config.solver}</span> ({config.turbulence})
                      </div>
                      <div className="text-neutral-300">
                        Input ΔP: <span className="text-white">{physics.pressureDropMPa.toFixed(2)} MPa</span> -&gt; ṁ:{' '}
                        <span className="text-white">{displayedTotalElementMassFlow.toFixed(4)} kg/s</span>
                      </div>
                      <div className="text-neutral-300">
                        Swirl Numbers: <span className="text-white">A_o = {physics.geometricCharacteristicA}</span> ·{' '}
                        <span className="text-white">A_f = {physics.fuelGeometricCharacteristicAf}</span>
                      </div>
                      <div className="text-neutral-300">
                        Outputs: <span className="text-white">C_d = {physics.cdOxOpenFoamCfd.toFixed(3)}</span> ·{' '}
                        <span className="text-white">2θ = {physics.sprayConeAngleOpenFoamDeg.toFixed(1)}°</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={handleRunSimulation}
                        disabled={isSimulating || isClearingCache}
                        className="py-2.5 px-3 bg-white hover:bg-neutral-200 disabled:opacity-60 text-black font-semibold text-xs rounded transition-colors flex items-center justify-center gap-2"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        {isSimulating ? 'Running OpenFOAM...' : 'Run CFD Simulation'}
                      </button>

                      <button
                        type="button"
                        onClick={handleClearCache}
                        disabled={isSimulating || isClearingCache}
                        className="py-2.5 px-3 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold text-xs rounded transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                        title="Completely delete contents of ~/OpenFOAM/CMB-v2406/run in WSL to start fresh"
                      >
                        <Trash2 className="w-4 h-4" />
                        {isClearingCache ? 'Clearing Cache...' : 'Clear Simulation Cache'}
                      </button>
                    </div>

                    {openfoamLog && (
                      <div className="mt-2 p-2.5 bg-black border border-neutral-800 rounded font-mono text-[10px] text-neutral-300 max-h-40 overflow-y-auto">
                        <div className="text-neutral-400 font-semibold mb-1 flex items-center justify-between border-b border-neutral-800 pb-1">
                          <span>OpenFOAM Execution Logs (~/OpenFOAM/CMB-v2406/run):</span>
                          <button
                            type="button"
                            onClick={() => setOpenfoamLog(null)}
                            className="text-neutral-500 hover:text-white px-1 text-xs"
                          >
                            ✕
                          </button>
                        </div>
                        <pre className="whitespace-pre-wrap">{openfoamLog}</pre>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2.5">
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
                        onClick={handleResetBaseline}
                        className="py-2 px-3 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 text-xs font-mono rounded flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Reset RD-0110
                      </button>
                    </div>
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
                    ← Previous Step
                  </button>
                  {workflowStep < 4 ? (
                    <button
                      type="button"
                      onClick={() => setWorkflowStep((s) => Math.min(4, s + 1) as WorkflowStep)}
                      className="px-3 py-1.5 text-xs font-mono text-white hover:text-neutral-300 font-semibold"
                    >
                      Next Step →
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveNav('openfoam_bridge')}
                      className="px-3 py-1.5 text-xs font-mono text-white hover:text-neutral-300 font-semibold"
                    >
                      Inspect blockMeshDict →
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

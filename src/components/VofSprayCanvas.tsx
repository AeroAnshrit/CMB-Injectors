/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  FLUID_REGIMES,
  InjectorConfig,
  InjectorPhysicsResult,
} from '../utils/injectorPhysics';
import { Crosshair, Eye, Layers, MapPin } from 'lucide-react';

interface VofSprayCanvasProps {
  config: InjectorConfig;
  physics: InjectorPhysicsResult;
  isSimulating: boolean;
  simProgressPct: number;
}

export const VofSprayCanvas: React.FC<VofSprayCanvasProps> = ({
  config,
  physics,
  simProgressPct,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewMode, setViewMode] = useState<'vof_contour' | 'v1_v16_blueprint' | 'radial_profile'>('vof_contour');
  const [showMeshWireframe, setShowMeshWireframe] = useState<boolean>(false);
  const [showRegressionCone, setShowRegressionCone] = useState<boolean>(true);
  const [showVertexLabels, setShowVertexLabels] = useState<boolean>(true);
  const [probeCoords, setProbeCoords] = useState<{
    xMm: number;
    rMm: number;
    alphaOx: number;
    alphaFuel: number;
    velMs: number;
  } | null>(null);

  const regime = FLUID_REGIMES[config.regimeId];

  useEffect(() => {
    if (viewMode === 'radial_profile') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || 780;
    const height = rect.height || 380;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas background
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, width, height);

    // Draw technical grid lines
    ctx.strokeStyle = 'rgba(64, 64, 64, 0.35)';
    ctx.lineWidth = 1;
    const gridSpacing = 36;
    for (let x = 0; x < width; x += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const vList = physics.verticesV1ToV16;
    const vMap = Object.fromEntries(vList.map((v) => [v.id, v]));

    // Coordinate mapping:
    // In the RD-0110 diagram, flow travels from Left (Upstream Head X = 25.80 mm) to Right (Exit Plane X = 0.00 mm),
    // and then expands into the combustion chamber plume for X < 0.00 mm.
    const centerY = height * 0.5;
    const xTotalMm = vMap.V2.xMm; // 25.80 mm
    const scalePxPerMm = Math.min(18.5, (height * 0.41) / Math.max(8.0, vMap.V5.rMm));

    // Place Upstream Rear Face (X = 25.80 mm) at left margin xPx = 46
    const leftMarginPx = 46;
    const mapX = (xMm: number) => leftMarginPx + (xTotalMm - xMm) * scalePxPerMm;
    const mapRUpper = (rMm: number) => centerY - rMm * scalePxPerMm;
    const mapRLower = (rMm: number) => centerY + rMm * scalePxPerMm;

    const exitPlaneXPx = mapX(0.0);
    const loxPostExitXPx = mapX(vMap.V13.xMm);
    const rNoPx = vMap.V13.rMm * scalePxPerMm;
    const rPoPx = vMap.V12.rMm * scalePxPerMm;
    const rSfPx = vMap.V9.rMm * scalePxPerMm;
    const rAirCorePx = physics.airCoreRadiusMm * scalePxPerMm;

    // 1. Draw Centerline Axis (R = 0.00 mm)
    ctx.save();
    ctx.strokeStyle = 'rgba(163, 163, 163, 0.45)';
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.moveTo(16, centerY);
    ctx.lineTo(width - 16, centerY);
    ctx.stroke();
    ctx.restore();

    // 2. Render Multi-Colored 2D VOF (alpha.liquid) Fluid Field & Conical Spray Sheet
    if (viewMode === 'vof_contour') {
      const halfConeRad = (physics.sprayHalfAngleDeg * Math.PI) / 180;
      const plumeMaxX = width - 22;

      // 2a. Inner LOX Swirl Chamber & Nozzle Liquid Film (V16 -> V15 -> V14 -> V13)
      ctx.fillStyle = 'rgba(6, 182, 212, 0.85)'; // Cyan LOX VOF alpha=1
      // Upper LOX wall film
      ctx.beginPath();
      ctx.moveTo(mapX(vMap.V16.xMm), mapRUpper(vMap.V16.rMm));
      ctx.lineTo(mapX(vMap.V15.xMm), mapRUpper(vMap.V15.rMm));
      ctx.lineTo(mapX(vMap.V14.xMm), mapRUpper(vMap.V14.rMm));
      ctx.lineTo(mapX(vMap.V13.xMm), mapRUpper(vMap.V13.rMm));
      ctx.lineTo(mapX(vMap.V13.xMm), centerY - rAirCorePx);
      ctx.lineTo(mapX(vMap.V14.xMm), centerY - rAirCorePx * 1.06);
      ctx.lineTo(mapX(vMap.V15.xMm), centerY - rAirCorePx * 1.45);
      ctx.lineTo(mapX(vMap.V16.xMm), centerY - rAirCorePx * 1.55);
      ctx.closePath();
      ctx.fill();

      // Lower LOX wall film
      ctx.beginPath();
      ctx.moveTo(mapX(vMap.V16.xMm), mapRLower(vMap.V16.rMm));
      ctx.lineTo(mapX(vMap.V15.xMm), mapRLower(vMap.V15.rMm));
      ctx.lineTo(mapX(vMap.V14.xMm), mapRLower(vMap.V14.rMm));
      ctx.lineTo(mapX(vMap.V13.xMm), mapRLower(vMap.V13.rMm));
      ctx.lineTo(mapX(vMap.V13.xMm), centerY + rAirCorePx);
      ctx.lineTo(mapX(vMap.V14.xMm), centerY + rAirCorePx * 1.06);
      ctx.lineTo(mapX(vMap.V15.xMm), centerY + rAirCorePx * 1.45);
      ctx.lineTo(mapX(vMap.V16.xMm), centerY + rAirCorePx * 1.55);
      ctx.closePath();
      ctx.fill();

      // 2b. Conical expanding hollow LOX sheet downstream of V13 (X <= L_r)
      const filmPxAtExit = Math.max(3, rNoPx - rAirCorePx);
      const breakupLenPx = physics.intactSheetBreakupLengthMm * scalePxPerMm;
      const stepsZ = 54;

      for (let i = 0; i < stepsZ; i++) {
        const frac1 = i / stepsZ;
        const frac2 = (i + 1) / stepsZ;
        const x1 = loxPostExitXPx + frac1 * (plumeMaxX - loxPostExitXPx);
        const x2 = loxPostExitXPx + frac2 * (plumeMaxX - loxPostExitXPx);
        const dz1 = x1 - loxPostExitXPx;
        const dz2 = x2 - loxPostExitXPx;

        const waveAmp1 = Math.min(5, (dz1 / breakupLenPx) * 2.4) * Math.sin(i * 0.75 + simProgressPct * 0.2);
        const waveAmp2 = Math.min(5, (dz2 / breakupLenPx) * 2.4) * Math.sin((i + 1) * 0.75 + simProgressPct * 0.2);

        const rOuter1 = rNoPx + dz1 * Math.tan(halfConeRad) + waveAmp1;
        const rOuter2 = rNoPx + dz2 * Math.tan(halfConeRad) + waveAmp2;

        const thinFactor1 = rNoPx / Math.max(rNoPx, rOuter1);
        const thinFactor2 = rNoPx / Math.max(rNoPx, rOuter2);
        const rInner1 = Math.max(0, rOuter1 - filmPxAtExit * Math.max(0.32, thinFactor1));
        const rInner2 = Math.max(0, rOuter2 - filmPxAtExit * Math.max(0.32, thinFactor2));

        const breakupDecay = dz1 > breakupLenPx ? Math.max(0.22, Math.exp(-(dz1 - breakupLenPx) / 140)) : 0.88;
        ctx.fillStyle = `rgba(6, 182, 212, ${breakupDecay.toFixed(2)})`;

        ctx.beginPath();
        ctx.moveTo(x1, centerY - rOuter1);
        ctx.lineTo(x2, centerY - rOuter2);
        ctx.lineTo(x2, centerY - rInner2);
        ctx.lineTo(x1, centerY - rInner1);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(x1, centerY + rOuter1);
        ctx.lineTo(x2, centerY + rOuter2);
        ctx.lineTo(x2, centerY + rInner2);
        ctx.lineTo(x1, centerY + rInner1);
        ctx.closePath();
        ctx.fill();
      }

      // 2c. Outer Annular RP-1 Swirl Chamber Stream (V11 -> V10 -> V9)
      const fuelFilmPx = Math.max(4, (rSfPx - rPoPx) * 0.65);
      ctx.fillStyle = 'rgba(245, 158, 11, 0.80)'; // Amber RP-1 VOF inside outer swirl slot
      // Upper fuel annular film along R_s,f
      ctx.fillRect(
        mapX(vMap.V10.xMm),
        mapRUpper(vMap.V10.rMm),
        exitPlaneXPx - mapX(vMap.V10.xMm),
        fuelFilmPx
      );
      // Lower fuel annular film along R_s,f
      ctx.fillRect(
        mapX(vMap.V10.xMm),
        mapRLower(vMap.V10.rMm) - fuelFilmPx,
        exitPlaneXPx - mapX(vMap.V10.xMm),
        fuelFilmPx
      );

      // Fuel conical sheet expanding downstream of X = 0.00 mm (V9)
      for (let i = 0; i < 40; i++) {
        const frac1 = i / 40;
        const frac2 = (i + 1) / 40;
        const x1 = exitPlaneXPx + frac1 * (plumeMaxX - exitPlaneXPx);
        const x2 = exitPlaneXPx + frac2 * (plumeMaxX - exitPlaneXPx);
        const dz1 = x1 - exitPlaneXPx;
        const dz2 = x2 - exitPlaneXPx;

        const rFuel1 = rSfPx + dz1 * Math.tan(halfConeRad * 1.05);
        const rFuel2 = rSfPx + dz2 * Math.tan(halfConeRad * 1.05);

        const alphaFuelDecay = Math.max(0.18, 0.76 * Math.exp(-dz1 / 190));
        ctx.fillStyle = `rgba(245, 158, 11, ${alphaFuelDecay.toFixed(2)})`;

        ctx.beginPath();
        ctx.moveTo(x1, centerY - rFuel1);
        ctx.lineTo(x2, centerY - rFuel2);
        ctx.lineTo(x2, centerY - rFuel2 + fuelFilmPx * 0.75);
        ctx.lineTo(x1, centerY - rFuel1 + fuelFilmPx * 0.75);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(x1, centerY + rFuel1 - fuelFilmPx * 0.75);
        ctx.lineTo(x2, centerY + rFuel2 - fuelFilmPx * 0.75);
        ctx.lineTo(x2, centerY + rFuel2);
        ctx.lineTo(x1, centerY + rFuel1);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 3. Procedurally Draw the Exact V1-V16 SolidWorks Closed-Loop Cross-Section (Upper & Mirrored Lower)
    const drawV1ToV16Polygon = (isUpper: boolean) => {
      const mapR = isUpper ? mapRUpper : mapRLower;
      ctx.beginPath();
      vList.forEach((v, idx) => {
        const px = mapX(v.xMm);
        const py = mapR(v.rMm);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = '#1E1E1E';
      ctx.fill();

      // Draw crisp engineering section hatching inside V1-V16 metal body
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(115, 115, 115, 0.32)';
      ctx.lineWidth = 1;
      for (let h = -height; h < width + height; h += 9) {
        ctx.beginPath();
        ctx.moveTo(h, 0);
        ctx.lineTo(h + height, height);
        ctx.stroke();
      }
      ctx.restore();

      ctx.strokeStyle = '#D4D4D4';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    };

    drawV1ToV16Polygon(true);
    drawV1ToV16Polygon(false);

    // 4. Draw Tangential Inlet Ports (LOX at x_in,o = 22.50 mm, RP-1 at x_in,f = 8.80 mm)
    const xOxPortPx = mapX(config.oxTangentialPortAxialPosMm);
    const rOxPortPx = (config.oxInletHoleDiameterMm / 2) * scalePxPerMm;
    const yOxOffsetPx = config.oxTangentialOffsetRadiusMm * scalePxPerMm;

    ctx.fillStyle = 'rgba(6, 182, 212, 0.35)';
    ctx.strokeStyle = '#06B6D4';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(xOxPortPx, centerY - yOxOffsetPx, rOxPortPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(xOxPortPx, centerY + yOxOffsetPx, rOxPortPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const xFuelPortPx = mapX(config.fuelTangentialPortAxialPosMm);
    const rFuelPortPx = Math.max(3.5, (config.fuelInletHoleDiameterMm / 2) * scalePxPerMm);
    const yFuelOffsetPx = config.fuelTangentialOffsetRadiusMm * scalePxPerMm;

    ctx.fillStyle = 'rgba(245, 158, 11, 0.45)';
    ctx.strokeStyle = '#F59E0B';
    ctx.beginPath();
    ctx.arc(xFuelPortPx, centerY - yFuelOffsetPx, rFuelPortPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(xFuelPortPx, centerY + yFuelOffsetPx, rFuelPortPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 5. Optional Structured blockMesh Grid Overlay
    if (showMeshWireframe) {
      ctx.strokeStyle = 'rgba(212, 212, 212, 0.25)';
      ctx.lineWidth = 0.75;
      const cellStep = Math.max(7, Math.round(13 - config.amrMaxLevel * 2));
      for (let x = mapX(vMap.V1.xMm); x < width - 22; x += cellStep) {
        ctx.beginPath();
        ctx.moveTo(x, centerY - rSfPx * 1.45);
        ctx.lineTo(x, centerY + rSfPx * 1.45);
        ctx.stroke();
      }
      for (let r = 0; r <= rSfPx * 1.45; r += cellStep) {
        ctx.beginPath();
        ctx.moveTo(mapX(vMap.V1.xMm), centerY - r);
        ctx.lineTo(width - 22, centerY - r);
        ctx.moveTo(mapX(vMap.V1.xMm), centerY + r);
        ctx.lineTo(width - 22, centerY + r);
        ctx.stroke();
      }
    }

    // 6. Spray Cone Angle Linear Regression Overlay (2*theta on alpha=0.5 iso-contour)
    if (showRegressionCone && viewMode === 'vof_contour') {
      const halfConeRad = (physics.sprayHalfAngleDeg * Math.PI) / 180;
      const coneRayLen = width * 0.36;
      ctx.save();
      ctx.strokeStyle = '#10B981';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);

      ctx.beginPath();
      ctx.moveTo(loxPostExitXPx, centerY - rNoPx);
      ctx.lineTo(
        loxPostExitXPx + coneRayLen * Math.cos(halfConeRad),
        centerY - rNoPx - coneRayLen * Math.sin(halfConeRad)
      );
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(loxPostExitXPx, centerY + rNoPx);
      ctx.lineTo(
        loxPostExitXPx + coneRayLen * Math.cos(halfConeRad),
        centerY + rNoPx + coneRayLen * Math.sin(halfConeRad)
      );
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(loxPostExitXPx, centerY, 58, -halfConeRad, halfConeRad);
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.fillText(
        `2θ = ${physics.sprayConeAngleOpenFoamDeg.toFixed(1)}°`,
        loxPostExitXPx + 65,
        centerY + 4
      );
      ctx.restore();
    }

    // 7. V1-V16 Vertex Markers & Labels
    if (showVertexLabels || viewMode === 'v1_v16_blueprint') {
      ctx.font = '600 9.5px "JetBrains Mono", monospace';
      vList.forEach((v) => {
        const px = mapX(v.xMm);
        const py = mapRUpper(v.rMm);

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(px, py, 2.6, 0, Math.PI * 2);
        ctx.fill();

        // Offset labels cleanly to avoid collisions
        let dx = -6;
        let dy = -6;
        if (v.id === 'V1') { dx = 4; dy = -5; }
        if (v.id === 'V2') { dx = -18; dy = -5; }
        if (v.id === 'V3') { dx = -16; dy = -6; }
        if (v.id === 'V4') { dx = -16; dy = -5; }
        if (v.id === 'V5' || v.id === 'V6') { dx = -6; dy = -7; }
        if (v.id === 'V7' || v.id === 'V8') { dx = 4; dy = -6; }
        if (v.id === 'V9') { dx = 5; dy = 3; }
        if (v.id === 'V10') { dx = -22; dy = -4; }
        if (v.id === 'V11') { dx = -22; dy = 10; }
        if (v.id === 'V12') { dx = 4; dy = -4; }
        if (v.id === 'V13') { dx = 4; dy = 10; }
        if (v.id === 'V14') { dx = -8; dy = 11; }
        if (v.id === 'V15') { dx = -10; dy = 11; }
        if (v.id === 'V16') { dx = 5; dy = 11; }

        ctx.fillStyle = '#E5E5E5';
        ctx.fillText(v.id, px + dx, py + dy);
      });
    }
  }, [
    config,
    physics,
    viewMode,
    showMeshWireframe,
    showRegressionCone,
    showVertexLabels,
    simProgressPct,
  ]);

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const vList = physics.verticesV1ToV16;
    const vMap = Object.fromEntries(vList.map((v) => [v.id, v]));
    const centerY = rect.height * 0.5;
    const xTotalMm = vMap.V2.xMm;
    const scalePxPerMm = Math.min(18.5, (rect.height * 0.41) / Math.max(8.0, vMap.V5.rMm));
    const leftMarginPx = 46;

    const xMm = Number((xTotalMm - (x - leftMarginPx) / scalePxPerMm).toFixed(2));
    const rMm = Number((Math.abs(y - centerY) / scalePxPerMm).toFixed(2));

    const rNoMm = config.oxNozzleInnerDiameterMm / 2;
    const rPoMm = rNoMm + config.oxPostWallThicknessMm;
    const rSfMm = rPoMm + config.fuelAnnularSlotWidthMm;

    const halfConeRad = (physics.sprayHalfAngleDeg * Math.PI) / 180;
    const dzFromPostMm = config.recessLengthMm - xMm;
    const expectedSheetRMm =
      dzFromPostMm <= 0
        ? rNoMm - physics.filmThicknessOpenFoamMm * 0.5
        : rNoMm + dzFromPostMm * Math.tan(halfConeRad);
    const distFromSheet = Math.abs(rMm - expectedSheetRMm);
    const alphaOx = Number(
      Math.max(0, Math.min(1, Math.exp(-Math.pow(distFromSheet / Math.max(0.25, physics.filmThicknessOpenFoamMm), 2)))).toFixed(3)
    );
    const alphaFuel = Number(
      (rMm > rPoMm && rMm <= rSfMm && xMm <= config.fuelChamberAxialDepthMm
        ? 0.85
        : 0.02
      ).toFixed(3)
    );
    const velMs = Number(
      (alphaOx * physics.oxExitVelocityMs + alphaFuel * physics.fuelExitVelocityMs).toFixed(1)
    );

    setProbeCoords({ xMm, rMm, alphaOx, alphaFuel, velMs });
  };

  return (
    <div className="bg-[#0A0A0A] border border-neutral-800 rounded-lg overflow-hidden flex flex-col">
      {/* Strictly Monochrome Canvas Header & Mode Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-neutral-800 bg-black">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold tracking-wider uppercase text-neutral-200">
            RD-0110 Procedural V1–V16 Cross-Section &amp; VOF Field
          </span>
          <span className="text-neutral-600" aria-hidden="true">·</span>
          <span className="text-xs font-mono text-neutral-400">
            A_o = {physics.geometricCharacteristicA.toFixed(2)} · A_f = {physics.fuelGeometricCharacteristicAf.toFixed(2)}
          </span>
        </div>

        {/* Monochrome View Switcher & Overlays */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-neutral-900 p-0.5 rounded border border-neutral-800">
            <button
              type="button"
              onClick={() => setViewMode('vof_contour')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'vof_contour'
                  ? 'bg-neutral-100 text-black font-semibold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              2D VOF Contour (α)
            </button>
            <button
              type="button"
              onClick={() => setViewMode('v1_v16_blueprint')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'v1_v16_blueprint'
                  ? 'bg-neutral-100 text-black font-semibold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              V1–V16 Blueprint
            </button>
            <button
              type="button"
              onClick={() => setViewMode('radial_profile')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'radial_profile'
                  ? 'bg-neutral-100 text-black font-semibold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Radial Throat Profile
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowVertexLabels((v) => !v)}
            className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              showVertexLabels
                ? 'bg-neutral-200 text-black border-neutral-300 font-semibold'
                : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white'
            }`}
            title="Toggle V1-V16 vertex coordinate labels"
          >
            <MapPin className="w-3.5 h-3.5" />
            V1–V16
          </button>

          <button
            type="button"
            onClick={() => setShowMeshWireframe((v) => !v)}
            className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              showMeshWireframe
                ? 'bg-neutral-200 text-black border-neutral-300 font-semibold'
                : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white'
            }`}
            title="Toggle structured blockMesh 5-degree wedge grid"
          >
            <Layers className="w-3.5 h-3.5" />
            blockMesh
          </button>

          <button
            type="button"
            onClick={() => setShowRegressionCone((v) => !v)}
            className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              showRegressionCone
                ? 'bg-neutral-200 text-black border-neutral-300 font-semibold'
                : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white'
            }`}
            title="Toggle alpha=0.5 linear regression spray cone fit"
          >
            <Eye className="w-3.5 h-3.5" />
            2θ Fit
          </button>
        </div>
      </div>

      {/* Main Viewport Stage */}
      {viewMode !== 'radial_profile' ? (
        <div className="relative w-full h-[360px] bg-[#050505]">
          <canvas
            ref={canvasRef}
            data-testid="vof-spray-canvas"
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={() => setProbeCoords(null)}
            className="w-full h-full cursor-crosshair block"
          />

          {/* Monochrome Overlay Frame with VOF Scale */}
          <div className="absolute top-3 right-3 bg-black/90 border border-neutral-800 rounded px-3 py-2 pointer-events-none">
            <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 mb-1.5">
              VOF Phase Fraction (α_liquid)
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-neutral-400">0.0 (Gas Core)</span>
              <div className="w-24 h-2 rounded-sm bg-gradient-to-r from-neutral-900 via-cyan-600 to-amber-500 border border-neutral-700" />
              <span className="text-[10px] font-mono text-neutral-200">1.0 (Liquid)</span>
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-[10px] font-mono text-neutral-400">
              <span>■ LOX (Ø{config.oxNozzleInnerDiameterMm.toFixed(2)} mm)</span>
              <span>■ RP-1 (δ_f={config.fuelAnnularSlotWidthMm.toFixed(2)} mm)</span>
            </div>
          </div>

          {/* Monochrome Crosshair Coordinate Probe */}
          <div className="absolute bottom-3 right-3 bg-black/90 border border-neutral-800 rounded px-3 py-1.5 text-xs font-mono text-neutral-300 flex items-center gap-3 pointer-events-none">
            <Crosshair className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            {probeCoords ? (
              <div className="flex items-center gap-3">
                <span>X: {probeCoords.xMm.toFixed(2)} mm</span>
                <span>R: {probeCoords.rMm.toFixed(2)} mm</span>
                <span>α_ox: {probeCoords.alphaOx.toFixed(2)}</span>
                <span>α_fuel: {probeCoords.alphaFuel.toFixed(2)}</span>
                <span>|U|: {probeCoords.velMs.toFixed(1)} m/s</span>
              </div>
            ) : (
              <span className="text-neutral-400">
                Hover V1–V16 cross-section to probe (X, R, α_liquid, |U|) · Recess L_r = {config.recessLengthMm.toFixed(2)} mm
              </span>
            )}
          </div>
        </div>
      ) : (
        /* 1D Radial Throat VOF & Velocity Profile SVG Chart (Monochrome) */
        <div className="p-4 h-[360px] flex flex-col justify-between bg-[#050505]">
          <div className="flex items-center justify-between text-xs text-neutral-400 font-mono">
            <span>
              OpenFOAM `sets` Extraction at Injector Exit (R = 0 to {(config.fuelNozzleInnerDiameterMm / 2).toFixed(2)} mm)
            </span>
            <span>
              Air Core r_a = {physics.airCoreRadiusMm} mm · Film t_f = {physics.filmThicknessOpenFoamMm} mm
            </span>
          </div>

          <svg className="w-full h-60 overflow-visible" viewBox="0 0 700 210">
            {[0, 0.25, 0.5, 0.75, 1.0].map((v, idx) => {
              const y = 185 - v * 155;
              return (
                <g key={idx}>
                  <line x1={48} y1={y} x2={670} y2={y} stroke="#262626" strokeDasharray="3 3" />
                  <text x={12} y={y + 4} fill="#737373" fontSize="10" fontFamily="JetBrains Mono">
                    {v.toFixed(2)}
                  </text>
                </g>
              );
            })}

            <line x1={48} y1={185 - 0.5 * 155} x2={670} y2={185 - 0.5 * 155} stroke="#737373" strokeWidth="1" strokeDasharray="5 4" />
            <text x={54} y={185 - 0.5 * 155 - 5} fill="#A3A3A3" fontSize="10" fontFamily="JetBrains Mono">
              α_liquid = 0.50 (Free-Surface Interface Threshold)
            </text>

            <polyline
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="2.5"
              points={physics.radialProfileAtExit
                .map((pt, i) => {
                  const x = 48 + (i / (physics.radialProfileAtExit.length - 1)) * 622;
                  const y = 185 - pt.alphaOx * 155;
                  return `${x},${y}`;
                })
                .join(' ')}
            />

            <polyline
              fill="none"
              stroke="#A3A3A3"
              strokeWidth="2.2"
              points={physics.radialProfileAtExit
                .map((pt, i) => {
                  const x = 48 + (i / (physics.radialProfileAtExit.length - 1)) * 622;
                  const y = 185 - pt.alphaFuel * 155;
                  return `${x},${y}`;
                })
                .join(' ')}
            />

            <polyline
              fill="none"
              stroke="#737373"
              strokeWidth="1.75"
              strokeDasharray="4 3"
              points={physics.radialProfileAtExit
                .map((pt, i) => {
                  const x = 48 + (i / (physics.radialProfileAtExit.length - 1)) * 622;
                  const normVel = Math.min(1, pt.swirlVelocityMs / Math.max(1, physics.oxExitVelocityMs));
                  const y = 185 - normVel * 155;
                  return `${x},${y}`;
                })
                .join(' ')}
            />
          </svg>

          <div className="flex items-center justify-between text-xs font-mono text-neutral-400 border-t border-neutral-800 pt-2">
            <span>R = 0.00 mm (Vortex Centerline)</span>
            <div className="flex items-center gap-4">
              <span className="text-white">— α_LOX (Inner Stage)</span>
              <span className="text-neutral-400">— α_RP1 (Outer Annulus)</span>
              <span className="text-neutral-500">-- U_θ / U_exit (Swirl Profile)</span>
            </div>
            <span>R = {physics.radialProfileAtExit[physics.radialProfileAtExit.length - 1]?.rMm} mm (Outer Wall)</span>
          </div>
        </div>
      )}
    </div>
  );
};

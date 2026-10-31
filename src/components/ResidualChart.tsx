/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ResidualPoint } from '../utils/injectorPhysics';

interface ResidualChartProps {
  residuals: ResidualPoint[];
  visibleStepCount: number;
  maxCoLimit: number;
}

export const ResidualChart: React.FC<ResidualChartProps> = ({
  residuals,
  visibleStepCount,
  maxCoLimit,
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const activeResiduals = residuals.slice(0, Math.max(2, visibleStepCount));
  const latest = activeResiduals[activeResiduals.length - 1] || residuals[residuals.length - 1];
  const inspected = hoverIndex !== null && activeResiduals[hoverIndex] ? activeResiduals[hoverIndex] : latest;

  // Log10 range: from 10^-1 (-1) down to 10^-7 (-7)
  const minLog = -7;
  const maxLog = -1;

  const mapLogToY = (val: number, height: number): number => {
    const safeVal = Math.max(1e-7, Math.min(1e-1, val));
    const logVal = Math.log10(safeVal);
    const norm = (logVal - minLog) / (maxLog - minLog);
    return height - 24 - norm * (height - 44);
  };

  const buildPolyline = (
    selector: (pt: ResidualPoint) => number,
    width: number,
    height: number
  ): string => {
    return activeResiduals
      .map((pt, idx) => {
        const x = 52 + (idx / Math.max(1, residuals.length - 1)) * (width - 72);
        const y = mapLogToY(selector(pt), height);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  };

  return (
    <div className="bg-[#0A0A0A] border border-neutral-800 rounded-lg p-4 flex flex-col justify-between">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-200">
            Live OpenFOAM PIMPLE Iteration Residuals (log₁₀ Scale)
          </h3>
          <p className="text-xs text-neutral-400">
            Parsed from <code className="text-neutral-200">log.interIsoFoam</code> · Outer loop initial residuals &amp; Courant telemetry
          </p>
        </div>

        {/* Strictly Monochrome Readout HUD */}
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono bg-black px-3 py-1.5 rounded border border-neutral-800 text-neutral-300">
          <span className="text-neutral-400">Iter {inspected.iteration}</span>
          <span className="text-white">α_liq: {inspected.alpha_liquid.toExponential(2)}</span>
          <span className="text-neutral-300">p_rgh: {inspected.p_rgh.toExponential(2)}</span>
          <span className="text-neutral-300">U_θ: {inspected.Utheta.toExponential(2)}</span>
          <span className="text-neutral-400">Co_max: {inspected.courantMax.toFixed(2)} / {maxCoLimit}</span>
        </div>
      </div>

      <div className="relative w-full h-44 bg-[#050505] border border-neutral-800 rounded overflow-hidden">
        <svg
          className="w-full h-full block"
          viewBox="0 0 720 176"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = e.clientX - rect.left;
            const frac = Math.max(0, Math.min(1, (relX - 40) / (rect.width - 60)));
            const idx = Math.min(activeResiduals.length - 1, Math.round(frac * (residuals.length - 1)));
            setHoverIndex(idx);
          }}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* Horizontal log10 grid lines */}
          {[-2, -3, -4, -5, -6, -7].map((exp) => {
            const y = mapLogToY(Math.pow(10, exp), 176);
            return (
              <g key={exp}>
                <line x1={52} y1={y} x2={700} y2={y} stroke="#262626" strokeDasharray="3 3" />
                <text x={8} y={y + 3} fill="#737373" fontSize="10" fontFamily="JetBrains Mono">
                  1e{exp}
                </text>
              </g>
            );
          })}

          {/* Convergence Criterion Line (1e-5) */}
          <line
            x1={52}
            y1={mapLogToY(1e-5, 176)}
            x2={700}
            y2={mapLogToY(1e-5, 176)}
            stroke="#525252"
            strokeWidth="1"
            strokeDasharray="6 4"
          />

          {/* Monochrome Grayscale Residual Curves */}
          <polyline
            fill="none"
            stroke="#737373"
            strokeWidth="1.5"
            points={buildPolyline((p) => p.p_rgh, 720, 176)}
          />
          <polyline
            fill="none"
            stroke="#525252"
            strokeWidth="1.4"
            strokeDasharray="3 3"
            points={buildPolyline((p) => p.k_turb, 720, 176)}
          />
          <polyline
            fill="none"
            stroke="#A3A3A3"
            strokeWidth="1.6"
            points={buildPolyline((p) => p.Utheta, 720, 176)}
          />
          <polyline
            fill="none"
            stroke="#D4D4D4"
            strokeWidth="1.6"
            strokeDasharray="5 3"
            points={buildPolyline((p) => p.Ux, 720, 176)}
          />
          <polyline
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="2.2"
            points={buildPolyline((p) => p.alpha_liquid, 720, 176)}
          />

          {/* Hover Crosshair */}
          {hoverIndex !== null && activeResiduals[hoverIndex] && (
            <line
              x1={52 + (hoverIndex / Math.max(1, residuals.length - 1)) * (720 - 72)}
              y1={12}
              x2={52 + (hoverIndex / Math.max(1, residuals.length - 1)) * (720 - 72)}
              y2={156}
              stroke="#A3A3A3"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
          )}
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mt-2 text-[11px] font-mono text-neutral-400">
        <div className="flex items-center gap-4">
          <span className="text-white">— alpha.liquid (MULES/plicRDF)</span>
          <span className="text-neutral-300">-- U_x (Axial)</span>
          <span className="text-neutral-400">— U_theta (Swirl Momentum)</span>
          <span className="text-neutral-500">— p_rgh (GAMG)</span>
          <span className="text-neutral-500">-- k / omega (SST)</span>
        </div>
        <span>
          Global Mass Imbalance: {inspected.massImbalancePct.toFixed(3)}% (Target &lt; 0.25%)
        </span>
      </div>
    </div>
  );
};

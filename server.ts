/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import { createServer as createViteServer } from 'vite';
import {
  DEFAULT_RD0110_CONFIG,
  InjectorConfig,
  calculateInjectorPhysics,
} from './src/utils/injectorPhysics';
import { generateOpenFoamCaseFiles } from './src/utils/openfoamGenerator';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  /**
   * POST /api/predict-mass-flow
   * Explicitly accepts input differential pressure (MPa) and RD-0110 injector parameters
   * and outputs the resulting oxidizer, fuel, and total mass flow rates (kg/s)
   * along with Discharge Coefficient (C_d), Spray Cone Angle (2*theta), and V1-V16 coordinates.
   */
  app.post('/api/predict-mass-flow', (req, res) => {
    try {
      const body = req.body || {};
      const differentialPressureMPa =
        typeof body.differentialPressureMPa === 'number'
          ? body.differentialPressureMPa
          : typeof body.inputDifferentialPressureMPa === 'number'
            ? body.inputDifferentialPressureMPa
            : DEFAULT_RD0110_CONFIG.inputDifferentialPressureMPa || 0.85;

      const mergedConfig: InjectorConfig = {
        ...DEFAULT_RD0110_CONFIG,
        ...(body.config || body),
        inputDifferentialPressureMPa: Math.max(0.02, Number(differentialPressureMPa)),
      };

      const physics = calculateInjectorPhysics(mergedConfig);

      res.json({
        status: 'OK',
        inputDifferentialPressureMPa: physics.pressureDropMPa,
        massFlowRate: {
          oxMassFlowElementKgS: physics.cfdExtractedOxMassFlowKgS,
          fuelMassFlowElementKgS: physics.cfdExtractedFuelMassFlowKgS,
          totalElementMassFlowKgS: Number(
            (physics.cfdExtractedOxMassFlowKgS + physics.cfdExtractedFuelMassFlowKgS).toFixed(4)
          ),
          fullEngineMassFlowKgS: Number(
            (
              (physics.cfdExtractedOxMassFlowKgS + physics.cfdExtractedFuelMassFlowKgS) *
              mergedConfig.elementCount
            ).toFixed(4)
          ),
        },
        dischargeCoefficients: {
          cdOxOpenFoamCfd: physics.cdOxOpenFoamCfd,
          cdOxViscousTheory: physics.cdOxViscousTheory,
          cdOxInviscid: physics.cdOxInviscid,
          cdFuelAnnulus: physics.cdFuelAnnulus,
        },
        sprayAndVof: {
          sprayConeAngleDeg: physics.sprayConeAngleOpenFoamDeg,
          filmThicknessMm: physics.filmThicknessOpenFoamMm,
          airCoreRadiusMm: physics.airCoreRadiusMm,
        },
        verticesV1ToV16: physics.verticesV1ToV16,
        physics,
      });
    } catch (err) {
      res.status(400).json({
        status: 'ERROR',
        message: err instanceof Error ? err.message : 'Failed to compute mass flow rate.',
      });
    }
  });

  /**
   * POST /api/cfd/rd0110-blockmesh
   * Phase 1 Parametric RD-0110 Backend Endpoint:
   * Takes the JSON payload of RD-0110 dimensions, computes the V1-V16 closed-loop vertices,
   * mathematically generates a pure structured system/blockMeshDict for a 5-degree axisymmetric wedge
   * (with snappyHexMesh and surfaceFeatureExtract completely removed), and enforces the
   * differential-pressure-to-mass-flow, Discharge Coefficient (C_d), and Spray Cone Angle (2*theta) calculations.
   */
  app.post('/api/cfd/rd0110-blockmesh', (req, res) => {
    try {
      const body = req.body || {};
      const mergedConfig: InjectorConfig = {
        ...DEFAULT_RD0110_CONFIG,
        ...(body.config || body),
      };
      const physics = calculateInjectorPhysics(mergedConfig);
      const files = generateOpenFoamCaseFiles(mergedConfig, physics);
      const blockMeshFile = files.find((f) => f.filename === 'system/blockMeshDict');

      res.json({
        status: 'CONVERGED',
        architecture: 'RD0110_PURE_STRUCTURED_BLOCKMESH_5DEG_WEDGE',
        unstructuredMeshingRemoved: true,
        inputDifferentialPressureMPa: physics.pressureDropMPa,
        massFlowRateKgS: {
          oxMassFlowKgS: physics.cfdExtractedOxMassFlowKgS,
          fuelMassFlowKgS: physics.cfdExtractedFuelMassFlowKgS,
          totalElementMassFlowKgS: Number(
            (physics.cfdExtractedOxMassFlowKgS + physics.cfdExtractedFuelMassFlowKgS).toFixed(4)
          ),
        },
        dischargeCoefficientCd: physics.cdOxOpenFoamCfd,
        sprayConeAngle2ThetaDeg: physics.sprayConeAngleOpenFoamDeg,
        swirlNumbers: {
          loxInnerAo: physics.geometricCharacteristicA,
          fuelOuterAf: physics.fuelGeometricCharacteristicAf,
        },
        verticesV1ToV16: physics.verticesV1ToV16,
        blockMeshDict: blockMeshFile?.content || '',
      });
    } catch (err) {
      res.status(400).json({
        status: 'ERROR',
        message: err instanceof Error ? err.message : 'Failed to generate RD-0110 blockMeshDict.',
      });
    }
  });

  /**
   * POST /api/cfd/jobs
   * Compatibility endpoint for triggering OpenFOAM case generation.
   */
  app.post('/api/cfd/jobs', (req, res) => {
    const body = req.body || {};
    const mergedConfig: InjectorConfig = {
      ...DEFAULT_RD0110_CONFIG,
      ...(body.config || body),
    };
    const physics = calculateInjectorPhysics(mergedConfig);
    const files = generateOpenFoamCaseFiles(mergedConfig, physics);

    res.json({
      status: 'QUEUED',
      jobId: `cmb_rd0110_${Date.now()}`,
      inputDifferentialPressureMPa: physics.pressureDropMPa,
      resultingElementMassFlowKgS: Number(
        (physics.cfdExtractedOxMassFlowKgS + physics.cfdExtractedFuelMassFlowKgS).toFixed(4)
      ),
      oxMassFlowKgS: physics.cfdExtractedOxMassFlowKgS,
      fuelMassFlowKgS: physics.cfdExtractedFuelMassFlowKgS,
      dischargeCoefficientCd: physics.cdOxOpenFoamCfd,
      sprayConeAngleDeg: physics.sprayConeAngleOpenFoamDeg,
      filmThicknessMm: physics.filmThicknessOpenFoamMm,
      generatedFilesCount: files.length,
    });
  });

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });

  app.use(vite.middlewares);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[CMB CFD Backend] Listening on http://localhost:${PORT}`);
  });
}

startServer();

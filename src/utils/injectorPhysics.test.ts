/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RD0110_CONFIG,
  calculateInjectorPhysics,
  computeRd0110Vertices,
  parseRd0110CsvParameters,
  solveAirCoreRatioX,
} from './injectorPhysics';
import { generateOpenFoamCaseFiles } from './openfoamGenerator';

test('solveAirCoreRatioX monotonically increases with swirl geometric constant A', () => {
  const xLowSwirl = solveAirCoreRatioX(1.2);
  const xMedSwirl = solveAirCoreRatioX(2.18);
  const xHighSwirl = solveAirCoreRatioX(8.0);

  assert.ok(xLowSwirl > 0.1 && xLowSwirl < 0.9);
  assert.ok(xMedSwirl > xLowSwirl, 'Higher A must produce a larger dimensionless air core X');
  assert.ok(xHighSwirl > xMedSwirl, 'Higher A must produce a larger dimensionless air core X');
});

test('RD-0110 baseline matches exact V1-V16 axial/radial coordinates and Bazarov swirl numbers from PDF', () => {
  const result = calculateInjectorPhysics(DEFAULT_RD0110_CONFIG);
  const vertices = computeRd0110Vertices(DEFAULT_RD0110_CONFIG);

  assert.equal(vertices.length, 16);
  const byId = Object.fromEntries(vertices.map((v) => [v.id, v]));

  assert.deepEqual({ x: byId.V1.xMm, r: byId.V1.rMm }, { x: 24.2, r: 0.0 });
  assert.deepEqual({ x: byId.V2.xMm, r: byId.V2.rMm }, { x: 25.8, r: 0.0 });
  assert.deepEqual({ x: byId.V8.xMm, r: byId.V8.rMm }, { x: 0.0, r: 6.5 });
  assert.deepEqual({ x: byId.V9.xMm, r: byId.V9.rMm }, { x: 0.0, r: 5.0 });
  assert.deepEqual({ x: byId.V12.xMm, r: byId.V12.rMm }, { x: 1.5, r: 3.5 });
  assert.deepEqual({ x: byId.V13.xMm, r: byId.V13.rMm }, { x: 1.5, r: 2.7 });
  assert.deepEqual({ x: byId.V14.xMm, r: byId.V14.rMm }, { x: 12.0, r: 2.7 });
  assert.deepEqual({ x: byId.V15.xMm, r: byId.V15.rMm }, { x: 13.8, r: 4.5 });
  assert.deepEqual({ x: byId.V16.xMm, r: byId.V16.rMm }, { x: 24.2, r: 4.5 });

  assert.equal(result.geometricCharacteristicA, 2.18);
  assert.equal(result.fuelGeometricCharacteristicAf, 30.61);

  assert.ok(result.cdOxOpenFoamCfd > 0.15 && result.cdOxOpenFoamCfd < 0.65);
  assert.ok(result.sprayConeAngleOpenFoamDeg > 40 && result.sprayConeAngleOpenFoamDeg < 110);
});

test('parseRd0110CsvParameters updates RD-0110 sliders from uploaded CSV text', () => {
  const sampleCsv = [
    'parameter,value,units',
    'D_n_o,5.80,mm',
    'delta_f,1.65,mm',
    'L_r,2.00,mm',
    'R_in_o,3.75,mm',
    'N_o,8,count',
    'D_s_f,10.80,mm',
  ].join('\n');

  const { updatedConfig, matchedKeys } = parseRd0110CsvParameters(sampleCsv, DEFAULT_RD0110_CONFIG);
  assert.equal(updatedConfig.oxNozzleInnerDiameterMm, 5.8);
  assert.equal(updatedConfig.recessLengthMm, 2.0);
  assert.equal(updatedConfig.oxTangentialOffsetRadiusMm, 3.75);
  assert.equal(updatedConfig.oxInletHoleCount, 8);
  assert.equal(updatedConfig.fuelNozzleInnerDiameterMm, 10.8);
  assert.ok(matchedKeys.length >= 6);
});

test('OpenFOAM case generator outputs blockMeshDict and snappyHexMeshDict with locationInMesh and boundary refinement levels', () => {
  const result = calculateInjectorPhysics(DEFAULT_RD0110_CONFIG);
  const files = generateOpenFoamCaseFiles(DEFAULT_RD0110_CONFIG, result);

  assert.equal(files.length, 5);
  const blockMesh = files.find((f) => f.filename === 'system/blockMeshDict');
  const snappyMesh = files.find((f) => f.filename === 'system/snappyHexMeshDict');
  assert.ok(blockMesh, 'system/blockMeshDict must be generated');
  assert.ok(snappyMesh, 'system/snappyHexMeshDict must be generated');
  assert.ok(snappyMesh.content.includes('locationInMesh (0.01500 0.00100 0.00000);'));
  assert.ok(snappyMesh.content.includes('level (2 3);'));
  assert.ok(snappyMesh.content.includes('level (3 4);'));
  assert.ok(snappyMesh.content.includes('level (1 2);'));
});

test('explicit inputDifferentialPressureMPa directly governs output mass flow rate via sqrt(dP)', () => {
  const lowDp = calculateInjectorPhysics({
    ...DEFAULT_RD0110_CONFIG,
    inputDifferentialPressureMPa: 0.4,
  });
  const highDp = calculateInjectorPhysics({
    ...DEFAULT_RD0110_CONFIG,
    inputDifferentialPressureMPa: 1.6,
  });

  assert.equal(lowDp.pressureDropMPa, 0.4);
  assert.equal(highDp.pressureDropMPa, 1.6);
  const ratio = highDp.cfdExtractedOxMassFlowKgS / lowDp.cfdExtractedOxMassFlowKgS;
  assert.ok(Math.abs(ratio - 2.0) < 0.02, `Expected ~2.0x mass flow ratio for 4x dP, got ${ratio}`);
});

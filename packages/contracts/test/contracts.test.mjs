import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { assertValidContract, validateContract } from '../src/index.mjs';

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
}

test('representative FI-S1 endpoint fixtures validate against shared contracts', async () => {
  const cases = [
    ['place-search', 'placeSearch'],
    ['place-detail', 'placeDetail'],
    ['claims', 'claimsResponse'],
    ['incidents', 'incidentsResponse'],
    ['match-results', 'matchResults'],
    ['observation-response', 'observationResponse'],
    ['observation-sync', 'observationSync'],
    ['route-result', 'routeResult'],
    ['incident-event', 'incidentEvent'],
    ['stream-event', 'streamEvent']
  ];

  for (const [fixtureName, schemaName] of cases) {
    assertValidContract(schemaName, await fixture(fixtureName));
  }
});

test('contract validation rejects undocumented fields and enum drift', async () => {
  const incident = await fixture('incident');
  const withPrivateField = { ...incident, reporterId: 'private-user' };
  assert.equal(validateContract('incident', withPrivateField).valid, false);
  assert.equal(validateContract('incident', { ...incident, severity: 'major' }).valid, false);
});

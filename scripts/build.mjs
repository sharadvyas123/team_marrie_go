import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertValidContract, contractVersion, schemas } from '../packages/contracts/src/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDirectory = path.join(root, 'packages/contracts/fixtures');
const outputDirectory = path.join(root, 'dist');
const fixtureSchemaNames = {
  'health.json': 'healthResponse',
  'ready.json': 'readyResponse',
  'problem.json': 'problemResponse',
  'pagination.json': 'pagination',
  'place-summary.json': 'placeSummary',
  'place-search.json': 'placeSearch',
  'place-detail.json': 'placeDetail',
  'access-graph.json': 'accessGraph',
  'categories.json': 'categoriesResponse',
  'features.json': 'featuresResponse',
  'claims.json': 'claimsResponse',
  'accessibility-claim.json': 'accessibilityClaim',
  'match-profile.json': 'matchProfile',
  'match-explanation.json': 'matchExplanation',
  'match-results.json': 'matchResults',
  'observation.json': 'observation',
  'observation-response.json': 'observationResponse',
  'observation-list.json': 'observationList',
  'observation-sync.json': 'observationSync',
  'moderation-item.json': 'moderationItem',
  'incident.json': 'incident',
  'incidents.json': 'incidentsResponse',
  'incident-event.json': 'incidentEvent',
  'stream-ready.json': 'streamReady',
  'stream-event.json': 'streamEvent',
  'route-request.json': 'routeRequest',
  'route-result.json': 'routeResult',
  'evidence-upload-intent.json': 'evidenceUploadIntent',
  'evidence.json': 'evidence',
  'facility-response.json': 'facilityResponse',
  'civic-changes.json': 'civicChanges',
  'session-summary.json': 'sessionSummary',
  'profile.json': 'profileResponse'
};

const fixtureFiles = (await readdir(fixtureDirectory)).filter((file) => file.endsWith('.json')).sort();
const manifest = [];

for (const file of fixtureFiles) {
  const schemaName = fixtureSchemaNames[file];
  if (!schemaName) {
    throw new Error(`Fixture ${file} is not mapped to a contract schema.`);
  }

  const value = JSON.parse(await readFile(path.join(fixtureDirectory, file), 'utf8'));
  assertValidContract(schemaName, value);
  const schema = schemas[schemaName];

  manifest.push({ file, schema: schema.$id });
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, 'contracts-manifest.json'),
  `${JSON.stringify({ contractVersion, fixtures: manifest }, null, 2)}\n`
);

process.stdout.write(`Validated ${manifest.length} contract fixtures.\n`);

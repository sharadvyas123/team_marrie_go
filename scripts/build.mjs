import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemas, contractVersion } from '../packages/contracts/src/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDirectory = path.join(root, 'packages/contracts/fixtures');
const outputDirectory = path.join(root, 'dist');
const fixtureSchemaNames = {
  'health.json': 'healthResponse',
  'problem.json': 'problemResponse',
  'pagination.json': 'pagination',
  'place-summary.json': 'placeSummary',
  'accessibility-claim.json': 'accessibilityClaim',
  'match-profile.json': 'matchProfile',
  'match-explanation.json': 'matchExplanation',
  'observation.json': 'observation',
  'moderation-item.json': 'moderationItem',
  'incident.json': 'incident',
  'route-request.json': 'routeRequest',
  'route-result.json': 'routeResult',
  'evidence-upload-intent.json': 'evidenceUploadIntent',
  'evidence.json': 'evidence',
  'facility-response.json': 'facilityResponse',
  'civic-changes.json': 'civicChanges',
  'session-summary.json': 'sessionSummary'
};

const fixtureFiles = (await readdir(fixtureDirectory)).filter((file) => file.endsWith('.json')).sort();
const manifest = [];

for (const file of fixtureFiles) {
  const schemaName = fixtureSchemaNames[file];
  if (!schemaName) {
    throw new Error(`Fixture ${file} is not mapped to a contract schema.`);
  }

  const value = JSON.parse(await readFile(path.join(fixtureDirectory, file), 'utf8'));
  const schema = schemas[schemaName];
  const missingFields = schema.required.filter((field) => !(field in value));
  if (missingFields.length > 0) {
    throw new Error(`${file} is missing required fields: ${missingFields.join(', ')}`);
  }

  manifest.push({ file, schema: schema.$id });
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, 'contracts-manifest.json'),
  `${JSON.stringify({ contractVersion, fixtures: manifest }, null, 2)}\n`
);

process.stdout.write(`Validated ${manifest.length} contract fixtures.\n`);

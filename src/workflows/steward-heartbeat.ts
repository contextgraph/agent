import { loadStewardConfig, type StewardIntegrationConfig } from '../steward-config.js';
import { printWrapped } from './render.js';

type AxiomDatasetsResponse =
  | Array<{ name?: string }>
  | { datasets?: Array<{ name?: string }> };

function findAxiomIntegration(integrations: StewardIntegrationConfig[]): StewardIntegrationConfig | null {
  return integrations.find((integration) => integration.name === 'axiom') ?? null;
}

function resolveBearerToken(integration: StewardIntegrationConfig): { envName: string; value: string } {
  const envName = integration.env.find((candidate) => {
    const value = process.env[candidate];
    return value && value.trim().length > 0;
  });

  if (!envName) {
    throw new Error(`Axiom integration is configured but none of its env vars are available: ${integration.env.join(', ')}`);
  }

  return {
    envName,
    value: process.env[envName] as string,
  };
}

function extractDatasetNames(payload: AxiomDatasetsResponse): string[] {
  const datasets = Array.isArray(payload) ? payload : payload.datasets ?? [];
  return datasets
    .map((dataset) => dataset.name?.trim())
    .filter((name): name is string => Boolean(name));
}

export async function runStewardHeartbeat(options: { steward: string }): Promise<void> {
  const config = await loadStewardConfig();
  if (!config) {
    throw new Error('No steward config found. Run `steward configure` first.');
  }

  const integration = findAxiomIntegration(config.integrations);
  if (!integration) {
    throw new Error('No Axiom integration is configured in ~/.steward/config.json.');
  }

  const token = resolveBearerToken(integration);
  const endpoint = new URL('/v2/datasets', integration.endpoint.endsWith('/') ? integration.endpoint : `${integration.endpoint}/`);

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token.value}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Axiom heartbeat request failed with ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as AxiomDatasetsResponse;
  const datasetNames = extractDatasetNames(payload);

  console.log('# Steward Heartbeat');
  console.log(`- Steward: ${options.steward}`);
  console.log(`- Integration: ${integration.name}`);
  console.log(`- Auth Env: ${token.envName}`);
  console.log(`- Dataset Count: ${datasetNames.length}`);

  console.log('\n## Result');
  if (datasetNames.length === 0) {
    printWrapped('Axiom responded successfully, but no dataset names were returned.', { indent: '  ' });
    return;
  }

  printWrapped(`Axiom responded successfully. Sample datasets: ${datasetNames.slice(0, 5).join(', ')}`, {
    indent: '  ',
  });
}

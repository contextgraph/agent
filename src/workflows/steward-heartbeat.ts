import { ApiClient, type IntegrationSurfaceResource } from '../api-client.js';
import { PRIMARY_WEB_BASE_URL } from '../platform-urls.js';
import { printWrapped } from './render.js';

type AxiomDatasetsResponse =
  | Array<{ name?: string }>
  | { datasets?: Array<{ name?: string }> };

function findAxiomIntegration(integrations: IntegrationSurfaceResource[]): IntegrationSurfaceResource | null {
  return integrations.find((integration) => integration.key === 'axiom') ?? null;
}

function resolveBearerToken(integration: IntegrationSurfaceResource): { envName: string; value: string } {
  const envName = integration.envVars.find((candidate) => {
    const value = process.env[candidate];
    return value && value.trim().length > 0;
  });

  if (!envName) {
    throw new Error(`Axiom integration is available in steward.foo, but none of its env vars are available locally: ${integration.envVars.join(', ')}`);
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

export async function runStewardHeartbeat(options: { steward: string; baseUrl?: string }): Promise<void> {
  const client = new ApiClient(options.baseUrl ?? PRIMARY_WEB_BASE_URL);
  const integrations = await client.getIntegrationSurfaces();
  const integration = findAxiomIntegration(integrations);
  if (!integration) {
    throw new Error('No Axiom integration surface is defined in steward.foo.');
  }
  if (!integration.defaultEndpoint) {
    throw new Error('Axiom integration surface is missing a default endpoint.');
  }

  const token = resolveBearerToken(integration);
  const endpoint = new URL('/v2/datasets', integration.defaultEndpoint.endsWith('/') ? integration.defaultEndpoint : `${integration.defaultEndpoint}/`);

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
  console.log(`- Integration: ${integration.name} (${integration.key})`);
  console.log(`- Auth Env: ${token.envName}`);
  console.log(`- Endpoint: ${integration.defaultEndpoint}`);
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

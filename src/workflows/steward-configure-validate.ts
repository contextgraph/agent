import { loadStewardConfig, saveStewardConfig, type StewardConfigFile, type StewardIntegrationConfig } from '../steward-config.js';
import { getStewardConfigPath } from '../steward-config.js';
import { printWrapped } from './render.js';

type ValidationOutcome = {
  name: string;
  ok: boolean;
  reason: string;
  validatedAt?: string;
};

function buildHeaders(integration: StewardIntegrationConfig): Headers {
  const headers = new Headers();
  const firstEnv = integration.env[0];
  const token = firstEnv ? process.env[firstEnv] : undefined;

  if (!token) {
    return headers;
  }

  if (integration.auth_type === 'bearer') {
    headers.set('Authorization', `Bearer ${token}`);
  } else if (integration.auth_type === 'api_key') {
    headers.set('X-API-Key', token);
  }

  return headers;
}

function isReachableStatus(status: number): boolean {
  return (status >= 200 && status < 300) || status === 401 || status === 403 || status === 404 || status === 405;
}

async function validateIntegration(integration: StewardIntegrationConfig): Promise<ValidationOutcome> {
  const missingEnv = integration.env.filter((name) => {
    const value = process.env[name];
    return !value || value.trim().length === 0;
  });

  if (missingEnv.length > 0) {
    return {
      name: integration.name,
      ok: false,
      reason: `Missing required env: ${missingEnv.join(', ')}`,
    };
  }

  let endpoint: URL;
  try {
    endpoint = new URL(integration.endpoint);
  } catch {
    return {
      name: integration.name,
      ok: false,
      reason: `Invalid endpoint URL: ${integration.endpoint}`,
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: buildHeaders(integration),
    });

    if (!isReachableStatus(response.status)) {
      return {
        name: integration.name,
        ok: false,
        reason: `Endpoint responded with unexpected status ${response.status}`,
      };
    }

    return {
      name: integration.name,
      ok: true,
      reason: `Endpoint reachable (${response.status})`,
      validatedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      name: integration.name,
      ok: false,
      reason: error instanceof Error ? error.message : 'Unknown network error',
    };
  }
}

function withValidatedTimestamps(config: StewardConfigFile, outcomes: ValidationOutcome[]): StewardConfigFile {
  const byName = new Map(outcomes.map((outcome) => [outcome.name, outcome]));

  return {
    ...config,
    integrations: config.integrations.map((integration) => {
      const outcome = byName.get(integration.name);
      if (!outcome?.ok || !outcome.validatedAt) {
        return integration;
      }

      return {
        ...integration,
        validated_at: outcome.validatedAt,
      };
    }),
  };
}

export async function runStewardConfigureValidate(): Promise<void> {
  const config = await loadStewardConfig();
  if (!config) {
    throw new Error(`No steward config found at ${getStewardConfigPath()}. Run \`steward configure\` first.`);
  }

  console.log('# Steward Config Validation');
  console.log(`- Path: ${getStewardConfigPath()}`);
  console.log(`- Integrations: ${config.integrations.length}`);

  const outcomes: ValidationOutcome[] = [];
  for (const integration of config.integrations) {
    outcomes.push(await validateIntegration(integration));
  }

  const validatedConfig = withValidatedTimestamps(config, outcomes);
  await saveStewardConfig(validatedConfig);

  console.log('\n## Results');
  for (const outcome of outcomes) {
    console.log(`- ${outcome.ok ? 'OK' : 'FAIL'}: ${outcome.name}`);
    printWrapped(outcome.reason, { indent: '  ' });
  }

  const failed = outcomes.filter((outcome) => !outcome.ok);
  const succeeded = outcomes.length - failed.length;

  console.log('\n## Summary');
  console.log(`- Passed: ${succeeded}`);
  console.log(`- Failed: ${failed.length}`);

  if (failed.length > 0) {
    throw new Error('One or more integrations failed validation.');
  }
}

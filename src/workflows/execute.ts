import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { spawnClaude } from '../claude-cli.js';
import { executeClaude } from '../claude-sdk.js';

const API_BASE_URL = 'https://www.contextgraph.dev';

export async function runExecute(actionId: string): Promise<void> {
  const credentials = await loadCredentials();

  if (!credentials) {
    console.error('❌ Not authenticated. Run authentication first.');
    process.exit(1);
  }

  if (isExpired(credentials) || isTokenExpired(credentials.clerkToken)) {
    console.error('❌ Token expired. Re-authenticate to continue.');
    process.exit(1);
  }

  console.log(`Fetching execution instructions for action ${actionId}...\n`);

  const response = await fetch(
    `${API_BASE_URL}/api/prompts/execute`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.clerkToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ actionId }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch execute prompt: ${response.statusText}\n${errorText}`);
  }

  const { prompt } = await response.json();

  const useSDK = process.env.USE_CLAUDE_SDK !== 'false';

  console.log(`Spawning Claude for execution${useSDK ? ' (SDK)' : ' (CLI)'}...\n`);

  const claudeResult = useSDK
    ? await executeClaude({
        prompt,
        cwd: process.cwd(),
      })
    : await spawnClaude({
        prompt,
        cwd: process.cwd(),
      });

  if (claudeResult.exitCode !== 0) {
    const implementation = useSDK ? 'SDK' : 'CLI';
    console.error(`\n❌ Claude ${implementation} execution failed with exit code ${claudeResult.exitCode}`);
    process.exit(1);
  }

  console.log('\n✅ Execution complete');
}


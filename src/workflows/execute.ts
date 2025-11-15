import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { spawnClaude } from '../claude-cli.js';

const API_BASE_URL = 'https://contextgraph.dev';

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
    `${API_BASE_URL}/api/actions/${actionId}/execute-prompt?token=${encodeURIComponent(credentials.clerkToken)}`,
    {
      headers: {
        'x-authorization': `Bearer ${credentials.clerkToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch execute prompt: ${response.status}`);
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error);
  }

  const prompt = result.data.prompt;

  console.log('Spawning Claude for execution...\n');

  const claudeResult = await spawnClaude({
    prompt,
    cwd: process.cwd(),
  });

  if (claudeResult.exitCode !== 0) {
    console.error(`\n❌ Claude execution failed with exit code ${claudeResult.exitCode}`);
    process.exit(1);
  }

  console.log('\n✅ Execution complete');
}


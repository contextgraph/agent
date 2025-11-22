import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { executeClaude } from '../claude-sdk.js';

const API_BASE_URL = 'https://www.contextgraph.dev';

export async function runPrepare(actionId: string): Promise<void> {
  const credentials = await loadCredentials();

  if (!credentials) {
    console.error('❌ Not authenticated. Run authentication first.');
    process.exit(1);
  }

  if (isExpired(credentials) || isTokenExpired(credentials.clerkToken)) {
    console.error('❌ Token expired. Re-authenticate to continue.');
    process.exit(1);
  }

  console.log(`Fetching preparation instructions for action ${actionId}...\n`);

  const response = await fetch(
    `${API_BASE_URL}/api/prompts/prepare`,
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
    throw new Error(`Failed to fetch prepare prompt: ${response.statusText}\n${errorText}`);
  }

  const { prompt } = await response.json();

  console.log('Spawning Claude for preparation...\n');

  const claudeResult = await executeClaude({
    prompt,
    cwd: process.cwd(),
  });

  if (claudeResult.exitCode !== 0) {
    console.error(`\n❌ Claude preparation failed with exit code ${claudeResult.exitCode}`);
    process.exit(1);
  }

  console.log('\n✅ Preparation complete');
}


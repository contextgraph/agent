import { loadCredentials, isExpired, isTokenExpired } from '../credentials.js';
import { executeClaude } from '../claude-sdk.js';
import { LogTransportService } from '../log-transport.js';
import { LogBuffer } from '../log-buffer.js';
import { HeartbeatManager } from '../heartbeat-manager.js';

const API_BASE_URL = 'https://www.contextgraph.dev';

export interface WorkflowOptions {
  cwd?: string;
}

export async function runPrepare(actionId: string, options?: WorkflowOptions): Promise<void> {
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

  // Initialize log streaming infrastructure
  const logTransport = new LogTransportService(API_BASE_URL, credentials.clerkToken);
  let runId: string | undefined;
  let heartbeatManager: HeartbeatManager | undefined;
  let logBuffer: LogBuffer | undefined;

  try {
    // Create run for this preparation phase
    console.log('[Log Streaming] Creating run for prepare phase...');
    runId = await logTransport.createRun(actionId);
    console.log(`[Log Streaming] Run created: ${runId}`);

    // Update run state to preparing
    await logTransport.updateRunState('preparing');

    // Start heartbeat manager
    heartbeatManager = new HeartbeatManager(API_BASE_URL, credentials.clerkToken, runId);
    heartbeatManager.start();
    console.log('[Log Streaming] Heartbeat started');

    // Set up log buffer for non-blocking transmission
    logBuffer = new LogBuffer(logTransport);
    logBuffer.start();

    console.log('Spawning Claude for preparation...\n');

    const claudeResult = await executeClaude({
      prompt,
      cwd: options?.cwd || process.cwd(),
      authToken: credentials.clerkToken,
      onLogEvent: (event) => {
        logBuffer!.push(event);
      },
    });

    // Update run state based on result
    const finalState = claudeResult.exitCode === 0 ? 'completed' : 'failed';
    await logTransport.updateRunState(finalState, {
      exitCode: claudeResult.exitCode,
      cost: claudeResult.cost,
      usage: claudeResult.usage,
      phase: 'prepare',
    });

    if (claudeResult.exitCode !== 0) {
      console.error(`\n❌ Claude preparation failed with exit code ${claudeResult.exitCode}`);
      process.exit(1);
    }

    console.log('\n✅ Preparation complete');

  } catch (error) {
    // Update run state to failed if we have a run
    if (runId) {
      try {
        await logTransport.updateRunState('failed', {
          error: error instanceof Error ? error.message : String(error),
          phase: 'prepare',
        });
      } catch (stateError) {
        console.error('[Log Streaming] Failed to update run state:', stateError);
      }
    }
    throw error;

  } finally {
    // Cleanup: stop heartbeat and flush remaining logs
    if (heartbeatManager) {
      heartbeatManager.stop();
      console.log('[Log Streaming] Heartbeat stopped');
    }

    if (logBuffer) {
      await logBuffer.stop();
      console.log('[Log Streaming] Logs flushed');
    }
  }
}

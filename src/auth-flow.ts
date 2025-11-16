import { startCallbackServer } from './callback-server.js';
import { saveCredentials } from './credentials.js';

type AuthenticationResult =
  | {
      success: true;
      credentials: {
        token: string;
        userId: string;
      };
    }
  | {
      success: false;
      error: string;
    };

type AuthenticationOptions = {
  baseUrl?: string;
  timeout?: number;
  openBrowser?: (url: string) => Promise<void>;
};

const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const DEFAULT_BASE_URL = 'https://www.contextgraph.dev';

async function defaultOpenBrowser(url: string): Promise<void> {
  const open = (await import('open')).default;
  await open(url);
}

export async function authenticateAgent(
  options: AuthenticationOptions = {}
): Promise<AuthenticationResult> {
  const {
    baseUrl = DEFAULT_BASE_URL,
    timeout = DEFAULT_TIMEOUT,
    openBrowser = defaultOpenBrowser,
  } = options;

  let server;

  try {
    server = await startCallbackServer();
    const { port, waitForCallback, close } = server;

    const authUrl = `${baseUrl}/auth/cli-callback?port=${port}`;

    console.log(`Opening browser to: ${authUrl}`);
    await openBrowser(authUrl);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Authentication timeout')), timeout);
    });

    const result = await Promise.race([waitForCallback(), timeoutPromise]);

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

    await saveCredentials({
      clerkToken: result.token,
      userId: result.userId,
      expiresAt,
      createdAt: new Date().toISOString(),
    });

    await close();

    return {
      success: true,
      credentials: {
        token: result.token,
        userId: result.userId,
      },
    };
  } catch (error) {
    if (server) {
      await server.close();
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

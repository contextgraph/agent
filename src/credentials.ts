import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { Credentials, StoredCredentials, GitCredentials } from './types/actions.js';

function getCredentialsDir(): string {
  return process.env.CONTEXTGRAPH_CREDENTIALS_DIR || path.join(os.homedir(), '.contextgraph');
}

function getCredentialsPath(): string {
  return path.join(getCredentialsDir(), 'credentials.json');
}

export const CREDENTIALS_DIR = getCredentialsDir();
export const CREDENTIALS_PATH = getCredentialsPath();

export async function saveCredentials(credentials: Credentials): Promise<void> {
  const dir = getCredentialsDir();
  const filePath = getCredentialsPath();

  await fs.mkdir(dir, { recursive: true, mode: 0o700 });

  // Load existing credentials to preserve git credentials if they exist
  const existing = await loadStoredCredentials();
  const storedCreds: StoredCredentials = {
    clerk: credentials,
    git: existing?.git,
  };

  const content = JSON.stringify(storedCreds, null, 2);
  await fs.writeFile(filePath, content, { mode: 0o600 });
}

/**
 * Load stored credentials from disk
 * Internal function that returns the full StoredCredentials structure
 */
async function loadStoredCredentials(): Promise<StoredCredentials | null> {
  const filePath = getCredentialsPath();

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);

    // Check if this is the old format (has clerkToken at root level)
    if ('clerkToken' in parsed && !('clerk' in parsed)) {
      // Migrate old format to new format
      return {
        clerk: parsed as Credentials,
      };
    }

    return parsed as StoredCredentials;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    console.error('Error loading credentials:', error);
    return null;
  }
}

export async function loadCredentials(): Promise<Credentials | null> {
  const stored = await loadStoredCredentials();
  return stored?.clerk || null;
}

export async function deleteCredentials(): Promise<void> {
  const filePath = getCredentialsPath();

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

export function isExpired(credentials: Credentials): boolean {
  return new Date(credentials.expiresAt) <= new Date();
}

export function isTokenExpired(token: string): boolean {
  try {
    // Decode JWT to check actual token expiration
    const parts = token.split('.');
    if (parts.length !== 3) {
      return true; // Invalid token format
    }

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const now = Math.floor(Date.now() / 1000);

    // Token without exp claim is considered expired
    if (!payload.exp) {
      return true;
    }

    // Check if token has expired (including exactly now)
    if (payload.exp <= now) {
      return true;
    }

    // Check if token is not yet valid
    if (payload.nbf && payload.nbf > now) {
      return true;
    }

    return false;
  } catch {
    return true; // If we can't decode it, treat as expired
  }
}

export function getTokenExpiration(token: string): Date | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.exp) {
      return new Date(payload.exp * 1000);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get an authenticated fetch function that includes the Clerk token
 *
 * This loads the credentials from disk and returns a fetch function
 * that automatically includes the x-authorization header (workaround for Vercel stripping Authorization).
 *
 * Throws an error if credentials are not found or expired.
 */
export async function getAuthenticatedFetch(): Promise<typeof fetch> {
  const credentials = await loadCredentials();

  if (!credentials) {
    throw new Error(
      'No credentials found. Please run authentication first.'
    );
  }

  if (isTokenExpired(credentials.clerkToken)) {
    throw new Error(
      'Your credentials have expired. Please re-authenticate.'
    );
  }

  // Return a fetch function that includes the x-authorization header
  // Use x-authorization instead of Authorization because Vercel strips Authorization header
  return async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('x-authorization', `Bearer ${credentials.clerkToken}`);

    return fetch(url, {
      ...init,
      headers,
    });
  };
}

// ============================================================================
// Git Credentials Functions
// ============================================================================

/**
 * Save git credentials to disk
 * Preserves existing Clerk credentials
 */
export async function saveGitCredentials(git: GitCredentials): Promise<void> {
  const dir = getCredentialsDir();
  const filePath = getCredentialsPath();

  await fs.mkdir(dir, { recursive: true, mode: 0o700 });

  // Load existing credentials to preserve clerk credentials
  const existing = await loadStoredCredentials();

  if (!existing?.clerk) {
    throw new Error(
      'Cannot save git credentials without Clerk credentials. Please authenticate first.'
    );
  }

  const storedCreds: StoredCredentials = {
    clerk: existing.clerk,
    git,
  };

  const content = JSON.stringify(storedCreds, null, 2);
  await fs.writeFile(filePath, content, { mode: 0o600 });
}

/**
 * Load git credentials from disk
 * Returns null if no git credentials are stored
 */
export async function loadGitCredentials(): Promise<GitCredentials | null> {
  const stored = await loadStoredCredentials();
  return stored?.git || null;
}

/**
 * Validate a git token by making a test API request
 * Returns true if token is valid, false otherwise
 */
export async function validateGitToken(
  token: string,
  provider: 'github' | 'gitlab'
): Promise<boolean> {
  try {
    const url = provider === 'github'
      ? 'https://api.github.com/user'
      : 'https://gitlab.com/api/v4/user';

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    return response.ok;
  } catch (error) {
    // Don't expose token in error messages
    console.error(`Failed to validate ${provider} token:`, error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

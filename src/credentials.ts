import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { Credentials } from './types/actions.js';

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

  const content = JSON.stringify(credentials, null, 2);
  await fs.writeFile(filePath, content, { mode: 0o600 });
}

export async function loadCredentials(): Promise<Credentials | null> {
  const filePath = getCredentialsPath();

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as Credentials;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    console.error('Error loading credentials:', error);
    return null;
  }
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

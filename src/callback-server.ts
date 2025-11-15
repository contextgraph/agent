import http from 'http';
import { URL } from 'url';
import type { CallbackResult } from './types/actions.js';

export type CallbackServerResult = {
  port: number;
  waitForCallback: () => Promise<CallbackResult>;
  close: () => void;
};

const MIN_PORT = 3000;
const MAX_PORT = 3100;

async function findFreePort(): Promise<number> {
  for (let port = MIN_PORT; port <= MAX_PORT; port++) {
    const isAvailable = await checkPortAvailable(port);
    if (isAvailable) {
      return port;
    }
  }

  throw new Error(`No free ports found between ${MIN_PORT} and ${MAX_PORT}`);
}

function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = http.createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port);
  });
}

export async function startCallbackServer(): Promise<CallbackServerResult> {
  const port = await findFreePort();

  let callbackResolve: ((result: CallbackResult) => void) | null = null;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    if (url.pathname === '/callback') {
      const token = url.searchParams.get('token');
      const userId = url.searchParams.get('userId');

      if (!token) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getErrorPage('Missing token parameter'));
        return;
      }

      if (!userId) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getErrorPage('Missing userId parameter'));
        return;
      }

      if (callbackResolve) {
        callbackResolve({ token, userId });
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getSuccessPage());
    } else {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getNotFoundPage());
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, resolve);
  });

  return {
    port,
    waitForCallback: () => {
      return new Promise((resolve) => {
        callbackResolve = resolve;
      });
    },
    close: () => {
      server.close();
    },
  };
}

function getSuccessPage(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authentication Successful</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      padding: 3rem;
      border-radius: 1rem;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
      max-width: 400px;
    }
    .icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 {
      color: #667eea;
      margin: 0 0 1rem 0;
      font-size: 1.5rem;
    }
    p {
      color: #666;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">✅</div>
    <h1>Authentication successful!</h1>
    <p>You can close this window and return to your terminal.</p>
  </div>
</body>
</html>
  `.trim();
}

function getErrorPage(message: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authentication Error</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    }
    .container {
      background: white;
      padding: 3rem;
      border-radius: 1rem;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
      max-width: 400px;
    }
    .icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 {
      color: #f5576c;
      margin: 0 0 1rem 0;
      font-size: 1.5rem;
    }
    p {
      color: #666;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">❌</div>
    <h1>Authentication error</h1>
    <p>${message}</p>
  </div>
</body>
</html>
  `.trim();
}

function getNotFoundPage(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Not Found</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #f0f0f0;
    }
    .container {
      background: white;
      padding: 3rem;
      border-radius: 1rem;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      text-align: center;
      max-width: 400px;
    }
    h1 {
      color: #666;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>404 Not Found</h1>
  </div>
</body>
</html>
  `.trim();
}

import http from 'http';
import { URL } from 'url';
import type { CallbackResult } from './types/actions.js';

export type CallbackServerResult = {
  port: number;
  waitForCallback: () => Promise<CallbackResult>;
  close: () => Promise<void>;
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
  const connections = new Set<import('net').Socket>();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    if (url.pathname === '/callback') {
      const token = url.searchParams.get('token');
      const userId = url.searchParams.get('userId');
      const email = url.searchParams.get('email');

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
        callbackResolve({ token, userId, ...(email ? { email } : {}) });
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getSuccessPage());
    } else {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getNotFoundPage());
    }
  });

  // Track connections so we can destroy them on close
  server.on('connection', (socket) => {
    connections.add(socket);
    socket.on('close', () => {
      connections.delete(socket);
    });
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
      return new Promise<void>((resolve, reject) => {
        // Destroy all active connections to ensure server closes immediately
        for (const socket of connections) {
          socket.destroy();
        }
        connections.clear();

        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
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
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: hsl(0 0% 8%);
      --tile-bg: hsl(0 0% 12%);
      --cream: hsl(45 30% 85%);
      --orange: hsl(30 95% 55%);
      --subtitle: hsl(0 0% 55%);
      --border: hsl(0 0% 20%);
    }

    * {
      box-sizing: border-box;
    }

    body {
      font-family: 'JetBrains Mono', 'SF Mono', 'Monaco', 'Inconsolata', monospace;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: var(--bg);
      padding: 1rem;
    }

    .container {
      background: var(--tile-bg);
      padding: 3rem;
      border-radius: 0.75rem;
      border: 1px solid var(--border);
      text-align: center;
      max-width: 400px;
      width: 100%;
    }

    .icon-container {
      width: 80px;
      height: 80px;
      margin: 0 auto 1.5rem;
      background: hsl(145 50% 12%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid hsl(145 50% 25%);
    }

    .icon {
      width: 40px;
      height: 40px;
      stroke: hsl(145 70% 55%);
      stroke-width: 3;
      fill: none;
    }

    h1 {
      color: var(--cream);
      margin: 0 0 0.75rem 0;
      font-size: 1.25rem;
      font-weight: 500;
      letter-spacing: -0.02em;
    }

    p {
      color: var(--subtitle);
      margin: 0;
      font-size: 0.875rem;
      line-height: 1.6;
    }

    .brand {
      margin-top: 2rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border);
    }

    .brand-text {
      color: var(--orange);
      font-size: 0.75rem;
      font-weight: 500;
      letter-spacing: 0.05em;
    }

    @keyframes check-draw {
      0% {
        stroke-dashoffset: 24;
      }
      100% {
        stroke-dashoffset: 0;
      }
    }

    .icon polyline {
      stroke-dasharray: 24;
      stroke-dashoffset: 24;
      animation: check-draw 0.4s ease-out 0.2s forwards;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon-container">
      <svg class="icon" viewBox="0 0 24 24">
        <polyline points="4 12 10 18 20 6"></polyline>
      </svg>
    </div>
    <h1>Authentication successful</h1>
    <p>You can close this window and return to your terminal.</p>
    <div class="brand">
      <span class="brand-text">CONTEXTGRAPH</span>
    </div>
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
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: hsl(0 0% 8%);
      --tile-bg: hsl(0 0% 12%);
      --red: hsl(0 80% 60%);
      --red-dim: hsl(0 50% 12%);
      --red-border: hsl(0 50% 25%);
      --cream: hsl(45 30% 85%);
      --orange: hsl(30 95% 55%);
      --subtitle: hsl(0 0% 55%);
      --border: hsl(0 0% 20%);
    }

    * {
      box-sizing: border-box;
    }

    body {
      font-family: 'JetBrains Mono', 'SF Mono', 'Monaco', 'Inconsolata', monospace;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: var(--bg);
      padding: 1rem;
    }

    .container {
      background: var(--tile-bg);
      padding: 3rem;
      border-radius: 0.75rem;
      border: 1px solid var(--border);
      text-align: center;
      max-width: 400px;
      width: 100%;
    }

    .icon-container {
      width: 80px;
      height: 80px;
      margin: 0 auto 1.5rem;
      background: var(--red-dim);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid var(--red-border);
    }

    .icon {
      width: 40px;
      height: 40px;
      stroke: var(--red);
      stroke-width: 3;
      fill: none;
    }

    h1 {
      color: var(--red);
      margin: 0 0 0.75rem 0;
      font-size: 1.25rem;
      font-weight: 500;
      letter-spacing: -0.02em;
    }

    p {
      color: var(--subtitle);
      margin: 0;
      font-size: 0.875rem;
      line-height: 1.6;
    }

    .brand {
      margin-top: 2rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border);
    }

    .brand-text {
      color: var(--orange);
      font-size: 0.75rem;
      font-weight: 500;
      letter-spacing: 0.05em;
    }

    @keyframes x-draw {
      0% {
        stroke-dashoffset: 34;
      }
      100% {
        stroke-dashoffset: 0;
      }
    }

    .icon line {
      stroke-dasharray: 17;
      stroke-dashoffset: 17;
    }

    .icon line:first-child {
      animation: x-draw 0.3s ease-out 0.2s forwards;
    }

    .icon line:last-child {
      animation: x-draw 0.3s ease-out 0.35s forwards;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon-container">
      <svg class="icon" viewBox="0 0 24 24">
        <line x1="6" y1="6" x2="18" y2="18"></line>
        <line x1="18" y1="6" x2="6" y2="18"></line>
      </svg>
    </div>
    <h1>Authentication error</h1>
    <p>${message}</p>
    <div class="brand">
      <span class="brand-text">CONTEXTGRAPH</span>
    </div>
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
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: hsl(0 0% 8%);
      --tile-bg: hsl(0 0% 12%);
      --cream: hsl(45 30% 85%);
      --orange: hsl(30 95% 55%);
      --subtitle: hsl(0 0% 55%);
      --border: hsl(0 0% 20%);
    }

    * {
      box-sizing: border-box;
    }

    body {
      font-family: 'JetBrains Mono', 'SF Mono', 'Monaco', 'Inconsolata', monospace;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: var(--bg);
      padding: 1rem;
    }

    .container {
      background: var(--tile-bg);
      padding: 3rem;
      border-radius: 0.75rem;
      border: 1px solid var(--border);
      text-align: center;
      max-width: 400px;
      width: 100%;
    }

    .code {
      color: var(--orange);
      font-size: 3rem;
      font-weight: 700;
      margin: 0 0 0.5rem 0;
      letter-spacing: -0.02em;
    }

    h1 {
      color: var(--cream);
      margin: 0;
      font-size: 1rem;
      font-weight: 400;
    }

    .brand {
      margin-top: 2rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border);
    }

    .brand-text {
      color: var(--orange);
      font-size: 0.75rem;
      font-weight: 500;
      letter-spacing: 0.05em;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="code">404</div>
    <h1>Not Found</h1>
    <div class="brand">
      <span class="brand-text">CONTEXTGRAPH</span>
    </div>
  </div>
</body>
</html>
  `.trim();
}

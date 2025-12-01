# @context-graph/agent

Autonomous agent for contextgraph action execution.

## Installation

No installation required! Use npx to run commands directly:

```bash
npx @context-graph/agent <command>
```

Or install globally for convenience:

```bash
npm install -g @context-graph/agent
```

## Prerequisites

- Node.js 18 or higher
- Active contextgraph.dev account

## Quick Start

### Option 1: Interactive Authentication

1. Authenticate with contextgraph.dev:

```bash
npx @context-graph/agent auth
```

2. Run the agent:

```bash
npx @context-graph/agent run
```

### Option 2: API Token (CI/CD & Cloud Deployments)

For automated environments, use an API token:

```bash
export CONTEXTGRAPH_API_TOKEN="your-api-token"
npx @context-graph/agent run
```

Get your API token from https://contextgraph.dev/settings/tokens

## Commands

### `auth`
Authenticate with contextgraph.dev using OAuth:

```bash
npx @context-graph/agent auth
```

Opens your browser to complete authentication. Credentials are securely stored in `~/.contextgraph/`.

### `whoami`
Check your current authentication status:

```bash
npx @context-graph/agent whoami
```

Shows your user ID and token expiration.

### `run <action-id>`
Run the autonomous agent loop:

```bash
npx @context-graph/agent run <action-id>
```

The agent will:
1. Fetch the action tree
2. Find the next unprepared/incomplete leaf action
3. Prepare it (if needed) - assess if it should be broken down
4. Execute it - implement the work using Claude
5. Repeat until all actions are complete

### `prepare <action-id>`
Prepare a single action:

```bash
npx @context-graph/agent prepare <action-id>
```

Spawns Claude to assess whether the action should be broken down into child actions or is ready to execute.

### `execute <action-id>`
Execute a single prepared action:

```bash
npx @context-graph/agent execute <action-id>
```

Spawns Claude to implement the action and mark it complete.

## How It Works

The agent implements a prepare/execute workflow:

**Prepare Phase:**
- Fetches action details including parent chain, siblings, and dependencies
- Analyzes whether the action is atomic or should be broken down
- If complex, creates child actions with proper dependencies
- Marks the action as prepared

**Execute Phase:**
- Implements the work described in the action
- Runs tests and builds to verify changes
- Commits and pushes changes to the appropriate branch
- Marks the action as complete with detailed completion context

**Autonomous Loop:**
- The `run` command traverses the action tree depth-first
- Automatically prepares and executes actions in dependency order
- Continues until all actions in the tree are complete

The agent integrates with contextgraph.dev's MCP server to:
- Fetch action details and relationships
- Create and update actions
- Track completion context and learnings

## Troubleshooting

### Authentication failures

If authentication fails or tokens expire:

```bash
npx @context-graph/agent auth
```

This will open a new browser session to re-authenticate.

### Expired credentials

Tokens expire after a period of time. Re-authenticate with:

```bash
npx @context-graph/agent whoami  # Check expiration
npx @context-graph/agent auth    # Re-authenticate if expired
```

### Network errors

Ensure you have internet connectivity and can reach:
- https://www.contextgraph.dev (API endpoint)
- https://contextgraph.dev (authentication)

## Links

- [contextgraph.dev](https://contextgraph.dev) - Main platform
- [GitHub Repository](https://github.com/context-graph/agent) - Source code and issues
- [Issue Tracker](https://github.com/context-graph/agent/issues) - Report bugs or request features

## Configuration

### Credentials

The agent supports two authentication methods:

**1. Interactive OAuth (Default)**

Credentials are stored in `~/.contextgraph/credentials.json` after running `contextgraph-agent auth`.

**2. API Token (Environment Variable)**

Set the `CONTEXTGRAPH_API_TOKEN` environment variable for automated deployments:

```bash
export CONTEXTGRAPH_API_TOKEN="your-api-token"
```

This is ideal for:
- CI/CD pipelines (GitHub Actions, GitLab CI, etc.)
- Cloud worker deployments (AWS Lambda, Modal, etc.)
- Docker containers
- Any automated environment where interactive login isn't possible

API tokens take precedence over file-based credentials when both are present.

### Worker Polling

The worker uses exponential backoff when no work is available to prevent server overload. Configure polling behavior with environment variables:

- `WORKER_INITIAL_POLL_INTERVAL` - Initial polling interval in milliseconds (default: 2000 / 2 seconds)
- `WORKER_MAX_POLL_INTERVAL` - Maximum polling interval in milliseconds (default: 30000 / 30 seconds)

When no work is available, the worker waits before polling again. The wait time increases exponentially (1.5x multiplier) up to the maximum interval. On successful claim, the interval resets to the initial value.

Example:
```bash
# Poll more frequently (every 1 second initially, up to 15 seconds max)
WORKER_INITIAL_POLL_INTERVAL=1000 WORKER_MAX_POLL_INTERVAL=15000 npx @context-graph/agent run <action-id>
```

### Claude Agent SDK

The agent uses the [Claude Agent SDK](https://github.com/anthropics/anthropic-sdk-typescript/tree/main/packages/agent-sdk) for reliable, high-performance execution of actions. The SDK provides:
- Consistent error handling and recovery
- Direct API integration without CLI dependencies
- Better timeout and cancellation control
- Structured message parsing and formatting

#### SDK Authentication

The Claude Agent SDK requires Anthropic API credentials. Set the `ANTHROPIC_API_KEY` environment variable:

```bash
export ANTHROPIC_API_KEY="your-anthropic-api-key"
```

This is required for:
- Worker agent execution
- Autonomous action processing
- Any command that spawns Claude for prepare/execute operations

**Generating Long-Lived Anthropic Tokens:**

For CI/CD pipelines, cloud deployments, and unattended worker execution, you'll need a long-lived Anthropic API key:

1. Visit the [Anthropic Console API Keys page](https://console.anthropic.com/settings/keys)
2. Click "Create Key" to generate a new API key
3. Give it a descriptive name (e.g., "Production Worker" or "CI/CD Pipeline")
4. Copy the key immediately - it won't be shown again
5. Store it securely in your environment or secrets manager

**Security Best Practices:**
- Never commit API keys to version control
- Use environment variables or secrets management systems (AWS Secrets Manager, GitHub Secrets, etc.)
- Rotate keys periodically
- Use separate keys for different environments (development, staging, production)
- Revoke compromised keys immediately from the Anthropic Console

For local development, you can set the key in your shell profile (`~/.bashrc`, `~/.zshrc`) or use a `.env` file (with proper `.gitignore` configuration).

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Development mode
pnpm dev
```

## License

MIT

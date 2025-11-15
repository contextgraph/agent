# @context-graph/agent

Autonomous agent for contextgraph action execution.

## Installation

```bash
npm install -g @context-graph/agent
```

Or use with npx:

```bash
npx @context-graph/agent <command>
```

## Prerequisites

- Node.js 18 or higher
- Claude CLI installed and available in PATH (`claude --version`)
- Active contextgraph.dev account

## Quick Start

1. Authenticate with contextgraph.dev:

```bash
contextgraph-agent auth
```

2. Run an action:

```bash
contextgraph-agent run <action-id>
```

Get your action ID from https://contextgraph.dev

## Commands

### `auth`
Authenticate with contextgraph.dev using OAuth:

```bash
contextgraph-agent auth
```

Opens your browser to complete authentication. Credentials are securely stored in `~/.contextgraph/`.

### `whoami`
Check your current authentication status:

```bash
contextgraph-agent whoami
```

Shows your user ID and token expiration.

### `run <action-id>`
Run the autonomous agent loop:

```bash
contextgraph-agent run <action-id>
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
contextgraph-agent prepare <action-id>
```

Spawns Claude to assess whether the action should be broken down into child actions or is ready to execute.

### `execute <action-id>`
Execute a single prepared action:

```bash
contextgraph-agent execute <action-id>
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

### Claude CLI not found

Ensure Claude CLI is installed and in your PATH:

```bash
claude --version
```

If not installed, follow the installation instructions at https://docs.claude.com

### Authentication failures

If authentication fails or tokens expire:

```bash
contextgraph-agent auth
```

This will open a new browser session to re-authenticate.

### Expired credentials

Tokens expire after a period of time. Re-authenticate with:

```bash
contextgraph-agent whoami  # Check expiration
contextgraph-agent auth    # Re-authenticate if expired
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

Credentials are stored in `~/.contextgraph/credentials.json`

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

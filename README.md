# @contextgraph/agent

Autonomous agent for contextgraph action execution.

## Installation

```bash
npm install -g @contextgraph/agent
```

Or use with npx:

```bash
npx @contextgraph/agent <command>
```

## Prerequisites

- Node.js >= 18
- Claude CLI: `npm install -g @anthropic/claude`
- Contextgraph MCP server configured in Claude Code

## Quick Start

1. Authenticate with contextgraph:

```bash
contextgraph-agent auth
```

2. Run the agent on an action:

```bash
contextgraph-agent run <action-id>
```

## Commands

- `contextgraph-agent auth` - Authenticate with contextgraph
- `contextgraph-agent run <action-id>` - Run autonomous agent loop
- `contextgraph-agent prepare <action-id>` - Prepare action for execution
- `contextgraph-agent execute <action-id>` - Execute prepared action
- `contextgraph-agent whoami` - Show current authentication status
- `contextgraph-agent config` - View/edit configuration

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

# steward

Local CLI for steward.foo.

## Quick Start

```bash
npm install -g @contextgraph/agent
steward auth
steward --help
steward backlog --help
steward backlog top
```

`steward auth` opens a browser login and stores credentials locally in `~/.steward/credentials.json`.

For non-interactive environments, set `STEWARD_API_TOKEN` instead of using browser auth.

## Tell Your Agent

Append this to `CLAUDE.md` or `AGENTS.md` in your project:

```bash
echo "Use the \`steward\` CLI for steward.foo work. Learn the workflow from \`steward --help\` and \`steward backlog --help\`." >> CLAUDE.md
```

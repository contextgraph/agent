/**
 * Pure helpers for upserting the steward remote MCP server into the various
 * config-file formats coding agents use. Kept side-effect free so the merge
 * logic is fully unit-testable; callers own the file I/O.
 *
 * Every supported client points at the same remote HTTP MCP endpoint, so the
 * only real variation is the surrounding file format.
 */

/** The remote HTTP MCP server entry shape shared by JSON clients. */
export interface McpHttpEntry {
  type: 'http';
  url: string;
}

/** JSON clients key their server map differently. */
export type McpJsonKey = 'mcpServers' | 'servers';

type JsonObject = Record<string, unknown>;

function parseJsonObject(existing: string | null | undefined): JsonObject {
  if (!existing || existing.trim().length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch (error) {
    throw new Error(
      `Existing config is not valid JSON, refusing to overwrite: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Existing config is not a JSON object, refusing to overwrite.');
  }
  return parsed as JsonObject;
}

/**
 * Merge `{ [jsonKey]: { [name]: entry } }` into an existing JSON config string,
 * preserving all other content. Returns pretty-printed JSON with a trailing
 * newline. Throws (rather than clobbering) if the existing content is not a
 * JSON object.
 */
export function upsertMcpServerJson(
  existing: string | null | undefined,
  jsonKey: McpJsonKey,
  name: string,
  entry: McpHttpEntry
): string {
  const root = parseJsonObject(existing);

  const currentServers = root[jsonKey];
  const servers: JsonObject =
    typeof currentServers === 'object' && currentServers !== null && !Array.isArray(currentServers)
      ? { ...(currentServers as JsonObject) }
      : {};

  servers[name] = entry;
  root[jsonKey] = servers;

  return `${JSON.stringify(root, null, 2)}\n`;
}

/** Whether the named server already exists under `jsonKey` in the config. */
export function hasMcpServerJson(
  existing: string | null | undefined,
  jsonKey: McpJsonKey,
  name: string
): boolean {
  const root = parseJsonObject(existing);
  const servers = root[jsonKey];
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(servers, name);
}

/**
 * Upsert a `[mcp_servers.<name>]` table into a Codex-style TOML config.
 *
 * If the table already exists its body is replaced up to the next top-level
 * table header (or EOF); otherwise the table is appended. Unrelated content is
 * preserved. We intentionally write only the keys we own (`url`) rather than
 * round-tripping the whole document, so this never reorders a user's config.
 */
export function upsertMcpServerToml(
  existing: string | null | undefined,
  name: string,
  url: string
): string {
  const header = `[mcp_servers.${name}]`;
  const tableLines = [header, `url = "${url}"`];

  const content = existing ?? '';
  if (content.trim().length === 0) {
    return `${tableLines.join('\n')}\n`;
  }

  const lines = content.split('\n');
  const headerIndex = lines.findIndex((line) => line.trim() === header);

  if (headerIndex === -1) {
    // Append the table, ensuring a blank-line separator.
    const trimmedTrailing = content.replace(/\n+$/, '');
    return `${trimmedTrailing}\n\n${tableLines.join('\n')}\n`;
  }

  // Replace the existing table body: from the header up to (but not including)
  // the next line that opens a new table (`[...]`), or end of file.
  let endIndex = lines.length;
  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  const before = lines.slice(0, headerIndex);
  const after = lines.slice(endIndex);
  const rebuilt = [...before, ...tableLines, ...after];
  let result = rebuilt.join('\n');
  if (!result.endsWith('\n')) {
    result += '\n';
  }
  return result;
}

/** Whether a `[mcp_servers.<name>]` table already exists in the TOML config. */
export function hasMcpServerToml(existing: string | null | undefined, name: string): boolean {
  if (!existing) {
    return false;
  }
  const header = `[mcp_servers.${name}]`;
  return existing.split('\n').some((line) => line.trim() === header);
}

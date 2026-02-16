import { loadCredentials, isExpired, isTokenExpired } from './credentials.js';
import { fetchWithRetry } from './fetch-with-retry.js';

/**
 * API client for the ContextGraph CLI (`cg`)
 *
 * This client calls the MCP server at mcp.contextgraph.dev using HTTP transport.
 * All methods return raw JSON responses from the MCP server.
 */
export class CgApiClient {
  constructor(
    private mcpServerUrl: string = 'https://mcp.contextgraph.dev'
  ) {}

  private async getAuthToken(): Promise<string> {
    const credentials = await loadCredentials();

    if (!credentials) {
      throw new Error('Not authenticated. Run `contextgraph-agent auth` to authenticate.');
    }

    // Check both the stored metadata and the actual JWT expiration
    if (isExpired(credentials) || isTokenExpired(credentials.clerkToken)) {
      throw new Error('Token expired. Run `contextgraph-agent auth` to re-authenticate.');
    }

    return credentials.clerkToken;
  }

  /**
   * Call an MCP tool by name with the given arguments
   *
   * @param toolName - The name of the MCP tool (e.g., "actions/fetch", "actions/search")
   * @param args - The arguments object to pass to the tool
   * @returns The tool's response data
   */
  async callTool(toolName: string, args: Record<string, any>): Promise<any> {
    const token = await this.getAuthToken();

    // Call the MCP server using JSON-RPC 2.0 format
    // The MCP protocol over HTTP uses tools/call method
    const response = await fetchWithRetry(
      this.mcpServerUrl,
      {
        method: 'POST',
        headers: {
          'x-authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args,
          },
        }),
      },
      { verbose: false }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MCP server error ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    // Check for JSON-RPC error
    if (result.error) {
      throw new Error(`MCP tool error: ${result.error.message || JSON.stringify(result.error)}`);
    }

    // Return the result data
    // MCP tools/call returns { result: { content: [...] } }
    // The content array typically has text items with the actual data
    if (result.result?.content?.[0]?.text) {
      try {
        // Try to parse as JSON if it's a text response
        return JSON.parse(result.result.content[0].text);
      } catch {
        // Return raw text if not JSON
        return result.result.content[0].text;
      }
    }

    // Fallback: return the entire result
    return result.result;
  }
}

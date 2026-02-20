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

    // Protocol error: HTTP-level failure
    if (!response.ok) {
      const errorText = await response.text();
      this.logError('protocol_error', {
        toolName,
        status: response.status,
        errorText,
      });
      throw new Error(`MCP server HTTP error ${response.status}: ${errorText}`);
    }

    let result: any;
    try {
      result = await response.json();
    } catch (parseError) {
      this.logError('json_parse_error', {
        toolName,
        parseError: parseError instanceof Error ? parseError.message : String(parseError),
      });
      throw new Error('Failed to parse MCP server response as JSON');
    }

    // JSON-RPC protocol error
    if (result.error) {
      this.logError('jsonrpc_error', {
        toolName,
        error: result.error,
      });
      throw new Error(`MCP JSON-RPC error: ${result.error.message || JSON.stringify(result.error)}`);
    }

    // Validate response structure
    if (!result.result) {
      this.logError('invalid_response_format', {
        toolName,
        receivedKeys: Object.keys(result),
        expected: 'result field',
      });
      throw new Error('Invalid MCP response: missing result field');
    }

    if (!result.result.content || !Array.isArray(result.result.content)) {
      this.logError('invalid_response_format', {
        toolName,
        receivedResultKeys: Object.keys(result.result),
        expected: 'result.content array',
      });
      throw new Error('Invalid MCP response: result.content is not an array');
    }

    if (result.result.content.length === 0) {
      this.logError('empty_content', {
        toolName,
      });
      throw new Error('Invalid MCP response: result.content is empty');
    }

    const firstContent = result.result.content[0];
    if (!firstContent.text) {
      this.logError('invalid_content_format', {
        toolName,
        contentType: firstContent.type || 'unknown',
        receivedKeys: Object.keys(firstContent),
      });
      throw new Error('Invalid MCP response: content[0].text is missing');
    }

    const textContent = firstContent.text;

    // Detect MCP tool errors returned in content
    // MCP tools may return error messages as text content with "Error: " prefix
    if (typeof textContent === 'string' && textContent.startsWith('Error: ')) {
      this.logError('mcp_tool_error', {
        toolName,
        errorMessage: textContent,
      });
      throw new Error(`MCP tool failed: ${textContent}`);
    }

    // Try to parse as JSON if it's a text response
    try {
      return JSON.parse(textContent);
    } catch {
      // Return raw text if not JSON
      this.logDebug('non_json_response', {
        toolName,
        textLength: textContent.length,
      });
      return textContent;
    }
  }

  /**
   * Log error information to stderr for debugging
   * Preserves JSON-only stdout for programmatic consumption
   */
  private logError(errorType: string, context: Record<string, any>): void {
    console.error(JSON.stringify({
      level: 'error',
      type: errorType,
      timestamp: new Date().toISOString(),
      ...context,
    }));
  }

  /**
   * Log debug information to stderr for debugging
   * Preserves JSON-only stdout for programmatic consumption
   */
  private logDebug(debugType: string, context: Record<string, any>): void {
    // Only log debug messages if DEBUG env var is set
    if (process.env.DEBUG) {
      console.error(JSON.stringify({
        level: 'debug',
        type: debugType,
        timestamp: new Date().toISOString(),
        ...context,
      }));
    }
  }
}

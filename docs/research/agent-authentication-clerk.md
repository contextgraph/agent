# Agent Authentication with Clerk - Research Findings

**Date**: December 9, 2025
**Action ID**: d1a0acfb-d056-4fbd-8631-a67474799f19
**Status**: Research Complete

## Executive Summary

This document presents research findings on Clerk's authentication capabilities for implementing secure, auditable agent identity. Currently, execution agents inherit user Clerk tokens, creating security and auditability gaps. This research evaluates three approaches:

1. **M2M Tokens** - Best for pure machine-to-machine service authentication
2. **OAuth Access Tokens** - Best for agents acting on behalf of users with scoped access
3. **API Keys** (Future) - Ideal solution when available, allowing users to delegate access to agents

**Recommendation**: Implement **OAuth Access Tokens** in the short term for proper user delegation and audit trails, while monitoring Clerk's API Keys feature for future migration.

---

## Current State Analysis

### How Authentication Works Today

The codebase currently uses user Clerk tokens for all agent API authentication:

- **`src/credentials.ts`**: Loads user credentials (JWT or API token) from `~/.contextgraph/credentials.json`
- **`src/auth-flow.ts`**: OAuth flow returns user tokens via browser callback
- **`src/workflows/agent.ts` (line 289)**: Agents use `credentials.clerkToken` (user's token)
- **`src/api-client.ts`**: All API calls include `x-authorization: Bearer ${userToken}` header

### Security and Auditability Gaps

**Problem 1: Privilege Escalation Risk**
- Agents act with full user privileges
- No scope limitation on what agents can access
- If agent is compromised, attacker has full user access

**Problem 2: No Agent Identity**
- Actions in audit logs appear as user actions
- Cannot distinguish between "user did X" vs "agent did X on behalf of user"
- No way to revoke agent access without revoking user access

**Problem 3: Token Lifecycle Issues**
- User tokens expire, breaking long-running agent workflows
- No independent token refresh for agents
- Agent failures tied to user session state

---

## Clerk's Authentication Capabilities

### 1. M2M (Machine-to-Machine) Tokens

**Status**: Generally Available (GA as of October 2025)

#### What They Are

M2M tokens authenticate machines (servers, applications, devices) to ensure they are who they say they are. Designed for backend service-to-service communication within your own infrastructure.

#### Key Features

- **Machine Configuration**: Create machines in Clerk Dashboard, specify which machines can communicate
- **Access Scopes**: Define allowed communication partners (e.g., Machine A can access Machine B)
- **Token Management**: Create, verify, and revoke tokens via API
- **Planned JWT Support**: Future update will allow local verification without network calls

#### API Operations

```typescript
// Create M2M token
const token = await clerkClient.machineAuth.createToken({
  machineId: 'machine_a',
  targetMachineId: 'machine_b'
});

// Verify M2M token
const verified = await clerkClient.machineAuth.verifyToken(token);

// Revoke M2M token
await clerkClient.machineAuth.revokeToken(tokenId);
```

#### Limitations for Agent Use Case

❌ **Not scoped to users** - M2M tokens are not associated with specific users by default
❌ **No user delegation** - Cannot represent "agent acting on behalf of user"
❌ **Limited audit trail** - Tokens show machine identity, not user context
❌ **Paid feature** - Requires paid plan (was free during beta)

**Use Case**: Backend service authentication (e.g., API gateway → database service), not for user-delegated agent actions.

**Sources**:
- [Clerk Machine Authentication Overview](https://clerk.com/docs/machine-auth/overview)
- [Using M2M Tokens](https://clerk.com/docs/guides/development/machine-auth/m2m-tokens)
- [M2M Tokens General Availability](https://clerk.com/changelog/2025-10-14-m2m-ga)

---

### 2. OAuth Access Tokens (User Delegation)

**Status**: Available Now

#### What They Are

OAuth access tokens allow third-party applications to request limited access to specific parts of a user's data through Clerk's API. Enables applications to interact with user data in a secure and controlled manner, based on explicit user consent.

#### Authorization Code Flow

Clerk supports the standard OAuth 2.0 Authorization Code Flow:

1. **Client** (agent application) requests authorization
2. **Authorization Service** (Clerk) authenticates user and shows consent screen
3. **User** grants permission with specific scopes
4. **Clerk** returns authorization code
5. **Client** exchanges code for access token
6. **Client** uses access token to call APIs on behalf of user

#### Key Features

- **Scoped Access**: Request specific permissions (e.g., read actions, write notes)
- **User Consent**: Explicit user approval required for each scope
- **Token Types**:
  - Access token (2 hour expiry)
  - Refresh token (3 day expiry)
  - ID token (user identity info)
- **Token Introspection**: Validate tokens and check scopes via `/oauth/token_info` endpoint

#### Implementation Flow

```typescript
// 1. Redirect user to authorization URL
const authUrl = `${clerkUrl}/oauth/authorize?` +
  `client_id=${clientId}&` +
  `redirect_uri=${redirectUri}&` +
  `response_type=code&` +
  `scope=read:actions write:actions`;

// 2. User approves, receives authorization code

// 3. Exchange code for tokens
const response = await fetch(`${clerkUrl}/oauth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: authorizationCode,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri
  })
});

const { access_token, refresh_token, id_token } = await response.json();

// 4. Use access token for API calls
const apiResponse = await fetch(`${apiUrl}/api/actions`, {
  headers: {
    'Authorization': `Bearer ${access_token}`
  }
});

// 5. Refresh when expired
const refreshResponse = await fetch(`${clerkUrl}/oauth/token`, {
  method: 'POST',
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refresh_token,
    client_id: clientId
  })
});
```

#### Token Expiration

- **Authorization codes**: 10 minutes
- **Access tokens**: 2 hours
- **Refresh tokens**: 3 days

#### Advantages for Agent Use Case

✅ **User association** - Tokens are explicitly tied to the user who granted consent
✅ **Scoped permissions** - Limit what agents can access (e.g., only read actions, not modify billing)
✅ **Revocable** - User can revoke agent access without logging out
✅ **Audit trail** - Token metadata includes user ID and granted scopes
✅ **Standards-based** - OAuth 2.0 is widely understood and supported
✅ **Token refresh** - Agents can maintain long-running access without user re-auth

#### Token Claims Structure

Access tokens include:
- `sub`: User ID (subject)
- `aud`: Client ID (audience)
- `scope`: Granted permissions
- `exp`: Expiration timestamp
- `iss`: Issuer (Clerk)

For agent scenarios, additional claims can be added via Clerk's session token customization:

```typescript
// Custom claim injection (in Clerk Dashboard or via API)
{
  "sub": "user_abc123",
  "act": {
    "sub": "agent_xyz789",  // Agent identifier
    "name": "Execution Agent"
  },
  "scope": "read:actions write:actions",
  "exp": 1733840000
}
```

The `act` (actor) claim indicates delegation - the agent is acting on behalf of the user.

#### API Endpoints

- **Token Exchange**: `POST /oauth/token`
- **User Info**: `GET /oauth/userinfo` (requires access token in Authorization header)
- **Token Introspection**: `POST /oauth/token_info` (check if token is valid, view scopes)
- **Token Revocation**: `POST /oauth/revoke` (invalidate access or refresh tokens)

**Sources**:
- [Clerk as an Identity Provider: OAuth 2.0](https://clerk.com/docs/advanced-usage/clerk-idp)
- [Use OAuth for Scoped Access](https://clerk.com/docs/oauth/scoped-access)
- [Verify OAuth Tokens with Clerk](https://clerk.com/docs/guides/configure/auth-strategies/oauth/verify-oauth-tokens)

---

### 3. API Keys (User-Delegated)

**Status**: In Development, Not Yet Released

#### What They Are

Clerk's planned API Keys feature will allow application users to create API keys that delegate access to the application's API on their behalf. This is the ideal solution for agent authentication.

#### Planned Features

- **User-Created Keys**: Users can create API keys directly through UserProfile component or custom hooks
- **Backend Verification**: Verify API keys using Clerk's SDKs
- **Instant Revocation**: Users can revoke keys at any time
- **Key-Specific Scopes**: Each key can have different permission levels

#### Why This Is Ideal for Agents

✅ **Native user delegation** - Keys are explicitly tied to the creating user
✅ **Long-lived** - No expiration hassles like OAuth tokens
✅ **Simple to use** - Just pass key in header, no token refresh flow
✅ **User control** - Users manage their own agent keys
✅ **Perfect audit trail** - Each key is identifiable in logs

#### When Available

Clerk documentation states: "Clerk has not released API key support yet, but is working on it and hoping to have it available soon."

**Alternative**: Use OAuth access tokens until API Keys are released, then migrate.

**Sources**:
- [Clerk Machine Authentication Overview](https://clerk.com/docs/machine-auth/overview)
- [API Key Definition](https://clerk.com/glossary/api-key)

---

## Industry Standards: On-Behalf-Of Authentication

### OAuth 2.0 Extension for AI Agents

The OAuth community is developing a formal extension for agent authentication: **OAuth 2.0 Extension: On-Behalf-Of User Authorization for AI Agents** (draft-oauth-ai-agents-on-behalf-of-user-00).

#### Key Concepts

**On-Behalf-Of (OBO) Flow**
- Agent obtains user authorization
- Access tokens include both user and agent identity
- APIs can enforce policies based on both identities

**Token Claims**
```json
{
  "sub": "user_12345",           // User identity
  "act": {
    "sub": "agent_67890",        // Agent identity
    "name": "ContextGraph Agent"
  },
  "scope": "read:actions write:actions",
  "exp": 1733840000
}
```

#### Microsoft Entra Agent ID

Microsoft has implemented comprehensive agent identity platform:

- **Interactive Agents**: Agents that work with user authorization
- **Autonomous Agents**: Agents with their own identity
- **Token Structure**: Uses `sub` and `act.sub` claims for attribution
- **OBO Flow**: Dedicated flow for agents to request user tokens
- **Nested Claims**: Multi-agent workflows represented through claim chains

#### Security Benefits

- **Scoped Permissions**: Agents receive only necessary permissions, filtered from user's scopes
- **Auditability**: Multi-agent workflows show clear attribution chain
- **Revocable**: Short-lived tokens with revocation checks
- **Policy Enforcement**: Each service in chain can enforce policy based on both user and agent identity

**Sources**:
- [OAuth 2.0 Extension: On-Behalf-Of for AI Agents](https://datatracker.ietf.org/doc/html/draft-oauth-ai-agents-on-behalf-of-user-00)
- [Understanding "On-Behalf-Of" in AI Agent Authentication](https://www.scalekit.com/blog/delegated-agent-access)
- [Microsoft Entra Agent ID](https://learn.microsoft.com/en-us/entra/agent-id/identity-platform/what-is-agent-id)

---

## Recommended Implementation Approach

### Phase 1: Implement OAuth Access Tokens (Immediate)

**Why OAuth First**
- Available now in Clerk
- Provides proper user delegation
- Enables scoped permissions
- Creates audit trail
- Standards-based and well-documented

**Implementation Steps**

#### 1. Register Agent as OAuth Application in Clerk

Configure in Clerk Dashboard:
- Application name: "ContextGraph Execution Agent"
- Redirect URIs: `http://localhost:3000/auth/callback`, `https://agent.contextgraph.dev/auth/callback`
- Scopes: Define granular permissions (e.g., `read:actions`, `write:actions`, `create:commits`)

#### 2. Create Agent Identity Type

```typescript
// src/types/agent-auth.ts
export interface AgentIdentity {
  agentId: string;
  agentType: 'execution' | 'preparation' | 'review';
  userId: string; // User who authorized the agent
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scopes: string[];
  createdAt: string;
}
```

#### 3. Implement Agent Authorization Flow

```typescript
// src/agent-auth-flow.ts
export async function authorizeAgent(): Promise<AgentIdentity> {
  // 1. Start callback server
  const server = await startCallbackServer();

  // 2. Generate OAuth URL with agent-specific scopes
  const authUrl = buildOAuthUrl({
    scopes: ['read:actions', 'write:actions', 'read:notes', 'write:notes'],
    redirectUri: `http://localhost:${server.port}/callback`
  });

  // 3. Open browser for user consent
  await openBrowser(authUrl);

  // 4. Wait for authorization code
  const { code } = await server.waitForCallback();

  // 5. Exchange code for tokens
  const tokens = await exchangeCodeForTokens(code);

  // 6. Create agent identity
  const agentIdentity: AgentIdentity = {
    agentId: generateAgentId(),
    agentType: 'execution',
    userId: tokens.userId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    scopes: tokens.scope.split(' '),
    createdAt: new Date().toISOString()
  };

  // 7. Save agent credentials
  await saveAgentCredentials(agentIdentity);

  return agentIdentity;
}
```

#### 4. Implement Token Refresh

```typescript
// src/agent-auth-flow.ts
export async function refreshAgentToken(
  agentIdentity: AgentIdentity
): Promise<AgentIdentity> {
  const response = await fetch(`${clerkUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: agentIdentity.refreshToken,
      client_id: process.env.CLERK_AGENT_CLIENT_ID!
    })
  });

  const tokens = await response.json();

  return {
    ...agentIdentity,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || agentIdentity.refreshToken,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  };
}
```

#### 5. Update API Client to Use Agent Tokens

```typescript
// src/api-client.ts
export class ApiClient {
  private async getAuthToken(): Promise<string> {
    // Check for agent credentials first
    const agentCreds = await loadAgentCredentials();
    if (agentCreds) {
      // Check if token is expired
      if (isTokenExpired(agentCreds.accessToken)) {
        // Refresh token
        const refreshed = await refreshAgentToken(agentCreds);
        await saveAgentCredentials(refreshed);
        return refreshed.accessToken;
      }
      return agentCreds.accessToken;
    }

    // Fallback to user credentials (backward compatibility)
    const credentials = await loadCredentials();
    if (!credentials) {
      throw new Error('Not authenticated. Run agent authorization first.');
    }

    return credentials.clerkToken;
  }

  // ... rest of ApiClient unchanged
}
```

#### 6. Add Agent Context to API Calls

For maximum auditability, include agent metadata in request headers:

```typescript
async getActionDetail(actionId: string): Promise<ActionDetailResource> {
  const token = await this.getAuthToken();
  const agentCreds = await loadAgentCredentials();

  const headers: Record<string, string> = {
    'x-authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // Add agent context headers
  if (agentCreds) {
    headers['x-agent-id'] = agentCreds.agentId;
    headers['x-agent-type'] = agentCreds.agentType;
  }

  const response = await fetchWithRetry(
    `${this.baseUrl}/api/actions/${actionId}`,
    { headers }
  );

  // ... rest unchanged
}
```

#### 7. Backend: Validate Agent Tokens

On the server side, validate OAuth tokens and extract agent context:

```typescript
// Server-side middleware
async function validateAgentAuth(req: Request) {
  const token = req.headers.get('x-authorization')?.replace('Bearer ', '');

  if (!token) {
    throw new Error('No authentication token');
  }

  // Verify token with Clerk
  const verified = await clerkClient.verifyToken(token);

  // Extract agent context from headers
  const agentId = req.headers.get('x-agent-id');
  const agentType = req.headers.get('x-agent-type');

  return {
    userId: verified.sub,
    agentId,
    agentType,
    scopes: verified.scope?.split(' ') || []
  };
}

// Use in API endpoints
export async function handleApiRequest(req: Request) {
  const auth = await validateAgentAuth(req);

  // Log for audit trail
  console.log(`API call by user ${auth.userId} via agent ${auth.agentId} (${auth.agentType})`);

  // Check scopes
  if (!auth.scopes.includes('write:actions')) {
    throw new Error('Insufficient permissions');
  }

  // Process request...
}
```

**Migration Path**
- Maintain backward compatibility with existing user token flow
- Agents try agent credentials first, fallback to user credentials
- Gradually migrate agent usage to OAuth tokens
- Eventually deprecate direct user token usage for agents

**Benefits**
- ✅ Proper user delegation with explicit consent
- ✅ Scoped permissions (agents only access what they need)
- ✅ Clear audit trail (user ID + agent ID in logs)
- ✅ Revocable access (user can revoke without re-auth)
- ✅ Standards-based (OAuth 2.0)
- ✅ Token refresh for long-running workflows

---

### Phase 2: Migrate to API Keys (When Available)

**Why API Keys Are Better Long-Term**
- Simpler for users (just create a key, no OAuth flow)
- Long-lived (no token refresh complexity)
- Native Clerk feature (better integration)
- More intuitive for end users

**Migration Strategy**

When Clerk releases API Keys:

1. **Add API Key Support**
   - Create UI for users to generate agent API keys
   - Store keys securely with agent identity
   - Update API client to accept API keys

2. **Dual-Mode Operation**
   - Support both OAuth tokens and API keys
   - Let users choose their preferred auth method
   - Recommend API keys for new agent setups

3. **Graceful Deprecation**
   - Continue supporting OAuth tokens for existing agents
   - Provide migration guide for OAuth → API key transition
   - Eventually phase out OAuth in favor of API keys

---

## Security Model

### Agent Identity vs User Identity

**Clear Separation**
- **User Identity**: Human who owns the account and grants permissions
- **Agent Identity**: Autonomous entity that acts on behalf of user
- **Relationship**: Agent ↔ User (one-to-many: user can have multiple agents)

### Authentication Flow

```
User (Human)
  ↓ grants consent
Agent OAuth Client (registers with Clerk)
  ↓ receives access token
Agent Process (execution, preparation, review)
  ↓ makes API calls with token
ContextGraph API
  ↓ validates token + scopes
Resource Access (actions, notes, commits)
```

### Authorization Model

**Scope-Based Permissions**

Agents request specific scopes during authorization:

- `read:actions` - View action details
- `write:actions` - Create, update, complete actions
- `read:notes` - View action notes
- `write:notes` - Create notes
- `read:git` - Access git context
- `write:git` - Update git information
- `admin:all` - Full access (should rarely be granted)

Users see requested scopes on consent screen and can approve/deny.

**Runtime Enforcement**

API endpoints check token scopes before allowing operations:

```typescript
if (!hasScope(token, 'write:actions')) {
  throw new ForbiddenError('Agent lacks permission to modify actions');
}
```

### Audit Trail

**Log Format**
```json
{
  "timestamp": "2025-12-09T18:30:00Z",
  "action": "update_action",
  "actionId": "d1a0acfb-d056-4fbd-8631-a67474799f19",
  "userId": "user_abc123",
  "agentId": "agent_xyz789",
  "agentType": "execution",
  "scopes": ["read:actions", "write:actions"],
  "result": "success"
}
```

**Audit Questions Answered**
- Who initiated? → `userId` (human who authorized agent)
- What system performed action? → `agentId`, `agentType`
- What was allowed? → `scopes`
- When did it happen? → `timestamp`
- What was the outcome? → `result`

### Token Lifecycle

**Access Token**
- Expires after 2 hours
- Used for API authentication
- Contains user ID, agent context, scopes
- Validated on every API call

**Refresh Token**
- Expires after 3 days
- Used to obtain new access tokens
- Stored securely in agent credentials
- Automatically used by API client when access token expires

**Revocation**
- User can revoke agent access in Clerk Dashboard
- Immediately invalidates all tokens for that agent
- Agent receives 401 Unauthorized on next API call
- Agent must re-authorize with user consent

---

## Implementation Checklist

### Backend (ContextGraph API)

- [ ] Register OAuth application in Clerk Dashboard
- [ ] Define granular scopes for agent permissions
- [ ] Update API endpoints to validate OAuth tokens
- [ ] Add scope checking middleware
- [ ] Implement audit logging with agent context
- [ ] Create user settings page for managing agent authorizations
- [ ] Document API scopes for agent developers

### Agent (Execution Client)

- [ ] Create `AgentIdentity` type definition
- [ ] Implement `authorizeAgent()` OAuth flow
- [ ] Implement `refreshAgentToken()` function
- [ ] Add agent credential storage (`saveAgentCredentials`, `loadAgentCredentials`)
- [ ] Update `ApiClient.getAuthToken()` to use agent credentials
- [ ] Add agent context headers to all API calls
- [ ] Implement token expiration handling with automatic refresh
- [ ] Create migration path for existing user token usage
- [ ] Add CLI command: `contextgraph agent authorize`
- [ ] Add CLI command: `contextgraph agent revoke`

### Testing

- [ ] Test OAuth flow end-to-end
- [ ] Test token refresh flow
- [ ] Test scope enforcement (agents denied when lacking permission)
- [ ] Test token expiration handling
- [ ] Test revocation (agent loses access after user revokes)
- [ ] Test audit logging (user + agent attribution)
- [ ] Test backward compatibility with user tokens
- [ ] Load test token validation performance

### Documentation

- [ ] User guide: "Authorizing Agents"
- [ ] Developer guide: "Agent Authentication Architecture"
- [ ] API reference: OAuth endpoints and scopes
- [ ] Security guide: Best practices for agent tokens
- [ ] Migration guide: User tokens → Agent OAuth tokens
- [ ] Troubleshooting: Common agent auth issues

---

## Alternative Approaches Considered

### 1. Clerk M2M Tokens Only

**Approach**: Use M2M tokens for all agent communication.

**Pros**:
- Simple to implement
- No OAuth complexity
- Designed for machine auth

**Cons**:
- ❌ No user association - can't tell which user's data agent is accessing
- ❌ No scoped permissions - all-or-nothing access
- ❌ Poor audit trail - only shows machine identity
- ❌ Paid feature

**Verdict**: ❌ Rejected - doesn't solve core problem of user delegation

---

### 2. Custom JWT Signing

**Approach**: Generate our own JWTs signed with application secret, embed agent context.

**Pros**:
- Full control over token structure
- Can add any claims needed
- No dependency on Clerk's OAuth

**Cons**:
- ❌ Reinventing the wheel - OAuth solves this
- ❌ Security burden - must implement signing, validation, rotation
- ❌ Not standards-based - harder to audit and integrate
- ❌ Doesn't leverage Clerk's revocation

**Verdict**: ❌ Rejected - unnecessary complexity, security risk

---

### 3. Service Accounts in Clerk

**Approach**: Create dedicated Clerk "user" accounts for each agent.

**Pros**:
- Simple to implement (just create users)
- Standard authentication flow

**Cons**:
- ❌ Abuses user concept - agents aren't users
- ❌ No user association - can't tell which human authorized agent
- ❌ Billing issues - might count toward user limits
- ❌ Confusing in dashboards - agent "users" mixed with real users

**Verdict**: ❌ Rejected - conceptual mismatch

---

### 4. Shared Secret Keys

**Approach**: Agent and API share a secret key, agent includes key in requests.

**Pros**:
- Very simple
- No OAuth complexity

**Cons**:
- ❌ No user association - all agents share same identity
- ❌ No revocation - must rotate key for all agents
- ❌ Security risk - single key compromise affects all agents
- ❌ No scoped permissions

**Verdict**: ❌ Rejected - major security issues

---

## Open Questions

### 1. Scope Granularity

**Question**: How granular should OAuth scopes be?

**Options**:
- Coarse (e.g., `read`, `write`, `admin`)
- Fine (e.g., `read:actions`, `write:actions`, `read:notes`, `write:notes`, `create:commits`)
- Resource-based (e.g., `action:read`, `action:write`, `note:read`, `note:write`)

**Recommendation**: Start with fine-grained scopes grouped by resource type (`<verb>:<resource>`). This allows users to grant specific permissions while keeping the consent screen manageable.

### 2. Multi-Agent Workflows

**Question**: How to handle workflows where one agent delegates to another?

**Example**: Execution agent needs to call preparation agent, which needs access to same action.

**Options**:
- Nested delegation (OBO with `act` claim chaining)
- Shared parent token (both agents use same OAuth token)
- Independent authorization (each agent has own token, user approves both)

**Recommendation**: Start with shared token (both agents use same authorization). Implement nested delegation later if needed for stricter isolation.

### 3. Token Storage Security

**Question**: How to securely store agent credentials?

**Current State**: User tokens stored in `~/.contextgraph/credentials.json` with file permissions 0o600.

**Considerations**:
- Refresh tokens are long-lived (3 days)
- Compromise gives attacker agent access
- Need protection from other processes on same machine

**Options**:
- OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- Encrypted file storage
- Memory-only (require re-auth frequently)

**Recommendation**: Start with encrypted file storage (file permissions + encryption at rest). Migrate to OS keychain for production.

### 4. Token Rotation Policy

**Question**: How frequently should tokens be refreshed?

**Clerk Defaults**:
- Access token: 2 hours
- Refresh token: 3 days

**Considerations**:
- Longer tokens = more risk if compromised
- Shorter tokens = more refresh overhead
- Long-running agents may outlive refresh token

**Recommendation**:
- Keep Clerk's default expiry times
- Implement automatic refresh before expiration
- Prompt user to re-authorize if refresh token expires during long workflow

---

## Conclusion

Clerk provides strong capabilities for implementing secure agent authentication through OAuth access tokens. While API Keys would be ideal when available, OAuth tokens provide immediate benefits:

✅ **User Delegation** - Proper "on-behalf-of" semantics
✅ **Scoped Permissions** - Limit agent access to necessary resources
✅ **Audit Trail** - Clear attribution (user + agent)
✅ **Revocable** - Users control agent access
✅ **Standards-Based** - OAuth 2.0 is well-understood
✅ **Available Now** - Can implement immediately

**Next Steps**:
1. Implement OAuth-based agent authentication (Phase 1)
2. Test with execution agents in local development
3. Rollout to production with phased migration
4. Monitor Clerk's API Keys feature for future migration (Phase 2)

---

## References

### Clerk Documentation
- [Machine Authentication Overview](https://clerk.com/docs/machine-auth/overview)
- [Using M2M Tokens](https://clerk.com/docs/guides/development/machine-auth/m2m-tokens)
- [Clerk as an Identity Provider: OAuth 2.0](https://clerk.com/docs/advanced-usage/clerk-idp)
- [Use OAuth for Scoped Access](https://clerk.com/docs/oauth/scoped-access)
- [Verify OAuth Tokens with Clerk](https://clerk.com/docs/guides/configure/auth-strategies/oauth/verify-oauth-tokens)
- [M2M Tokens General Availability](https://clerk.com/changelog/2025-10-14-m2m-ga)

### Industry Standards
- [OAuth 2.0 Extension: On-Behalf-Of for AI Agents](https://datatracker.ietf.org/doc/html/draft-oauth-ai-agents-on-behalf-of-user-00)
- [Understanding "On-Behalf-Of" in AI Agent Authentication](https://www.scalekit.com/blog/delegated-agent-access)
- [Microsoft Entra Agent ID](https://learn.microsoft.com/en-us/entra/agent-id/identity-platform/what-is-agent-id)

### Additional Resources
- [Clerk M2M Example Repository](https://github.com/clerk/m2m-example)
- [AI Agent Authentication Methods](https://stytch.com/blog/ai-agent-authentication-methods/)
- [Why M2M Tokens Aren't Enough for Agent-Based Systems](https://prefactor.tech/blog/why-m2m-tokens-aren-t-enough-for-agent-based-systems-beyond-static-credentials)

---

**Document Status**: Complete
**Last Updated**: December 9, 2025
**Action ID**: d1a0acfb-d056-4fbd-8631-a67474799f19

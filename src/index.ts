/**
 * Public surface of the host half.
 *
 * The Cordis loader imports `lib/index.js` and mounts `apply`. Everything else
 * exported here exists so behaviour can be asserted without a live harness —
 * the unit and contract suites in `test/` import these named helpers directly.
 */

export { apply, inject, name } from './host/plugin.js'
export type { PluginContext } from './host/plugin.js'

export { loadState, migrateLoadedState, persistServer, saveState } from './host/state.js'
export { accessToken, authHeaders, hasToken, resolveHeaders } from './host/auth/credentials.js'
export { createOAuth } from './host/auth/oauth.js'
export type { OAuthMetadata, OAuthService } from './host/auth/oauth.js'

export { normalizeEnvPairs, parseArgs, parseEnv, quoteWindowsToken } from './host/util/text.js'
export { serviceOf } from './host/util/services.js'

export {
  imageDiagnostic,
  isDshImageAttachment,
  projectMcpContent,
  renderBrokerExecuteResult,
  renderMcpResult,
} from './host/mcp/content.js'
export { mcpImageProjectionHandlers } from './host/mcp/image.js'
export type { ImageProjectionHandlers } from './host/mcp/image.js'
export { convParams, sanitizeValue } from './host/mcp/schema.js'
export { publicName, workspaceServerId, workspaceTokenKey } from './host/mcp/naming.js'
export { parseRpc, parseSseMessages } from './host/mcp/rpc.js'
export { bindToolsChanged, createHttpTransport } from './host/mcp/http-transport.js'
export { spawnStdio } from './host/mcp/stdio-transport.js'
export { createTransports } from './host/mcp/transports.js'
export {
  disposeRegistrations,
  listAllTools,
  makeToolDefinition,
  registrationSignature,
  syncToolRegistrations,
} from './host/mcp/tools.js'

export {
  ALIAS_TERM_WEIGHT,
  MCP_SEARCH_ALIASES,
  buildAliasIndex,
  expandSearchTerms,
} from './host/broker/aliases.js'
export { normalizeSearchText, stemSearchToken, tokenizeSearchText } from './host/broker/tokenize.js'
export { searchToolEntries } from './host/broker/search.js'
export { brokerCatalog, isMcpToolName, makeBrokerDefinitions } from './host/broker/definitions.js'

export { createRegistry, setServerAuthStatus } from './host/registry.js'
export { resolveSetupAgent } from './host/workspace/agents.js'
export { createWorkspaceScope } from './host/workspace/scope.js'
export { createWorkspaceManager } from './host/workspace/manager.js'
export {
  buildWorkspaceEntry,
  canonicalize,
  normalizeWorkspaceServer,
  readWorkspaceConfig,
  sameServerConfig,
  wsConfigPath,
} from './host/workspace/config.js'

export type {
  AgentLike,
  ContentBlock,
  LoggerLike,
  McpHandle,
  McpToolInfo,
  PluginState,
  RegisteredTool,
  ServerConfig,
  ServerStatus,
  ServerView,
  ToolCatalogEntry,
  ToolDefinition,
  ToolSearchResult,
  WorkspaceView,
} from './host/types.js'

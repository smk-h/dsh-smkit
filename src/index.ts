/**
 * Public surface of the host half, and the composition root.
 *
 * The Cordis loader imports `lib/index.js` and mounts `apply`. Everything else
 * exported here exists so behaviour can be asserted without a live harness —
 * the unit and contract suites in `test/` import these named helpers directly.
 *
 * `apply` is the composition root and nothing more: it builds the platform
 * layer, walks the feature list, and mounts the one prefix route from the
 * handlers those features contributed while mounting. Adding a feature is a
 * directory plus one entry in `FEATURES`.
 */

import { API_PREFIX, ROUTE_PATH } from './host/platform/constants.js'
import { createPrefixRoute } from './host/platform/routes.js'
import { customSettingsFeature } from './host/features/custom-settings/host.js'
import { mcpFeature } from './host/features/mcp/host.js'
import { openSpecFeature } from './host/features/openspec/host.js'
import { sessionDeleteFeature } from './host/features/session-delete/host.js'
import { skillsFeature } from './host/features/skills/host.js'
import type { HostFeature, HostPlatform, PluginContext } from './host/platform/context.js'
import type { ApiHandler } from './host/platform/routes.js'
import type { ServiceAccessor } from './host/platform/types.js'

export type { PluginContext }

/** Display metadata for loader diagnostics. */
export const name = 'mcp-manager'

/** Host-side hard dependency: every tier registers tools through `ctx.tools`. */
export const inject = ['tools']

/** The features this plugin ships; the order here is the order they mount. */
const FEATURES: HostFeature[] = [
  mcpFeature,
  sessionDeleteFeature,
  customSettingsFeature,
  skillsFeature,
  openSpecFeature,
]

export function apply(ctx: PluginContext): void {
  // Collected here, filled by the features, consumed by the one route below.
  const handlers: ApiHandler[] = []
  const outsideApi: ApiHandler[] = []
  const platform: HostPlatform = {
    logger: ctx.logger,
    tools: ctx.tools,
    services: ctx as unknown as ServiceAccessor,
    ctx,
    outsideApi,
    handlers,
  }
  for (const feature of FEATURES) feature.mount(platform)

  // The GUI surface (Settings → MCP, the session delete dialog) needs the
  // webserver, but the agent-side tiers do not. Mount the route when (and if) a
  // webserver appears instead of declaring a hard dependency.
  ctx.effect(() =>
    ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(() =>
        webCtx.webServer?.register(
          createPrefixRoute({
            path: ROUTE_PATH,
            apiPrefix: API_PREFIX,
            outsideApi,
            handlers,
            logger: ctx.logger,
          }),
        ),
      )
    }).dispose,
  )
}

/**
 * Re-exported helpers. They exist so the test suites can exercise host
 * behaviour without a live harness; none of them is needed to mount the plugin.
 */
export {
  effectiveToolCallTimeoutMs,
  loadState,
  migrateLoadedState,
  normalizeToolCallTimeoutMs,
  persistServer,
  saveState,
} from './host/features/mcp/state.js'
export { createSessionDeleter, createSessionPreviewer } from './host/features/session-delete/delete.js'
export type {
  SessionDeleteOutcome,
  SessionDeleter,
  SessionDeleterDeps,
  SessionPreviewer,
  SessionPreviewOutcome,
} from './host/features/session-delete/delete.js'
export { createRetryAdmin } from './host/features/custom-settings/service.js'
export { createRetryHandlers, RETRY_POLICY_PATH, RETRY_ROUTES_PATH } from './host/features/custom-settings/api.js'
export { normalizePolicy, parsePolicyFields, readAtPath, storedRetryableCodes } from './host/features/custom-settings/policy.js'
export type { RetryAdmin, RetrySaveInput, RetrySaveOutcome, RetrySaveFailure } from './host/features/custom-settings/service.js'
export { createModelInputAdmin } from './host/features/custom-settings/model-input.js'
export {
  createModelInputHandlers,
  MODEL_INPUT_PROVIDERS_PATH,
  MODEL_INPUT_SAVE_PATH,
} from './host/features/custom-settings/model-input-api.js'
export type {
  ModelInputAdmin,
  ModelInputSaveFailure,
  ModelInputSaveInput,
  ModelInputSaveOutcome,
} from './host/features/custom-settings/model-input.js'
export type {
  AdminDeps,
  ConfigurableProviderLike,
  LlmModelInfoLike,
  LlmProviderInfoLike,
  LlmServiceLike,
  ResolvedRetryPolicyLike,
  SettingsDescriptorLike,
  SettingsPathOp,
  SettingsServiceLike,
} from './host/features/custom-settings/types.js'
export type {
  RetryMode,
  RetryPolicyFields,
  RetryRefusal,
  RetryRouteView,
  RetryRoutesResponse,
  RetrySaveRequest,
  RetrySaveResponse,
} from './shared/custom-settings/retry.js'
export type {
  InputModality,
  ModelInputRefusal,
  ModelInputSaveRequest,
  ModelInputSaveResponse,
  ModelInputView,
  ModelInputsResponse,
  ModalityChoice,
  ProviderInputRefusal,
  ProviderInputView,
} from './shared/custom-settings/model-input.js'
export { encodeSegment, projectKey, sessionDir } from './host/features/session-delete/path.js'
export {
  deleteEntry,
  listProject,
  listRoot,
  planRemoval,
  removeSkill,
  setSkillEnabled,
  togglePaths,
} from './host/features/skills/catalog.js'
export { readSkillFrontmatter } from './host/features/skills/frontmatter.js'
export { entryIsLink, scanRoot } from './host/features/skills/scan.js'
export { isInsideRoot, rootOf, skillRoots } from './host/features/skills/roots.js'
export { listSkillScopes } from './host/features/skills/workspaces.js'
export { handleOpenSpec } from './host/features/openspec/api.js'
export { ignoreOpenSpec, runGit } from './host/features/openspec/gitignore.js'
export { OPENSPEC_INIT_COMMAND_LINE, OPENSPEC_UPDATE_COMMAND_LINE } from './host/features/openspec/constants.js'
export { initEnv, initOpenSpec, runOpenSpec } from './host/features/openspec/init.js'
export { inspectOpenSpec, projectRootOf as openSpecRootOf } from './host/features/openspec/inspect.js'
export { removalRefusal, removeOpenSpec } from './host/features/openspec/remove.js'
export { streamOpenSpecUpdate, updateEnv, updateOpenSpec } from './host/features/openspec/update.js'
export type { OpenSpecRemovalTarget } from './host/features/openspec/remove.js'
export type { OpenSpecInitOutcome } from './host/features/openspec/init.js'
export type { OpenSpecRunner, OpenSpecUpdateEmitter, OpenSpecUpdateRunner } from './host/features/openspec/types.js'
export type {
  OpenSpecArtifactEntry,
  OpenSpecArtifacts,
  OpenSpecPart,
  OpenSpecRemoveResponse,
  OpenSpecStore,
  OpenSpecTreeNode,
  OpenSpecView,
} from './shared/openspec/contract.js'
export type { Outcome, RemovalPlan } from './host/features/skills/catalog.js'
export type { ScannedSkill, SkillScan } from './host/features/skills/scan.js'
export { accessToken, authHeaders, hasToken, resolveHeaders } from './host/features/mcp/auth/credentials.js'
export { createOAuth } from './host/features/mcp/auth/oauth.js'
export type { OAuthMetadata, OAuthService } from './host/features/mcp/auth/oauth.js'

export { errorText, normalizeEnvPairs, parseArgs, parseEnv, quoteWindowsToken } from './host/platform/util/text.js'
export { serviceOf } from './host/platform/util/services.js'

export {
  imageDiagnostic,
  isDshImageAttachment,
  projectMcpContent,
  renderBrokerExecuteResult,
  renderMcpResult,
} from './host/features/mcp/mcp/content.js'
export { mcpImageProjectionHandlers } from './host/features/mcp/mcp/image.js'
export type { ImageProjectionHandlers } from './host/features/mcp/mcp/image.js'
export { convParams, sanitizeValue } from './host/features/mcp/mcp/schema.js'
export { publicName, workspaceServerId, workspaceTokenKey } from './host/features/mcp/mcp/naming.js'
export { parseRpc, parseSseMessages } from './host/features/mcp/mcp/rpc.js'
export { bindToolsChanged, createHttpTransport } from './host/features/mcp/mcp/http-transport.js'
export { spawnStdio } from './host/features/mcp/mcp/stdio-transport.js'
export { createTransports } from './host/features/mcp/mcp/transports.js'
export {
  disposeRegistrations,
  listAllTools,
  makeToolDefinition,
  registrationSignature,
  syncToolRegistrations,
} from './host/features/mcp/mcp/tools.js'

export {
  ALIAS_TERM_WEIGHT,
  MCP_SEARCH_ALIASES,
  buildAliasIndex,
  expandSearchTerms,
} from './host/features/mcp/broker/aliases.js'
export { normalizeSearchText, stemSearchToken, tokenizeSearchText } from './host/features/mcp/broker/tokenize.js'
export { searchToolEntries } from './host/features/mcp/broker/search.js'
export { brokerCatalog, isMcpToolName, makeBrokerDefinitions } from './host/features/mcp/broker/definitions.js'

export { createRegistry, setServerAuthStatus } from './host/features/mcp/registry.js'
export { resolveSetupAgent } from './host/features/mcp/workspace/agents.js'
export { createWorkspaceScope } from './host/features/mcp/workspace/scope.js'
export { createWorkspaceManager } from './host/features/mcp/workspace/manager.js'
export {
  buildWorkspaceEntry,
  canonicalize,
  normalizeWorkspaceServer,
  readWorkspaceConfig,
  sameServerConfig,
  wsConfigPath,
} from './host/features/mcp/workspace/config.js'

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
  ToolView,
  ToolDefinition,
  ToolSearchResult,
  WorkspaceView,
} from './host/features/mcp/types.js'

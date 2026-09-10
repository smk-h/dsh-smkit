/**
 * Generation-local image projection for one MCP tool.
 *
 * Matches the official `dsh-mcp-client` contract: `execute` stages a
 * projection, and `finalizeContent` installs it **only** when the registry's
 * post-execute result is unchanged. That two-step shape is what stops a raw
 * `{ type: 'image', data }` block from reaching session history, which reads
 * `attachmentId`/`bytes` off every image block and crashes otherwise.
 *
 * Admission is deliberately strict and degrades to text: a result is only
 * upgraded to a real attachment when the store is mounted, the routed model
 * declares image input, and the bytes are canonical base64 of an allowed
 * raster type.
 */

import { isDeepStrictEqual } from 'node:util'
import { CANONICAL_BASE64_RE, IMAGE_MEDIA_TYPES } from '../constants.js'
import { serviceOf } from '../util/services.js'
import { isRecord } from '../util/text.js'
import { imageDiagnostic, isDshImageAttachment, projectMcpContent, renderMcpResult } from './content.js'
import type { ContentBlock, McpContentItem, ServiceAccessor, ToolFinalizeResult } from '../types.js'

interface DecodedImage {
  data: Buffer
  mediaType: string
}

interface AttachmentStore {
  saveImages?(decoded: DecodedImage[]): Promise<unknown[]>
  saveImage?(item: DecodedImage): Promise<unknown>
}

interface ModelInfo {
  inputModalities?: unknown
}

interface LlmService {
  resolveModelInfo(provider: unknown, model: unknown, signal?: AbortSignal): Promise<ModelInfo>
}

/** The slice of a tool-execution context image admission reads. */
interface ImageExec {
  signal?: AbortSignal
  agent?: {
    options?: { provider?: unknown; model?: unknown }
    session?: {
      requestHeader?: () => { config?: { provider?: unknown; model?: unknown } } | undefined
    }
  }
}

interface StagedProjection {
  value: unknown
  fallback: ContentBlock[]
  content: ContentBlock[]
}

export interface ImageProjectionHandlers {
  prepare(
    value: { content?: McpContentItem[]; text?: string } | undefined,
    exec: unknown,
    args: unknown,
  ): Promise<void>
  finalizeContent(exec: unknown, result: ToolFinalizeResult): ContentBlock[] | undefined
}

function containsImage(content: unknown): boolean {
  return Array.isArray(content) && content.some((value) => isRecord(value) && value.type === 'image')
}

function decodeImage(block: Record<string, unknown>): DecodedImage {
  if (typeof block.mimeType !== 'string' || !IMAGE_MEDIA_TYPES.has(block.mimeType)) {
    throw new Error('the declared media type is not PNG, JPEG, WebP, or GIF')
  }
  if (typeof block.data !== 'string' || !CANONICAL_BASE64_RE.test(block.data)) {
    throw new Error('the image data is not canonical base64')
  }
  const data = Buffer.from(block.data, 'base64')
  if (data.toString('base64') !== block.data) {
    throw new Error('the image data is not canonical base64')
  }
  return { data, mediaType: block.mimeType }
}

async function resolveImageAdmission(
  ctx: ServiceAccessor | null | undefined,
  exec: ImageExec | undefined,
): Promise<AttachmentStore> {
  const attachments = serviceOf(ctx, 'attachments')
  if (attachments === undefined) throw new Error('no attachment store is mounted')
  const routed = exec?.agent?.session?.requestHeader?.()?.config
  const provider = routed?.provider ?? exec?.agent?.options?.provider
  const model = routed?.model ?? exec?.agent?.options?.model
  const llm = serviceOf(ctx, 'llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('the current model route could not be resolved')
  }
  let info: ModelInfo
  try {
    info = await (llm as LlmService).resolveModelInfo(provider, model, exec?.signal)
  } catch {
    throw new Error('the current model route could not be verified')
  }
  if (info.inputModalities === undefined || !(info.inputModalities as unknown[]).includes('image')) {
    throw new Error(`model "${String(model)}" does not declare image input`)
  }
  if (exec?.signal?.aborted) throw new Error('the tool call was canceled before image storage')
  return attachments as AttachmentStore
}

async function saveDecodedImages(attachments: AttachmentStore, decoded: DecodedImage[]): Promise<unknown[]> {
  if (typeof attachments.saveImages === 'function') return attachments.saveImages(decoded)
  const saveOne = attachments.saveImage
  if (typeof saveOne !== 'function') throw new TypeError('the attachment store cannot save images')
  const refs: unknown[] = []
  for (const item of decoded) refs.push(await saveOne(item))
  return refs
}

async function prepareImageProjection(
  ctx: ServiceAccessor | null | undefined,
  exec: ImageExec | undefined,
  content: unknown[],
): Promise<ContentBlock[]> {
  const decoded: DecodedImage[] = []
  const validationErrors = new Map<number, string>()
  const imageIndexes: number[] = []
  for (const [index, value] of content.entries()) {
    if (!isRecord(value) || value.type !== 'image') continue
    imageIndexes.push(index)
    try {
      decoded.push(decodeImage(value))
    } catch (error) {
      validationErrors.set(index, error instanceof Error ? error.message : String(error))
    }
  }
  if (validationErrors.size > 0) {
    return projectMcpContent(content, (block, index) => ({
      type: 'text',
      text: imageDiagnostic(
        block,
        validationErrors.get(index) ?? 'another image in the same result was invalid',
      ),
    }))
  }

  let attachments: AttachmentStore
  try {
    attachments = await resolveImageAdmission(ctx, exec)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return projectMcpContent(content, (block) => ({ type: 'text', text: imageDiagnostic(block, reason) }))
  }

  try {
    const refs = await saveDecodedImages(attachments, decoded)
    const byIndex = new Map(imageIndexes.map((index, offset) => [index, refs[offset]]))
    return projectMcpContent(content, (block, index) => {
      const attachment = byIndex.get(index)
      if (!isDshImageAttachment(attachment)) {
        return {
          type: 'text',
          text: imageDiagnostic(block, 'durable image storage rejected the result'),
        }
      }
      return { type: 'image', attachment }
    })
  } catch (error) {
    const shape = isRecord(error) ? error : {}
    const admission = shape.name === 'AttachmentError' || typeof shape.code === 'string'
    const reason = admission
      ? `image admission rejected the result: ${String(shape.message ?? '')}`
      : 'durable image storage rejected the result'
    return projectMcpContent(content, (block) => ({ type: 'text', text: imageDiagnostic(block, reason) }))
  }
}

/**
 * Build the `prepare`/`finalizeContent` pair for one MCP tool. `toolName` is
 * carried for diagnostics only, mirroring the reference implementation.
 */
export function mcpImageProjectionHandlers(
  ctx: ServiceAccessor | null | undefined,
  toolName: string,
): ImageProjectionHandlers {
  const projections = new WeakMap<object, StagedProjection>()
  void toolName
  return {
    async prepare(value, exec, args) {
      const content = Array.isArray(value?.content) ? value.content : []
      if (!isRecord(exec) || !containsImage(content)) return
      const fallback = renderMcpResult(args, value)
      const projected = await prepareImageProjection(ctx, exec as ImageExec, content)
      projections.set(exec, { value, fallback, content: projected })
    },
    finalizeContent(exec, result) {
      if (!isRecord(exec)) return undefined
      const projection = projections.get(exec)
      if (projection === undefined) return undefined
      projections.delete(exec)
      if (result.isError) return undefined
      if (!isDeepStrictEqual(result.value, projection.value)) return undefined
      if (!isDeepStrictEqual(result.content, projection.fallback)) return undefined
      return projection.content
    },
  }
}

/**
 * Projection of untrusted MCP content blocks into DSH content blocks.
 *
 * The rule that keeps sessions alive: DSH history reads `attachmentId`/`bytes`
 * off every image block, so a raw `{ type: 'image', data }` from a server would
 * crash the session. Text is preserved verbatim; images are handed to an
 * `image` projector whose default is a text placeholder.
 */

import { isRecord } from '../util/text.js'
import type {
  ContentBlock,
  DshImageAttachment,
  ImageProjector,
  McpContentItem,
  McpImageBlock,
  TextBlock,
} from '../types.js'

/** The user-facing reason an image block did not become a real attachment. */
export function imageDiagnostic(block: { mimeType?: unknown } | undefined, reason: string): string {
  const mediaType = block?.mimeType ?? 'unknown media type'
  return `[image unavailable: ${mediaType}; ${reason}; raw image data remains available to programmatic callers]`
}

/** Whether a value is a durable DSH attachment the history can consume. */
export function isDshImageAttachment(attachment: unknown): attachment is DshImageAttachment {
  return (
    isRecord(attachment) &&
    attachment.attachmentId != null &&
    attachment.mediaType != null &&
    attachment.bytes != null
  )
}

/**
 * Project untrusted MCP content blocks into DSH ContentBlocks.
 *
 * Text blocks are preserved; image blocks are handed to `image`
 * (default: a text placeholder so DSH never sees `{type:'image', data}`
 * without an attachment).
 */
export function projectMcpContent(
  mcpContent: unknown,
  image: ImageProjector = (block) => ({
    type: 'text',
    text: imageDiagnostic(block, 'this result was not admitted to durable model context'),
  }),
): ContentBlock[] {
  const projected: ContentBlock[] = []
  for (const [index, value] of (Array.isArray(mcpContent) ? mcpContent : []).entries()) {
    if (!isRecord(value)) {
      projected.push({ type: 'text', text: '[unsupported MCP content block: expected an object]' })
      continue
    }
    switch (value.type) {
      case 'text':
        if (value.text !== undefined) projected.push({ type: 'text', text: value.text })
        break
      case 'image':
        projected.push(image(value, index))
        break
      case 'resource_link':
        if (value.name === undefined || value.uri === undefined) {
          projected.push({
            type: 'text',
            text: '[resource link unavailable: the MCP block is missing its name or URI]',
          })
        } else {
          projected.push({ type: 'text', text: `Resource link: ${value.name} (${value.uri})` })
        }
        break
      case 'audio':
        projected.push({
          type: 'text',
          text: `[audio result unsupported: ${
            value.mimeType ?? 'unknown media type'
          }; raw audio data remains available to programmatic callers]`,
        })
        break
      case 'resource':
        projected.push({
          type: 'text',
          text: '[embedded resource unsupported; raw resource data remains available to programmatic callers]',
        })
        break
      default:
        projected.push({ type: 'text', text: `[unsupported MCP content type: ${value.type}]` })
    }
  }
  return projected.length > 0 ? projected : [{ type: 'text', text: '' }]
}

/** Native `output.render` for MCP tools: text-first, never a bare MCP image. */
export function renderMcpResult(
  _args: unknown,
  value: { content?: McpContentItem[]; text?: string } | undefined,
): ContentBlock[] {
  if (Array.isArray(value?.content) && value.content.length > 0) return projectMcpContent(value.content)
  const fallback: TextBlock = { type: 'text', text: value?.text || '' }
  return [fallback]
}

/**
 * Native `output.render` for `mcp_execute_tool`. Inner tools should already
 * have projected images; still refuse a bare MCP image so a nested buggy
 * result cannot poison session history.
 */
export function renderBrokerExecuteResult(
  _args: unknown,
  value: { content?: ContentBlock[] } | undefined,
): ContentBlock[] {
  const content = Array.isArray(value?.content) ? value.content : []
  if (content.length === 0) return [{ type: 'text', text: 'MCP tool completed with no output.' }]
  return content.map((block) => {
    if (isRecord(block) && block.type === 'image' && !isDshImageAttachment(block.attachment)) {
      return {
        type: 'text',
        text: imageDiagnostic(block as McpImageBlock, 'raw MCP image data was not projected to a DSH attachment'),
      }
    }
    return block
  })
}

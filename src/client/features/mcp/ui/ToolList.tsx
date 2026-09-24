/**
 * The registered tools of one connected server: a collapsed summary line (the
 * translated tool count with a caret) that opens into a wrapped row of name
 * chips, each showing a card with the server's own description and input
 * parameters — what the count alone used to leave out.
 *
 * The chips start hidden on purpose: the point of the line is that a server may
 * have dozens of tools, and the row stays one line until the list is asked for
 * (the same disclosure the shell's own MCP panel uses).
 *
 * The card is the section's first element that needs more than a label, so it
 * cannot be a `.smkit-ui-tip::after` bubble and is real DOM instead. It is placed from
 * the chip's viewport rect with `position: fixed`: the settings page scrolls,
 * and a card anchored inside that scroll area would be clipped by it (the
 * shell's own bubbles solve the same problem the same way).
 *
 * What it has to fit inside is that scroll area, not the window — a card
 * clamped to the window at the panel's right edge hangs outside the panel it
 * belongs to. So the bounds come from the same ancestor walk the `.smkit-ui-tip`
 * bubbles clamp to (`tip.ts`'s `clipBounds`): the card is centred on its chip
 * and pulled inside them, opens on the side that has room for it there, and is
 * never taller than that room — it fits by construction, never by measuring
 * itself after render.
 *
 * A chip's own leave is what closes its card, in every direction — a row-level
 * leave would keep the card up while the pointer crossed the row's invisible
 * width beside the last chip of a line. The one exception is the pointer moving
 * *toward* the card, which keeps it: the gap between chip and card is crossed
 * with no chip under the pointer, and a card that vanished there could never be
 * reached (the block's own leave fires on that crossing too, and asks the same
 * question).
 *
 * Once the pointer is on the card, the card's own leave governs — so it follows
 * the pointer instead of sticking, with three deliberate exceptions, all of
 * them about reading and copying the text inside it:
 *
 * - A pointer button held down in the card is a selection in progress. The card
 *   may not be dropped until it is released, or the drag would take the
 *   selection with it — and a selection drag routinely ends past the card's
 *   edge, which is why the release is watched on the document.
 * - A click in the card never closes it. Browsers disagree about what a click
 *   focuses, and a browser that moved focus off the chips would otherwise read
 *   as "the keyboard walked away" — the state the blur guard exists for, and
 *   why it clears only once the pointer is gone as well.
 * - A selection left in the card keeps it: Ctrl+C copies what is still
 *   selected, and unmounting the card would take that text off the page. The
 *   next pointer move that reaches the block, the card or another chip settles
 *   it as usual.
 *
 * The chips carry a tab stop so the same card answers a keyboard walk. They are
 * plain tags rather than buttons — nothing happens on activation — and the card
 * itself is a visual affordance, like the section's `.smkit-ui-tip` bubbles: a server
 * with 38 tools should not add 38 controls to the page's tab order in any
 * announced role.
 */

import { createChevronDownIcon } from '../../../platform/icons/ChevronDownIcon'
import { clipBounds } from '../../../platform/ui/tip'
import type { ClientDeps, Translator } from '../../../platform/types'
import type { ToolView } from '../types'

/** Card width, and the space kept between the card and a viewport edge. */
const CARD_WIDTH = 360
const CARD_GUTTER = 12
/** Gap between the chip and its card. */
const CARD_GAP = 6
/** Room a card wants on the side it opens; less than this and it flips over. */
const CARD_MIN_ROOM = 220

export interface ToolListProps {
  t: Translator
  tools: ToolView[]
}

/** A chip's place in the viewport. */
interface ChipRect {
  left: number
  top: number
  bottom: number
  width: number
}

/** A chip's place plus which tool it opened — what a card is rendered from. */
interface ChipAnchor extends ChipRect {
  index: number
  /** The chip itself: the card's placement walks its ancestors for the panel
   * that clips the section (`clipBounds`), which a bare rect cannot. */
  node: HTMLElement
}

/** A card's viewport box, as both its placement and the hover test read it. */
interface CardBox {
  left: number
  width: number
  /** `true` hangs the card off the chip's bottom edge, `false` grows it upward
   * from the chip's top edge. */
  below: boolean
  /** Distance from the matching viewport edge (`top` / `bottom`). */
  offset: number
  maxHeight: number
}

/** One row of the card's parameter list. */
interface ToolParam {
  name: string
  type: string
  required: boolean
  description: string
}

/**
 * The tool's input schema as flat rows.
 *
 * The host hands over the sanitised schema the registry boundary accepts
 * (`convParams`): a root object with `properties` and `required`, each property
 * carrying at most `type`, `enum`/`oneOf` and a description. Richer vocabulary
 * the MCP server declared arrives as the annotation-only "unconstrained JSON
 * value" form, which is why an absent `type` reads as `any` here rather than
 * being guessed back from the description.
 */
function parameterRows(schema: ToolView['parameters']): ToolParam[] {
  const properties = schema?.properties
  if (!properties || typeof properties !== 'object') return []
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((name): name is string => typeof name === 'string')
      : [],
  )
  return Object.keys(properties).map((name) => {
    const node = (properties as Record<string, unknown>)[name]
    const field = node && typeof node === 'object' ? (node as Record<string, unknown>) : {}
    return {
      name,
      type:
        typeof field.type === 'string'
          ? field.type
          : Array.isArray(field.oneOf)
            ? 'oneOf'
            : 'any',
      required: required.has(name),
      description: typeof field.description === 'string' ? field.description : '',
    }
  })
}

/**
 * Where the card goes for a chip: centred on it, pulled inside the panel that
 * clips the section, and opened on the side with room for it there.
 */
function cardBox(rect: ChipRect, node: HTMLElement): CardBox {
  const bounds = clipBounds(node, CARD_GUTTER)
  const width = Math.min(CARD_WIDTH, Math.max(bounds.right - bounds.left, 0))
  const centred = rect.left + rect.width / 2 - width / 2
  const roomBelow = bounds.bottom - CARD_GAP - rect.bottom
  const roomAbove = rect.top - CARD_GAP - bounds.top
  // Below the chip when there is room there, or when it is the roomier side —
  // and otherwise above, growing upward from its own bottom edge so no height
  // has to be predicted.
  const below = roomBelow >= CARD_MIN_ROOM || roomBelow >= roomAbove
  const room = below ? roomBelow : roomAbove
  return {
    left: Math.min(Math.max(centred, bounds.left), Math.max(bounds.right - width, bounds.left)),
    width,
    below,
    offset: below ? rect.bottom + CARD_GAP : window.innerHeight - (rect.top - CARD_GAP),
    // Never more than the room the panel left: a taller card would be the very
    // overflow this placement exists to prevent.
    maxHeight: Math.max(room, 0),
  }
}

/** The box as the inline geometry the card is rendered with. */
function cardStyle(box: CardBox): Record<string, string> {
  const style: Record<string, string> = {
    left: `${box.left}px`,
    width: `${box.width}px`,
    maxHeight: `${box.maxHeight}px`,
  }
  if (box.below) style.top = `${box.offset}px`
  else style.bottom = `${box.offset}px`
  return style
}

/**
 * Whether a pointer at `(x, y)` is heading onto the card rather than away from
 * the chip: past the chip on the side the card opened, and within the card's
 * horizontal span. Anything else is a leave.
 *
 * The card's height is deliberately not part of this: the question is only
 * which way the pointer went, and the box's own edges answer that.
 */
function headingToCard(rect: ChipRect, node: HTMLElement, x: number, y: number): boolean {
  const box = cardBox(rect, node)
  if (x < box.left || x > box.left + box.width) return false
  return box.below ? y >= rect.bottom : y <= rect.top
}

/** Whether the page has a text selection, i.e. text a copy would take. */
function hasSelection(): boolean {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return false
  const selection = window.getSelection()
  return selection !== null && !selection.isCollapsed
}

export function createToolList(deps: ClientDeps): (props: ToolListProps) => JSX.Element {
  const { h, react } = deps
  const ChevronDownIcon = createChevronDownIcon(deps)

  return function ToolList({ t, tools }: ToolListProps): JSX.Element {
    const [anchor, setAnchor] = react.useState<ChipAnchor | null>(null)
    /** Whether the tool names are listed; the count line toggles it. */
    const [open, setOpen] = react.useState(false)
    /** The pointer is on the block or the card right now. Tracked separately
     * from `anchor` because the two answer different questions: which card is
     * open, and whether a click or a focus change may take it away. */
    const [over, setOver] = react.useState(false)
    /** A pointer button is held down in the card: a selection in progress. */
    const [selecting, setSelecting] = react.useState(false)
    const current = anchor ? tools[anchor.index] ?? null : null
    const params = current ? parameterRows(current.parameters) : []
    const anchorAt = (index: number, event: JSX.AnchorEventLike): ChipAnchor => {
      const rect = event.currentTarget.getBoundingClientRect()
      return {
        index,
        node: event.currentTarget,
        left: rect.left,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
      }
    }

    // The release of a selection drag is watched on the document: dragging to
    // select routinely ends past the card's edge, where none of the handlers
    // below would see it, and a button left stuck down would freeze the card
    // open for good. `over` is a dependency so the closure reads its current
    // value rather than the one from the click that started the drag.
    react.useEffect(() => {
      if (!selecting || typeof document === 'undefined') return undefined
      const release = (): void => {
        setSelecting(false)
        // A drag that ended away from the block and the card: with a selection
        // still standing, the card is kept so Ctrl+C can take it; with nothing
        // selected it goes, as any other leave would.
        if (!over && !hasSelection()) setAnchor(null)
      }
      document.addEventListener('mouseup', release)
      return () => document.removeEventListener('mouseup', release)
    }, [selecting, over])

    return (
      <div
        className="smkit-mcp-tools"
        onMouseEnter={() => setOver(true)}
        onMouseLeave={(event) => {
          setOver(false)
          if (selecting) return
          // The gap between a chip and its card is not part of this block, so
          // crossing it fires this leave as well: the direction test decides,
          // or the safety net would close the card on its way to the pointer.
          if (anchor && headingToCard(anchor, anchor.node, event.clientX, event.clientY)) return
          setAnchor(null)
        }}
        onBlur={(event) => {
          // Focus out of the chips, but the pointer is still on the card (a
          // click in it, in the browsers that move focus): not a walk away.
          if (over) return
          const next = event.relatedTarget
          if (next && event.currentTarget.contains(next)) return
          setAnchor(null)
        }}
      >
        <button
          className="smkit-mcp-tools-toggle"
          type="button"
          aria-expanded={open}
          disabled={tools.length === 0}
          onClick={() => {
            setAnchor(null)
            setOpen(!open)
          }}
        >
          <span className="smkit-mcp-tools-caret" data-smkit-open={open ? 'true' : undefined}>
            <ChevronDownIcon size={12} />
          </span>
          {t('toolCount', { count: tools.length })}
        </button>
        {open && tools.length > 0 ? (
          <div className="smkit-mcp-tools-tool-chips">
            {tools.map((tool, index) => (
              <span
                className="smkit-mcp-tools-tool-chip"
                tabIndex={0}
                // A drag may pass over other chips: it is still one selection.
                onMouseEnter={(event) => {
                  if (selecting) return
                  setAnchor(anchorAt(index, event))
                }}
                // Per chip, not per row: the card covers the chips beside it, so
                // a row-level leave would not fire until the pointer had crossed
                // the whole list. The chip's own rect decides the one direction
                // that keeps the card — the pointer moving onto it.
                onMouseLeave={(event) => {
                  if (selecting) return
                  const rect = event.currentTarget.getBoundingClientRect()
                  if (headingToCard(rect, event.currentTarget, event.clientX, event.clientY)) return
                  setAnchor(null)
                }}
                onFocus={(event) => setAnchor(anchorAt(index, event))}
                key={tool.name}
              >
                {tool.name}
              </span>
            ))}
          </div>
        ) : null}
        {current && anchor ? (
          <div
            className="smkit-mcp-tools-tool-card"
            style={cardStyle(cardBox(anchor, anchor.node))}
            // Entering the card keeps the pointer "inside" even when it arrived
            // across the gap, where the block's leave just cleared that.
            onMouseEnter={() => setOver(true)}
            onMouseLeave={() => {
              setOver(false)
              if (selecting) return
              setAnchor(null)
            }}
            onMouseDown={() => setSelecting(true)}
          >
            <div className="smkit-mcp-tools-tool-card-head">
              <span className="smkit-mcp-tools-tool-card-name">{current.name}</span>
              <span className="smkit-mcp-tools-tool-card-kind">{t('toolKind')}</span>
            </div>
            <div className={current.description ? 'smkit-mcp-tools-tool-card-desc' : 'smkit-mcp-tools-tool-card-empty'}>
              {current.description || t('noDescription')}
            </div>
            {params.length === 0 ? (
              <div className="smkit-mcp-tools-tool-card-empty">{t('noParameters')}</div>
            ) : (
              <div className="smkit-mcp-tools-tool-card-params">
                {params.map((param) => (
                  <div className="smkit-mcp-tools-tool-param" key={param.name}>
                    <div className="smkit-mcp-tools-tool-param-head">
                      <span className="smkit-mcp-tools-tool-param-name">{param.name}</span>
                      <span className="smkit-mcp-tools-tool-param-type">{param.type}</span>
                      {param.required ? (
                        <span className="smkit-mcp-tools-tool-param-required">{t('required')}</span>
                      ) : null}
                    </div>
                    {param.description ? (
                      <div className="smkit-mcp-tools-tool-param-desc">{param.description}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    )
  }
}

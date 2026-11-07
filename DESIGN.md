# Slate Foundation Design System

## 1. Atmosphere & Identity

A quiet editorial workshop: warm paper in the center, muted utility surfaces around it, and one ink-blue accent reserved for intent. The signature is the **living margin**: block controls and diagnostics stay peripheral until selected, so rich multilingual content remains the visual center.

Primary persona: a keyboard-first knowledge worker authoring multilingual documents. Secondary persona: a product engineer inspecting event and capability contracts. Stress contexts include 200% zoom, keyboard-only use, reduced motion, narrow mobile widths, temporary motor impairment, and long unbroken payloads.

## 2. Color

| Role | Token | Value | Usage |
|---|---|---|---|
| Canvas | `--canvas` | `#ebe9e4` | App surround |
| Paper | `--paper` | `#fffefa` | Document surface |
| Surface | `--surface` | `#f5f3ee` | Sidebar and toolbar |
| Elevated | `--elevated` | `#ffffff` | Dialogs and inspector cards |
| Ink | `--ink` | `#24231f` | Primary text |
| Ink muted | `--ink-muted` | `#66625b` | Secondary text |
| Ink faint | `--ink-faint` | `#918b82` | Metadata and placeholders |
| Line | `--line` | `#dedbd3` | Whisper dividers |
| Line strong | `--line-strong` | `#c9c5bc` | Active boundaries |
| Accent | `--accent` | `#1f5e71` | Primary actions and focus |
| Accent soft | `--accent-soft` | `#dfecef` | Selected rows and badges |
| Selection | `--selection` | `#2f6fb0` | Structural block selection outline |
| Selection soft | `--selection-soft` | `#e4eef9` | Structural block selection fill |
| Synced | `--sync` | `#6e568f` | Shared-source indicator and icon |
| Synced soft | `--sync-soft` | `#f1edf6` | Shared-source resting surface |
| Success | `--success` | `#356a47` | Saved/accepted |
| Success soft | `--success-soft` | `#e6f0e8` | Status surface |
| Warning | `--warning` | `#8a5a16` | Deferred/conflict |
| Warning soft | `--warning-soft` | `#f7ecd6` | Status surface |
| Danger | `--danger` | `#9b3a32` | Destructive/error |
| Danger soft | `--danger-soft` | `#f7e5e2` | Status surface |
| Locked | `--locked` | `#62527a` | Locked content |
| Locked soft | `--locked-soft` | `#ece7f2` | Locked block surface |
| Scrim | `--scrim` | `rgba(36, 35, 31, 0.46)` | Dialog backdrop |

Color never carries status alone; pair it with text or a Radix icon. Raw colors are forbidden outside the token declaration.

## 3. Typography

Fonts are local-first to avoid render blocking and to support Korean fully.

- UI/body: `Pretendard Variable`, `Pretendard`, `Apple SD Gothic Neo`, `Noto Sans KR`, sans-serif.
- Editorial display: `Iowan Old Style`, `Noto Serif KR`, `Batang`, serif.
- Mono: `SFMono-Regular`, `Consolas`, `Liberation Mono`, monospace.

| Level | Token | Size / line | Weight | Usage |
|---|---|---|---|---|
| Display | `--type-display` | `40px / 1.15` | 650 | Document title |
| H1 | `--type-h1` | `30px / 1.25` | 650 | Major heading |
| H2 | `--type-h2` | `24px / 1.32` | 620 | Section heading |
| H3 | `--type-h3` | `19px / 1.4` | 620 | Card heading |
| Body | `--type-body` | `16px / 1.72` | 400 | Editor prose |
| UI | `--type-ui` | `14px / 1.45` | 520 | Controls |
| Small | `--type-small` | `13px / 1.45` | 450 | Metadata |
| Caption | `--type-caption` | `12px / 1.4` | 560 | Status and diagnostics |
| Mono | `--type-mono` | `12px / 1.55` | 450 | IDs and event payloads |

## 4. Spacing & Layout

4px base: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 20px, `--space-6` 24px, `--space-8` 32px, `--space-10` 40px, `--space-12` 48px, `--space-16` 64px.

Editor interaction dimensions: `--control-size` 32px, `--selection-control-size` 36px, `--touch-target-size` 44px, `--icon-size` 16px, `--drop-rule-size` 2px, `--drop-dot-size` 8px, `--menu-width` 208px, `--menu-row-size` 36px, `--menu-max-height` 416px, `--link-input-width` 208px, and `--link-error-width` 192px. These values are declared once and reused by every ProseMirror surface.

- Desktop shell: `244px minmax(0, 1fr)` plus optional `320px` inspector.
- Header is fixed in shell flow; workspace body owns vertical scroll via `min-block-size: 0`.
- Desktop shell has an explicit `100dvh` height so editor and inspector can scroll independently. Toolbar controls do not shrink below their target size and wrap when necessary. Mobile navigation retains the primitive showcase entry; only connection metadata is hidden.
- Document measure: `720px`; prose measure: `68ch`.
- Runtime tokens `--document-measure` and `--prose-measure` carry those measures; `--type-body`, `--type-h1`, `--type-h2`, `--type-h3`, and `--type-mono` carry the documented type recipes.
- Wide comparison dialog measure: `960px`; its before/after panes collapse to one column below tablet width.
- Below 1100px the inspector moves below the document instead of disappearing, preserving access to host forms and external-update controls. Below 768px navigation is a compact three-column strip, the header stacks title above controls, and the toolbar wraps. At 375px the document is one column with 16px gutters and no horizontal primary-content scroll. Korean labels use word-preserving wrapping.
- z-index: base 0, sticky 10, popover 30, scrim 40, dialog 50, toast 60.

## 5. Components

### Action Button
- Structure: semantic `button` with Radix icon and optional label.
- Variants: primary, secondary, ghost, danger, icon-only.
- States: default, hover tonal shift, active `scale(.98)`, visible focus, disabled with reason, saving label.
- Accessibility: 40px desktop and 44px touch target; icon-only requires accessible name.

### Navigation Row / Tab
- Structure: icon + label + optional status; active state uses accent-soft and a 2px inline indicator.
- States: hover, active/current, focus, disabled with visible unavailable reason.
- Layout: cluster; long labels wrap or ellipsize with title.

### Toolbar
- Groups format, block, history, and document actions with separators; native button semantics and `aria-pressed` for toggles.
- Scroll owner: none; wraps at tablet and becomes horizontally scrollable only for secondary actions on mobile.

### Editor Block
- Structure: stable block wrapper + peripheral handle + ProseMirror-rendered native content.
- Variants are supplied by the active block profile. Structured documents use sections with optional titles, callouts and quotes containing child blocks; Markdown heading levels belong only to the Markdown format adapter.
- States: selected, locked, readonly, review candidate, opaque. Locked/opaque states show a textual badge.
- Accessibility: content remains in logical DOM order; controls are keyboard reachable; drag is never the only move mechanism.

### Living Margin Controls
- A reusable `attachBlockInteractions(view, options)` boundary owns ephemeral controls while the `EditorView` remains the only document state owner. It supports local, Yjs, and composite schemas by capability detection rather than simulated block types.
- Hover or editor focus reveals a compact plus and grip rail beside the current logical block, including nested children. Parent-to-child targeting is not suppressed by the parent's rectangle. Coarse pointers keep the rail discoverable at the focused block with 44px targets. Readonly surfaces omit mutation controls entirely; locked blocks expose identity and status but no destructive actions.
- The grip is the only drag origin. Its menu opens by click, `Shift+F10`, or the Context Menu key and includes duplicate, delete, move, and supported type changes. Every action resolves the stable block ID against the current document when invoked; menu position is never treated as document identity.
- Drag shows one accent insertion rule between blocks, supports document-start and document-end gaps, and autoscrolls the nearest editor scroll owner. Cancel, Escape, pointer cancellation, and leaving the same editor clear all transient drag state. Keyboard move actions remain first-class.
- Grip click selects the block and opens its context menu. Shift adds/removes a range from the last focus, Ctrl/Cmd toggles, Escape clears, and Delete/Backspace owns the canonical structural batch. Ancestor and descendant are never simultaneous explicit selection roots.
  Dragging empty editor chrome draws a rectangular marquee; starting inside editable text activates native text mode. Pointer-down outside the context clears selection, except declared rail/menu/format controls; entering another editor deactivates the previous context.
- Selected blocks use one `selection-soft` subtree wash plus a blue `selection` outline. Children do not repaint white islands or acquire a second explicit selection fill. Synced blocks retain a thin purple `sync` strip and a labeled sync icon when selected, while keyboard focus uses the warning token as a third independent state.
  Selection state, anchor, focus, and marquee geometry are view-only and never enter document JSON or collaborative state. The interaction contract, not DOM classes, defines selection state.

### Editor Popover / Command Menu
- Structure: owner-document portal, anchored to a block control or text caret, with viewport-clamped position, whisper border, paper/elevated surface, and the documented popover shadow.
- Slash commands appear only for a leading `/query` in an eligible native text block. Arrow keys move the active option, Enter applies it, and Escape closes without changing content. Choosing a command removes only the query before transforming the current block or inserting a sibling.
- Context and slash rows use roving focus, visible active fill, concise labels, optional keyboard hints, and semantic `menu` / `menuitem` roles. Open/close uses opacity and a short scale transform; reduced motion uses opacity only.

### Selection Format Bar
- A compact floating toolbar appears above a non-empty text selection and preserves that selection on pointer down. It offers only marks present in the active schema: bold, italic, inline code, and link.
- Link editing is an anchored labeled form with explicit apply/cancel actions and focus return. Only safe `http:`, `https:`, `mailto:`, hash, and site-relative URLs are accepted; invalid input remains visible with an inline error.
- The bar is absent for collapsed selections, readonly editors, code blocks, node selections, and inactive composite input contexts.

### Panel / Inspector
- Structure: labeled tablist, tabpanel, compact cards, key/value rows.
- States: empty, populated, warning, error. Desktop rail becomes an in-flow panel below content on narrow layouts.

### Dialog / Form
- Structure: title, description, labeled controls, inline validation, footer actions.
- States: valid, invalid, saving, saved. Escape closes unless a dirty draft needs explicit save/cancel choice.
- Review dialogs use an immutable before pane beside an editable candidate pane; host drafts remain outside document content and disclose their captured revision.

### Ownership Examples Workspace
- A five-tab operational workspace compares notebook, project board, status projection, Markdown file tree, and mixed backlog ownership without presenting implementation progress.
- Each scenario uses the existing panel, status badge, action button, viewer, editor, and dialog primitives. Ownership labels state the authoritative layer in text and never rely on color.
- The tab strip wraps below tablet width. Scenario bodies use an overflow-safe sidebar or intrinsic grid and collapse to one column at 375px with the scenario body as the only vertical scroll owner.
- Read-only domain roots have no native mutation controls. Editable presentation or proposal layers open through an explicit lower-layer panel and preserve stale drafts with a visible dependency warning.

### Status Badge / Toast
- Badge is text plus icon where needed. Toast uses `aria-live="polite"`, never steals focus, and offers recovery when actionable.
- On mobile the status region occupies its own row above the document instead of covering text. Prose preserves words when wrapping; long unbroken payloads still wrap inside their containers.

### Agent Tool Workbench
- A three-tab operational surface separates managed Markdown, typed database, and mixed-backlog workflows while keeping one consistent resource/request/review/timeline grammar.
- The shared model selector is a labeled native select with loading, error, disabled, and selected states. It appears only on user-initiated agent surfaces; autonomous lower-layer flows use the server default.
- The native option shows the model ID. Selected provider status and the complete model ID also appear in wrapping metadata linked with `aria-describedby`, so narrow panels never hide the selected identity.
- Exact before/after values and fingerprints use the mono recipe inside bounded, wrapping source panels. Lifecycle controls remain visible and cancellation is distinct from observer detachment.
- Desktop uses a compact controls rail beside the wider immutable review artifact. Below 768px tabs and panels become one column; at 375px every long identifier wraps without horizontal page overflow.

### Git Document Library
- A three-region list/document/review shell uses the existing 244px navigation measure and 320px inspector measure. The document is the primary scroll owner; library and review rails scroll independently only on wide screens.
- The library combines a recursive file tree, full-text search, and backlinks. Active files use `accent-soft`; paths and excerpts always wrap or ellipsize without forcing shell overflow.
- Draft recovery is a warning-soft in-flow notice. Saving writes the managed working tree only; selective commit remains a separate primary action in the review rail.
- Review tabs expose structured changes, before/working content, per-document history restore, managed branches, and fixed remote actions. Divergence and conflicts always require explicit controls and textual status.
- Below 1100px the review rail moves below the editor. Below 768px all regions become one flow, the file tree receives a bounded internal list, and before/working diff panes stack.

### Structured Workspace
- A fixed-sidenav list/detail shell presents a nested page tree beside one paper document. The document is the only primary scroll owner; database tables may scroll inline on narrow screens.
- At desktop widths, the page rail reserves eight `--space-10` units for the added grip and move controls. Page labels stay on one line with ellipsis and a full-title tooltip; short titles in languages without spaces must not collapse into one-character stacks. Below 768px the existing full-width collapsible rail remains unchanged.
- Page, database, and synced-source status use the shared badge and action-button primitives. Synced occurrences use a subtle `sync-soft` surface, thin purple `sync` strip, icon, and the text `Synced`; blue remains reserved for structural selection and color never acts alone.
- Section titles derive HTML h1-h6 from semantic section nesting and embedding depth. Structured JSON does not store fixed Markdown heading levels; rendering never changes content.
- A canonical shared source owns one runtime and history. Occurrences supply placement, depth, focus and bookmarks; inactive occurrences are readonly projections and cannot route commands. Saving and remote conflicts are independent of which occurrence currently has focus.
- Below 768px the page tree becomes a collapsible top rail and the document keeps 16px gutters. Search and the Ctrl-K command palette remain keyboard reachable at every width.
- Persisted page-reference blocks produce a compact backlinks region after the document. Each backlink names its source page and returns focus to the exact reference block through the URL hash.
- A compact labeled paste-policy selector above the document makes independent duplication versus persisted shared-source references explicit; reference mode never invents a source for ordinary local blocks.
- The document toolbar pairs a labeled page picker with an explicit insertion action. Local sections reveal title and shared-source controls on hover or focus; coarse pointers keep them visible with 44px targets.
- Typed databases switch between a scroll-safe table and status-column kanban. Kanban cards retain text labels and native selects, and every status move writes through the same database CAS entity as table edits.

## 6. Motion & Interaction

- Micro: `--motion-fast` 120ms ease-out for press/focus feedback.
- Standard: `--motion-standard` 200ms ease-in-out for tabs, menus, and sheets.
- Emphasis: `--motion-emphasis` 320ms cubic-bezier(.16,1,.3,1) for dialog entry.
- Only transform, opacity, and filter animate. Reduced-motion removes transforms and shortens opacity transitions to near-instant.
- Keyboard: Mod-B/I, Mod-Z/Shift-Mod-Z, Enter creates a sibling block, Backspace at an empty block joins/deletes when permitted, Alt-Arrow moves blocks, Mod-Shift-D duplicates.
- Block controls use `--motion-fast` for hover/focus opacity and a subtle `scale(.98)` press response. Menus use `--motion-standard` opacity plus `translateY(-4px)` entry, adapted from the beui.dev context-menu pattern without adding a motion dependency; movement remains interruptible and all exit paths clean synchronously.
- Pointer drag has no decorative animation: the insertion rule is immediate feedback and the moved block lands through one ProseMirror transaction so native history, Yjs history, stable IDs, and lock filters remain authoritative.

## 7. Depth & Surface

Mixed restrained strategy: tonal separation and whisper borders at rest; one multi-layer shadow only for dialogs/popovers.

- Paper: `0 1px 2px rgba(36,35,31,.04), 0 12px 36px rgba(36,35,31,.06)`.
- CSS token `--shadow-paper` carries the Paper recipe for rendered Markdown and document surfaces.
- Popover: `0 2px 6px rgba(36,35,31,.06), 0 18px 48px rgba(36,35,31,.12)`.
- CSS token `--shadow-popover` carries the Popover recipe; `--type-small-size`, `--type-caption-size`, and `--type-caption` carry compact menu and toolbar typography without one-off values.
- Cards use no independent shadow; active cards use line-strong or a semantic soft surface.
- Radius tokens: 4px controls, 8px panels/cards, 12px dialogs, full radius only for status badges.

## 8. Accessibility Constraints & Accepted Debt

Target WCAG 2.2 AA: 4.5:1 normal text, 3:1 large text and controls, visible 2px focus, full keyboard navigation, semantic landmarks, zoom to 200%, no color-only state, reduced motion, appropriate multilingual line breaking, and minimum 44px touch targets on coarse pointers.

Block interactions additionally require: grip-only drag initiation, `Shift+F10` context access, non-drag reorder commands, selection-preserving format controls, viewport-clamped portals in the editor's `ownerDocument`, and synchronous cleanup on Escape/pointer cancellation. Slash handling must not run during IME composition or in code, caption, locked, readonly, or unsupported schema contexts.

| Item | Location | Why accepted | Owner / Exit |
|---|---|---|---|
| Screen-reader announcement depth for every ProseMirror structural command is basic | Editor | Foundation scope provides semantic content and status announcements, not a bespoke SR narration layer | Future accessibility profile |
| Dark theme | Entire app | The supplied brief prioritizes a restrained editorial workspace; light theme is complete | Add only with independently contrast-tested tokens |

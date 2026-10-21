# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Prerequisites

- Node.js 18+
- Obsidian 0.15.0+ (desktop only)

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start esbuild watch mode (development)
npm run build        # Production build (svelte-check + tsc + esbuild)
npm run test         # Run unit tests (vitest)
npm run test:extended # Run extended test suite (GRIDNOTE_TEST_SCOPE=extended)
npm run check        # Svelte type check only
npm run version      # Sync version from package.json to manifest.json & versions.json
```

Run a single test file: `npx vitest run tests/unit/utils/hash.test.ts`

Tests mock the `obsidian` module via `tests/mocks/obsidian/index.ts` (aliased in `vitest.config.mjs`). Test setup runs `tests/setup.ts`. The Obsidian API is not available at test time.

## Architecture

This is **Grid Note**, an Obsidian desktop plugin that transforms Markdown documents into focused tree-structured card views.

### Tech Stack
- **UI**: Svelte 4 (components in `src/components/`)
- **Build**: esbuild with esbuild-svelte plugin, outputting a single `main.js` (CJS format)
- **Obsidian API**: v1.8.7 (externalized, not bundled)
- **Tests**: Vitest
- **CSS**: Injected per-component via Svelte (`css: "injected"`)
- **Spatial navigation**: spatial-navigation-js for keyboard-driven card navigation
- **TypeScript**: strict mode with `verbatimModuleSyntax` — always use `import type` for type-only imports. Also enforces `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess` — unused variables and untyped index access are compile errors.

### Core Data Flow

```
Markdown file content
  → MarkdownDocumentProcessor (src/processor/)
  → DocumentStructure + TreeNode[]
  → GridNoteContent.svelte (root Svelte component)
  → Cascade renderer
```

1. **`src/main.ts`** — Plugin entry point (`GridNotePlugin extends Plugin`). Registers commands, settings tab, and the image preview post-processor.
2. **`src/views/GridNoteMarkdownModeManager.ts`** — Central orchestrator (1544 lines, highest fan-out). Manages the toggle between Obsidian's native Markdown view and the Grid Note rendered view. Holds the active `GridNoteContent` Svelte instance and coordinates editing, search, history, and range editing operations.
3. **`src/processor/`** — `MarkdownDocumentProcessor` parses raw markdown into `DocumentStructure` (defined in `src/types/document.ts`). Uses a stack-based algorithm to build parent-child relationships from heading levels. `MarkdownParser` handles the low-level line-by-line parsing.
4. **`src/themes/`** — Tree model. `treeModel.ts` transforms `DocumentStructure` into a flat `TreeNode[]` array with a DP-based sibling matching algorithm (`matchSiblingNodes`) that scores identity, content similarity, and position for efficient UI reuse during re-parsing.
5. **`src/components/GridNoteContent.svelte`** — Root Svelte component mounted into the Markdown view's content area. Manages progressive card rendering, card selection/keyboard navigation, editing context (queue-based serialization: only one card editor active at a time), fold state persistence, and delegates to the Cascade renderer.
6. **`src/components/themes/`** — Theme implementations:
   - `cascade/` — Cascade renderer (CascadeTheme, CascadeNode, CascadeVirtualBranch)
   - `shared/` — Shared editing components (EditableMarkdownCard, FloatingCardEditor, cardEditingContext)
7. **`src/utils/`** — Supporting modules:
   - `EmbeddableMarkdownEditor` — Wraps Obsidian's internal CodeMirror-based editor or falls back to `<textarea>`. Extends `Component` for lifecycle management.
   - `GridNoteRangeEditorModal` — Modal for editing a full node's markdown range.
   - `GridNoteTextSearch` / `GridNoteTextSearchModal` — Full-text search within the rendered view.
   - `markdownEdit` / `markdownContent` — Document manipulation helpers (insert headings, replace ranges, split frontmatter).
   - `codemirrorHistory` — Undo/redo integration with Obsidian's editor.
   - `foldStorage` — Persists card collapse/expand state.
   - `i18n` — Localized command text (Chinese/English).

### Key Patterns
- **Lifecycle**: Svelte components are mounted/unmounted by `GridNoteMarkdownModeManager`. Editor wrappers extend Obsidian's `Component` and use `registerDomEvent()` / `register()` for cleanup.
- **Event registration**: All DOM event listeners and timers must be registered through Obsidian's Component lifecycle (`registerDomEvent`, `register`) to ensure proper cleanup on plugin disable.
- **Settings**: Single `GridNoteSettings` object persisted via `plugin.loadData()`/`saveData()`. Defined in `src/settings.ts`.
- **Feature availability**: Inline Cascade card editing and screenshot export are available to all users. There is no theme-selection flow.
- **Plugin ID in Obsidian**: `grid-note` (see `manifest.json`).
- **Editing serialization**: `cardEditingContext.ts` implements a queue-based pattern — `beginEdit()` queues transitions and processes them sequentially, ensuring only one card editor is active at a time.
- **Obsidian internal access**: `src/utils/obsidianInternal.ts` provides access to Obsidian's internal APIs (app ID, internal editor). These are not part of the public API and may break across versions.

### Release Flow
Release is triggered by pushing a tag **without** `v` prefix (e.g. `git tag "2.0.4"`). GitHub Actions builds, validates version consistency across `package.json`/`manifest.json`/`versions.json`, syncs artifacts to `Dcx199302/Obsidian-GridNote-Plugin`, and creates a GitHub Release. See `README.md` for full details.

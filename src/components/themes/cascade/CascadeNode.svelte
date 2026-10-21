<script lang="ts">
    import type { App } from 'obsidian';
    import { getContext } from 'svelte';
    import { readable } from 'svelte/store';
    import CollapseToggleButton from '../../controls/CollapseToggleButton.svelte';
    import HeadingCopyMenuButton from '../../controls/HeadingCopyMenuButton.svelte';
    import EditableTreeTitle from '../../controls/EditableTreeTitle.svelte';
    import HeadingDeleteButton from '../../controls/HeadingDeleteButton.svelte';
    import HeadingLevelIcon from '../../controls/HeadingLevelIcon.svelte';
    import HeadingRangeEditButton from '../../controls/HeadingRangeEditButton.svelte';
    import MarkdownContent from '../../content/MarkdownContent.svelte';
    import PrefaceCompositeContent from '../../content/PrefaceCompositeContent.svelte';
    import EditableMarkdownCard from '../shared/EditableMarkdownCard.svelte';
    import {
        gridNoteCardEditingContextKey,
        type GridNoteCardEditingContext
    } from '../shared/cardEditingContext';
    import type { TreeNode } from '../../../types';
    import {
        DEFAULT_VISIBLE_TREE_LAYERS,
        type VisibleTreeLayersSetting
    } from '../../../themes/treeModel';
    import type { GridNoteCopyAction } from '../../../utils/gridNoteCopy';
    import { isGridNotePrefaceNode } from '../../../utils/treeNodeKind';

    export let node: TreeNode;
    export let depth: number = 0;
    export let visibleTreeLayers: VisibleTreeLayersSetting = DEFAULT_VISIBLE_TREE_LAYERS;
    export let onSaveTitleEdit: ((node: TreeNode, title: string) => Promise<void>) | null = null;
    export let onOpenNodeRangeEdit: ((node: TreeNode) => Promise<void> | void) | null = null;
    export let onDeleteNode: ((node: TreeNode) => Promise<boolean> | boolean) | null = null;
    export let onCopyNodeAction: ((
        node: TreeNode,
        action: GridNoteCopyAction,
        anchorEl: HTMLElement
    ) => Promise<void> | void) | null = null;
    export let app: App | null = null;
    export let sourcePath: string = '';

    const editingContext = getContext<GridNoteCardEditingContext | undefined>(
        gridNoteCardEditingContextKey
    );
    const activeEditorId = editingContext?.activeEditorId
        ?? readable<string | null>(null);
    const activeEditorReady = editingContext?.activeEditorReady
        ?? readable(false);
    const activeEditingPathKeys = editingContext?.activeEditingPathKeys
        ?? readable<Set<string>>(new Set());
    const collapsedNodeIds = editingContext?.collapsedNodeIds
        ?? readable<Set<string>>(new Set());
    const selectedCardId = editingContext?.selectedCardId
        ?? readable<string | null>(null);

    let localExpanded = true;

    $: isRootNode = depth === 0;
    $: isRootContainer = isRootNode && (node.headingLevel === null || node.headingLevel === 1);
    $: isDocumentHeadingRoot = isRootNode && node.headingLevel === 1;
    $: isPrefaceNode = isGridNotePrefaceNode(node);
    $: hasVisibleChildren = node.children.length > 0;
    $: hasChildren = hasVisibleChildren || node.hasHiddenChildren;
    $: hasContent = node.content.trim().length > 0;
    $: isCollapsible = hasContent || hasChildren;
    $: showCollapseToggle = node.headingLevel !== null;
    $: isExpanded = editingContext ? !$collapsedNodeIds.has(node.viewId) : localExpanded;
    $: isCollapsed = isCollapsible && !isExpanded;
    $: canRenderChildren = hasVisibleChildren;
    $: hasActiveEditor = $activeEditorId !== null;
    $: isEditingSelf = $activeEditorId === node.viewId;
    $: isEditingDisplayReady = isEditingSelf && $activeEditorReady;
    $: isInEditingPath = $activeEditingPathKeys.has(node.viewId);
    $: isSelected = $selectedCardId === node.viewId;
    $: hasBlockingMask = hasActiveEditor && !isEditingSelf;
    // 列宽直接读取 treeModel 的预计算结果，避免节点组件重复递归。
    $: childColumnWidth = Math.max(1, node.visibleSubtreeDepth - 1);
    // 顶层非 H1 节点仍按分支布局，但不继承文档根标题的交互语义。
    $: shouldSplitBody = (
        (!isRootNode || node.headingLevel !== 1)
        && canRenderChildren
        && isExpanded
    );
    $: bodyRowStyle = shouldSplitBody
        ? `grid-template-columns: minmax(0, ${hasContent ? 1 : 0.4}fr) minmax(0, ${childColumnWidth}fr);`
        : '';

    function toggleExpand() {
        if (!isCollapsible) {
            return;
        }

        if (!editingContext) {
            localExpanded = !isExpanded;
            return;
        }

        editingContext.setNodeExpanded(node.viewId, !isExpanded);
    }

    function suppressMaskedInteraction(event: Event) {
        event.preventDefault();
        event.stopPropagation();
    }
</script>

<section
    class="cascade-node"
    class:is-root={isRootContainer}
    class:is-top-level={isRootNode}
    class:is-collapsed={isCollapsed}
    class:is-selected={isSelected}
    class:has-split={shouldSplitBody}
    class:has-editing-descendant={isInEditingPath}
    data-heading-level={node.headingLevel ?? 0}
    data-layout-depth={depth}
    id="cascade-node-{node.viewId}"
>
    {#if !isPrefaceNode}
        <div
            class="cascade-node-heading-row"
            class:is-editing-covered={isEditingDisplayReady}
        >
            <div class="cascade-node-heading-left">
                {#if showCollapseToggle}
                    <CollapseToggleButton
                        expanded={isExpanded}
                        disabled={!isCollapsible}
                        ariaLabelExpanded="折叠"
                        ariaLabelCollapsed="展开"
                        on:toggle={toggleExpand}
                    />
                {/if}
            </div>

            <div class="cascade-node-heading-center">
                <HeadingLevelIcon headingLevel={node.headingLevel} />
                <EditableTreeTitle
                    value={node.header}
                    {app}
                    {sourcePath}
                    parseAsHeading={node.headingLevel !== null}
                    editable={node.headingLevel !== null}
                    className="cascade-node-title"
                    onSave={onSaveTitleEdit && node.headingLevel !== null
                        ? (nextTitle) => onSaveTitleEdit(node, nextTitle)
                        : null}
                />
                {#if node.headingLevel !== null}
                    <span
                        class="cascade-heading-dash"
                        class:is-hidden={isEditingDisplayReady}
                        aria-hidden="true"
                    ></span>
                {/if}
            </div>

            <div class="cascade-node-heading-right">
                {#if node.headingLevel !== null}
                    <HeadingRangeEditButton
                        onEdit={onOpenNodeRangeEdit ? () => onOpenNodeRangeEdit(node) : null}
                    />
                    <HeadingDeleteButton onDelete={onDeleteNode ? () => onDeleteNode(node) : null} />
                    <HeadingCopyMenuButton
                        onSelect={onCopyNodeAction
                            ? (action, anchorEl) => onCopyNodeAction(node, action, anchorEl)
                            : null}
                    />
                {/if}
            </div>

            {#if hasBlockingMask}
                <!-- svelte-ignore a11y-no-static-element-interactions, a11y-click-events-have-key-events -->
                <div
                    class="cascade-node-heading-mask"
                    aria-hidden="true"
                    on:pointerdown={suppressMaskedInteraction}
                    on:click={suppressMaskedInteraction}
                    on:dblclick={suppressMaskedInteraction}
                ></div>
            {/if}
        </div>
    {/if}

    <div
        class="cascade-node-body-row"
        class:has-split={shouldSplitBody}
        style={bodyRowStyle}
    >
        <EditableMarkdownCard
            node={node}
            {app}
            selectable={!isPrefaceNode}
            editable={!isPrefaceNode}
            onActivatePreview={onOpenNodeRangeEdit && isPrefaceNode
                ? (currentNode) => onOpenNodeRangeEdit(currentNode)
                : null}
            isDocumentHeadingRoot={isDocumentHeadingRoot}
            className={`cascade-node-card${isCollapsed ? ' is-collapsed' : ''}${isPrefaceNode ? ' is-preface-card' : ''}`}
        >
            {#if isPrefaceNode}
                <PrefaceCompositeContent
                    content={node.content}
                    {app}
                    {sourcePath}
                    className="cascade-node-body"
                />
            {:else if hasContent}
                <MarkdownContent
                    content={node.content}
                    startLine={node.editStartLine}
                    {app}
                    {sourcePath}
                    className="cascade-node-body"
                />
            {:else}
                <div class="cascade-node-body cascade-node-body-empty" aria-hidden="true"></div>
            {/if}
        </EditableMarkdownCard>

        {#if canRenderChildren}
            <div
                class="cascade-node-children-container"
                class:has-editing-descendant={isInEditingPath}
                hidden={!isExpanded}
                aria-hidden={!isExpanded}
            >
                <div
                    class="cascade-node-children-stack"
                    class:has-editing-descendant={isInEditingPath}
                    class:is-primary-children-stack={
                        node.headingLevel === 1
                    }
                >
                        {#each node.children as child (child.viewId)}
                        <svelte:self
                            node={child}
                            depth={depth + 1}
                            {visibleTreeLayers}
                            {onSaveTitleEdit}
                            {onOpenNodeRangeEdit}
                            {onDeleteNode}
                            {onCopyNodeAction}
                            {app}
                            {sourcePath}
                        />
                    {/each}
                </div>
            </div>
        {/if}
    </div>
</section>

<style>
    .cascade-node {
        --gridnote-heading-icon-size: 22px;
        --gridnote-heading-action-slot-width: max(
            104px,
            calc(var(--gridnote-heading-icon-size) * 3 + 28px)
        );
        position: relative;
        display: flex;
        flex-direction: column;
        width: 100%;
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
        overflow: visible;
    }

    .cascade-node.has-editing-descendant {
        z-index: 80;
    }

    .cascade-node.is-top-level,
    .cascade-node.is-root {
        padding-inline: 16px;
    }

    .cascade-node.is-root:not(.has-split) > .cascade-node-heading-row {
        width: min(72%, 960px);
        min-width: min(100%, 360px);
        margin-inline: auto;
    }

    .cascade-node.is-root:not(.has-split) > .cascade-node-body-row > :global(.cascade-node-card) {
        width: min(72%, 960px);
        min-width: min(100%, 360px);
        margin-inline: auto;
    }

    .cascade-node.is-root:not(.has-split) > .cascade-node-body-row > :global(.cascade-node-card) {
        --gridnote-card-preview-padding: 1rem 1.25rem;
    }

    .cascade-node-body-row {
        display: grid;
        align-items: stretch;
        grid-template-columns: minmax(0, 1fr);
        width: 100%;
        min-width: 0;
        overflow: visible;
    }

    .cascade-node-body-row.has-split {
        column-gap: 18px;
    }

    .cascade-node-heading-row {
        position: relative;
        display: flex;
        align-items: center;
        column-gap: 8px;
        padding-block: 2px;
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
        overflow: visible;
    }

    .cascade-node:not(.is-root):not(.is-top-level):not([data-layout-depth="1"]) > .cascade-node-heading-row::before {
        content: '';
        flex: 0 0 auto;
        width: 18px;
        height: 1px;
        background: var(--gridnote-divider-color, var(--background-modifier-border));
        margin-left: -18px;
        margin-right: -8px;
    }

    .cascade-node[data-layout-depth="1"] > .cascade-node-heading-row {
        padding-left: 0;
    }

    .cascade-node-heading-left,
    .cascade-node-heading-right {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: center;
        gap: 4px;
        min-width: var(--gridnote-heading-icon-size);
        color: var(--icon-color, var(--text-muted));
    }

    .cascade-node-heading-left {
        justify-content: flex-start;
    }

    .cascade-node-heading-center {
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        gap: 6px;
        min-width: 0;
        color: var(--gridnote-heading-color, var(--text-normal));
        position: relative;
    }

    .cascade-heading-dash {
        flex: 1 1 0%;
        align-self: center;
        height: 0;
        margin-left: 0;
        margin-right: 0;
        border-top: 1px dashed var(--background-modifier-border);
        opacity: 0;
        transition: opacity 0.15s ease, border-color 0.15s ease;
        pointer-events: none;
    }

    .cascade-node-heading-row:hover .cascade-heading-dash {
        opacity: 1;
        border-color: var(--interactive-accent);
    }

    .cascade-heading-dash.is-hidden {
        opacity: 0 !important;
    }

    .cascade-node-heading-row:hover :global(.cascade-node-title:not(.is-editing)) {
        color: var(--interactive-accent);
    }

    .cascade-node-heading-row:hover .cascade-node-heading-right {
        color: var(--interactive-accent);
    }

    .cascade-node-heading-row.is-editing-covered {
        pointer-events: none;
    }

    .cascade-node-heading-row.is-editing-covered > * {
        user-select: none;
    }

    .cascade-node-heading-mask {
        position: absolute;
        inset: 0;
        z-index: 2;
        background: transparent;
        pointer-events: auto;
    }

    .cascade-node-body-row > :global(.cascade-node-card) {
        --gridnote-card-preview-padding: 0.625rem 0.75rem;
        --gridnote-card-selection-radius: 8px;
        display: flex;
        flex-direction: column;
        overflow: visible;
        min-width: 0;
        box-sizing: border-box;
        /* border: 1px solid color-mix(
            in srgb,
            var(--background-modifier-border) 70%,
            var(--text-faint) 30%
        ) !important; */
        border-radius: 8px;
    }

    .cascade-node-body-row > :global(.cascade-node-card.is-editing) {
        overflow: visible;
        z-index: 20;
    }

    .cascade-node-body-row > :global(.cascade-node-card.is-collapsed) {
        display: none;
    }

    .cascade-node.is-selected > .cascade-node-body-row > :global(.cascade-node-card:not(.is-editing)) {
        --gridnote-cascade-border-color: color-mix(
            in srgb,
            var(--interactive-accent) 48%,
            var(--background-modifier-border) 52%
        );
        border-color: var(--gridnote-cascade-border-color) !important;
    }

    :global(.cascade-node-title) {
        flex: 0 1 auto;
        width: auto;
        min-width: 0;
        min-height: var(--gridnote-heading-icon-size);
        font-family: inherit;
        font-size: 18px;
        font-weight: 700;
        line-height: 1;
        color: var(--gridnote-heading-color, var(--text-normal));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding-inline: 10px 0;
    }

    :global(.cascade-node-title .editable-tree-title-content) {
        height: auto;
        min-height: 0;
    }

    :global(.cascade-node-title.is-editing) {
        color: var(--interactive-accent);
        opacity: 1;
    }

    .cascade-node-heading-row :global(.tree-toggle-button) {
        flex-shrink: 0;
    }

    .cascade-node-heading-right {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: flex-end;
        gap: 4px;
        padding: 0;
        opacity: 0;
        pointer-events: none;
    }

    .cascade-node-heading-row:hover .cascade-node-heading-right {
        opacity: 1;
        pointer-events: auto;
    }

    .cascade-node.is-selected .cascade-node-heading-left {
        color: color-mix(in srgb, var(--text-normal) 68%, var(--interactive-accent) 32%);
        opacity: 0.94;
    }

    .cascade-node.is-selected .cascade-node-heading-right {
        color: color-mix(in srgb, var(--text-normal) 68%, var(--interactive-accent) 32%);
    }

    .cascade-node.is-collapsed :global(.cascade-node-title) {
        color: color-mix(
            in srgb,
            var(--gridnote-heading-color, var(--text-normal)) 52%,
            var(--text-muted) 48%
        );
        opacity: 0.68;
    }

    .cascade-node.is-collapsed .cascade-node-heading-center :global(.heading-level-icon) {
        color: var(--text-muted);
        opacity: 0.68;
    }

    .cascade-node.is-collapsed .cascade-node-heading-left,
    .cascade-node.is-collapsed .cascade-node-heading-right {
        color: var(--text-muted);
        opacity: 0.72;
    }

    .cascade-node.is-collapsed .cascade-node-heading-row :global(.tree-toggle-button) {
        opacity: 0.72;
    }

    .cascade-node[data-heading-level="1"] {
        --gridnote-heading-icon-size: 30px;
        --gridnote-heading-color: var(
            --gridnote-heading-color-h1,
            var(--gridnote-heading-color-default, var(--text-normal))
        );
        padding-bottom: 16px;
    }

    .cascade-node[data-heading-level="2"] {
        --gridnote-heading-icon-size: 28px;
        --gridnote-heading-color: var(
            --gridnote-heading-color-h2,
            var(--gridnote-heading-color-default, var(--text-normal))
        );
    }

    .cascade-node[data-heading-level="3"] {
        --gridnote-heading-color: var(
            --gridnote-heading-color-h3,
            var(--gridnote-heading-color-default, var(--text-normal))
        );
    }

    .cascade-node[data-heading-level="4"] {
        --gridnote-heading-color: var(
            --gridnote-heading-color-h4,
            var(--gridnote-heading-color-default, var(--text-normal))
        );
    }

    .cascade-node[data-heading-level="5"] {
        --gridnote-heading-color: var(
            --gridnote-heading-color-h5,
            var(--gridnote-heading-color-default, var(--text-normal))
        );
    }

    .cascade-node[data-heading-level="6"] {
        --gridnote-heading-color: var(
            --gridnote-heading-color-h6,
            var(--gridnote-heading-color-default, var(--text-normal))
        );
    }

    :global(.cascade-node-body) {
        color: var(--text-normal);
        font-family: inherit;
        font-size: var(--font-text-size);
        line-height: 1.5;
        overflow-wrap: anywhere;
        word-break: break-word;
    }

    .cascade-node-body-empty {
        min-height: 1.5rem;
    }

    .cascade-node-children-container {
        display: flex;
        flex-direction: column;
        width: 100%;
        min-width: 0;
        overflow: visible;
    }

    .cascade-node-body-row.has-split > .cascade-node-children-container {
        grid-column: 2;
        align-self: stretch;
        contain: layout style;
    }

    .cascade-node-body-row:not(.has-split) > .cascade-node-children-container {
        margin-top: 18px;
    }

    .cascade-node-children-container.has-editing-descendant,
    .cascade-node-children-stack.has-editing-descendant {
        position: relative;
        z-index: 85;
    }

    .cascade-node-children-container[hidden] {
        display: none !important;
    }

    .cascade-node-children-stack {
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: 100%;
        min-width: 0;
        overflow: visible;
    }

    .cascade-node-children-stack.is-primary-children-stack {
        gap: 12px;
    }

    /* @supports (content-visibility: auto) {
        .cascade-node-body-row.has-split > .cascade-node-children-container:not(.has-editing-descendant) {
            content-visibility: auto;
            contain-intrinsic-size: auto 420px;
        }
    } */

</style>

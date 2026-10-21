<script lang="ts">
    import type { App } from 'obsidian';
    import type { TreeNode } from '../../../types';
    import {
        DEFAULT_VISIBLE_TREE_LAYERS,
        type VisibleTreeLayersSetting
    } from '../../../themes/treeModel';
    import type { GridNoteCopyAction } from '../../../utils/gridNoteCopy';
    import CascadeVirtualBranch from './CascadeVirtualBranch.svelte';
    import CascadeNode from './CascadeNode.svelte';

    export let nodes: TreeNode[] = [];
    export let maxDepth: number = 1;
    export let nodeCount: number = 0;
    export let visibleTreeLayers: VisibleTreeLayersSetting = DEFAULT_VISIBLE_TREE_LAYERS;
    export let viewportElement: HTMLElement | null = null;
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

    const ROOT_VIRTUALIZATION_THRESHOLD = 6;
    const NODE_VIRTUALIZATION_THRESHOLD = 48;
    const HEIGHT_VIRTUALIZATION_THRESHOLD = 4800;

    $: totalNodeCount = nodeCount;
    $: estimatedTotalHeight = nodes.reduce(
        (totalHeight, node) => totalHeight + node.cascadeEstimatedHeight,
        0
    );
    $: shouldVirtualize = (
        nodes.length >= ROOT_VIRTUALIZATION_THRESHOLD
        || totalNodeCount >= NODE_VIRTUALIZATION_THRESHOLD
        || estimatedTotalHeight >= HEIGHT_VIRTUALIZATION_THRESHOLD
    );
</script>

<section class="cascade-theme" data-max-depth={maxDepth}>
    <div class="cascade-theme-stage">
        {#each nodes as node (node.viewId)}
            <CascadeVirtualBranch
                {node}
                {viewportElement}
                virtualized={shouldVirtualize}
                fallbackHeight={node.cascadeEstimatedHeight}
            >
                <CascadeNode
                    {node}
                    depth={0}
                    {visibleTreeLayers}
                    {onSaveTitleEdit}
                    {onOpenNodeRangeEdit}
                    {onDeleteNode}
                    {onCopyNodeAction}
                    {app}
                    {sourcePath}
                />
            </CascadeVirtualBranch>
        {/each}
    </div>
</section>

<style>
    .cascade-theme {
        width: 100%;
        min-width: 0;
        max-width: 100%;
    }

    .cascade-theme-stage {
        display: flex;
        flex-direction: column;
        gap: 20px;
        width: 100%;
        min-width: 0;
        max-width: 100%;
        box-sizing: border-box;
        padding: 8px 0 32px;
        border-radius: 12px;
        overflow: visible;
    }

</style>

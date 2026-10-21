import type { TreeNode } from '../../types';
import type { GridNoteCardSelectionHint } from '../themes/shared/cardEditingContext';
import { isGridNotePrefaceNode } from '../../utils/treeNodeKind';

export interface GridNoteCardNavigationEntry {
    parentId: string | null;
    previousSiblingId: string | null;
    nextSiblingId: string | null;
    firstChildId: string | null;
}

export interface GridNoteCardNavigationContext {
    renderedNodes: TreeNode[];
    renderedNodeLookup: Map<string, TreeNode>;
    fullNodeLookup: Map<string, TreeNode>;
    nodeParentMap: Map<string, string | null>;
    navigationMap: Map<string, GridNoteCardNavigationEntry>;
    collapsedNodeIds: Set<string>;
}

export type GridNoteCardNavigationDirection = 'up' | 'down' | 'left' | 'right';

export function buildCardNavigation(
    nodes: TreeNode[],
    collapsedIds: Set<string>,
    parentId: string | null = null,
    navigationMap: Map<string, GridNoteCardNavigationEntry> = new Map(),
    lookup: Map<string, TreeNode> = new Map()
): {
    lookup: Map<string, TreeNode>;
    navigationMap: Map<string, GridNoteCardNavigationEntry>;
} {
    const selectableNodes = nodes.filter((node) =>
        !collapsedIds.has(node.viewId) && !isGridNotePrefaceNode(node)
    );

    for (let index = 0; index < selectableNodes.length; index += 1) {
        const node = selectableNodes[index];
        if (!node) {
            continue;
        }

        const selectableChildren = node.children.filter(
            (child) => !collapsedIds.has(child.viewId)
        );
        lookup.set(node.viewId, node);
        navigationMap.set(node.viewId, {
            parentId,
            previousSiblingId: selectableNodes[index - 1]?.viewId ?? null,
            nextSiblingId: selectableNodes[index + 1]?.viewId ?? null,
            firstChildId: selectableChildren[0]?.viewId ?? null
        });

        buildCardNavigation(node.children, collapsedIds, node.viewId, navigationMap, lookup);
    }

    return {
        lookup,
        navigationMap
    };
}

function findNearestCollapsedAncestor(
    nodeId: string,
    context: GridNoteCardNavigationContext
): TreeNode | null {
    let currentParentId = context.nodeParentMap.get(nodeId) ?? null;

    while (currentParentId) {
        if (context.collapsedNodeIds.has(currentParentId)) {
            return context.fullNodeLookup.get(currentParentId) ?? null;
        }

        currentParentId = context.nodeParentMap.get(currentParentId) ?? null;
    }

    return null;
}

function buildVisibleTraversalNodeIds(
    nodes: TreeNode[],
    collapsedIds: Set<string>,
    nodeIds: string[] = []
): string[] {
    for (const node of nodes) {
        if (!isGridNotePrefaceNode(node)) {
            nodeIds.push(node.viewId);
        }

        if (!collapsedIds.has(node.viewId)) {
            buildVisibleTraversalNodeIds(node.children, collapsedIds, nodeIds);
        }
    }

    return nodeIds;
}

function isSelectableNodeId(nodeId: string, context: GridNoteCardNavigationContext): boolean {
    const node = context.fullNodeLookup.get(nodeId);
    return Boolean(
        node
        && !isGridNotePrefaceNode(node)
        && !context.collapsedNodeIds.has(nodeId)
    );
}

function findNearestSelectableNodeFromAnchor(
    anchorNodeId: string,
    context: GridNoteCardNavigationContext
): TreeNode | null {
    const orderedNodeIds = buildVisibleTraversalNodeIds(
        context.renderedNodes,
        context.collapsedNodeIds
    );
    const anchorIndex = orderedNodeIds.indexOf(anchorNodeId);
    if (anchorIndex === -1) {
        return null;
    }

    for (let index = anchorIndex + 1; index < orderedNodeIds.length; index += 1) {
        const candidateNodeId = orderedNodeIds[index];
        if (!candidateNodeId) {
            continue;
        }

        const candidateNode = context.renderedNodeLookup.get(candidateNodeId);
        if (candidateNode) {
            return candidateNode;
        }
    }

    for (let index = anchorIndex - 1; index >= 0; index -= 1) {
        const candidateNodeId = orderedNodeIds[index];
        if (!candidateNodeId) {
            continue;
        }

        const candidateNode = context.renderedNodeLookup.get(candidateNodeId);
        if (candidateNode) {
            return candidateNode;
        }
    }

    return null;
}

export function resolveSelectableNode(
    node: TreeNode | null,
    context: GridNoteCardNavigationContext
): TreeNode | null {
    if (!node) {
        return null;
    }

    const collapsedAncestor = findNearestCollapsedAncestor(node.viewId, context);
    const anchorNodeId = collapsedAncestor?.viewId ?? node.viewId;

    if (isSelectableNodeId(anchorNodeId, context)) {
        return context.fullNodeLookup.get(anchorNodeId) ?? null;
    }

    return findNearestSelectableNodeFromAnchor(anchorNodeId, context);
}

function findAdjacentSelectableSameLevelNode(
    nodeId: string,
    direction: 'up' | 'down',
    context: GridNoteCardNavigationContext
): TreeNode | null {
    const currentNode = context.renderedNodeLookup.get(nodeId)
        ?? context.fullNodeLookup.get(nodeId);
    if (!currentNode) {
        return null;
    }

    const orderedNodeIds = buildVisibleTraversalNodeIds(
        context.renderedNodes,
        context.collapsedNodeIds
    );
    const startIndex = orderedNodeIds.indexOf(nodeId);
    if (startIndex === -1) {
        return null;
    }

    const step = direction === 'up' ? -1 : 1;
    for (
        let index = startIndex + step;
        index >= 0 && index < orderedNodeIds.length;
        index += step
    ) {
        const candidateNodeId = orderedNodeIds[index];
        if (!candidateNodeId || context.collapsedNodeIds.has(candidateNodeId)) {
            continue;
        }

        const candidateNode = context.renderedNodeLookup.get(candidateNodeId);
        if (!candidateNode) {
            continue;
        }

        if (candidateNode.headingLevel === currentNode.headingLevel) {
            return candidateNode;
        }
    }

    return null;
}

function normalizeSelectionHeader(header: string): string {
    return header.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function createSelectionHint(node: TreeNode): GridNoteCardSelectionHint {
    return {
        viewId: node.viewId,
        identityKey: node.identityKey,
        startLine: node.startLine,
        headingLevel: node.headingLevel,
        header: node.header
    };
}

function isBetterSelectionHint(
    candidate: TreeNode,
    current: TreeNode | null,
    hint: GridNoteCardSelectionHint
): boolean {
    return !current || (
        Math.abs(candidate.startLine - hint.startLine)
        < Math.abs(current.startLine - hint.startLine)
    ) || (
        Math.abs(candidate.startLine - hint.startLine)
        === Math.abs(current.startLine - hint.startLine)
        && candidate.startLine < current.startLine
    );
}

export function findNodeBySelectionHint(
    hint: GridNoteCardSelectionHint | null,
    lookup: Map<string, TreeNode>
): TreeNode | null {
    if (!hint || lookup.size === 0) {
        return null;
    }

    if (hint.viewId) {
        const exactNode = lookup.get(hint.viewId);
        if (exactNode) {
            return exactNode;
        }
    }

    const normalizedHeader = normalizeSelectionHeader(hint.header);
    let identityMatch: TreeNode | null = null;
    let headerMatch: TreeNode | null = null;
    let levelMatch: TreeNode | null = null;
    let fallbackMatch: TreeNode | null = null;

    for (const candidate of lookup.values()) {
        if (isBetterSelectionHint(candidate, fallbackMatch, hint)) {
            fallbackMatch = candidate;
        }

        const hasSameIdentity = candidate.identityKey === hint.identityKey;
        const hasSameLevel = candidate.headingLevel === hint.headingLevel;
        if (
            hasSameIdentity
            && hasSameLevel
            && isBetterSelectionHint(candidate, identityMatch, hint)
        ) {
            identityMatch = candidate;
        }

        if (!hasSameLevel) {
            continue;
        }

        if (isBetterSelectionHint(candidate, levelMatch, hint)) {
            levelMatch = candidate;
        }
        if (
            normalizeSelectionHeader(candidate.header) === normalizedHeader
            && isBetterSelectionHint(candidate, headerMatch, hint)
        ) {
            headerMatch = candidate;
        }
    }

    return identityMatch ?? headerMatch ?? levelMatch ?? fallbackMatch;
}

export function resolveCardNavigationTarget(
    nodeId: string,
    direction: GridNoteCardNavigationDirection,
    context: GridNoteCardNavigationContext
): string | null {
    const entry = context.navigationMap.get(nodeId);
    if (!entry) {
        return null;
    }

    const currentNode = context.renderedNodeLookup.get(nodeId)
        ?? context.fullNodeLookup.get(nodeId);
    if (!currentNode) {
        return null;
    }

    const parentId = context.nodeParentMap.get(nodeId) ?? null;
    const isCollapsed = context.collapsedNodeIds.has(nodeId);

    if (currentNode.headingLevel === 1 && parentId === null) {
        if (!isCollapsed && (direction === 'down' || direction === 'right')) {
            return entry.firstChildId;
        }

        return null;
    }

    switch (direction) {
        case 'up':
            return findAdjacentSelectableSameLevelNode(nodeId, 'up', context)?.viewId ?? null;
        case 'down':
            return findAdjacentSelectableSameLevelNode(nodeId, 'down', context)?.viewId ?? null;
        case 'left': {
            if (!entry.parentId) {
                return null;
            }

            const parentNode = context.renderedNodeLookup.get(entry.parentId)
                ?? context.fullNodeLookup.get(entry.parentId);
            if (currentNode.headingLevel === 2 && parentNode?.headingLevel === 1) {
                return null;
            }

            return entry.parentId;
        }
        case 'right':
            return isCollapsed ? null : entry.firstChildId;
        default:
            return null;
    }
}

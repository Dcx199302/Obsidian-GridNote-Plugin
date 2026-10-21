import type { DocumentStructure, TreeNode } from '../../types';

export function buildNodeParentMap(nodes: TreeNode[]): Map<string, string | null> {
    const parentMap = new Map<string, string | null>();

    function visitNode(node: TreeNode, parentViewId: string | null) {
        parentMap.set(node.viewId, parentViewId);
        for (const child of node.children) {
            visitNode(child, node.viewId);
        }
    }

    for (const node of nodes) {
        visitNode(node, null);
    }

    return parentMap;
}

export function buildNodeLookup(nodes: TreeNode[]): Map<string, TreeNode> {
    const nextLookup = new Map<string, TreeNode>();

    function visitNode(node: TreeNode) {
        nextLookup.set(node.viewId, node);
        for (const child of node.children) {
            visitNode(child);
        }
    }

    for (const node of nodes) {
        visitNode(node);
    }

    return nextLookup;
}

export function areSetsEqual<T>(left: Set<T>, right: Set<T>): boolean {
    if (left.size !== right.size) {
        return false;
    }

    for (const value of left) {
        if (!right.has(value)) {
            return false;
        }
    }

    return true;
}

export function buildHeadingEndLineMap(
    structure: DocumentStructure | null
): Map<number, number> {
    const nextMap = new Map<number, number>();
    if (!structure) {
        return nextMap;
    }

    for (const node of structure.lineIndex) {
        if (!node.heading) {
            continue;
        }

        nextMap.set(node.range.startLine, node.range.endLine);
    }

    return nextMap;
}

export function buildVisibleCollapsedNodeIds(
    lines: Set<number>,
    nodeLookup: Map<string, TreeNode>
): Set<string> {
    const nextIds = new Set<string>();

    for (const node of nodeLookup.values()) {
        if (node.headingLevel !== null && lines.has(node.startLine)) {
            nextIds.add(node.viewId);
        }
    }

    return nextIds;
}

export function buildVisibleCollapsedHeadingLines(
    nodeIds: Set<string>,
    nodeLookup: Map<string, TreeNode>
): Set<number> {
    const nextLines = new Set<number>();

    for (const nodeId of nodeIds) {
        const node = nodeLookup.get(nodeId);
        if (node && node.headingLevel !== null) {
            nextLines.add(node.startLine);
        }
    }

    return nextLines;
}

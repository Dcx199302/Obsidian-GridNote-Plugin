import type { TreeNode } from '../types';

export type TreeInsertPosition = 'before' | 'after' | 'child';

export interface TreeInsertTarget {
    insertLine: number;
    headingLevel: number;
}

export function resolveTreeInsertTarget(
    node: TreeNode,
    position: TreeInsertPosition
): TreeInsertTarget | null {
    if (node.headingLevel === null) {
        return null;
    }

    switch (position) {
        case 'before':
            return {
                insertLine: node.startLine,
                headingLevel: node.headingLevel
            };
        case 'after':
            return {
                insertLine: node.endLine + 1,
                headingLevel: node.headingLevel
            };
        case 'child':
            return {
                insertLine: node.endLine + 1,
                headingLevel: Math.min(6, node.headingLevel + 1)
            };
        default:
            return null;
    }
}

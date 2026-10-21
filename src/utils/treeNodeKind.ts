import type { TreeNode } from '../types';

export function isGridNotePrefaceNode(
    node: Pick<TreeNode, 'headingLevel' | 'header'>
): boolean {
    return node.headingLevel === null && node.header === '前置内容';
}

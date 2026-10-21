import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../../../../src/types';
import { reconcileCollapsedHeadingLines } from '../../../../src/components/gridNoteContent/foldProjection';

function createNode(
    viewId: string,
    header: string,
    startLine: number
): TreeNode {
    return {
        viewId,
        identityKey: `heading:${startLine}`,
        contentHash: header,
        header,
        content: `${header} content`,
        contentLineCount: 1,
        fullText: `# ${header}`,
        editableText: `${header} content`,
        children: [],
        hasHiddenChildren: false,
        startLine,
        blockEndLine: startLine,
        editStartLine: startLine + 1,
        editEndLine: startLine + 1,
        endLine: startLine + 1,
        headingLevel: 2,
        visibleSubtreeDepth: 1,
        subtreeNodeCount: 1,
        cascadeEstimatedHeight: 100
    };
}

function createLookup(nodes: TreeNode[]) {
    return new Map(nodes.map((node) => [node.viewId, node]));
}

describe('reconcileCollapsedHeadingLines', () => {
    it('remaps surviving view ids instead of assigning an old line to a newly inserted heading', () => {
        const inserted = createNode('inserted', '新建标题', 6);
        const changedB = createNode('node-b', 'B', 8);
        const changedC = createNode('node-c', 'C', 11);
        const lookup = createLookup([inserted, changedB, changedC]);

        const result = reconcileCollapsedHeadingLines(
            new Set(['node-b', 'node-c']),
            new Set([6, 9]),
            lookup
        );

        expect(result.nodeIds).toEqual(new Set(['node-b', 'node-c']));
        expect(result.headingLines).toEqual(new Set([8, 11]));
    });

    it('keeps a line fallback when a view id cannot be reused', () => {
        const replacement = createNode('replacement', 'Replacement', 6);
        const lookup = createLookup([replacement]);

        const result = reconcileCollapsedHeadingLines(
            new Set(['missing-node']),
            new Set([6]),
            lookup
        );

        expect(result.nodeIds).toEqual(new Set(['replacement']));
        expect(result.headingLines).toEqual(new Set([6]));
    });
});

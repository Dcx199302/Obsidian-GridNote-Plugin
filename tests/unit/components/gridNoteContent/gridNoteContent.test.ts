import { describe, expect, it } from 'vitest';
import {
    buildCardNavigation,
    createSelectionHint,
    findNodeBySelectionHint,
    resolveCardNavigationTarget,
    resolveSelectableNode
} from '../../../../src/components/gridNoteContent/cardNavigation';
import { resolveInsertShortcutPosition } from '../../../../src/components/gridNoteContent/keyboardInteraction';
import { resolveRevealTargetNode } from '../../../../src/components/gridNoteContent/revealTarget';
import type { TreeNode } from '../../../../src/types';

function createNode(
    viewId: string,
    header: string,
    headingLevel: number | null,
    overrides: Partial<TreeNode> = {}
): TreeNode {
    const line = Number(viewId.replace(/\D/g, '')) * 10;
    return {
        viewId,
        identityKey: `identity:${viewId}`,
        contentHash: `hash:${viewId}`,
        header,
        content: `${header} content`,
        contentLineCount: 1,
        fullText: `${header} content`,
        editableText: `${header} content`,
        children: [],
        hasHiddenChildren: false,
        startLine: line,
        blockEndLine: line,
        editStartLine: line,
        editEndLine: line,
        endLine: line,
        headingLevel,
        visibleSubtreeDepth: 1,
        subtreeNodeCount: 1,
        cascadeEstimatedHeight: 100,
        ...overrides
    };
}

function createLookup(nodes: TreeNode[]): Map<string, TreeNode> {
    const lookup = new Map<string, TreeNode>();

    function visit(node: TreeNode) {
        lookup.set(node.viewId, node);
        node.children.forEach(visit);
    }

    nodes.forEach(visit);
    return lookup;
}

function createParentMap(nodes: TreeNode[]): Map<string, string | null> {
    const parentMap = new Map<string, string | null>();

    function visit(node: TreeNode, parentId: string | null) {
        parentMap.set(node.viewId, parentId);
        node.children.forEach((child) => visit(child, node.viewId));
    }

    nodes.forEach((node) => visit(node, null));
    return parentMap;
}

describe('GridNote card navigation', () => {
    const grandchild = createNode('n3', 'Third', 3, { startLine: 30, endLine: 30 });
    const secondChild = createNode('n2', 'Second', 2, {
        children: [grandchild],
        startLine: 20,
        endLine: 20
    });
    const firstChild = createNode('n1', 'First', 2, { startLine: 10, endLine: 10 });
    const root = createNode('root', 'Root', 1, {
        children: [firstChild, secondChild],
        startLine: 0,
        endLine: 0
    });
    const nodes = [root];
    const lookup = createLookup(nodes);
    const { lookup: renderedLookup, navigationMap } = buildCardNavigation(
        nodes,
        new Set<string>()
    );

    function createContext(collapsedNodeIds: Set<string>) {
        return {
            renderedNodes: nodes,
            renderedNodeLookup: renderedLookup,
            fullNodeLookup: lookup,
            nodeParentMap: createParentMap(nodes),
            navigationMap,
            collapsedNodeIds
        };
    }

    it('builds sibling, parent, and child navigation entries', () => {
        expect(navigationMap.get(firstChild.viewId)).toEqual({
            parentId: root.viewId,
            previousSiblingId: null,
            nextSiblingId: secondChild.viewId,
            firstChildId: null
        });
        expect(navigationMap.get(secondChild.viewId)?.firstChildId).toBe(grandchild.viewId);
    });

    it('resolves keyboard navigation targets', () => {
        const context = createContext(new Set<string>());

        expect(resolveCardNavigationTarget(root.viewId, 'down', context)).toBe(firstChild.viewId);
        expect(resolveCardNavigationTarget(firstChild.viewId, 'down', context)).toBe(secondChild.viewId);
        expect(resolveCardNavigationTarget(secondChild.viewId, 'up', context)).toBe(firstChild.viewId);
        expect(resolveCardNavigationTarget(secondChild.viewId, 'right', context)).toBe(grandchild.viewId);
        expect(resolveCardNavigationTarget(grandchild.viewId, 'left', context)).toBe(secondChild.viewId);
    });

    it('falls back to a nearby selectable node when an ancestor is collapsed', () => {
        const context = createContext(new Set([secondChild.viewId]));

        expect(resolveSelectableNode(grandchild, context)).toBe(firstChild);
        expect(resolveCardNavigationTarget(secondChild.viewId, 'right', context)).toBeNull();
    });

    it('restores a selection by identity when the view id changed', () => {
        const nextSecondChild = {
            ...secondChild,
            viewId: 'next-n2',
            children: []
        };
        const nextLookup = createLookup([{ ...root, children: [firstChild, nextSecondChild] }]);
        const hint = createSelectionHint(secondChild);

        expect(findNodeBySelectionHint(hint, nextLookup)).toBe(nextSecondChild);
    });

    it('keeps a top-level non-H1 heading on branch navigation semantics', () => {
        const laterH1 = createNode('n4', 'Later root', 1, { startLine: 40, endLine: 40 });
        const topNodes = [secondChild, laterH1];
        const topContext = {
            renderedNodes: topNodes,
            renderedNodeLookup: createLookup(topNodes),
            fullNodeLookup: createLookup(topNodes),
            nodeParentMap: createParentMap(topNodes),
            navigationMap: buildCardNavigation(topNodes, new Set<string>()).navigationMap,
            collapsedNodeIds: new Set<string>()
        };

        expect(resolveCardNavigationTarget(secondChild.viewId, 'down', topContext)).toBeNull();
        expect(resolveCardNavigationTarget(secondChild.viewId, 'right', topContext))
            .toBe(grandchild.viewId);
        expect(resolveCardNavigationTarget(grandchild.viewId, 'left', topContext))
            .toBe(secondChild.viewId);
        expect(resolveCardNavigationTarget(laterH1.viewId, 'down', topContext)).toBeNull();
    });
});

describe('GridNote insert shortcuts', () => {
    it('keeps a top-level H2 on branch insertion semantics', () => {
        const node = createNode('n2', 'Branch', 2);

        expect(resolveInsertShortcutPosition(node, 'ArrowDown', false)).toBe('after');
        expect(resolveInsertShortcutPosition(node, 'ArrowUp', false)).toBe('before');
        expect(resolveInsertShortcutPosition(node, 'ArrowRight', false)).toBe('child');
    });

    it('reserves downward insertion for a document H1 root', () => {
        const node = createNode('n1', 'Root', 1);

        expect(resolveInsertShortcutPosition(node, 'ArrowDown', true)).toBe('child');
        expect(resolveInsertShortcutPosition(node, 'ArrowUp', true)).toBeNull();
        expect(resolveInsertShortcutPosition(node, 'ArrowRight', true)).toBeNull();
    });
});

describe('GridNote reveal target', () => {
    const first = createNode('n1', 'First', 2, { startLine: 10, endLine: 10 });
    const second = createNode('n2', 'Second', 2, { startLine: 20, endLine: 20 });
    const lookup = createLookup([first, second]);

    it('prefers an exact anchor identity', () => {
        expect(resolveRevealTargetNode({
            line: 0,
            anchor: {
                identityKey: second.identityKey,
                startLine: second.startLine,
                editStartLine: second.editStartLine,
                endLine: second.endLine,
                headingLevel: second.headingLevel,
                header: 'Changed header',
                scrollPoint: true
            }
        }, lookup)).toBe(second);
    });

    it('returns an exact view-id anchor without fallback ranking', () => {
        expect(resolveRevealTargetNode({
            line: 0,
            anchor: {
                viewId: second.viewId,
                identityKey: 'missing-identity',
                startLine: 0,
                editStartLine: 0,
                endLine: 0,
                headingLevel: null,
                header: 'missing',
                scrollPoint: true
            }
        }, lookup)).toBe(second);
    });

    it('prefers the smallest enclosing node for a body-line reveal', () => {
        const parent = createNode('parent', 'Parent', 2, {
            startLine: 0,
            endLine: 40,
            editStartLine: 1,
            editEndLine: 40
        });
        const child = createNode('child', 'Child', 3, {
            startLine: 10,
            endLine: 20,
            editStartLine: 11,
            editEndLine: 20
        });
        parent.children = [child];
        const nestedLookup = createLookup([parent]);

        expect(resolveRevealTargetNode({ line: 15 }, nestedLookup)).toBe(child);
    });

    it('falls back to header and then line distance', () => {
        expect(resolveRevealTargetNode({
            line: 0,
            anchor: {
                identityKey: 'missing-identity',
                startLine: 20,
                editStartLine: 20,
                endLine: 20,
                headingLevel: 2,
                header: 'second',
                scrollPoint: true
            }
        }, lookup)).toBe(second);

        expect(resolveRevealTargetNode({ line: 11 }, lookup)).toBe(first);
    });
});

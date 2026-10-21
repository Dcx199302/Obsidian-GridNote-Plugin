import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../../../src/types';
import { resolveTreeInsertTarget } from '../../../src/utils/treeInsert';

function createTreeNode(overrides: Partial<TreeNode> = {}): TreeNode {
	return {
		viewId: 'node-1',
		identityKey: 'node-1',
		contentHash: 'hash',
		header: 'Title',
		content: 'Body',
		contentLineCount: 1,
		fullText: '# Title\nBody',
		editableText: 'Body',
		children: [],
		hasHiddenChildren: false,
		startLine: 4,
		blockEndLine: 6,
		editStartLine: 5,
		editEndLine: 6,
		endLine: 6,
		headingLevel: 2,
		visibleSubtreeDepth: 0,
		subtreeNodeCount: 1,
		cascadeEstimatedHeight: 80,
		...overrides
	};
}

describe('resolveTreeInsertTarget', () => {
	it('inserts before the current heading at the same level', () => {
		expect(resolveTreeInsertTarget(createTreeNode(), 'before')).toEqual({
			insertLine: 4,
			headingLevel: 2
		});
	});

	it('inserts children one level deeper and caps the level at h6', () => {
		expect(
			resolveTreeInsertTarget(createTreeNode({ headingLevel: 6, endLine: 9 }), 'child')
		).toEqual({
			insertLine: 10,
			headingLevel: 6
		});
	});

	it('returns null for preface nodes', () => {
		expect(
			resolveTreeInsertTarget(createTreeNode({ headingLevel: null, header: '前置内容' }), 'after')
		).toBeNull();
	});
});

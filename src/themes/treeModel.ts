import type { DocumentNode, DocumentStructure } from '../types';
import type { TreeNode, TreeThemeModel } from '../types';
import { cyrb53, generateSimpleId } from '../utils/hash';

export type VisibleTreeLayersSetting = number | 'auto';
export const MIN_VISIBLE_TREE_LAYERS = 1;
export const MAX_VISIBLE_TREE_LAYERS = 6;
export const DEFAULT_VISIBLE_TREE_LAYERS: VisibleTreeLayersSetting = 'auto';

function hasTextContent(text: string | null): boolean {
	return Boolean(text && text.trim().length > 0);
}

function clampVisibleTreeLayers(visibleTreeLayers: number): number {
	return Math.max(
		MIN_VISIBLE_TREE_LAYERS,
		Math.min(MAX_VISIBLE_TREE_LAYERS, visibleTreeLayers)
	);
}

function resolveVisibleTreeLayers(visibleTreeLayers: VisibleTreeLayersSetting): number {
	return visibleTreeLayers === 'auto'
		? MAX_VISIBLE_TREE_LAYERS
		: clampVisibleTreeLayers(visibleTreeLayers);
}

function getMaxVisibleHeadingLevel(visibleTreeLayers: number): number {
	return Math.min(6, visibleTreeLayers + 1);
}

function normalizeHeader(header: string): string {
	return header.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeContent(content: string): string {
	return content.trim().replace(/\s+/g, ' ').slice(0, 500);
}

function createSubtreeHash(
	headingLevel: number | null,
	header: string,
	content: string,
	childHashes: string[]
): string {
	return cyrb53([
		`level:${headingLevel ?? 'root'}`,
		`header:${header}`,
		`content:${content}`,
		`children:${childHashes.join(',')}`
	].join('|'));
}

function getBlockEndLine(startLine: number, fullText: string): number {
	const lineCount = fullText === '' ? 0 : fullText.split('\n').length;
	return startLine + Math.max(0, lineCount - 1);
}

type TreeNodeKind = 'heading' | 'content';

interface TreeNodeMeta {
	kind: TreeNodeKind;
	headingLevel: number | null;
	header: string;
	normalizedHeader: string;
	content: string;
	contentLineCount: number;
	normalizedContent: string;
	identityKey: string;
	fullText: string;
	startLine: number;
	blockEndLine: number;
	editStartLine: number;
	editEndLine: number;
	endLine: number;
	childCount: number;
}

function canReuseChildren(previousNode: TreeNode, nextChildren: TreeNode[]): boolean {
	if (previousNode.children.length !== nextChildren.length) {
		return false;
	}

	return previousNode.children.every((child, index) => child === nextChildren[index]);
}

function canReuseTreeNode(
	previousNode: TreeNode,
	nextNode: TreeNode
): boolean {
	return (
		previousNode.identityKey === nextNode.identityKey &&
		previousNode.contentHash === nextNode.contentHash &&
		previousNode.hasHiddenChildren === nextNode.hasHiddenChildren &&
		previousNode.startLine === nextNode.startLine &&
		previousNode.blockEndLine === nextNode.blockEndLine &&
		previousNode.editStartLine === nextNode.editStartLine &&
		previousNode.editEndLine === nextNode.editEndLine &&
		previousNode.endLine === nextNode.endLine &&
		previousNode.fullText === nextNode.fullText &&
		previousNode.editableText === nextNode.editableText &&
		canReuseChildren(previousNode, nextNode.children)
	);
}

function createIdentityKey(kind: TreeNodeKind, line: number): string {
	return `${kind}:${line}`;
}

function buildPreviousNodeMap(nodes: TreeNode[], nodeMap: Map<string, TreeNode>): Map<string, TreeNode> {
	for (const node of nodes) {
		nodeMap.set(node.viewId, node);
		buildPreviousNodeMap(node.children, nodeMap);
	}

	return nodeMap;
}

function getTreeNodeKind(node: TreeNode): TreeNodeKind {
	return node.headingLevel === null && node.header === '正文内容'
		? 'content'
		: node.identityKey.startsWith('heading:')
			? 'heading'
			: 'content';
}

function createNodeMeta(node: DocumentNode): TreeNodeMeta {
	const kind: TreeNodeKind = node.heading ? 'heading' : 'content';
	const headingLevel = node.heading?.level ?? null;
	const header = node.heading?.text ?? '正文内容';
	const content = node.content ?? '';
	const contentLineCount = content === '' ? 1 : content.split('\n').length;
	const startLine = node.range.startLine;
	const fullText = node.fullText;

	return {
		kind,
		headingLevel,
		header,
		normalizedHeader: normalizeHeader(header),
		content,
		contentLineCount,
		normalizedContent: normalizeContent(content),
		identityKey: createIdentityKey(
			kind,
			node.heading?.line ?? startLine
		),
		fullText,
		startLine,
		blockEndLine: getBlockEndLine(startLine, fullText),
		editStartLine: node.contentRange.startLine,
		editEndLine: node.contentRange.endLine,
		endLine: node.range.endLine,
		childCount: node.children.length
	};
}

function createRootContentMeta(
    structure: DocumentStructure,
    frontmatterPreview: string = ''
): TreeNodeMeta | null {
    const prefaceContent = structure.root.content ?? '';
    const content = frontmatterPreview
        ? (prefaceContent ? `${frontmatterPreview}\n${prefaceContent}` : frontmatterPreview)
        : prefaceContent;
    if (!hasTextContent(content)) {
        return null;
    }

    const contentLineCount = content.split('\n').length;
    const startLine = structure.root.contentRange.startLine;

	return {
		kind: 'content',
		headingLevel: null,
		header: '前置内容',
		normalizedHeader: normalizeHeader('前置内容'),
		content,
		contentLineCount,
		normalizedContent: normalizeContent(content),
		identityKey: createIdentityKey('content', startLine),
		fullText: content,
		startLine,
		blockEndLine: getBlockEndLine(startLine, content),
		editStartLine: startLine,
		editEndLine: structure.root.contentRange.endLine,
		endLine: structure.root.contentRange.endLine,
		childCount: 0
	};
}

function createViewId(): string {
	return generateSimpleId('tree');
}

interface TreeNodeLayoutMetrics {
	visibleSubtreeDepth: number;
	subtreeNodeCount: number;
	cascadeEstimatedHeight: number;
}

function createTreeNodeLayoutMetrics(
	children: TreeNode[],
	contentLineCount: number,
	depthFromTop: number
): TreeNodeLayoutMetrics {
	const visibleSubtreeDepth = children.length === 0
		? 1
		: 1 + Math.max(...children.map((child) => child.visibleSubtreeDepth));
	const subtreeNodeCount = 1 + children.reduce(
		(count, child) => count + child.subtreeNodeCount,
		0
	);
	const cascadeBaseHeight = depthFromTop === 0 ? 180 : 148;
	const cascadeContentHeight = Math.min(contentLineCount * 20, 240);
	const cascadeChildGap = Math.min(children.length * 20, 180);
	const cascadeChildHeight = children.reduce(
		(sum, child) => sum + child.cascadeEstimatedHeight,
		0
	);

	return {
		visibleSubtreeDepth,
		subtreeNodeCount,
		cascadeEstimatedHeight: (
			cascadeBaseHeight
			+ cascadeContentHeight
			+ cascadeChildGap
			+ Math.min(cascadeChildHeight, 3200)
		),
	};
}

function getTreeNodeNormalizedContent(node: TreeNode): string {
	return normalizeContent(node.content);
}

function getNodeMatchScore(
	previousNode: TreeNode,
	nextMeta: TreeNodeMeta,
	previousIndex: number,
	nextIndex: number
): number {
	if (getTreeNodeKind(previousNode) !== nextMeta.kind) {
		return Number.NEGATIVE_INFINITY;
	}

	if (previousNode.headingLevel !== nextMeta.headingLevel) {
		return Number.NEGATIVE_INFINITY;
	}

	let score = 0;

	if (previousNode.identityKey === nextMeta.identityKey) {
		score += 24;
	}

	if (normalizeHeader(previousNode.header) === nextMeta.normalizedHeader) {
		score += 10;
	}

	if (getTreeNodeNormalizedContent(previousNode) === nextMeta.normalizedContent) {
		score += 14;
	}

	if (previousNode.fullText === nextMeta.fullText) {
		score += 20;
	}

	if (previousNode.children.length === nextMeta.childCount) {
		score += 3;
	}

	const lineDelta = Math.abs(previousNode.startLine - nextMeta.startLine);
	if (lineDelta === 0) {
		score += 6;
	} else if (lineDelta <= 2) {
		score += 3;
	} else if (lineDelta <= 6) {
		score += 1;
	}

	const indexDelta = Math.abs(previousIndex - nextIndex);
	if (indexDelta === 0) {
		score += 4;
	} else if (indexDelta === 1) {
		score += 2;
	}

	return score >= 12 ? score : Number.NEGATIVE_INFINITY;
}

function matchSiblingNodes(
	previousNodes: TreeNode[],
	nextMetas: TreeNodeMeta[]
): Array<TreeNode | null> {
	const previousCount = previousNodes.length;
	const nextCount = nextMetas.length;
	const scores = Array.from({ length: previousCount }, () =>
		Array.from({ length: nextCount }, () => Number.NEGATIVE_INFINITY)
	);
	const dp = Array.from({ length: previousCount + 1 }, () =>
		Array.from({ length: nextCount + 1 }, () => 0)
	);

	for (let previousIndex = 0; previousIndex < previousCount; previousIndex += 1) {
		const previousNode = previousNodes[previousIndex];
		const scoreRow = scores[previousIndex];
		if (!previousNode || !scoreRow) {
			continue;
		}

		for (let nextIndex = 0; nextIndex < nextCount; nextIndex += 1) {
			const nextMeta = nextMetas[nextIndex];
			if (!nextMeta) {
				continue;
			}

			scoreRow[nextIndex] = getNodeMatchScore(
				previousNode,
				nextMeta,
				previousIndex,
				nextIndex
			);
		}
	}

	for (let previousIndex = 1; previousIndex <= previousCount; previousIndex += 1) {
		const currentRow = dp[previousIndex];
		const previousRow = dp[previousIndex - 1];
		const scoreRow = scores[previousIndex - 1];
		if (!currentRow || !previousRow || !scoreRow) {
			continue;
		}

		for (let nextIndex = 1; nextIndex <= nextCount; nextIndex += 1) {
			const skipPrevious = previousRow[nextIndex] ?? 0;
			const skipNext = currentRow[nextIndex - 1] ?? 0;
			let bestScore = Math.max(skipPrevious, skipNext);
			const matchScore = scoreRow[nextIndex - 1];

			if (matchScore !== undefined && matchScore !== Number.NEGATIVE_INFINITY) {
				bestScore = Math.max(
					bestScore,
					(previousRow[nextIndex - 1] ?? 0) + matchScore
				);
			}

			currentRow[nextIndex] = bestScore;
		}
	}

	const matches = Array<TreeNode | null>(nextCount).fill(null);
	let previousIndex = previousCount;
	let nextIndex = nextCount;

	while (previousIndex > 0 && nextIndex > 0) {
		const previousRow = dp[previousIndex - 1];
		const currentRow = dp[previousIndex];
		const scoreRow = scores[previousIndex - 1];
		const previousNode = previousNodes[previousIndex - 1];
		const matchScore = scoreRow?.[nextIndex - 1];

		if (!previousRow || !currentRow || !previousNode) {
			break;
		}

		if (
			matchScore !== undefined &&
			matchScore !== Number.NEGATIVE_INFINITY &&
			currentRow[nextIndex] ===
				(previousRow[nextIndex - 1] ?? 0) + matchScore
		) {
			matches[nextIndex - 1] = previousNode;
			previousIndex -= 1;
			nextIndex -= 1;
			continue;
		}

		if (currentRow[nextIndex] === (previousRow[nextIndex] ?? 0)) {
			previousIndex -= 1;
			continue;
		}

		nextIndex -= 1;
	}

	return matches;
}

function buildTreeNodes(
	documentNodes: DocumentNode[],
	previousNodes: TreeNode[],
	depthFromTop: number,
	visibleTreeLayers: number,
	maxVisibleHeadingLevel: number
): TreeNode[] {
	const visibleDocumentNodes = documentNodes.filter((node) => {
		const headingLevel = node.heading?.level ?? null;
		return headingLevel === null || headingLevel <= maxVisibleHeadingLevel;
	});
	const nextMetas = visibleDocumentNodes.map(createNodeMeta);
	const previousMatches = matchSiblingNodes(previousNodes, nextMetas);
	const nextNodes: TreeNode[] = [];

	for (let index = 0; index < visibleDocumentNodes.length; index += 1) {
		const node = visibleDocumentNodes[index];
		const nextMeta = nextMetas[index];
		const previousNode = previousMatches[index] ?? null;
		if (!node || !nextMeta) {
			continue;
		}

			// visibleTreeLayers 表示实际可见层数，当前层一旦已经到达上限，
			// 就不再继续展开下一层，避免出现“多渲一层”的 off-by-one。
			const hasHiddenChildren = (
				node.children.length > 0
				&& depthFromTop >= Math.max(0, visibleTreeLayers - 1)
			);
		const children = hasHiddenChildren
			? []
			: buildTreeNodes(
				node.children,
				previousNode?.children ?? [],
				depthFromTop + 1,
				visibleTreeLayers,
				maxVisibleHeadingLevel
			);
		const contentHash = createSubtreeHash(
			nextMeta.headingLevel,
			nextMeta.header,
			nextMeta.content,
			children.map(child => child.contentHash)
		);
		const nextNode: TreeNode = {
			viewId: previousNode?.viewId ?? createViewId(),
			identityKey: nextMeta.identityKey,
			contentHash,
			header: nextMeta.header,
			content: nextMeta.content,
			contentLineCount: nextMeta.contentLineCount,
			fullText: nextMeta.fullText,
			editableText: nextMeta.content,
			children,
			hasHiddenChildren,
			startLine: nextMeta.startLine,
			blockEndLine: nextMeta.blockEndLine,
			editStartLine: nextMeta.editStartLine,
			editEndLine: nextMeta.editEndLine,
			endLine: nextMeta.endLine,
			headingLevel: nextMeta.headingLevel,
			...createTreeNodeLayoutMetrics(
				children,
				nextMeta.contentLineCount,
				depthFromTop
			)
		};

		if (previousNode && canReuseTreeNode(previousNode, nextNode)) {
			nextNodes.push(previousNode);
			continue;
		}

		nextNodes.push(nextNode);
	}

	return nextNodes;
}

function createRootContentNode(
	structure: DocumentStructure,
	previousNodesByViewId: Map<string, TreeNode>,
	previousRootContentNode: TreeNode | null,
	frontmatterPreview: string
): TreeNode | null {
	const nextMeta = createRootContentMeta(structure, frontmatterPreview);
	if (!nextMeta) {
		return null;
	}

	const previousNode = previousRootContentNode;
	const nextNode: TreeNode = {
		viewId: previousNode?.viewId ?? createViewId(),
		identityKey: nextMeta.identityKey,
		contentHash: createSubtreeHash(
			null,
			nextMeta.header,
			nextMeta.content,
			[]
		),
		header: nextMeta.header,
		content: nextMeta.content,
		contentLineCount: nextMeta.contentLineCount,
		fullText: nextMeta.fullText,
		editableText: nextMeta.content,
		children: [],
		hasHiddenChildren: false,
		startLine: nextMeta.startLine,
		blockEndLine: nextMeta.blockEndLine,
		editStartLine: nextMeta.editStartLine,
		editEndLine: nextMeta.editEndLine,
		endLine: nextMeta.endLine,
		headingLevel: null,
		...createTreeNodeLayoutMetrics(
			[],
			nextMeta.contentLineCount,
			0
		)
	};

	if (
		previousNode &&
		previousNodesByViewId.get(previousNode.viewId) === previousNode &&
		canReuseTreeNode(previousNode, nextNode)
	) {
		return previousNode;
	}

	return nextNode;
}

export function buildTreeThemeModel(
    structure: DocumentStructure | null,
    previousModel: TreeThemeModel | null = null,
    visibleTreeLayers: VisibleTreeLayersSetting = DEFAULT_VISIBLE_TREE_LAYERS,
    frontmatterPreview: string = ''
): TreeThemeModel {
	if (!structure) {
		return {
			nodes: [],
			maxDepth: 1,
			nodeCount: 0,
		};
	}

	const normalizedVisibleTreeLayers = resolveVisibleTreeLayers(visibleTreeLayers);
	const maxVisibleHeadingLevel = getMaxVisibleHeadingLevel(normalizedVisibleTreeLayers);
	const previousNodesByViewId = previousModel
		? buildPreviousNodeMap(previousModel.nodes, new Map<string, TreeNode>())
		: new Map<string, TreeNode>();
	const nodes: TreeNode[] = [];
	const previousRootNodes = previousModel?.nodes ?? [];
	const previousRootContentNode = previousRootNodes.find(
		(node) => node.headingLevel === null && node.header === '前置内容'
	) ?? null;
	const previousTreeRootNodes = previousRootNodes.filter(
		(node) => !(node.headingLevel === null && node.header === '前置内容')
	);
    const rootContentNode = createRootContentNode(
        structure,
        previousNodesByViewId,
        previousRootContentNode,
        frontmatterPreview
    );
	if (rootContentNode) {
		nodes.push(rootContentNode);
	}

	nodes.push(
		...buildTreeNodes(
			structure.root.children,
			previousTreeRootNodes,
			0,
			normalizedVisibleTreeLayers,
			maxVisibleHeadingLevel
		)
	);

	const maxDepth = nodes.length > 0
		? Math.max(...nodes.map((node) => node.visibleSubtreeDepth))
		: 1;

	return {
		nodes,
		maxDepth,
		nodeCount: nodes.reduce((count, node) => count + node.subtreeNodeCount, 0),
	};
}

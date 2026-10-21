export interface TreeNode {
	viewId: string;
	identityKey: string;
	contentHash: string;
	header: string;
	content: string;
	contentLineCount: number;
	fullText: string;
	editableText: string;
	children: TreeNode[];
	hasHiddenChildren: boolean;
	startLine: number;
	blockEndLine: number;
	editStartLine: number;
	editEndLine: number;
	endLine: number;
	headingLevel: number | null;
	visibleSubtreeDepth: number;
	subtreeNodeCount: number;
	cascadeEstimatedHeight: number;
}

export interface TreeThemeModel {
	nodes: TreeNode[];
	maxDepth: number;
	nodeCount: number;
}

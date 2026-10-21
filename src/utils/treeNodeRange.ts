import type { DocumentNode, DocumentStructure, TreeNode } from '../types';
import { normalizeHeadingText } from './markdownEdit';
import { isGridNotePrefaceNode } from './treeNodeKind';

interface TreeNodeRange {
    startLine: number;
    endLine: number;
}

function isHeadingMatch(
    documentNode: DocumentNode | null | undefined,
    treeNode: Pick<TreeNode, 'headingLevel' | 'header'>
): documentNode is DocumentNode {
    if (!documentNode?.heading || treeNode.headingLevel === null) {
        return false;
    }

    return documentNode.heading.level === treeNode.headingLevel
        && normalizeHeadingText(documentNode.heading.text) === normalizeHeadingText(treeNode.header);
}

function toTreeNodeRange(documentNode: DocumentNode): TreeNodeRange {
    return {
        startLine: documentNode.range.startLine,
        endLine: documentNode.range.endLine
    };
}

export function resolveCurrentTreeNodeRange(
    structure: DocumentStructure | null,
    treeNode: Pick<TreeNode, 'headingLevel' | 'header' | 'fullText' | 'startLine'>
): TreeNodeRange | null {
    if (!structure) {
        return null;
    }

    if (isGridNotePrefaceNode(treeNode)) {
        const { startLine, endLine } = structure.root.contentRange;
        if (endLine < startLine) {
            return null;
        }

        return {
            startLine,
            endLine
        };
    }

    if (treeNode.headingLevel === null) {
        return null;
    }

    const exactStartNode = structure.startLineIndex.get(treeNode.startLine);
    if (isHeadingMatch(exactStartNode, treeNode)) {
        return toTreeNodeRange(exactStartNode);
    }

    const candidates = structure.lineIndex.filter((documentNode) => isHeadingMatch(documentNode, treeNode));
    if (candidates.length === 0) {
        return null;
    }

    let bestCandidate = candidates[0] ?? null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
        let score = -Math.abs(candidate.range.startLine - treeNode.startLine);

        if (candidate.fullText === treeNode.fullText) {
            score += 200;
        }

        if (candidate.range.startLine === treeNode.startLine) {
            score += 80;
        }

        if (score > bestScore) {
            bestScore = score;
            bestCandidate = candidate;
        }
    }

    return bestCandidate ? toTreeNodeRange(bestCandidate) : null;
}

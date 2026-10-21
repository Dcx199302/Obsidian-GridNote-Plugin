import type { TreeNode } from '../../types';
import type {
    GridNoteHistoryRevealRequest,
    GridNoteRevealAnchor
} from '../../utils/historyReveal';

function normalizeRevealHeader(header: string): string {
    return header.trim().replace(/\s+/g, ' ').toLowerCase();
}

function measureRevealLineDistance(node: TreeNode, line: number): number {
    if (line < node.startLine) {
        return node.startLine - line;
    }

    if (line > node.endLine) {
        return line - node.endLine;
    }

    return 0;
}

function compareRevealLineDistance(
    left: TreeNode,
    right: TreeNode,
    line: number
): number {
    const leftDistance = measureRevealLineDistance(left, line);
    const rightDistance = measureRevealLineDistance(right, line);
    if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
    }

    const leftSpan = left.endLine - left.startLine;
    const rightSpan = right.endLine - right.startLine;
    if (leftSpan !== rightSpan) {
        return leftSpan - rightSpan;
    }

    return right.startLine - left.startLine;
}

function compareRevealAnchor(
    left: TreeNode,
    right: TreeNode,
    anchor: GridNoteRevealAnchor,
    normalizedAnchorHeader: string
): number {
    const leftHeaderPenalty = normalizeRevealHeader(left.header) === normalizedAnchorHeader
        ? 0
        : 1;
    const rightHeaderPenalty = normalizeRevealHeader(right.header) === normalizedAnchorHeader
        ? 0
        : 1;
    if (leftHeaderPenalty !== rightHeaderPenalty) {
        return leftHeaderPenalty - rightHeaderPenalty;
    }

    const leftScore = (
        Math.abs(left.startLine - anchor.startLine) * 24
        + Math.abs(left.editStartLine - anchor.editStartLine) * 18
        + Math.abs(left.endLine - anchor.endLine) * 6
    );
    const rightScore = (
        Math.abs(right.startLine - anchor.startLine) * 24
        + Math.abs(right.editStartLine - anchor.editStartLine) * 18
        + Math.abs(right.endLine - anchor.endLine) * 6
    );
    if (leftScore !== rightScore) {
        return leftScore - rightScore;
    }

    return left.startLine - right.startLine;
}

function findNearestNodeByLine(
    line: number,
    lookup: Map<string, TreeNode>
): TreeNode | null {
    let result: TreeNode | null = null;
    for (const candidate of lookup.values()) {
        if (
            !result
            || compareRevealLineDistance(candidate, result, line) < 0
        ) {
            result = candidate;
        }
    }

    return result;
}

function isBetterRevealAnchor(
    candidate: TreeNode,
    current: TreeNode | null,
    anchor: GridNoteRevealAnchor,
    normalizedAnchorHeader: string
): boolean {
    return !current
        || compareRevealAnchor(candidate, current, anchor, normalizedAnchorHeader) < 0;
}

function findNodeByRevealAnchor(
    anchor: GridNoteRevealAnchor,
    lookup: Map<string, TreeNode>
): TreeNode | null {
    if (anchor.viewId) {
        const exactNode = lookup.get(anchor.viewId);
        if (exactNode) {
            return exactNode;
        }
    }

    const normalizedAnchorHeader = normalizeRevealHeader(anchor.header);
    let exactIdentityMatch: TreeNode | null = null;
    let identityMatch: TreeNode | null = null;
    let headerMatch: TreeNode | null = null;
    let levelMatch: TreeNode | null = null;
    let fallbackMatch: TreeNode | null = null;

    for (const candidate of lookup.values()) {
        if (isBetterRevealAnchor(candidate, fallbackMatch, anchor, normalizedAnchorHeader)) {
            fallbackMatch = candidate;
        }

        const hasSameIdentity = candidate.identityKey === anchor.identityKey;
        const hasSameLevel = candidate.headingLevel === anchor.headingLevel;
        if (hasSameIdentity) {
            if (isBetterRevealAnchor(candidate, identityMatch, anchor, normalizedAnchorHeader)) {
                identityMatch = candidate;
            }
            if (
                hasSameLevel
                && isBetterRevealAnchor(candidate, exactIdentityMatch, anchor, normalizedAnchorHeader)
            ) {
                exactIdentityMatch = candidate;
            }
        }

        if (!hasSameLevel) {
            continue;
        }

        if (isBetterRevealAnchor(candidate, levelMatch, anchor, normalizedAnchorHeader)) {
            levelMatch = candidate;
        }
        if (
            normalizeRevealHeader(candidate.header) === normalizedAnchorHeader
            && isBetterRevealAnchor(candidate, headerMatch, anchor, normalizedAnchorHeader)
        ) {
            headerMatch = candidate;
        }
    }

    return exactIdentityMatch
        ?? identityMatch
        ?? headerMatch
        ?? levelMatch
        ?? fallbackMatch;
}

export function resolveRevealTargetNode(
    request: Pick<GridNoteHistoryRevealRequest, 'line' | 'anchor'>,
    lookup: Map<string, TreeNode>
): TreeNode | null {
    if (request.anchor && lookup.size > 0) {
        const anchoredNode = findNodeByRevealAnchor(request.anchor, lookup);
        if (anchoredNode) {
            return anchoredNode;
        }
    }

    if (request.line === null) {
        return null;
    }

    return findNearestNodeByLine(request.line, lookup);
}

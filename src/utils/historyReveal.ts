import type { DocumentNode, TreeNode } from '../types';
import { getNodeLineKey } from '../types';

export type GridNoteRevealSource = 'history' | 'search' | 'outline';

export interface GridNoteRevealAnchor {
    viewId?: string;
    identityKey: string;
    startLine: number;
    editStartLine: number;
    endLine: number;
    headingLevel: number | null;
    header: string;
    scrollPoint: true;
}

export interface GridNoteHistoryRevealRequest {
    requestId: number;
    line: number | null;
    /**
     * 历史定位使用该行作为视觉目标；它和 anchor 分离，
     * anchor 只负责解析目标卡片。
     */
    revealLine?: number | null;
    anchor?: GridNoteRevealAnchor;
    source?: GridNoteRevealSource;
    scrollMode?: 'anchor' | 'comfort' | 'change';
}

export interface GridNoteHistoryChangeRange {
    oldStartLine: number;
    oldEndLine: number;
    newStartLine: number;
    newEndLine: number;
}

interface DocumentNodeRevealAnchorOptions {
    header?: string;
    identityLine?: number;
}

function resolveRevealHeader(
    node: Pick<DocumentNode, 'heading'>,
    options: DocumentNodeRevealAnchorOptions = {}
): string {
    if (typeof options.header === 'string' && options.header.trim() !== '') {
        return options.header;
    }

    return node.heading?.text?.trim() || '正文内容';
}

export function createRevealAnchorFromDocumentNode(
    node: Pick<DocumentNode, 'heading' | 'range' | 'contentRange'>,
    options: DocumentNodeRevealAnchorOptions = {}
): GridNoteRevealAnchor {
    const identityKey = node.heading
        ? getNodeLineKey(node)
        : `content:${options.identityLine ?? node.range.startLine}`;
    return {
        identityKey,
        startLine: node.range.startLine,
        editStartLine: node.contentRange.startLine,
        endLine: node.range.endLine,
        headingLevel: node.heading?.level ?? null,
        header: resolveRevealHeader(node, options),
        scrollPoint: true
    };
}

export function createRevealAnchorFromTreeNode(
    node: Pick<
        TreeNode,
        'viewId' | 'identityKey' | 'startLine' | 'editStartLine' | 'endLine' | 'headingLevel' | 'header'
    >
): GridNoteRevealAnchor {
    return {
        viewId: node.viewId,
        identityKey: node.identityKey,
        startLine: node.startLine,
        editStartLine: node.editStartLine,
        endLine: node.endLine,
        headingLevel: node.headingLevel,
        header: node.header,
        scrollPoint: true
    };
}

/**
 * 通过公共前缀和公共同后缀解析替换区间。
 * 相比首个差异行，该算法能让行号偏移和删除仍落在真实编辑位置。
 */
export function findHistoryChangeRange(
    previousContent: string,
    nextContent: string
): GridNoteHistoryChangeRange | null {
    if (previousContent === nextContent) {
        return null;
    }

    const previousLines = previousContent.split('\n');
    const nextLines = nextContent.split('\n');
    const sharedLength = Math.min(previousLines.length, nextLines.length);

    let prefixLength = 0;
    while (
        prefixLength < sharedLength
        && previousLines[prefixLength] === nextLines[prefixLength]
    ) {
        prefixLength += 1;
    }

    let suffixLength = 0;
    while (
        suffixLength < sharedLength - prefixLength
        && previousLines[previousLines.length - 1 - suffixLength]
            === nextLines[nextLines.length - 1 - suffixLength]
    ) {
        suffixLength += 1;
    }

    const oldEndLine = previousLines.length - suffixLength;
    const newEndLine = nextLines.length - suffixLength;

    if (prefixLength >= oldEndLine && prefixLength >= newEndLine) {
        return null;
    }

    return {
        oldStartLine: prefixLength,
        oldEndLine,
        newStartLine: prefixLength,
        newEndLine
    };
}

export function selectHistoryRevealLine(
    changeRange: GridNoteHistoryChangeRange | null,
    cursorLine: number | null,
    nextContent: string
): number | null {
    if (!changeRange) {
        return null;
    }

    if (
        cursorLine !== null
        && cursorLine >= changeRange.newStartLine
        && cursorLine < changeRange.newEndLine
    ) {
        return cursorLine;
    }

    const maximumLine = Math.max(0, nextContent.split('\n').length - 1);
    return Math.max(
        0,
        Math.min(changeRange.newStartLine, maximumLine)
    );
}

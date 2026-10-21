import type { DocumentNode, DocumentStructure } from '../types';
import {
    createRevealAnchorFromDocumentNode,
    type GridNoteRevealAnchor
} from './historyReveal';

const DEFAULT_BROWSE_LIMIT = 24;
const DEFAULT_SEARCH_LIMIT = 80;
const MAX_SNIPPETS_PER_RESULT = 3;
const SNIPPET_CONTEXT_BEFORE = 42;
const SNIPPET_CONTEXT_AFTER = 64;
const SNIPPET_MERGE_GAP = 28;

export interface GridNoteSearchTextRange {
    start: number;
    end: number;
}

interface SearchableNode {
    title: string;
    breadcrumb: string[];
    headingLevel: number | null;
    startLine: number;
    endLine: number;
    editStartLine: number;
    headerText: string;
    contentText: string;
    anchor: GridNoteRevealAnchor;
}

export interface GridNoteSearchSnippet {
    text: string;
    matches: GridNoteSearchTextRange[];
    isTrimmedStart: boolean;
    isTrimmedEnd: boolean;
}

export interface GridNoteSearchResult {
    title: string;
    breadcrumb: string[];
    headingLevel: number | null;
    startLine: number;
    endLine: number;
    anchor: GridNoteRevealAnchor;
    titleMatches: GridNoteSearchTextRange[];
    snippets: GridNoteSearchSnippet[];
    titleMatched: boolean;
    score: number;
    matchCount: number;
}

export interface GridNoteSearchResponse {
    query: string;
    normalizedQuery: string;
    terms: string[];
    results: GridNoteSearchResult[];
    total: number;
    truncated: boolean;
    isBrowseMode: boolean;
}

export interface GridNoteSearchOptions {
    browseLimit?: number;
    searchLimit?: number;
}

interface NodeMatch {
    node: SearchableNode;
    score: number;
    matchCount: number;
    titleMatched: boolean;
    titleMatches: GridNoteSearchTextRange[];
    contentMatches: GridNoteSearchTextRange[];
}

export function searchDocumentStructure(
    structure: DocumentStructure,
    query: string,
    options: GridNoteSearchOptions = {}
): GridNoteSearchResponse {
    const browseLimit = options.browseLimit ?? DEFAULT_BROWSE_LIMIT;
    const searchLimit = options.searchLimit ?? DEFAULT_SEARCH_LIMIT;
    const normalizedQuery = normalizeSearchText(query);
    const terms = normalizedQuery === ''
        ? []
        : Array.from(new Set(normalizedQuery.split(/\s+/).filter(Boolean)));
    const nodes = collectSearchableNodes(structure);

    if (terms.length === 0) {
        const browseResults = nodes
            .slice(0, browseLimit)
            .map((node) => createBrowseResult(node));
        return {
            query,
            normalizedQuery,
            terms,
            results: browseResults,
            total: nodes.length,
            truncated: nodes.length > browseResults.length,
            isBrowseMode: true
        };
    }

    const matches = nodes
        .map((node) => matchNode(node, normalizedQuery, terms))
        .filter((match): match is NodeMatch => match !== null)
        .sort((left, right) => {
            if (left.score !== right.score) {
                return right.score - left.score;
            }

            return left.node.startLine - right.node.startLine;
        });

    const total = matches.length;
    const limitedMatches = matches.slice(0, searchLimit);

    return {
        query,
        normalizedQuery,
        terms,
        results: limitedMatches.map((match) => createSearchResult(match)),
        total,
        truncated: total > limitedMatches.length,
        isBrowseMode: false
    };
}

function collectSearchableNodes(structure: DocumentStructure): SearchableNode[] {
    const results: SearchableNode[] = [];

    if ((structure.root.content ?? '').trim() !== '') {
        results.push({
            title: '前置内容',
            breadcrumb: ['文档开头'],
            headingLevel: null,
            startLine: structure.root.contentRange.startLine,
            endLine: structure.root.contentRange.endLine,
            editStartLine: structure.root.contentRange.startLine,
            headerText: '前置内容',
            contentText: structure.root.content ?? '',
            anchor: createRevealAnchorFromDocumentNode(structure.root, {
                header: '前置内容',
                identityLine: structure.root.contentRange.startLine
            })
        });
    }

    const visitNode = (node: DocumentNode, breadcrumb: string[]) => {
        const title = node.heading?.text?.trim() || '正文内容';
        const nextBreadcrumb = node.heading
            ? [...breadcrumb, title]
            : breadcrumb;

        results.push({
            title,
            breadcrumb: breadcrumb.slice(),
            headingLevel: node.heading?.level ?? null,
            startLine: node.range.startLine,
            endLine: node.range.endLine,
            editStartLine: node.contentRange.startLine,
            headerText: title,
            contentText: node.content ?? '',
            anchor: createRevealAnchorFromDocumentNode(node, {
                header: title
            })
        });

        for (const child of node.children) {
            visitNode(child, nextBreadcrumb);
        }
    };

    for (const child of structure.root.children) {
        visitNode(child, []);
    }

    return results.sort((left, right) => left.startLine - right.startLine);
}

function matchNode(
    node: SearchableNode,
    normalizedQuery: string,
    terms: string[]
): NodeMatch | null {
    const headerTextLower = node.headerText.toLowerCase();
    const contentTextLower = node.contentText.toLowerCase();
    const normalizedHeaderText = normalizeSearchText(node.headerText);
    const normalizedContentText = normalizeSearchText(node.contentText);

    if (!terms.every((term) => headerTextLower.includes(term) || contentTextLower.includes(term))) {
        return null;
    }

    const titleMatches = findMatchRanges(node.headerText, terms);
    const contentMatches = findMatchRanges(node.contentText, terms);
    const titleMatched = titleMatches.length > 0;
    const titlePhraseMatched = normalizedQuery !== ''
        && normalizedHeaderText.includes(normalizedQuery);
    const contentPhraseMatched = normalizedQuery !== ''
        && normalizedContentText.includes(normalizedQuery);
    const matchCount = titleMatches.length + contentMatches.length;

    let score = 0;
    if (titlePhraseMatched) {
        score += 140;
    }
    if (contentPhraseMatched) {
        score += 60;
    }

    score += titleMatches.length * 42;
    score += contentMatches.length * 9;

    if (titleMatched && !contentPhraseMatched) {
        score += 18;
    }

    if (node.headingLevel !== null) {
        score += Math.max(0, 8 - node.headingLevel);
    }

    return {
        node,
        score,
        matchCount,
        titleMatched,
        titleMatches,
        contentMatches
    };
}

function createSearchResult(match: NodeMatch): GridNoteSearchResult {
    const snippets = createSnippets(match.node.contentText, match.contentMatches);
    if (snippets.length === 0) {
        snippets.push(createPreviewSnippet(match.node.contentText || match.node.headerText));
    }

    return {
        title: match.node.title,
        breadcrumb: match.node.breadcrumb,
        headingLevel: match.node.headingLevel,
        startLine: match.node.startLine,
        endLine: match.node.endLine,
        anchor: match.node.anchor,
        titleMatches: match.titleMatches,
        snippets,
        titleMatched: match.titleMatched,
        score: match.score,
        matchCount: match.matchCount
    };
}

function createBrowseResult(node: SearchableNode): GridNoteSearchResult {
    return {
        title: node.title,
        breadcrumb: node.breadcrumb,
        headingLevel: node.headingLevel,
        startLine: node.startLine,
        endLine: node.endLine,
        anchor: node.anchor,
        titleMatches: [],
        snippets: [createPreviewSnippet(node.contentText || node.headerText)],
        titleMatched: false,
        score: 0,
        matchCount: 0
    };
}

function createPreviewSnippet(text: string): GridNoteSearchSnippet {
    const trimmedText = text.trim();
    const preview = trimmedText.length > 180
        ? trimmedText.slice(0, 180).trimEnd()
        : trimmedText;

    return {
        text: preview,
        matches: [],
        isTrimmedStart: false,
        isTrimmedEnd: preview.length < trimmedText.length
    };
}

function createSnippets(
    contentText: string,
    matches: GridNoteSearchTextRange[]
): GridNoteSearchSnippet[] {
    if (contentText.trim() === '' || matches.length === 0) {
        return [];
    }

    const windows = matches
        .slice(0, MAX_SNIPPETS_PER_RESULT)
        .map((match) => ({
            start: Math.max(0, match.start - SNIPPET_CONTEXT_BEFORE),
            end: Math.min(contentText.length, match.end + SNIPPET_CONTEXT_AFTER)
        }));
    const mergedWindows = mergeWindows(windows);

    return mergedWindows.slice(0, MAX_SNIPPETS_PER_RESULT).map((window) => {
        const snippetText = contentText.slice(window.start, window.end).trim();
        const leadingTrimOffset = contentText
            .slice(window.start, window.end)
            .indexOf(snippetText);
        const safeOffset = leadingTrimOffset >= 0 ? leadingTrimOffset : 0;
        const absoluteStart = window.start + safeOffset;
        const absoluteEnd = absoluteStart + snippetText.length;
        const snippetMatches = matches
            .filter((match) => match.end > absoluteStart && match.start < absoluteEnd)
            .map((match) => ({
                start: Math.max(match.start, absoluteStart) - absoluteStart,
                end: Math.min(match.end, absoluteEnd) - absoluteStart
            }));

        return {
            text: snippetText,
            matches: snippetMatches,
            isTrimmedStart: absoluteStart > 0,
            isTrimmedEnd: absoluteEnd < contentText.length
        };
    });
}

function mergeWindows(windows: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
    if (windows.length === 0) {
        return [];
    }

    const sortedWindows = windows
        .slice()
        .sort((left, right) => left.start - right.start);
    const mergedWindows = [sortedWindows[0]!];

    for (let index = 1; index < sortedWindows.length; index += 1) {
        const currentWindow = sortedWindows[index];
        const previousWindow = mergedWindows[mergedWindows.length - 1];
        if (!currentWindow || !previousWindow) {
            continue;
        }

        if (currentWindow.start <= previousWindow.end + SNIPPET_MERGE_GAP) {
            previousWindow.end = Math.max(previousWindow.end, currentWindow.end);
            continue;
        }

        mergedWindows.push({ ...currentWindow });
    }

    return mergedWindows;
}

function findMatchRanges(text: string, terms: string[]): GridNoteSearchTextRange[] {
    if (text === '' || terms.length === 0) {
        return [];
    }

    const normalizedText = text.toLowerCase();
    const ranges: GridNoteSearchTextRange[] = [];

    for (const term of terms) {
        if (term === '') {
            continue;
        }

        let searchIndex = 0;
        while (searchIndex < normalizedText.length) {
            const matchIndex = normalizedText.indexOf(term, searchIndex);
            if (matchIndex === -1) {
                break;
            }

            ranges.push({
                start: matchIndex,
                end: matchIndex + term.length
            });
            searchIndex = matchIndex + Math.max(1, term.length);
        }
    }

    return mergeRanges(ranges);
}

function mergeRanges(ranges: GridNoteSearchTextRange[]): GridNoteSearchTextRange[] {
    if (ranges.length === 0) {
        return [];
    }

    const sortedRanges = ranges
        .slice()
        .sort((left, right) => left.start - right.start);
    const mergedRanges = [{ ...sortedRanges[0]! }];

    for (let index = 1; index < sortedRanges.length; index += 1) {
        const currentRange = sortedRanges[index];
        const previousRange = mergedRanges[mergedRanges.length - 1];
        if (!currentRange || !previousRange) {
            continue;
        }

        if (currentRange.start <= previousRange.end) {
            previousRange.end = Math.max(previousRange.end, currentRange.end);
            continue;
        }

        mergedRanges.push({ ...currentRange });
    }

    return mergedRanges;
}

function normalizeSearchText(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

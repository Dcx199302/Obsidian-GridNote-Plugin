import type { App } from 'obsidian';
import type { DocumentStructure } from '../../types';
import type { TreeNode } from '../../types';
import {
    readPersistedFoldState,
    type PersistedFoldRange,
    type PersistedFoldState
} from '../../utils/foldStorage';
import {
    buildHeadingEndLineMap,
    buildVisibleCollapsedHeadingLines,
    buildVisibleCollapsedNodeIds
} from './nodeIndex';

export function readCollapsedHeadingLines(options: {
    app: App | null;
    sourcePath: string;
    structure: DocumentStructure | null;
    foldLineOffset: number;
}): Set<number> {
    const persisted = readPersistedFoldState(options.app, options.sourcePath);
    if (!persisted || persisted.folds.length === 0) {
        return new Set<number>();
    }

    const headingEndLineMap = buildHeadingEndLineMap(options.structure);
    const nextLines = new Set<number>();

    for (const fold of persisted.folds) {
        const startLine = fold.from - options.foldLineOffset;
        if (startLine >= 0 && headingEndLineMap.has(startLine)) {
            nextLines.add(startLine);
        }
    }

    return nextLines;
}

export function createPersistedFoldState(options: {
    sourcePath: string;
    structure: DocumentStructure | null;
    foldLineOffset: number;
    lines: Set<number>;
}): PersistedFoldState | null {
    if (!options.sourcePath || !options.structure) {
        return null;
    }

    const headingEndLineMap = buildHeadingEndLineMap(options.structure);
    const folds: PersistedFoldRange[] = Array.from(options.lines)
        .sort((left, right) => left - right)
        .map((line) => {
            const endLine = headingEndLineMap.get(line);
            return typeof endLine === 'number'
                ? {
                    from: options.foldLineOffset + line,
                    to: options.foldLineOffset + endLine
                }
                : null;
        })
        .filter((item): item is PersistedFoldRange => item !== null);

    return {
        folds,
        lines: options.foldLineOffset + options.structure.totalLines
    };
}


export interface ReconciledCollapsedState {
    nodeIds: Set<string>;
    headingLines: Set<number>;
}

export function reconcileCollapsedHeadingLines(
    currentNodeIds: Set<string>,
    previousHeadingLines: Set<number>,
    nodeLookup: Map<string, TreeNode>
): ReconciledCollapsedState {
    const nextIds = new Set<string>();

    for (const nodeId of currentNodeIds) {
        if (nodeLookup.has(nodeId)) {
            nextIds.add(nodeId);
        }
    }

    const hasUnreusedNodeIds = [...currentNodeIds].some((nodeId) => !nodeLookup.has(nodeId));
    if (hasUnreusedNodeIds) {
        for (const nodeId of buildVisibleCollapsedNodeIds(previousHeadingLines, nodeLookup)) {
            nextIds.add(nodeId);
        }
    }

    return {
        nodeIds: nextIds,
        headingLines: buildVisibleCollapsedHeadingLines(nextIds, nodeLookup)
    };
}

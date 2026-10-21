import { normalizeEditorText } from './editorText';
import type { PersistedFoldState } from '../../utils/foldStorage';

export interface LineEdit {
    startLine: number;
    oldEndLineExclusive: number;
    replacementLineCount: number;
}

export function describeLineEdit(
    previousText: string,
    nextText: string
): LineEdit | null {
    if (normalizeEditorText(previousText) === normalizeEditorText(nextText)) {
        return null;
    }

    const previousLines = normalizeEditorText(previousText).split('\n');
    const nextLines = normalizeEditorText(nextText).split('\n');

    let prefixLength = 0;
    while (
        prefixLength < previousLines.length
        && prefixLength < nextLines.length
        && previousLines[prefixLength] === nextLines[prefixLength]
    ) {
        prefixLength += 1;
    }

    let suffixLength = 0;
    while (
        suffixLength < previousLines.length - prefixLength
        && suffixLength < nextLines.length - prefixLength
        && previousLines[previousLines.length - 1 - suffixLength]
            === nextLines[nextLines.length - 1 - suffixLength]
    ) {
        suffixLength += 1;
    }

    return {
        startLine: prefixLength,
        oldEndLineExclusive: previousLines.length - suffixLength,
        replacementLineCount: Math.max(
            0,
            nextLines.length - suffixLength - prefixLength
        )
    };
}

function mapLinePosition(position: number, edit: LineEdit): number {
    const deletedLineCount = edit.oldEndLineExclusive - edit.startLine;
    const lineDelta = edit.replacementLineCount - deletedLineCount;

    // 纯插入发生在 startLine 前，因此从该行开始的折叠必须后移，更早位置保持不变。
    if (deletedLineCount === 0) {
        return position >= edit.startLine
            ? position + lineDelta
            : position;
    }

    if (position <= edit.startLine) {
        return position;
    }

    if (position >= edit.oldEndLineExclusive) {
        return position + lineDelta;
    }

    return edit.startLine + Math.min(
        position - edit.startLine,
        edit.replacementLineCount
    );
}

export function remapPersistedFoldState(
    state: PersistedFoldState | null,
    edit: LineEdit
): PersistedFoldState | null {
    if (!state) {
        return null;
    }

    const nextFolds = state.folds
        .map((fold) => {
            const from = mapLinePosition(fold.from, edit);
            const endExclusive = mapLinePosition(fold.to + 1, edit);
            return {
                from,
                to: endExclusive - 1
            };
        })
        .filter((fold) => fold.to >= fold.from);

    return {
        folds: nextFolds,
        lines: Math.max(0, mapLinePosition(state.lines, edit))
    };
}

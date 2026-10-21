import { describe, expect, it } from 'vitest';
import {
    describeLineEdit,
    remapPersistedFoldState
} from '../../../../src/views/markdownMode/foldRangeEdit';
import type { PersistedFoldState } from '../../../../src/utils/foldStorage';

function createFoldState(from: number, to: number, lines: number): PersistedFoldState {
    return { folds: [{ from, to }], lines };
}

describe('foldRangeEdit', () => {
    it('shifts a later fold when lines are inserted before it', () => {
        const edit = describeLineEdit(
            '# A\n\n# Folded\ncontent\n\n# After',
            '# A\n\n## New\n\n# Folded\ncontent\n\n# After'
        );

        expect(edit).toEqual({
            startLine: 2,
            oldEndLineExclusive: 2,
            replacementLineCount: 2
        });
        expect(remapPersistedFoldState(createFoldState(2, 3, 6), edit!))
            .toEqual({ folds: [{ from: 4, to: 5 }], lines: 8 });
    });

    it('shifts a later fold backward when preceding lines are deleted', () => {
        const edit = describeLineEdit(
            '# A\nold\n\n# Folded\ncontent\n\n# After',
            '# A\n\n# Folded\ncontent\n\n# After'
        );

        expect(remapPersistedFoldState(createFoldState(3, 4, 7), edit!))
            .toEqual({ folds: [{ from: 2, to: 3 }], lines: 6 });
    });

    it('expands a fold when a child is inserted inside it', () => {
        const edit = describeLineEdit(
            '# Folded\ncontent\n\n# After',
            '# Folded\ncontent\n\n## New\n\n# After'
        );

        expect(remapPersistedFoldState(createFoldState(0, 2, 4), edit!))
            .toEqual({ folds: [{ from: 0, to: 4 }], lines: 6 });
    });

    it('removes a fold when its complete range is deleted', () => {
        const edit = describeLineEdit(
            '# Before\n\n# Folded\ncontent\n\n# After',
            '# Before\n\n# After'
        );
        const next = remapPersistedFoldState(createFoldState(2, 3, 6), edit!);

        expect(next?.folds).toEqual([]);
        expect(next?.lines).toBe(3);
    });
});

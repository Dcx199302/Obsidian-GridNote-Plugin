import { describe, expect, it } from 'vitest';
import {
    findHistoryChangeRange,
    selectHistoryRevealLine
} from '../../../src/utils/historyReveal';

describe('history reveal change range', () => {
    it('resolves a replacement range while preserving the shared suffix', () => {
        expect(findHistoryChangeRange(
            'one\nold-a\nold-b\ntwo',
            'one\nnew-a\nnew-b\ntwo'
        )).toEqual({
            oldStartLine: 1,
            oldEndLine: 3,
            newStartLine: 1,
            newEndLine: 3
        });
    });

    it('resolves an insertion range', () => {
        expect(findHistoryChangeRange('one\nthree', 'one\ntwo\nthree')).toEqual({
            oldStartLine: 1,
            oldEndLine: 1,
            newStartLine: 1,
            newEndLine: 2
        });
    });

    it('resolves a deletion range', () => {
        expect(findHistoryChangeRange('one\ntwo\nthree', 'one\nthree')).toEqual({
            oldStartLine: 1,
            oldEndLine: 2,
            newStartLine: 1,
            newEndLine: 1
        });
    });

    it('uses the restored cursor only when it is inside the changed range', () => {
        const change = findHistoryChangeRange('one\nold\nthree', 'one\nnew\nthree');

        expect(selectHistoryRevealLine(change, 1, 'one\nnew\nthree')).toBe(1);
        expect(selectHistoryRevealLine(change, 2, 'one\nnew\nthree')).toBe(1);
    });
});

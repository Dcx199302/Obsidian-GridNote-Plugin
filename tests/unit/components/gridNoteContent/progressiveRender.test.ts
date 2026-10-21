import { describe, expect, it } from 'vitest';
import { resolveProgressiveBatchSize } from '../../../../src/components/gridNoteContent/progressiveRender';

describe('resolveProgressiveBatchSize', () => {
    it('keeps small documents conservative', () => {
        expect(resolveProgressiveBatchSize(8)).toBe(4);
    });

    it('scales batches for large documents', () => {
        expect(resolveProgressiveBatchSize(120)).toBe(12);
        expect(resolveProgressiveBatchSize(600)).toBe(36);
    });
});

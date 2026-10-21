import { describe, expect, it, vi } from 'vitest';
import { performHistoryAction } from '../../../src/utils/codemirrorHistory';

vi.mock('@codemirror/commands', () => ({
    redo: vi.fn(),
    redoDepth: vi.fn(() => 0),
    undo: vi.fn(),
    undoDepth: vi.fn(() => 0)
}));

function createFallbackEditor(action: () => void) {
    let value = 'current';

    return {
        getValue: () => value,
        undo: () => {
            action();
            value = 'previous';
        },
        redo: () => {
            action();
        }
    };
}

describe('codemirror history fallback', () => {
    it('reports an undo as changed only when content changes', () => {
        const editor = createFallbackEditor(() => undefined);

        expect(performHistoryAction(editor, 'undo')).toBe(true);
        expect(performHistoryAction(editor, 'redo')).toBe(false);
    });

    it('does not report a missing editor as changed', () => {
        expect(performHistoryAction(null, 'undo')).toBe(false);
        expect(performHistoryAction(null, 'redo')).toBe(false);
    });
});

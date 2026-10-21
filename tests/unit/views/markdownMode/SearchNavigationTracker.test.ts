import { describe, expect, it } from 'vitest';
import { SearchNavigationTracker } from '../../../../src/views/markdownMode/SearchNavigationTracker';

function createEditor(text: string, line: number, ch: number) {
    return {
        getValue: () => text,
        getCursor: () => ({ line, ch })
    };
}

describe('SearchNavigationTracker', () => {
    it('captures a search selection when it arrives with an async content transition', () => {
        const tracker = new SearchNavigationTracker();
        const oldEditor = createEditor('old content', 0, 0);
        tracker.initialize(oldEditor);

        const nextText = '---\ngridnote: true\n---\n# Target\nneedle';
        const nextEditor = createEditor(nextText, 4, 2);
        tracker.capture(nextEditor, nextText, 4);

        expect(tracker.pendingCursorLine).toBe(4);
    });

    it('ignores a selection that still belongs to the previous editor content', () => {
        const tracker = new SearchNavigationTracker();
        tracker.initialize(createEditor('old content', 0, 0));

        const nextText = '# New content';
        tracker.capture(
            createEditor('old selected content', 3, 0),
            nextText,
            3
        );

        expect(tracker.pendingCursorLine).toBeNull();
    });

    it('captures the initial caret when Obsidian search opens a file without a selection', () => {
        const tracker = new SearchNavigationTracker();
        tracker.initialize(createEditor('old content', 0, 0));

        const nextText = '# New content\nneedle';
        tracker.capture(createEditor(nextText, 1, 0), nextText, null);

        expect(tracker.pendingCursorLine).toBe(1);
    });

    it('captures a late-initialized editor that already contains the target file', () => {
        const tracker = new SearchNavigationTracker();
        const nextText = '# New content\nneedle';
        tracker.initialize(createEditor(nextText, 1, 0));
        tracker.capture(createEditor(nextText, 1, 0), nextText, null);

        expect(tracker.pendingCursorLine).toBe(1);
    });

    it('updates the pending target when a search selection appears after initial content', () => {
        const tracker = new SearchNavigationTracker();
        const nextText = '# New content\nneedle';
        tracker.initialize(createEditor(nextText, 0, 0));
        tracker.capture(createEditor(nextText, 0, 0), nextText, null);
        tracker.capture(createEditor(nextText, 1, 0), nextText, 1);

        expect(tracker.pendingCursorLine).toBe(1);
    });
});

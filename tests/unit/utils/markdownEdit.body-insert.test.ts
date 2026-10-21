import { describe, expect, it } from 'vitest';
import {
    insertHeadingInEditorBodyAtLine,
    type MarkdownLineEditor
} from '../../../src/utils/markdownEdit';

function createEditor(initialLines: string[]) {
    let text = initialLines.join('\n');

    const getOffset = (position: { line: number; ch: number }) => {
        const lines = text.split('\n');
        let offset = 0;
        for (let line = 0; line < position.line; line += 1) {
            offset += (lines[line]?.length ?? 0) + 1;
        }
        return offset + position.ch;
    };

    const editor: MarkdownLineEditor = {
        lineCount: () => text.split('\n').length,
        getLine: (line: number) => text.split('\n')[line] ?? '',
        replaceRange: (replacement, from, to) => {
            const fromOffset = getOffset(from);
            const toOffset = to ? getOffset(to) : fromOffset;
            text = text.slice(0, fromOffset)
                + replacement
                + text.slice(toOffset);
        }
    };

    return {
        editor,
        getLines: () => text.split('\n')
    };
}

describe('insertHeadingInEditorBodyAtLine', () => {
    it('adds frontmatter offset when inserting into the native editor', () => {
        const { editor, getLines } = createEditor([
            '---',
            'gridnote: true',
            '---',
            '# Parent',
            'line 1',
            'line 2',
            'line 3'
        ]);

        const insertedBodyLine = insertHeadingInEditorBodyAtLine(
            editor,
            4,
            3,
            2
        );

        expect(getLines()).toEqual([
            '---',
            'gridnote: true',
            '---',
            '# Parent',
            'line 1',
            'line 2',
            'line 3',
            '## 新建标题',
            ''
        ]);
        expect(insertedBodyLine).toBe(4);
    });
});

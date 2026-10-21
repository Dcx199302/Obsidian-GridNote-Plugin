import { describe, expect, it } from 'vitest';
import { hasSourceEditorTransitioned } from '../../../../src/views/markdownMode/sourceEditorTransition';

describe('hasSourceEditorTransitioned', () => {
    it('does not mistake the previous non-empty file for the newly opened file', () => {
        expect(hasSourceEditorTransitioned('previous file', 'new file')).toBe(false);
    });

    it('accepts equivalent newline formats', () => {
        expect(hasSourceEditorTransitioned('# Title\r\nBody', '# Title\nBody')).toBe(true);
    });

    it('waits until vault content is available', () => {
        expect(hasSourceEditorTransitioned('# Title', null)).toBe(false);
    });
});

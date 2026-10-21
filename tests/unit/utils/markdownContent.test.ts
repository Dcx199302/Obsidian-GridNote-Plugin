import { describe, expect, it } from 'vitest';
import { splitMarkdownContent } from '../../../src/utils/markdownContent';

describe('splitMarkdownContent', () => {
    it('derives frontmatter boundaries from content when metadata cache is unavailable', () => {
        const content = '---\ngridnote: true\n---\n# Title\nBody';

        expect(splitMarkdownContent(content, null)).toEqual({
            frontmatter: '---\ngridnote: true\n---',
            body: '# Title\nBody',
            bodyStartLine: 3,
            hasFrontmatter: true
        });
    });

    it('ignores stale metadata cache frontmatter positions', () => {
        const content = '---\ngridnote: true\n---\n# Title';
        const staleCache = { frontmatter: { position: { end: { line: 10 } } } };

        expect(splitMarkdownContent(content, staleCache).bodyStartLine).toBe(3);
    });

    it('keeps content without frontmatter intact', () => {
        const content = '# Title';

        expect(splitMarkdownContent(content, null)).toEqual({
            frontmatter: '',
            body: '# Title',
            bodyStartLine: 0,
            hasFrontmatter: false
        });
    });
    it('does not treat an indented delimiter inside a YAML block scalar as frontmatter end', () => {
        const content = '---\ngridnote: true\nnote: |\n  ---\n---\n# Title';
        const sections = splitMarkdownContent(content, null);

        expect(sections.frontmatter).toBe('---\ngridnote: true\nnote: |\n  ---\n---');
        expect(sections.body).toBe('# Title');
        expect(sections.bodyStartLine).toBe(5);
    });

    it('preserves CRLF frontmatter boundaries and empty bodies', () => {
        const content = '---\r\ngridnote: true\r\n---\r\n';
        const sections = splitMarkdownContent(content, null);

        expect(sections.frontmatter).toBe('---\r\ngridnote: true\r\n---');
        expect(sections.body).toBe('');
        expect(sections.bodyStartLine).toBe(3);
    });
});

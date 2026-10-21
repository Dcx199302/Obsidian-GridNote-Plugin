import { describe, expect, it } from 'vitest';
import { MarkdownDocumentProcessor } from '../../../src/processor/MarkdownDocumentProcessor';
import { buildTreeThemeModel } from '../../../src/themes/treeModel';
import { MarkdownParser } from '../../../src/processor/MarkdownParser';

describe('MarkdownParser.parseHeading', () => {
	it('parses top-level ATX headings', () => {
		expect(MarkdownParser.parseHeading('### 标题', 10)).toEqual({
			level: 3,
			text: '标题',
			line: 10
		});
	});

	it('does not parse headings with leading spaces', () => {
		expect(MarkdownParser.parseHeading(' ## 标题', 1)).toBeNull();
		expect(MarkdownParser.parseHeading('    ## 标题', 2)).toBeNull();
	});

	it('supports optional closing hashes', () => {
		expect(MarkdownParser.parseHeading('## 标题 ###   ', 2)).toEqual({
			level: 2,
			text: '标题',
			line: 2
		});
	});

	it('supports empty ATX headings', () => {
		expect(MarkdownParser.parseHeading('#', 3)).toEqual({
			level: 1,
			text: '',
			line: 3
		});
		expect(MarkdownParser.parseHeading('### ###', 4)).toEqual({
			level: 3,
			text: '',
			line: 4
		});
	});

	it('requires a separator between opening hashes and heading text', () => {
		expect(MarkdownParser.parseHeading('##标题', 5)).toBeNull();
	});

	it('keeps a literal trailing hash in normal heading text', () => {
		expect(MarkdownParser.parseHeading('## C#', 6)).toEqual({
			level: 2,
			text: 'C#',
			line: 6
		});
	});
});

describe('MarkdownParser.splitIntoBlocks', () => {
	it('ignores heading-like lines inside fenced code blocks', () => {
		const markdown = [
			'# Top',
			'```ts',
			'### inside fence',
			'```',
			'### After'
		].join('\n');

		const headingLines = MarkdownParser
			.splitIntoBlocks(markdown)
			.filter((block) => block.heading !== null)
			.map((block) => block.heading?.line);

		expect(headingLines).toEqual([0, 4]);
	});
});

describe('documents without an H1 heading', () => {
    it('preserves heading semantics while building a layout tree', () => {
        const markdown = [
            '## First branch',
            '### First child',
            '#### Grandchild',
            '## Second branch'
        ].join('\n');
        const structure = new MarkdownDocumentProcessor().parse(markdown);
        const model = buildTreeThemeModel(structure);

        expect(model.nodes.map((node) => node.header)).toEqual([
            'First branch',
            'Second branch'
        ]);
        expect(model.nodes[0]?.headingLevel).toBe(2);
        expect(model.nodes[0]?.children[0]?.headingLevel).toBe(3);
        expect(model.nodes[0]?.children[0]?.children[0]?.headingLevel).toBe(4);
        expect(model.nodes[0]?.visibleSubtreeDepth).toBe(3);
    });
});

describe('documents whose first heading is H2', () => {
    it('keeps the leading H2 branch separate from a later H1 root', () => {
        const markdown = [
            'Leading content',
            '',
            '## First branch',
            '### First child',
            '### Second child',
            '# Later root'
        ].join('\n');
        const structure = new MarkdownDocumentProcessor().parse(markdown);
        const model = buildTreeThemeModel(structure);

        expect(model.nodes.map((node) => node.header)).toEqual([
            '前置内容',
            'First branch',
            'Later root'
        ]);
        expect(model.nodes[1]?.headingLevel).toBe(2);
        expect(model.nodes[1]?.children.map((node) => node.headingLevel)).toEqual([3, 3]);
        expect(model.nodes[2]?.headingLevel).toBe(1);
        expect(model.nodes[2]?.children).toEqual([]);
    });
});

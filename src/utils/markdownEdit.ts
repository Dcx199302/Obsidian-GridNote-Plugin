import type { EditorPosition } from 'obsidian';

function splitMarkdownLines(markdown: string): string[] {
    return markdown === '' ? [] : markdown.split('\n');
}

export function sanitizeHeadingDraftText(text: string): string {
    return text
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\r?\n+/g, ' ');
}

export function normalizeHeadingText(text: string): string {
    return sanitizeHeadingDraftText(text)
        .replace(/\s+/g, ' ')
        .trim();
}

export function createHeadingLine(
    headingLevel: number,
    title: string
): string {
    return `${'#'.repeat(headingLevel)} ${normalizeHeadingText(title)}`;
}

export interface MarkdownLineEditor {
    lineCount(): number;
    getLine(line: number): string;
    replaceRange(
        text: string,
        from: EditorPosition,
        to?: EditorPosition
    ): void;
}

function hasAdjacentBlankLine(lines: string[], insertLine: number): boolean {
    const nextLine = lines[insertLine];
    const previousLine = insertLine > 0
        ? lines[insertLine - 1]
        : undefined;

    return Boolean(
        (nextLine !== undefined && nextLine.trim() === '')
        || (previousLine !== undefined && previousLine.trim() === '')
    );
}

export function insertHeadingAtLine(
    markdown: string,
    insertLine: number,
    headingLevel: number,
    title: string = '新建标题'
): string {
    const lines = splitMarkdownLines(markdown);
    const safeInsertLine = Math.max(0, Math.min(insertLine, lines.length));
    const nextLines = [...lines];
    const headingLine = createHeadingLine(headingLevel, title);

    if (hasAdjacentBlankLine(nextLines, safeInsertLine)) {
        nextLines.splice(safeInsertLine, 0, headingLine);
    } else {
        nextLines.splice(safeInsertLine, 0, headingLine, '');
    }

    return nextLines.join('\n');
}

export function insertHeadingInEditorAtLine(
    editor: MarkdownLineEditor,
    insertLine: number,
    headingLevel: number,
    title: string = '新建标题'
): number {
    const totalLines = Math.max(editor.lineCount(), 1);
    const safeInsertLine = Math.max(0, insertLine);
    const headingLine = createHeadingLine(headingLevel, title);

    if (safeInsertLine < totalLines) {
        const previousLineText = safeInsertLine > 0
            ? editor.getLine(safeInsertLine - 1) ?? ''
            : '';
        const nextLineText = editor.getLine(safeInsertLine) ?? '';
        const hasAdjacentBlank = previousLineText.trim() === ''
            || nextLineText.trim() === '';
        const suffix = hasAdjacentBlank ? '\n' : '\n\n';

        editor.replaceRange(`${headingLine}${suffix}`, {
            line: safeInsertLine,
            ch: 0
        });
        return safeInsertLine;
    }

    const lastLineIndex = totalLines - 1;
    const lastLineText = editor.getLine(lastLineIndex) ?? '';
    const leadingBreak = lastLineText.length > 0 ? '\n' : '';

    editor.replaceRange(`${leadingBreak}${headingLine}\n`, {
        line: lastLineIndex,
        ch: lastLineText.length
    });

    return lastLineText.length > 0 ? totalLines : lastLineIndex;
}

export function insertHeadingInEditorBodyAtLine(
    editor: MarkdownLineEditor,
    bodyInsertLine: number,
    bodyStartLine: number,
    headingLevel: number,
    title: string = '新建标题'
): number {
    const editorInsertedLine = insertHeadingInEditorAtLine(
        editor,
        bodyStartLine + bodyInsertLine,
        headingLevel,
        title
    );

    return Math.max(0, editorInsertedLine - bodyStartLine);
}

export function replaceMarkdownLineRange(
    markdown: string,
    startLine: number,
    endLine: number,
    replacement: string
): string {
    const lines = splitMarkdownLines(markdown);
    const safeStartLine = Math.max(0, Math.min(startLine, lines.length));
    const safeEndLine = Math.max(safeStartLine - 1, Math.min(endLine, lines.length - 1));
    const deleteCount = safeEndLine >= safeStartLine
        ? safeEndLine - safeStartLine + 1
        : 0;
    const replacementLines = replacement === ''
        ? []
        : replacement.split('\n');

    lines.splice(safeStartLine, deleteCount, ...replacementLines);
    return lines.join('\n');
}

export function readMarkdownLineRange(
    markdown: string,
    startLine: number,
    endLine: number
): string {
    const lines = splitMarkdownLines(markdown);
    const safeStartLine = Math.max(0, Math.min(startLine, lines.length));
    const safeEndLine = Math.max(safeStartLine - 1, Math.min(endLine, lines.length - 1));

    if (safeEndLine < safeStartLine) {
        return '';
    }

    return lines.slice(safeStartLine, safeEndLine + 1).join('\n');
}

export interface MarkdownEditorReplacement {
    replacement: string;
    from: EditorPosition;
    to: EditorPosition;
}

export function createMarkdownEditorReplacement(
    fullMarkdown: string,
    bodyStartLine: number,
    startLine: number,
    endLine: number,
    replacement: string
): MarkdownEditorReplacement {
    const fullLines = splitMarkdownLines(fullMarkdown);
    const fromLine = bodyStartLine + startLine;
    const toLineExclusive = bodyStartLine + endLine + 1;
    const hasContentAfter = toLineExclusive < fullLines.length;

    if (endLine < startLine) {
        if (hasContentAfter) {
            return {
                replacement: replacement.length > 0 && !replacement.endsWith('\n')
                    ? `${replacement}\n`
                    : replacement,
                from: { line: fromLine, ch: 0 },
                to: { line: fromLine, ch: 0 }
            };
        }

        const anchorLine = Math.max(0, Math.min(fullLines.length - 1, fromLine - 1));
        const anchorCh = fullLines[anchorLine]?.length ?? 0;
        return {
            replacement: replacement ? `\n${replacement}` : replacement,
            from: { line: anchorLine, ch: anchorCh },
            to: { line: anchorLine, ch: anchorCh }
        };
    }

    const normalizedReplacement = hasContentAfter &&
        replacement.length > 0 &&
        !replacement.endsWith('\n')
        ? `${replacement}\n`
        : replacement;

    if (hasContentAfter) {
        return {
            replacement: normalizedReplacement,
            from: { line: fromLine, ch: 0 },
            to: { line: toLineExclusive, ch: 0 }
        };
    }

    const finalLine = bodyStartLine + endLine;
    return {
        replacement,
        from: { line: fromLine, ch: 0 },
        to: {
            line: finalLine,
            ch: fullLines[finalLine]?.length ?? 0
        }
    };
}

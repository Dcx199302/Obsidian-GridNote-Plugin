export interface MarkdownContentSections {
    frontmatter: string;
    body: string;
    bodyStartLine: number;
    hasFrontmatter: boolean;
}

export interface PrefaceCompositeSections {
    frontmatter: string;
    preface: string;
    hasFrontmatter: boolean;
}

interface FrontmatterBoundary {
    frontmatter: string;
    contentStart: number;
    contentStartLine: number;
}

function isFrontmatterDelimiter(line: string): boolean {
    const withoutCr = line.endsWith('\r')
        ? line.slice(0, -1)
        : line;

    // YAML frontmatter 分隔符必须从第 0 列开始；缩进的 --- 可以出现在块标量内部。
    return withoutCr.trimEnd() === '---';
}

function findFrontmatterBoundary(content: string): FrontmatterBoundary | null {
    let lineStart = 0;
    let lineIndex = 0;

    while (lineStart < content.length) {
        const newlineIndex = content.indexOf('\n', lineStart);
        const lineEnd = newlineIndex === -1
            ? content.length
            : newlineIndex;
        const line = content.slice(lineStart, lineEnd);

        if (lineIndex === 0 && !isFrontmatterDelimiter(line)) {
            return null;
        }

        if (lineIndex > 0 && isFrontmatterDelimiter(line)) {
            return {
                frontmatter: content.slice(
                    0,
                    line.endsWith('\r') ? lineEnd - 1 : lineEnd
                ),
                contentStart: newlineIndex === -1
                    ? content.length
                    : newlineIndex + 1,
                contentStartLine: lineIndex + 1
            };
        }

        if (newlineIndex === -1) {
            return null;
        }

        lineStart = newlineIndex + 1;
        lineIndex += 1;
    }

    return null;
}

export function splitMarkdownContent(
    content: string,
    _cache: unknown = null
): MarkdownContentSections {
    const boundary = findFrontmatterBoundary(content);
    if (!boundary) {
        return {
            frontmatter: '',
            body: content,
            bodyStartLine: 0,
            hasFrontmatter: false
        };
    }

    return {
        frontmatter: boundary.frontmatter,
        body: content.slice(boundary.contentStart),
        bodyStartLine: boundary.contentStartLine,
        hasFrontmatter: true
    };
}

export function joinMarkdownContent(
    sections: MarkdownContentSections,
    body: string
): string {
    if (!sections.hasFrontmatter) {
        return body;
    }

    if (body === '') {
        return sections.frontmatter;
    }

    return `${sections.frontmatter}\n${body}`;
}

export function splitPrefaceCompositeContent(
    content: string
): PrefaceCompositeSections {
    const boundary = findFrontmatterBoundary(content);
    if (!boundary) {
        return {
            frontmatter: '',
            preface: content,
            hasFrontmatter: false
        };
    }

    return {
        frontmatter: boundary.frontmatter,
        preface: content.slice(boundary.contentStart),
        hasFrontmatter: true
    };
}

export function joinFrontmatterAndBody(
    frontmatter: string,
    body: string
): string {
    if (frontmatter === '') {
        return body;
    }

    if (body === '') {
        return frontmatter;
    }

    return `${frontmatter}\n${body}`;
}

export function getFrontmatterBodyStartLine(frontmatter: string): number {
    if (frontmatter === '') {
        return 0;
    }

    return frontmatter.split('\n').length;
}

export function stripFrontmatterFromMarkdown(
    content: string,
    cache: unknown = null
): string {
    return splitMarkdownContent(content, cache).body;
}

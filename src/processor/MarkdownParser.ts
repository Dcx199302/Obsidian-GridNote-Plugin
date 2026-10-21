/**
 * Markdown 解析器
 * 提供纯静态方法用于解析 Markdown 文档
 */

import type { RawBlock, HeadingInfo } from '../types/document';

/**
 * 代码块状态
 */
interface CodeBlockState {
    isInCodeBlock: boolean;
    fence: string;  // '`' 或 '~'
    fenceLength: number;
}

/**
 * Markdown 解析器类
 * 所有方法都是静态的，不维护状态
 */
export class MarkdownParser {
    /**
     * 检测行是否是代码块边界
     *
     * @param line - 要检测的行
     * @param state - 当前代码块状态
     * @returns 更新后的代码块状态
     */
    static detectCodeBlockTransition(line: string, state: CodeBlockState): CodeBlockState {
        const trimmedLine = line.trim();

        // 检测代码块边界标记（3个或更多的 ` 或 ~）
        const fenceMatch = trimmedLine.match(/^(`{3,}|~{3,})/);

        if (!fenceMatch || !fenceMatch[1]) {
            return state;
        }

        const fenceStr = fenceMatch[1];
        const fence = fenceStr[0] ?? '';
        const fenceLength = fenceStr.length;

        // 如果当前在代码块内
        if (state.isInCodeBlock) {
            // 检查是否是匹配的闭合标记（同类型、等长或更长）
            if (fence === state.fence && fenceLength >= state.fenceLength) {
                return {
                    isInCodeBlock: false,
                    fence: '',
                    fenceLength: 0
                };
            }
        } else {
            // 不在代码块内，这是开始标记
            return {
                isInCodeBlock: true,
                fence: fence,
                fenceLength: fenceLength
            };
        }

        return state;
    }

    /**
     * 解析标题行
     *
     * @param line - 要解析的行
     * @param lineIndex - 行号（0-based）
     * @returns HeadingInfo 对象，如果不是标题则返回 null
     */
    static parseHeading(line: string, lineIndex: number): HeadingInfo | null {
        // 兼容 Obsidian 常见 ATX 标题写法：
        // 1. 必须顶格（不允许前置空格）
        // 2. # 后允许仅空白（空标题），或空白 + 文本
        // 3. 支持可选的尾部闭合 #（例如 "## Title ##"）
        const headingMatch = line.match(/^(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/);

        if (!headingMatch || !headingMatch[1]) {
            return null;
        }

        const level = headingMatch[1].length;
        const rawText = (headingMatch[2] ?? '').trim();
        const normalizedText = rawText.replace(/[ \t]+#+[ \t]*$/, '').trim();
        const text = /^#+$/.test(rawText) ? '' : normalizedText;

        return {
            level,
            text,
            line: lineIndex
        };
    }

    /**
     * 将 Markdown 文本分割为原始块
     * 每个块要么以标题开始，要么是连续的非标题内容
     *
     * @param text - Markdown 文本
     * @returns 原始块数组
     */
    static splitIntoBlocks(text: string): RawBlock[] {
        const lines = text.split('\n');
        const blocks: RawBlock[] = [];

        // 初始化代码块状态
        let codeBlockState: CodeBlockState = {
            isInCodeBlock: false,
            fence: '',
            fenceLength: 0
        };

        let currentBlock: RawBlock | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? '';

            // 检测代码块状态变化
            const previousInCodeBlock = codeBlockState.isInCodeBlock;
            codeBlockState = this.detectCodeBlockTransition(line, codeBlockState);

            // 如果在代码块内，将行添加到当前块（不检测标题）
            if (codeBlockState.isInCodeBlock || previousInCodeBlock) {
                if (currentBlock) {
                    currentBlock.text += '\n' + line;
                    currentBlock.endLine = i;
                } else {
                    // 不在块中，创建新块（非标题内容）
                    currentBlock = {
                        text: line,
                        startLine: i,
                        endLine: i,
                        heading: null
                    };
                }
                continue;
            }

            // 尝试解析标题
            const heading = this.parseHeading(line, i);

            if (heading) {
                // 这是一个标题行
                // 如果有当前块，保存它
                if (currentBlock) {
                    blocks.push(currentBlock);
                }
                // 开始新块
                currentBlock = {
                    text: line,
                    startLine: i,
                    endLine: i,
                    heading: heading
                };
            } else {
                // 非标题行
                if (currentBlock) {
                    // 添加到当前块
                    currentBlock.text += '\n' + line;
                    currentBlock.endLine = i;
                } else {
                    // 不在块中，创建新块（文档开头的非标题内容）
                    currentBlock = {
                        text: line,
                        startLine: i,
                        endLine: i,
                        heading: null
                    };
                }
            }
        }

        // 保存最后一个块
        if (currentBlock) {
            blocks.push(currentBlock);
        }

        return blocks;
    }

    /**
     * 处理未闭合的代码块
     * 如果文档在代码块内结束，需要正确处理
     *
     * @param blocks - 原始块数组
     * @returns 处理后的块数组
     */
    static handleUnclosedCodeBlocks(blocks: RawBlock[]): RawBlock[] {
        // 检查最后一个块是否包含未闭合的代码块
        if (blocks.length === 0) return blocks;

        const lastBlock = blocks[blocks.length - 1];
        if (!lastBlock) return blocks;

        let codeBlockState: CodeBlockState = {
            isInCodeBlock: false,
            fence: '',
            fenceLength: 0
        };

        // 重新扫描最后一个块以检测代码块状态
        const lines = lastBlock.text.split('\n');
        for (const line of lines) {
            codeBlockState = this.detectCodeBlockTransition(line, codeBlockState);
        }

        // 如果未闭合，不需要特殊处理，因为内容已经正确包含在块中
        // 只是记录状态（可以用于警告用户）
        if (codeBlockState.isInCodeBlock) {
            console.warn('MarkdownParser: Document ends with unclosed code block');
        }

        return blocks;
    }

    /**
     * 提取块的内容部分（不含标题行）
     *
     * @param block - 原始块
     * @returns 内容字符串，如果没有内容则返回 null
     */
    static extractBlockContent(block: RawBlock): string | null {
        if (!block.heading) {
            // 没有标题，整个文本就是内容
            return block.text || null;
        }

        // 有标题，提取标题之后的内容
        const lines = block.text.split('\n');
        if (lines.length <= 1) {
            return null;
        }

        const content = lines.slice(1).join('\n');
        return content.trim() || null;
    }

    /**
     * 获取块的内容范围（不含标题行）
     *
     * @param block - 原始块
     * @returns 内容的行范围
     */
    static getContentRange(block: RawBlock): { startLine: number; endLine: number } {
        if (!block.heading) {
            // 没有标题，范围就是整个块
            return {
                startLine: block.startLine,
                endLine: block.endLine
            };
        }

        // 有标题，内容从标题下一行开始
        const contentStartLine = block.startLine + 1;

        // 如果只有标题行，没有内容
        if (contentStartLine > block.endLine) {
            return {
                startLine: contentStartLine,
                endLine: contentStartLine - 1  // 无效范围
            };
        }

        return {
            startLine: contentStartLine,
            endLine: block.endLine
        };
    }
}

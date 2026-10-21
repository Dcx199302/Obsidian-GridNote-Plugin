/**
 * Markdown 文档处理器
 * 负责解析文档、管理结构、提供查询和编辑 API
 */

import type {
    DocumentNode,
    DocumentStructure,
    NodeId,
    LineRange,
    EditResult,
    InsertPosition
} from '../types/document';
import { nodeIdToString, isRootNode } from '../types/document';
import { MarkdownParser } from './MarkdownParser';
import { generateContentHash } from '../utils/hash';

/**
 * Markdown 文档处理器类
 */
export class MarkdownDocumentProcessor {
    private currentStructure: DocumentStructure | null = null;
    private version: number = 0;

    /**
     * 解析 Markdown 文本
     *
     * @param text - Markdown 文本
     * @returns 文档结构
     */
    parse(text: string): DocumentStructure {
        this.version++;

        const lines = text.split('\n');
        const totalLines = lines.length;

        // 分割为原始块
        let blocks = MarkdownParser.splitIntoBlocks(text);
        blocks = MarkdownParser.handleUnclosedCodeBlocks(blocks);

        // 创建根节点
        const root = this.createRootNode(totalLines);

        // 使用栈来维护当前的父节点链
        const stack: DocumentNode[] = [root];

        // 扁平索引
        const flatIndex = new Map<string, DocumentNode>();
        // 起始行号索引
        const startLineIndex = new Map<number, DocumentNode>();
        // 行号索引
        const lineIndex: DocumentNode[] = [];

        let sequence = 0;

        // 处理每个块
        for (const block of blocks) {
            if (!block) continue;

            if (block.heading) {
                // 这是一个标题块
                const heading = block.heading;

                // 找到正确的父节点（层级比当前标题小）
                while (
                    stack.length > 1 &&
                    stack[stack.length - 1] &&
                    stack[stack.length - 1]!.heading !== null &&
                    stack[stack.length - 1]!.heading!.level >= heading.level
                ) {
                    stack.pop();
                }

                const parent = stack[stack.length - 1];
                if (!parent) continue;

                // 提取内容
                const content = MarkdownParser.extractBlockContent(block);
                const contentRange = MarkdownParser.getContentRange(block);

                // 创建节点
                const node = this.createNode({
                    heading,
                    content,
                    fullText: block.text,
                    range: {
                        startLine: block.startLine,
                        endLine: block.endLine
                    },
                    contentRange,
                    parent,
                    indexInParent: parent.children.length,
                    depth: parent.depth + 1,
                    version: this.version,
                    sequence: sequence++
                });

                // 添加到父节点
                parent.children.push(node);

                    // 更新索引
                    flatIndex.set(nodeIdToString(node.id), node);
                    startLineIndex.set(node.range.startLine, node);
                    lineIndex.push(node);

                // 压入栈（作为后续可能的子节点的父节点）
                stack.push(node);
            } else {
                // 非标题内容，附加到当前节点
                const current = stack[stack.length - 1];
                if (!current) continue;

                if (current.content) {
                    current.content += '\n' + block.text;
                } else {
                    current.content = block.text;
                }

                // 更新内容范围
                current.contentRange.endLine = block.endLine;
                current.range.endLine = block.endLine;

                // 更新 fullText
                if (current.fullText) {
                    current.fullText += '\n' + block.text;
                } else {
                    current.fullText = block.text;
                }
            }
        }

        // 计算所有节点的最终范围（考虑子节点）
        this.calculateFinalRanges(root, totalLines);

        // 构建行号索引（按起始行排序）
        lineIndex.sort((a, b) => a.range.startLine - b.range.startLine);

        this.currentStructure = {
            root,
            flatIndex,
            startLineIndex,
            lineIndex,
            version: this.version,
            rawText: text,
            totalLines
        };

        return this.currentStructure;
    }

    /**
     * 更新文档（全量重新解析）
     *
     * @param newText - 新的 Markdown 文本
     * @returns 新的文档结构
     */
    update(newText: string): DocumentStructure {
        return this.parse(newText);
    }

    /**
     * 获取当前文档结构
     */
    getStructure(): DocumentStructure | null {
        return this.currentStructure;
    }

    // ==================== 查询方法 ====================

    /**
     * 通过 ID 获取节点
     */
    getNodeById(id: NodeId): DocumentNode | null {
        if (!this.currentStructure) return null;
        return this.currentStructure.flatIndex.get(nodeIdToString(id)) ?? null;
    }

    /**
     * 通过行号获取节点
     */
    getNodeAtLine(line: number): DocumentNode | null {
        if (!this.currentStructure) return null;

        // 在行号索引中二分查找
        const { lineIndex } = this.currentStructure;
        let low = 0;
        let high = lineIndex.length - 1;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const node = lineIndex[mid];

            if (!node) {
                if (mid === low) break;
                high = mid - 1;
                continue;
            }

            if (line >= node.range.startLine && line <= node.range.endLine) {
                return node;
            } else if (line < node.range.startLine) {
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }

        return null;
    }

    /**
     * 通过起始行号获取当前版本中的节点
     */
    getNodeByStartLine(startLine: number): DocumentNode | null {
        if (!this.currentStructure) return null;
        return this.currentStructure.startLineIndex.get(startLine) ?? null;
    }

    /**
     * 获取节点的完整范围（含所有子节点）
     */
    getNodeFullRange(node: DocumentNode): LineRange {
        if (node.children.length === 0) {
            return node.range;
        }

        // 递归获取最后一个子节点的范围
        const lastChild = node.children[node.children.length - 1];
        if (!lastChild) {
            return node.range;
        }

        const lastChildRange = this.getNodeFullRange(lastChild);

        return {
            startLine: node.range.startLine,
            endLine: Math.max(node.range.endLine, lastChildRange.endLine)
        };
    }

    // ==================== 导航方法 ====================

    /**
     * 获取所有兄弟节点（包括自己）
     */
    getSiblings(node: DocumentNode): DocumentNode[] {
        if (!node.parent) return [node];
        return node.parent.children;
    }

    /**
     * 获取前一个兄弟节点
     */
    getPreviousSibling(node: DocumentNode): DocumentNode | null {
        if (!node.parent || node.indexInParent === 0) return null;
        return node.parent.children[node.indexInParent - 1] ?? null;
    }

    /**
     * 获取后一个兄弟节点
     */
    getNextSibling(node: DocumentNode): DocumentNode | null {
        if (!node.parent) return null;
        if (node.indexInParent >= node.parent.children.length - 1) return null;
        return node.parent.children[node.indexInParent + 1] ?? null;
    }

    /**
     * 获取第一个子节点
     */
    getFirstChild(node: DocumentNode): DocumentNode | null {
        return node.children[0] ?? null;
    }

    /**
     * 获取最后一个子节点
     */
    getLastChild(node: DocumentNode): DocumentNode | null {
        return node.children[node.children.length - 1] ?? null;
    }

    /**
     * 获取父节点
     */
    getParent(node: DocumentNode): DocumentNode | null {
        return node.parent;
    }

    // ==================== 范围识别方法 ====================

    /**
     * 获取标题行号
     */
    getTitleLine(node: DocumentNode): number | null {
        return node.heading?.line ?? null;
    }

    /**
     * 获取内容起始行号
     */
    getContentStartLine(node: DocumentNode): number {
        return node.contentRange.startLine;
    }

    /**
     * 获取内容结束行号
     */
    getContentEndLine(node: DocumentNode): number {
        return node.contentRange.endLine;
    }

    /**
     * 获取插入子节点的位置（行号）
     * 返回在所有子节点之后的位置
     */
    getChildInsertPosition(parentNode: DocumentNode): number {
        if (parentNode.children.length === 0) {
            // 没有子节点，在父节点内容之后插入
            return parentNode.range.endLine + 1;
        }

        // 有子节点，在最后一个子节点之后插入
        const lastChild = this.getLastChild(parentNode);
        if (lastChild) {
            const lastChildRange = this.getNodeFullRange(lastChild);
            return lastChildRange.endLine + 1;
        }

        return parentNode.range.endLine + 1;
    }

    /**
     * 获取插入兄弟节点的位置（行号）
     */
    getSiblingInsertPosition(node: DocumentNode, position: 'before' | 'after'): number {
        if (position === 'before') {
            return node.range.startLine;
        } else {
            const fullRange = this.getNodeFullRange(node);
            return fullRange.endLine + 1;
        }
    }

    // ==================== 编辑方法 ====================

    /**
     * 插入节点
     */
    insertNode(options: {
        targetId: NodeId;
        position: InsertPosition;
        content: string;
        headingLevel?: number;
    }): EditResult {
        const { targetId, position, content, headingLevel } = options;

        if (!this.currentStructure) {
            return this.createErrorResult('No document loaded');
        }

        const targetNode = this.getNodeById(targetId);
        if (!targetNode) {
            return this.createErrorResult('Target node not found');
        }

        const lines = this.currentStructure.rawText.split('\n');
        let insertLine: number;

        // 确定插入位置
        switch (position) {
            case 'before':
                insertLine = this.getSiblingInsertPosition(targetNode, 'before');
                break;
            case 'after':
                insertLine = this.getSiblingInsertPosition(targetNode, 'after');
                break;
            case 'first-child':
                insertLine = targetNode.children.length > 0
                    ? targetNode.children[0]!.range.startLine
                    : this.getChildInsertPosition(targetNode);
                break;
            case 'last-child':
                insertLine = this.getChildInsertPosition(targetNode);
                break;
            default:
                return this.createErrorResult('Invalid position');
        }

        // 构建要插入的文本
        let textToInsert: string;
        if (headingLevel && headingLevel >= 1 && headingLevel <= 6) {
            const prefix = '#'.repeat(headingLevel);
            textToInsert = `${prefix} ${content}`;
        } else {
            textToInsert = content;
        }

        // 插入文本
        lines.splice(insertLine, 0, textToInsert);
        const newText = lines.join('\n');

        // 重新解析
        const newStructure = this.update(newText);

        return {
            success: true,
            newText,
            newStructure,
            affectedNodes: []
        };
    }

    /**
     * 更新标题
     */
    updateTitle(nodeId: NodeId, newTitle: string): EditResult {
        if (!this.currentStructure) {
            return this.createErrorResult('No document loaded');
        }

        const node = this.getNodeById(nodeId);
        if (!node) {
            return this.createErrorResult('Node not found');
        }

        if (!node.heading) {
            return this.createErrorResult('Node has no heading');
        }

        const lines = this.currentStructure.rawText.split('\n');
        const titleLine = node.heading.line;

        // 构建新的标题行
        const prefix = '#'.repeat(node.heading.level);
        lines[titleLine] = `${prefix} ${newTitle}`;

        const newText = lines.join('\n');
        const newStructure = this.update(newText);

        return {
            success: true,
            newText,
            newStructure,
            affectedNodes: [node]
        };
    }

    /**
     * 更新内容
     */
    updateContent(nodeId: NodeId, newContent: string): EditResult {
        if (!this.currentStructure) {
            return this.createErrorResult('No document loaded');
        }

        const node = this.getNodeById(nodeId);
        if (!node) {
            return this.createErrorResult('Node not found');
        }

        const lines = this.currentStructure.rawText.split('\n');

        // 计算内容范围
        const contentStart = node.contentRange.startLine;
        const contentEnd = node.contentRange.endLine;

        // 检查是否有有效的内容范围
        if (contentStart > contentEnd) {
            // 没有内容，需要在标题后插入
            if (node.heading) {
                const newLines = newContent.split('\n');
                lines.splice(contentStart, 0, ...newLines);
            }
        } else {
            // 替换现有内容
            const newLines = newContent.split('\n');
            lines.splice(contentStart, contentEnd - contentStart + 1, ...newLines);
        }

        const newText = lines.join('\n');
        const newStructure = this.update(newText);

        return {
            success: true,
            newText,
            newStructure,
            affectedNodes: [node]
        };
    }

    /**
     * 删除节点
     */
    deleteNode(nodeId: NodeId, includeChildren: boolean = true): EditResult {
        if (!this.currentStructure) {
            return this.createErrorResult('No document loaded');
        }

        const node = this.getNodeById(nodeId);
        if (!node) {
            return this.createErrorResult('Node not found');
        }

        // 不能删除根节点
        if (isRootNode(node)) {
            return this.createErrorResult('Cannot delete root node');
        }

        const lines = this.currentStructure.rawText.split('\n');

        // 计算要删除的范围
        const range = includeChildren
            ? this.getNodeFullRange(node)
            : node.range;

        // 删除行
        lines.splice(range.startLine, range.endLine - range.startLine + 1);

        const newText = lines.join('\n');
        const newStructure = this.update(newText);

        return {
            success: true,
            newText,
            newStructure,
            affectedNodes: [node]
        };
    }

    // ==================== 私有辅助方法 ====================

    /**
     * 创建根节点
     */
    private createRootNode(totalLines: number): DocumentNode {
        return {
            id: {
                contentHash: 'root',
                version: this.version,
                sequence: 0
            },
            heading: null,
            content: null,
            fullText: '',
            range: {
                startLine: 0,
                endLine: Math.max(0, totalLines - 1)
            },
            contentRange: {
                startLine: 0,
                endLine: Math.max(0, totalLines - 1)
            },
            children: [],
            parent: null,
            indexInParent: 0,
            depth: 0
        };
    }

    /**
     * 创建普通节点
     */
    private createNode(options: {
        heading: { level: number; text: string; line: number } | null;
        content: string | null;
        fullText: string;
        range: LineRange;
        contentRange: LineRange;
        parent: DocumentNode;
        indexInParent: number;
        depth: number;
        version: number;
        sequence: number;
    }): DocumentNode {
        const {
            heading,
            content,
            fullText,
            range,
            contentRange,
            parent,
            indexInParent,
            depth,
            version,
            sequence
        } = options;

        const contentHash = generateContentHash(
            heading?.text ?? null,
            content
        );

        return {
            id: {
                contentHash,
                version,
                sequence
            },
            heading,
            content,
            fullText,
            range,
            contentRange,
            children: [],
            parent,
            indexInParent,
            depth
        };
    }

    /**
     * 计算所有节点的最终范围（考虑子节点和下一个兄弟）
     */
    private calculateFinalRanges(node: DocumentNode, totalLines: number): void {
        // 先递归处理子节点
        for (const child of node.children) {
            if (child) {
                this.calculateFinalRanges(child, totalLines);
            }
        }

        // 如果没有子节点，范围已经正确
        if (node.children.length === 0) {
            return;
        }

        // 更新范围以包含所有子节点
        const lastChild = node.children[node.children.length - 1];
        if (lastChild) {
            node.range.endLine = Math.max(node.range.endLine, lastChild.range.endLine);
        }

        // 处理子节点之间的范围边界
        for (let i = 0; i < node.children.length - 1; i++) {
            const current = node.children[i];
            const next = node.children[i + 1];

            if (!current || !next) continue;

            // 当前节点的结束行应该是下一个节点的开始行 - 1
            current.range.endLine = next.range.startLine - 1;

            // 递归更新当前节点的子节点
            this.updateChildRanges(current);
        }

        // 处理最后一个子节点
        const lastChildNode = node.children[node.children.length - 1];
        if (lastChildNode) {
            // 如果有下一个兄弟，结束行是下一个兄弟的开始行 - 1
            // 否则，结束行保持不变（到文档末尾或父节点内容末尾）
            if (node.parent) {
                const parentChildren = node.parent.children;
                const nodeIndex = parentChildren.indexOf(node);
                if (nodeIndex >= 0 && nodeIndex < parentChildren.length - 1) {
                    const nextSibling = parentChildren[nodeIndex + 1];
                    if (nextSibling) {
                        lastChildNode.range.endLine = Math.min(
                            lastChildNode.range.endLine,
                            nextSibling.range.startLine - 1
                        );
                    }
                }
            }
        }
    }

    /**
     * 递归更新子节点的范围
     */
    private updateChildRanges(node: DocumentNode): void {
        for (let i = 0; i < node.children.length - 1; i++) {
            const current = node.children[i];
            const next = node.children[i + 1];

            if (!current || !next) continue;

            // 更新结束行
            const newEndLine = next.range.startLine - 1;
            if (current.range.endLine > newEndLine) {
                current.range.endLine = newEndLine;
            }

            // 递归处理
            this.updateChildRanges(current);
        }

        // 处理最后一个子节点
        if (node.children.length > 0) {
            const lastChild = node.children[node.children.length - 1];
            if (lastChild) {
                // 最后一子节点的结束行不应超过父节点的结束行
                if (lastChild.range.endLine > node.range.endLine) {
                    lastChild.range.endLine = node.range.endLine;
                }
                this.updateChildRanges(lastChild);
            }
        }
    }

    /**
     * 创建错误结果
     */
    private createErrorResult(error: string): EditResult {
        return {
            success: false,
            newText: this.currentStructure?.rawText ?? '',
            newStructure: this.currentStructure!,
            affectedNodes: [],
            error
        };
    }
}

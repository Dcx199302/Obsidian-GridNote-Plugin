/**
 * Markdown 文档处理工具 - 核心类型定义
 */

/**
 * 节点解析期 ID
 * - 仅保证单次解析内唯一
 * - 不作为跨外部更新的稳定节点身份
 * - contentHash/version/sequence 主要服务于解析期索引和内部调试
 */
export interface NodeId {
    contentHash: string;
    version: number;
    sequence: number;
}

/**
 * 行范围（0-based）
 */
export interface LineRange {
    startLine: number;
    endLine: number;
}

/**
 * 标题信息
 */
export interface HeadingInfo {
    level: number;      // 1-6
    text: string;       // 不含 # 符号
    line: number;       // 行号（0-based）
}

/**
 * 原始块（解析中间产物）
 */
export interface RawBlock {
    text: string;
    startLine: number;
    endLine: number;
    heading: HeadingInfo | null;
}

/**
 * 文档节点
 */
export interface DocumentNode {
    /** 解析期临时标识，不是稳定主键 */
    id: NodeId;
    /** 标题信息（如果没有标题则为 null） */
    heading: HeadingInfo | null;
    /** 内容（不含标题行，如果没有内容则为 null） */
    content: string | null;
    /** 完整文本（包含标题行和内容） */
    fullText: string;
    /** 完整范围（含标题行） */
    range: LineRange;
    /** 内容范围（不含标题行） */
    contentRange: LineRange;
    /** 子节点 */
    children: DocumentNode[];
    /** 父节点（根节点为 null） */
    parent: DocumentNode | null;
    /** 在父节点中的索引位置 */
    indexInParent: number;
    /** 树深度（根节点为 0） */
    depth: number;
}

/**
 * 文档结构
 */
export interface DocumentStructure {
    /** 根节点（虚拟节点，代表整个文档） */
    root: DocumentNode;
    /** 解析期 ID -> Node 的扁平索引 */
    flatIndex: Map<string, DocumentNode>;
    /** 当前版本中以起始行号定位的索引 */
    startLineIndex: Map<number, DocumentNode>;
    /** 按行号排序的节点数组 */
    lineIndex: DocumentNode[];
    /** 文档版本号 */
    version: number;
    /** 当前参与树解析的原始文本，是视图层的内容真源 */
    rawText: string;
    /** 总行数 */
    totalLines: number;
}

/**
 * 插入位置类型
 */
export type InsertPosition = 'before' | 'after' | 'first-child' | 'last-child';

/**
 * 编辑操作
 */
export interface EditOperation {
    type: 'insert' | 'update-title' | 'update-content' | 'delete';
    targetId?: NodeId;
    position?: InsertPosition;
    content?: string;
    headingLevel?: number;
    includeChildren?: boolean;
}

/**
 * 编辑结果
 */
export interface EditResult {
    success: boolean;
    newText: string;
    newStructure: DocumentStructure;
    affectedNodes: DocumentNode[];
    error?: string;
}

/**
 * 创建节点 ID 的字符串表示（用于 Map key）
 */
export function nodeIdToString(id: NodeId): string {
    return `${id.contentHash}:${id.version}:${id.sequence}`;
}

/**
 * 当前版本内的节点行号键
 * - 标题节点优先使用标题行
 * - 其他节点使用块起始行
 */
export function getNodeLineKey(node: Pick<DocumentNode, 'heading' | 'range'>): string {
    if (node.heading) {
        return `heading:${node.heading.line}`;
    }

    return `content:${node.range.startLine}`;
}

/**
 * 创建空节点 ID
 */
export function createEmptyNodeId(): NodeId {
    return {
        contentHash: '',
        version: 0,
        sequence: 0
    };
}

/**
 * 检查是否为根节点
 */
export function isRootNode(node: DocumentNode): boolean {
    return node.parent === null && node.heading === null;
}

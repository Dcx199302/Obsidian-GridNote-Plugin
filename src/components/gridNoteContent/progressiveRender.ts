export function resolveProgressiveBatchSize(totalNodeCount: number): number {
    // 根节点会被 CascadeVirtualBranch 二级虚拟化，真正内容按视口挂载。
    // 大文件按总量提高一级节点装载数，避免快速滚动长时间停留在占位区。
    return Math.min(
        36,
        Math.max(4, Math.ceil(totalNodeCount / 10))
    );
}

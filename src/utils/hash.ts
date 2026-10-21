/**
 * 哈希工具
 * 使用 cyrb53 算法 - 轻量级、高质量的哈希函数
 */

/**
 * cyrb53 哈希函数
 * 基于 https://stackoverflow.com/a/52171480
 *
 * @param str - 要哈希的字符串
 * @param seed - 可选的种子值（默认为 0）
 * @returns 53 位哈希值的字符串表示
 */
export function cyrb53(str: string, seed: number = 0): string {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;

    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    // 返回 53 位整数作为字符串
    return ((h2 >>> 0) * 2097152 + (h1 >>> 0)).toString(16);
}

/**
 * 生成内容哈希
 * 基于标题文本和内容的前 100 个字符生成哈希
 *
 * @param headingText - 标题文本（不含 # 符号），可为 null
 * @param content - 内容文本，可为 null
 * @returns 哈希字符串
 */
export function generateContentHash(headingText: string | null, content: string | null): string {
    const headingPart = headingText ?? '';
    const contentPart = content?.slice(0, 100) ?? '';
    const combined = `${headingPart}|${contentPart}`;
    return cyrb53(combined);
}

/**
 * 生成简单 ID（用于临时标识）
 *
 * @param prefix - ID 前缀
 * @returns 带前缀的唯一 ID
 */
export function generateSimpleId(prefix: string = 'node'): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${timestamp}_${random}`;
}

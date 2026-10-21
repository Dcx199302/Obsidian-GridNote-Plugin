/**
 * 搜索高亮片段切分工具。
 * 把 text 按命中 query 的子串切成「命中/非命中」片段数组，
 * 供模板按段渲染 <mark>，避免使用 {@html}（规避 XSS）。
 */

export interface HighlightSegment {
	/** 片段文本（原样输出，不做转义，由模板负责） */
	text: string;
	/** 是否命中 query */
	hit: boolean;
}

/**
 * 将 text 按 query 命中位置切分。
 * - query 为空（trim 后）→ 返回单段非命中，覆盖整段 text
 * - 大小写不敏感子串匹配
 * - 命中片段长度等于 query.length
 *
 * @param text 待切分文本（通常是文件 basename 或文件夹名）
 * @param query 搜索关键词（已是去抖后的当前值，可为空）
 */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
	const q = (query ?? '').trim().toLowerCase();
	if (!q || !text) {
		return [{ text, hit: false }];
	}

	const lower = text.toLowerCase();
	const segments: HighlightSegment[] = [];
	let cursor = 0;
	let idx = lower.indexOf(q, cursor);

	while (idx !== -1) {
		if (idx > cursor) {
			segments.push({ text: text.slice(cursor, idx), hit: false });
		}
		segments.push({ text: text.slice(idx, idx + q.length), hit: true });
		cursor = idx + q.length;
		idx = lower.indexOf(q, cursor);
	}

	if (cursor < text.length) {
		segments.push({ text: text.slice(cursor), hit: false });
	}

	return segments.length > 0 ? segments : [{ text, hit: false }];
}

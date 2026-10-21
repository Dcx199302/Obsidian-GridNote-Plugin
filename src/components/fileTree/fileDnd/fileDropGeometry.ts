/**
 * 拖拽落点检测：移植 cardtree-bookmarks-ext (React) 的 live DOM 方案。
 * 每帧 elementsFromPoint 定位 dropzone → getDropIndexFromPoint 计算 slot，
 * stickyY / hysteresis / pointerDelta / expanded zone retention 防抖。
 */

/** 落点检测结果：目标文件夹 + 在渲染列表中的插入 index */
export interface FileDropTargetInfo {
	folderId: string;
	dropIndex: number;
}

export function clampIndex(value: number, max: number): number {
	return Math.max(0, Math.min(value, max));
}

/**
 * dropzone 内按指针位置计算插入 index（适配换行 grid）。
 * 分行(centerY) → stickyY 锁行 → 行内中心线+hysteresis 定 slot → pointerDelta 方向感知。
 */
export function getDropIndexFromPoint(
	dropZone: HTMLElement,
	x: number,
	y: number,
	previousIndex: number | null,
	pointerDelta: { dx: number; dy: number } | null,
): number {
	const items = Array.from(dropZone.querySelectorAll<HTMLElement>('[data-file-path]'));
	if (items.length === 0) return 0;

	const rects = items.map((item, index) => ({
		index,
		rect: getLayoutRect(item),
	}));
	const firstRect = rects[0]!.rect;
	const lastRect = rects[rects.length - 1]!.rect;

	if (y <= firstRect.top - 6) return 0;
	if (y >= lastRect.bottom + 6) return rects.length;

	// 分行：centerY 相近(centerRowMergeTolerance 内)视为同一行
	type Row = { start: number; end: number; top: number; bottom: number; centerY: number };
	const rows: Row[] = [];
	const indexToRow = new Map<number, number>();
	const rowMergeTolerance = 18;

	for (const entry of rects) {
		const centerY = entry.rect.top + entry.rect.height / 2;
		const rowIndex = rows.findIndex((row) => Math.abs(row.centerY - centerY) <= rowMergeTolerance);
		if (rowIndex === -1) {
			rows.push({
				start: entry.index,
				end: entry.index,
				top: entry.rect.top,
				bottom: entry.rect.bottom,
				centerY,
			});
			indexToRow.set(entry.index, rows.length - 1);
			continue;
		}
		const row = rows[rowIndex]!;
		row.start = Math.min(row.start, entry.index);
		row.end = Math.max(row.end, entry.index);
		row.top = Math.min(row.top, entry.rect.top);
		row.bottom = Math.max(row.bottom, entry.rect.bottom);
		row.centerY = (row.centerY + centerY) / 2;
		indexToRow.set(entry.index, rowIndex);
	}

	// 行选择：stickyY 锁定上一帧行，避免行间抖动
	const stickyY = 12;
	const previousAnchorIndex =
		previousIndex == null
			? null
			: clampIndex(previousIndex === rects.length ? rects.length - 1 : previousIndex, rects.length - 1);
	const previousRowIndex = previousAnchorIndex == null ? null : (indexToRow.get(previousAnchorIndex) ?? null);

	let activeRow: Row | null = null;
	if (previousRowIndex != null) {
		const prevRow = rows[previousRowIndex]!;
		if (y >= prevRow.top - stickyY && y <= prevRow.bottom + stickyY) {
			activeRow = prevRow;
		}
	}

	if (!activeRow) {
		activeRow = rows[0]!;
		let bestDistance = Infinity;
		for (const row of rows) {
			const distance = y < row.top ? row.top - y : y > row.bottom ? y - row.bottom : 0;
			if (distance < bestDistance) {
				bestDistance = distance;
				activeRow = row;
			}
		}
	}

	// 行内 slot：中心线分界 + hysteresis
	const rowEntries = rects.slice(activeRow.start, activeRow.end + 1);
	if (rowEntries.length === 0) return 0;

	const firstInRow = rowEntries[0]!;
	const lastInRow = rowEntries[rowEntries.length - 1]!;

	if (x <= firstInRow.rect.left) return firstInRow.index;
	if (x >= lastInRow.rect.right) return lastInRow.index + 1;

	for (const entry of rowEntries) {
		const beforeIndex = entry.index;
		const afterIndex = entry.index + 1;
		const axisMid = (entry.rect.left + entry.rect.right) / 2;
		const insideCard =
			x >= entry.rect.left && x <= entry.rect.right && y >= entry.rect.top && y <= entry.rect.bottom;

		// card 内部且水平移动 → 方向决定 before/after
		if (
			insideCard &&
			pointerDelta &&
			Math.abs(pointerDelta.dx) > 0.8 &&
			Math.abs(pointerDelta.dx) >= Math.abs(pointerDelta.dy) * 0.6
		) {
			return pointerDelta.dx > 0 ? afterIndex : beforeIndex;
		}

		const hysteresis = 3;
		if (x < axisMid - hysteresis) return beforeIndex;
		if (x > axisMid + hysteresis) continue;

		// hysteresis 区间内保持上一帧 slot
		if (previousIndex != null) {
			const prev = clampIndex(previousIndex, items.length);
			if (prev === beforeIndex || prev === afterIndex) return prev;
		}
		return beforeIndex;
	}

	return lastInRow.index + 1;
}

/**
 * 全局落点检测：elementsFromPoint 定位 dropzone → getDropIndexFromPoint。
 * 指针略微超出 zone(±expand)时保持上一帧，避免边界闪烁。
 */
export function findDropTarget(
	x: number,
	y: number,
	previous: FileDropTargetInfo | null,
	pointerDelta: { dx: number; dy: number } | null,
): FileDropTargetInfo | null {
	const elements = document.elementsFromPoint(x, y);

	for (const el of elements) {
		if (!el.instanceOf(HTMLElement)) continue;
		const zone = el.closest<HTMLElement>('.gridnote-ft-file-list[data-folder-id]');
		if (!zone) continue;
		const folderId = zone.dataset.folderId;
		if (!folderId) continue;
		const previousIndex = previous?.folderId === folderId ? previous.dropIndex : null;
		return { folderId, dropIndex: getDropIndexFromPoint(zone, x, y, previousIndex, pointerDelta) };
	}

	// expanded zone retention：指针略超边界时保持上一帧
	if (previous) {
		const retainedZone = document.querySelector<HTMLElement>(
			`.gridnote-ft-file-list[data-folder-id="${cssEscape(previous.folderId)}"]`,
		);
		if (retainedZone) {
			const rect = retainedZone.getBoundingClientRect();
			const expand = 18;
			if (
				x >= rect.left - expand &&
				x <= rect.right + expand &&
				y >= rect.top - expand &&
				y <= rect.bottom + expand
			) {
				return {
					folderId: previous.folderId,
					dropIndex: getDropIndexFromPoint(retainedZone, x, y, previous.dropIndex, pointerDelta),
				};
			}
		}
	}

	return null;
}

/** 捕获所有文件条目的视口 rect（FLIP first 帧） */
export function captureFileRects(): Map<string, DOMRect> {
	const rects = new Map<string, DOMRect>();
	const items = document.querySelectorAll<HTMLElement>('[data-file-path]');
	for (const el of items) {
		const path = el.dataset.filePath;
		if (!path) continue;
		rects.set(path, el.getBoundingClientRect());
	}
	return rects;
}

/** FLIP：对比 beforeRects 与当前位置，对有位移的条目播放滑动动画 */
export function applyFileFlip(beforeRects: Map<string, DOMRect>, duration: number): void {
	const items = document.querySelectorAll<HTMLElement>('[data-file-path]');
	for (const el of items) {
		const path = el.dataset.filePath;
		if (!path) continue;
		const before = beforeRects.get(path);
		if (!before) continue;
		const after = el.getBoundingClientRect();
		const dx = before.left - after.left;
		const dy = before.top - after.top;
		if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
		el.animate(
			[{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
			{ duration, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
		);
	}
}

/** 飞入动画：从指针释放位置飞入最终网格槽位 */
export function animateFlyIn(
	path: string,
	origin: { left: number; top: number; width: number; height: number },
	duration: number,
): void {
	const el = document.querySelector<HTMLElement>(`[data-file-path="${cssEscape(path)}"]`);
	if (!el) return;
	const target = el.getBoundingClientRect();
	const dx = origin.left - target.left;
	const dy = origin.top - target.top;
	const sx = target.width > 0 ? origin.width / target.width : 1;
	const sy = target.height > 0 ? origin.height / target.height : 1;
	el.animate(
		[
			{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
			{ transform: 'translate(0, 0) scale(1, 1)' },
		],
		{ duration, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' },
	);
}

function cssEscape(s: string): string {
	return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}

/**
 * 获取元素去除 FLIP transform 后的 layout rect，避免动画期间的视觉偏移干扰检测。
 */
function getLayoutRect(el: HTMLElement): DOMRect {
	const rect = el.getBoundingClientRect();
	if (el.getAnimations().length === 0) return rect;
	const m = window.getComputedStyle(el).transform;
	if (!m || m === 'none') return rect;
	const match = m.match(/matrix(?:3d)?\(([^)]+)\)/);
	if (!match) return rect;
	const parts = match[1]!.split(',').map(parseFloat);
	// matrix(a,b,c,d,tx,ty) → parts[4],parts[5]; matrix3d → parts[12],parts[13]
	const tx = parts.length === 6 ? parts[4]! : parts[12]!;
	const ty = parts.length === 6 ? parts[5]! : parts[13]!;
	return new DOMRect(rect.left - tx, rect.top - ty, rect.width, rect.height);
}

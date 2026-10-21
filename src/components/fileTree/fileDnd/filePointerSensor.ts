/**
 * 文件指针传感器：pointerdown → 移动超过阈值激活拖拽，否则视为单击。
 * 与 cardtree 文件夹拖拽隔离。
 */
export interface FilePointerSensorOptions {
	container: HTMLElement;
	activationDistance?: number;
	onDragStart: (path: string, gridEl: HTMLElement, entryEl: HTMLElement, x: number, y: number) => void;
	onDragMove: (x: number, y: number) => void;
	onDragEnd: (x: number, y: number) => void;
}

export function createFilePointerSensor(options: FilePointerSensorOptions) {
	const { container, activationDistance = 6, onDragStart, onDragMove, onDragEnd } = options;

	let startX = 0;
	let startY = 0;
	let active = false;
	let dragPath: string | null = null;
	let dragGrid: HTMLElement | null = null;
	let dragEntry: HTMLElement | null = null;

	function onPointerDown(e: PointerEvent) {
		// 仅响应主键
		if (e.button !== 0) return;
		const entry: HTMLElement | null = (e.target as HTMLElement).closest('[data-file-path]');
		if (!entry) return;
		const path = entry.getAttribute('data-file-path');
		if (!path) return;
		const grid: HTMLElement | null = entry.closest('[data-folder-id]');
		if (!grid) return;

		startX = e.clientX;
		startY = e.clientY;
		dragPath = path;
		dragGrid = grid;
		dragEntry = entry;

		document.addEventListener('pointermove', onPointerMove);
		document.addEventListener('pointerup', onPointerUp);
		document.addEventListener('pointercancel', onPointerCancel);
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragPath) return;
		if (!active) {
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			if (Math.sqrt(dx * dx + dy * dy) < activationDistance) return;
			active = true;
		// 激活后拦截 click
		suppressClick();
			onDragStart(dragPath, dragGrid!, dragEntry!, startX, startY);
		}
		onDragMove(e.clientX, e.clientY);
	}

	function onPointerUp(e: PointerEvent) {
		if (active) {
			onDragEnd(e.clientX, e.clientY);
		}
		cleanup();
	}

	function onPointerCancel() {
		cleanup();
	}

	/** 拖拽激活后拦截紧随的 click 事件 */
	function suppressClick(): void {
		const handler = (ev: Event) => {
			ev.preventDefault();
			ev.stopPropagation();
			document.removeEventListener('click', handler, true);
		};
		document.addEventListener('click', handler, true);
		// 兜底：200ms 后自行移除
		window.setTimeout(() => document.removeEventListener('click', handler, true), 200);
	}

	function cleanup() {
		active = false;
		dragPath = null;
		dragGrid = null;
		dragEntry = null;
		document.removeEventListener('pointermove', onPointerMove);
		document.removeEventListener('pointerup', onPointerUp);
		document.removeEventListener('pointercancel', onPointerCancel);
	}

	container.addEventListener('pointerdown', onPointerDown);

	return {
		destroy() {
			container.removeEventListener('pointerdown', onPointerDown);
			cleanup();
		},
	};
}

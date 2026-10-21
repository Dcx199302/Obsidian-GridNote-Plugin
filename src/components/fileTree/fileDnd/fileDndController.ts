import { tick } from 'svelte';
import { createFlipAnimation } from '@xuchengdong/cardtree-svelte';
import { normalizePath, Notice, type App, TFile } from 'obsidian';
import type { FileSelectionStore } from './fileSelectionStore';
import { ROOT_FOLDER_ID } from './fileSelectionStore';
import {
	createFileDragStore,
	type FileDragStore,
	type FileDropPosition,
} from './fileDragStore';
import { createFilePointerSensor } from './filePointerSensor';
import {
	findDropTarget,
	captureFileRects,
	applyFileFlip,
	clampIndex,
	type FileDropTargetInfo,
} from './fileDropGeometry';

/** 解析 folderId → vault 路径（ROOT → ''） */
export type ResolveFolderPath = (folderId: string) => string | null;
/** 取某文件夹当前文件数组（用于落点计算与持久化基准） */
export type GetFolderFiles = (folderId: string) => { path: string; name: string }[];
/** 同文件夹重排：更新数据层并触发视图重渲染（调用方做 FLIP） */
export type ApplyFileReorder = (
	folderId: string,
	dragPaths: string[],
	refPath: string | null,
	position: 'before' | 'after',
) => void;
/** 跨文件夹移动文件集合到目标父路径，返回实际移动数量 */
export type MoveFiles = (dragPaths: string[], targetFolderPath: string) => Promise<number>;

export interface FileDndControllerOptions {
	container: HTMLElement;
	app: App;
	selectionStore: FileSelectionStore;
	dragStore?: FileDragStore;
	resolveFolderPath: ResolveFolderPath;
	getFolderFiles: GetFolderFiles;
	applyFileReorder: ApplyFileReorder;
	moveFiles: MoveFiles;
}

interface ActiveDrag {
	paths: string[];
	sourceFolderId: string;
	sourceFolderPath: string;
	gridEl: HTMLElement;
}

interface DropResult {
	folderId: string;
	referencePath: string | null;
	position: FileDropPosition;
	placeholderIndex: number | null;
}

/**
 * 文件拖拽编排器：pointerSensor 激活拖拽 → overlay transform3d 跟随指针 →
 * findDropTarget live 检测落点 → capture-before + tick().then(FLIP) 平滑过渡。
 */
export function createFileDndController(options: FileDndControllerOptions) {
	const { container, selectionStore, resolveFolderPath, getFolderFiles, applyFileReorder, moveFiles } = options;
	const dragStore: FileDragStore = options.dragStore ?? createFileDragStore();

	const flip = createFlipAnimation({
		childSelector: '[data-file-path]',
		keyAttribute: 'data-file-path',
		animatingClass: 'is-ft-file-reordering',
		duration: 250,
		threshold: 1,
	});

	let active: ActiveDrag | null = null;
	let sensor: { destroy: () => void } | null = null;

	// --- overlay ---
	let overlayEl: HTMLElement | null = null;

	// --- rAF + 检测状态 ---
	let dropRafId: number | null = null;
	let lastResult: DropResult | null = null;
	let lastDropTarget: FileDropTargetInfo | null = null;

	// --- 自动滚动 ---
	const SCROLL_EDGE = 50;
	const SCROLL_MAX_SPEED = 12;
	let lastPointerX = 0;
	let lastPointerY = 0;
	let prevPointerX = 0;
	let prevPointerY = 0;
	let scrollRafId: number | null = null;
	let scrollEl: HTMLElement | null = null;
	let scrollDelta = 0;

	// --- 卡片高亮 ---
	let highlightedCard: HTMLElement | null = null;

	function setOverlayPosition(x: number, y: number): void {
		if (!overlayEl) {
			overlayEl = document.querySelector<HTMLElement>('.gridnote-ft-file-drag-overlay');
		}
		if (overlayEl) {
			overlayEl.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
		}
	}

	function onDragStart(path: string, gridEl: HTMLElement, _entryEl: HTMLElement, x: number, y: number) {
		const sourceFolderId = gridEl.getAttribute('data-folder-id') ?? ROOT_FOLDER_ID;
		const sourceFolderPath = resolveFolderPath(sourceFolderId) ?? '';
		let paths: string[];
		if (selectionStore.isSelected(path)) {
			paths = getSelectedPathsInFolder(sourceFolderId);
		} else {
			const files = getFolderFiles(sourceFolderId);
			selectionStore.select(sourceFolderId, path, 'none', files);
			paths = [path];
		}
		active = { paths, sourceFolderId, sourceFolderPath, gridEl };
		dragStore.startDrag(paths, sourceFolderId);
		setOverlayPosition(x, y);
		document.body.addClass('gridnote-file-drag-active');

		lastResult = null;
		lastDropTarget = null;
		prevPointerX = x;
		prevPointerY = y;
	}

	function onDragMove(x: number, y: number) {
		lastPointerX = x;
		lastPointerY = y;
		setOverlayPosition(x, y);

		if (dropRafId === null) {
			dropRafId = window.requestAnimationFrame(() => {
				dropRafId = null;
				processDropFrame();
				updateAutoScroll(lastPointerX, lastPointerY);
			});
		}
	}

	/** 共享：rAF 内落点计算 + placeholder 更新（onDragMove / onScroll / autoScroll 复用） */
	function processDropFrame(): void {
		if (!active) return;

		// pointerDelta：与上一帧的指针位移，用于方向感知
		const dx = lastPointerX - prevPointerX;
		const dy = lastPointerY - prevPointerY;
		const pointerDelta = Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1 ? { dx, dy } : null;

		// capture-before：store 更新前捕获当前 rect
		const beforeRects = captureFileRects();

		const target = findDropTarget(lastPointerX, lastPointerY, lastDropTarget, pointerDelta);
		const result = targetToResult(target, lastPointerX, lastPointerY);

		if (!sameResult(result, lastResult)) {
			lastDropTarget = target;
			lastResult = result;
			if (result) dragStore.setHover(result);
			else dragStore.clearHover();
			updateCardHighlight(result);
			void tick().then(() => applyFileFlip(beforeRects, 150));
		}

		prevPointerX = lastPointerX;
		prevPointerY = lastPointerY;
	}

	async function onDragEnd(x: number, y: number) {
		const state = dragStore.getState();
		document.body.removeClass('gridnote-file-drag-active');
		try {
			if (state.status === 'hovering' && active) {
				const target = state.dropTarget;
				dragStore.beginDrop();
				if (target.position === 'inside') {
					const targetPath = resolveFolderPath(target.folderId) ?? '';
					if (targetPath !== active.sourceFolderPath) {
						await moveFiles(active.paths, targetPath);
					}
				} else if (target.folderId === active.sourceFolderId) {
					await performReorderFlip(active.gridEl, active.sourceFolderId, active.paths, target.referencePath, target.position, x, y);
				} else {
					const targetPath = resolveFolderPath(target.folderId) ?? '';
					if (targetPath !== active.sourceFolderPath) {
						// moveFiles 后路径变更，重排需用新路径
						const movedPaths = active.paths.map((p) => {
							const name = p.substring(p.lastIndexOf('/') + 1);
							return normalizePath(targetPath ? `${targetPath}/${name}` : name);
						});
						await moveFiles(active.paths, targetPath);
						const targetGrid = document.querySelector<HTMLElement>(
							`.gridnote-ft-file-list[data-folder-id="${cssEscape(target.folderId)}"]`,
						);
						if (targetGrid) {
							await performReorderFlip(targetGrid, target.folderId, movedPaths, target.referencePath, target.position, x, y);
						} else {
							applyFileReorder(target.folderId, movedPaths, target.referencePath, target.position);
						}
					}
				}
			} else if (state.status === 'dragging' && active) {
				await animateRebound(active, x, y);
			}
		} finally {
			if (dropRafId !== null) {
				window.cancelAnimationFrame(dropRafId);
				dropRafId = null;
			}
			lastResult = null;
			lastDropTarget = null;
			stopAutoScroll();
			clearCardHighlight();
			active = null;
			dragStore.complete();
		}
	}

	// ── 自动滚动 ──

	function updateAutoScroll(x: number, y: number): void {
		const el = findScrollContainer(x, y);
		if (!el) { stopAutoScroll(); return; }
		const rect = el.getBoundingClientRect();
		const distToTop = y - rect.top;
		const distToBottom = rect.bottom - y;
		const canScrollUp = el.scrollTop > 0;
		const canScrollDown = el.scrollTop < el.scrollHeight - el.clientHeight - 1;
		if (distToTop < SCROLL_EDGE && canScrollUp) {
			scrollDelta = -Math.ceil((1 - distToTop / SCROLL_EDGE) * SCROLL_MAX_SPEED);
			startAutoScroll(el);
		} else if (distToBottom < SCROLL_EDGE && canScrollDown) {
			scrollDelta = Math.ceil((1 - distToBottom / SCROLL_EDGE) * SCROLL_MAX_SPEED);
			startAutoScroll(el);
		} else {
			stopAutoScroll();
		}
	}

	function findScrollContainer(x: number, y: number): HTMLElement | null {
		const candidates = document.querySelectorAll<HTMLElement>(
			'.gridnote-ft-root-files, .gridnote-file-tree-container',
		);
		for (const el of candidates) {
			if (el.scrollHeight <= el.clientHeight) continue;
			const r = el.getBoundingClientRect();
			if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
		}
		return null;
	}

	function startAutoScroll(el: HTMLElement): void {
		if (scrollEl === el && scrollRafId !== null) return;
		stopAutoScroll();
		scrollEl = el;
		const step = () => {
			if (!scrollEl) return;
			scrollEl.scrollTop += scrollDelta;
			processDropFrame();
			scrollRafId = window.requestAnimationFrame(step);
		};
		scrollRafId = window.requestAnimationFrame(step);
	}

	function stopAutoScroll(): void {
		if (scrollRafId !== null) {
			window.cancelAnimationFrame(scrollRafId);
			scrollRafId = null;
		}
		scrollEl = null;
		scrollDelta = 0;
	}

	// ── 卡片高亮 ──

	function updateCardHighlight(target: DropResult | null): void {
		if (highlightedCard) {
			highlightedCard.classList.remove('is-ft-file-drop-inside');
			highlightedCard = null;
		}
		if (target && target.position === 'inside') {
			const node = document.querySelector<HTMLElement>(`[data-source-id="${cssEscape(target.folderId)}"]`);
			if (node) {
				const cardEl = node.querySelector<HTMLElement>('.gridnote-ft-node-card') ?? node;
				cardEl.classList.add('is-ft-file-drop-inside');
				highlightedCard = cardEl;
			} else if (target.folderId === ROOT_FOLDER_ID) {
				const rootEl = document.querySelector<HTMLElement>('.gridnote-ft-root-files');
				if (rootEl) {
					rootEl.classList.add('is-ft-file-drop-inside');
					highlightedCard = rootEl;
				}
			}
		}
	}

	function clearCardHighlight(): void {
		if (highlightedCard) {
			highlightedCard.classList.remove('is-ft-file-drop-inside');
			highlightedCard = null;
		}
	}

	// ── 回弹动画 ──

	function animateRebound(act: ActiveDrag, pointerX: number, pointerY: number): Promise<void> {
		return new Promise((resolve) => {
			if (!overlayEl) { resolve(); return; }
			const firstPath = act.paths[0];
			const sourceEl = firstPath
				? act.gridEl.querySelector<HTMLElement>(`[data-file-path="${cssEscape(firstPath)}"]`)
				: null;
			if (!sourceEl) { resolve(); return; }
			const rect = sourceEl.getBoundingClientRect();
			const targetX = rect.left + rect.width / 2;
			const targetY = rect.top + rect.height / 2;
			if (Math.abs(targetX - pointerX) < 1 && Math.abs(targetY - pointerY) < 1) { resolve(); return; }
			const fromT = `translate3d(${pointerX}px, ${pointerY}px, 0) translate(-50%, -50%)`;
			const toT = `translate3d(${targetX}px, ${targetY}px, 0) translate(-50%, -50%)`;
			overlayEl.style.transform = toT;
			const animation = overlayEl.animate(
				[{ transform: fromT }, { transform: toT }],
				{ duration: 280, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
			);
			animation.onfinish = () => resolve();
			animation.oncancel = () => resolve();
		});
	}

	// ── 落位 FLIP（仅 onDragEnd） ──

	async function performReorderFlip(
		gridEl: HTMLElement,
		folderId: string,
		dragPaths: string[],
		refPath: string | null,
		position: 'before' | 'after',
		pointerX: number,
		pointerY: number,
	) {
		flip.snapshot(gridEl);
		applyFileReorder(folderId, dragPaths, refPath, position);
		await tick();
		flip.play(gridEl);
		const firstPath = dragPaths[0];
		if (firstPath) {
			const el = gridEl.querySelector<HTMLElement>(`[data-file-path="${cssEscape(firstPath)}"]`);
			if (el) {
				const rect = el.getBoundingClientRect();
				const dx = pointerX - (rect.left + rect.width / 2);
				const dy = pointerY - (rect.top + rect.height / 2);
				if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
					el.animate(
						[
							{ transform: `translate(${dx}px, ${dy}px) scale(1.04)`, opacity: 0.85 },
							{ transform: 'translate(0,0) scale(1)', opacity: 1 },
						],
						{ duration: 260, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' },
					);
				}
			}
		}
	}

	// ── 落点检测 ──

	/**
 * dropIndex → DropResult 转换。target 为 null 时 elementsFromPoint 兜底检测容器 → inside。
 */
	function targetToResult(target: FileDropTargetInfo | null, x: number, y: number): DropResult | null {
		if (!active) return null;

		if (target) {
			const files = getFolderFiles(target.folderId);
			const dragSet = new Set(active.paths);
			const visibleFiles = files.filter((f) => !dragSet.has(f.path));
			const placeholderIndex = clampIndex(target.dropIndex, visibleFiles.length);

			// 源文件夹空网格：拖回原位无意义
			if (visibleFiles.length === 0 && target.folderId === active.sourceFolderId) return null;

			if (placeholderIndex >= visibleFiles.length) {
				const last = visibleFiles[visibleFiles.length - 1];
				return {
					folderId: target.folderId,
					referencePath: last ? last.path : null,
					position: 'after',
					placeholderIndex,
				};
			}
			const ref = visibleFiles[placeholderIndex];
			return {
				folderId: target.folderId,
				referencePath: ref ? ref.path : null,
				position: 'before',
				placeholderIndex,
			};
		}

		// elementsFromPoint 兜底：检测卡片 / 根区域 → inside
		const els = document.elementsFromPoint(x, y) as HTMLElement[];
		for (const el of els) {
			const card = el.closest('[data-source-id]');
			if (card) {
				const folderId = card.getAttribute('data-source-id') ?? ROOT_FOLDER_ID;
				if (folderId === active.sourceFolderId) return null;
				return { folderId, referencePath: null, position: 'inside', placeholderIndex: null };
			}
			if (el.closest('.gridnote-ft-root-files')) {
				if (active.sourceFolderId === ROOT_FOLDER_ID) return null;
				return { folderId: ROOT_FOLDER_ID, referencePath: null, position: 'inside', placeholderIndex: null };
			}
		}
		return null;
	}

	function getSelectedPathsInFolder(folderId: string): string[] {
		const files = getFolderFiles(folderId);
		return files.filter((f) => selectionStore.isSelected(f.path)).map((f) => f.path);
	}

	function cssEscape(s: string): string {
		return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
	}

	function sameResult(a: DropResult | null, b: DropResult | null): boolean {
		if (a === null && b === null) return true;
		if (a === null || b === null) return false;
		return a.folderId === b.folderId && a.referencePath === b.referencePath && a.position === b.position;
	}

	function onScroll(): void {
		if (active && dropRafId === null) {
			dropRafId = window.requestAnimationFrame(() => {
				dropRafId = null;
				processDropFrame();
			});
		}
	}

	sensor = createFilePointerSensor({
		container,
		onDragStart,
		onDragMove,
		onDragEnd: (x, y) => { void onDragEnd(x, y); },
	});

	// 拖拽期间监听所有滚动容器的 scroll 事件（capture 以覆盖嵌套容器）
	document.addEventListener('scroll', onScroll, true);

	return {
		dragStore,
		destroy() {
			sensor?.destroy();
			sensor = null;
			flip.destroy();
			document.removeEventListener('scroll', onScroll, true);
			if (dropRafId !== null) {
				window.cancelAnimationFrame(dropRafId);
				dropRafId = null;
			}
			stopAutoScroll();
			clearCardHighlight();
			overlayEl = null;
			document.body.removeClass('gridnote-file-drag-active');
		},
	};
}

/** 工具：批量移动文件（供 moveFiles 回调实现复用） */
export async function moveVaultFiles(app: App, dragPaths: string[], targetFolderPath: string): Promise<number> {
	let moved = 0;
	const skipped: string[] = [];
	for (const sourcePath of dragPaths) {
		const file = app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile)) continue;
		const name = file.name;
		const newPath = normalizePath(targetFolderPath ? `${targetFolderPath}/${name}` : name);
		if (newPath === sourcePath) continue;
		const existing = app.vault.getAbstractFileByPath(newPath);
		if (existing) {
			skipped.push(name);
			continue;
		}
		try {
			await app.fileManager.renameFile(file, newPath);
			moved++;
		} catch {
			// 单个失败不阻断其余
		}
	}
	if (skipped.length > 0) {
		const summary = skipped.length <= 3
			? skipped.join('、')
			: `${skipped.slice(0, 3).join('、')} 等 ${skipped.length} 个`;
		new Notice(`目标目录已存在同名文件，已跳过：${summary}`);
	}
	return moved;
}

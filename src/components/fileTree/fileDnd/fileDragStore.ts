import { writable, type Readable } from 'svelte/store';

/** before/after=参照文件前后；inside=放入目标文件夹 */
export type FileDropPosition = 'before' | 'after' | 'inside';

export interface FileDropTarget {
	/** 目标文件夹 id */
	folderId: string;
	/** 插入参照文件路径（inside=null） */
	referencePath: string | null;
	position: FileDropPosition;
	/** 渲染列表中的 placeholder index（inside=null） */
	placeholderIndex: number | null;
}

/**
 * 拖拽状态。指针坐标不经过 store（controller 直接写 overlay DOM），
 * 仅落点变化时更新以触发 FolderCardFiles 重渲染。
 */
export type FileDragState =
	| { status: 'idle' }
	| { status: 'dragging'; paths: string[]; sourceFolderId: string }
	| { status: 'hovering'; paths: string[]; sourceFolderId: string; dropTarget: FileDropTarget }
	| { status: 'dropping'; paths: string[] };

export interface FileDragStore extends Readable<FileDragState> {
	startDrag: (paths: string[], sourceFolderId: string) => void;
	setHover: (target: FileDropTarget) => void;
	clearHover: () => void;
	beginDrop: () => void;
	complete: () => void;
	cancel: () => void;
	getState: () => FileDragState;
}

export function createFileDragStore(): FileDragStore {
	const { subscribe, set, update } = writable<FileDragState>({ status: 'idle' });
	let current: FileDragState = { status: 'idle' };
	subscribe((s) => { current = s; });

	function startDrag(paths: string[], sourceFolderId: string): void {
		set({ status: 'dragging', paths, sourceFolderId });
	}

	function setHover(target: FileDropTarget): void {
		update((s) => {
			if (s.status !== 'dragging' && s.status !== 'hovering') return s;
			return { status: 'hovering', paths: s.paths, sourceFolderId: s.sourceFolderId, dropTarget: target };
		});
	}

	function clearHover(): void {
		update((s) => {
			if (s.status !== 'hovering') return s;
			return { status: 'dragging', paths: s.paths, sourceFolderId: s.sourceFolderId };
		});
	}

	function beginDrop(): void {
		update((s) => {
			if (s.status !== 'hovering') return s;
			return { status: 'dropping', paths: s.paths };
		});
	}

	function complete(): void {
		set({ status: 'idle' });
	}

	function cancel(): void {
		set({ status: 'idle' });
	}

	function getState(): FileDragState {
		return current;
	}

	return { subscribe, startDrag, setHover, clearHover, beginDrop, complete, cancel, getState };
}

export function getDropTarget(state: FileDragState): FileDropTarget | null {
	return state.status === 'hovering' ? state.dropTarget : null;
}

export function getDragPaths(state: FileDragState): string[] {
	return state.status !== 'idle' ? state.paths : [];
}

export function isFileDragActive(state: FileDragState): boolean {
	return state.status !== 'idle';
}

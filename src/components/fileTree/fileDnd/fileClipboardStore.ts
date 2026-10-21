import { writable, type Readable } from 'svelte/store';

/** 文件剪贴板状态（modal 级：弹框关闭后清空，不记录剪切选中态） */
export interface FileClipboardState {
	/** 被剪切的文件路径 */
	cutPaths: string[];
	/** 源文件夹 id（仅用于视觉 is-cut 范围） */
	sourceFolderId: string | null;
}

export interface FileClipboardStore extends Readable<FileClipboardState> {
	cut: (paths: string[], sourceFolderId: string) => void;
	getPaths: () => string[];
	clear: () => void;
}

const EMPTY: FileClipboardState = { cutPaths: [], sourceFolderId: null };

export function createFileClipboardStore(): FileClipboardStore {
	const { subscribe, set } = writable<FileClipboardState>({ ...EMPTY });
	let current: FileClipboardState = { ...EMPTY };
	subscribe((s) => { current = s; });

	function cut(paths: string[], sourceFolderId: string): void {
		set({ cutPaths: [...paths], sourceFolderId });
	}

	function getPaths(): string[] {
		return current.cutPaths;
	}

	function clear(): void {
		set({ ...EMPTY });
	}

	return { subscribe, cut, getPaths, clear };
}

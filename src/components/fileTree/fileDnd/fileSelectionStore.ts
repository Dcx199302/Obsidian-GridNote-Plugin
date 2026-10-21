import { writable, type Readable } from 'svelte/store';

/** 根散文件专用的文件夹 id（不进 cardtree 节点树） */
export const ROOT_FOLDER_ID = '__root__';

export type SelectModifier = 'none' | 'toggle' | 'range';

export interface FileSelectionState {
	/** 当前选中所在的文件夹 id（null=无选中），切换 folderId 自动清空 */
	activeFolderId: string | null;
	selectedPaths: Set<string>;
	anchorPath: string | null;
}

export interface FileSelectionStore extends Readable<FileSelectionState> {
	select: (folderId: string, path: string, modifier: SelectModifier, files: { path: string }[]) => void;
	clear: () => void;
	isSelected: (path: string) => boolean;
	getSelected: () => string[];
	getActiveFolderId: () => string | null;
}

export function createFileSelectionStore(): FileSelectionStore {
	const { subscribe, set, update } = writable<FileSelectionState>({
		activeFolderId: null,
		selectedPaths: new Set(),
		anchorPath: null,
	});

	let current: FileSelectionState = { activeFolderId: null, selectedPaths: new Set(), anchorPath: null };
	subscribe((s) => { current = s; });

	function select(folderId: string, path: string, modifier: SelectModifier, files: { path: string }[]): void {
		update((state) => {
			// 切换文件夹：清空旧选中，以新单击为新起点
			if (state.activeFolderId !== folderId) {
				return { activeFolderId: folderId, selectedPaths: new Set([path]), anchorPath: path };
			}

			if (modifier === 'toggle') {
				const next = new Set(state.selectedPaths);
				if (next.has(path)) next.delete(path);
				else next.add(path);
				return {
					activeFolderId: folderId,
					selectedPaths: next,
					anchorPath: next.size > 0 ? state.anchorPath : null,
				};
			}

			if (modifier === 'range') {
				const anchor = state.anchorPath ?? path;
				return {
					activeFolderId: folderId,
					selectedPaths: new Set(computeRange(files, anchor, path)),
					anchorPath: anchor,
				};
			}

			// 单选
			return { activeFolderId: folderId, selectedPaths: new Set([path]), anchorPath: path };
		});
	}

	function clear(): void {
		set({ activeFolderId: null, selectedPaths: new Set(), anchorPath: null });
	}

	function isSelected(path: string): boolean {
		return current.selectedPaths.has(path);
	}
	function getSelected(): string[] {
		return [...current.selectedPaths];
	}
	function getActiveFolderId(): string | null {
		return current.activeFolderId;
	}

	return { subscribe, select, clear, isSelected, getSelected, getActiveFolderId };
}

/** Shift 范围选中：从 anchor 到 target 的连续路径（含两端） */
function computeRange(files: { path: string }[], anchor: string, target: string): string[] {
	const paths = files.map((f) => f.path);
	const a = paths.indexOf(anchor);
	const b = paths.indexOf(target);
	if (a < 0 || b < 0) return [target];
	return paths.slice(Math.min(a, b), Math.max(a, b) + 1);
}

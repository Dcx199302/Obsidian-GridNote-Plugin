import type { App } from 'obsidian';

/**
 * 文件树折叠状态持久化（纯数据层，零 vault 写操作）。
 *
 * stableId 每次加载 vault 时动态生成，不可持久化；改用稳定的 vault 路径做 key，
 * 与 fileTreeSortStorage 一致。加载时再由路径反向映射回 stableId 恢复折叠。
 */
const COLLAPSE_STORAGE_KEY = 'GRID_NOTE_FILE_TREE_COLLAPSED';

function readVaultLocalStorage(app: App, key: string): unknown {
	return app.loadLocalStorage(key);
}

function writeVaultLocalStorage(app: App, key: string, value: unknown): void {
	app.saveLocalStorage(key, value);
}

/** 读取被折叠的文件夹路径列表（容错：损坏/非法时降级为空） */
export function readCollapsedPaths(app: App): string[] {
	try {
		const stored = readVaultLocalStorage(app, COLLAPSE_STORAGE_KEY);
		if (!stored) return [];
		const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
	} catch (error) {
		console.error('GridNote: 读取文件树折叠状态失败', error);
		return [];
	}
}

/** 写入被折叠的文件夹路径列表（去重后存储） */
export function writeCollapsedPaths(app: App, paths: string[]): void {
	try {
		const unique = [...new Set(paths)];
		writeVaultLocalStorage(app, COLLAPSE_STORAGE_KEY, unique);
	} catch (error) {
		console.error('GridNote: 写入文件树折叠状态失败', error);
	}
}

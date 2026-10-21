import type { App } from 'obsidian';

/**
 * 文件树下钻（drill）路径持久化，与 fileTreeCollapseStorage 同范式：
 * stableId 每次加载动态生成，不可持久化；改用稳定的 vault 路径做 key，
 * 加载时由路径反查 stableId 恢复下钻位置。
 */
const DRILL_STORAGE_KEY = 'GRID_NOTE_FILE_TREE_LAST_DRILL_PATH';

/** 读取上次下钻的文件夹路径（容错：损坏/非法时降级为根） */
export function readLastDrillPath(app: App): string {
	try {
		const stored = app.loadLocalStorage(DRILL_STORAGE_KEY);
		if (!stored) return '';
		return typeof stored === 'string' ? stored : '';
	} catch {
		return '';
	}
}

/** 写入当前下钻的文件夹路径（根目录存空串） */
export function writeLastDrillPath(app: App, path: string): void {
	try {
		app.saveLocalStorage(DRILL_STORAGE_KEY, path ?? '');
	} catch {
		// 写入失败不影响功能
	}
}

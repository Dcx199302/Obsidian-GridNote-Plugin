import type { App } from 'obsidian';

/**
 * 文件树自定义排序存储（纯数据层，零 vault 写操作）。
 *
 * vault 是真实文件系统，文件/文件夹没有"顺序"属性。本模块在 localStorage 里
 * 维护一份"自定义顺序"，显示层按它排序。模块只读写 localStorage，**绝不调用
 * vault 的 rename/create/trash/delete**——用户文件不会被破坏。
 *
 * 数据结构：folder/file 两套，key = 父文件夹的 vault 路径（根级用 ''），
 * value = 子项 name 的期望顺序。不在数组里的子项降级走字母序。
 */
export interface FileTreeSortData {
    version: 1;
    folder: Record<string, string[]>;
    file: Record<string, string[]>;
}

export type SortKind = 'folder' | 'file';
export type ReorderPosition = 'before' | 'after' | 'first-child' | 'last-child';

const SORT_STORAGE_KEY = 'GRID_NOTE_FILE_TREE_SORT';
const SORT_DATA_VERSION = 1 as const;

type SortMap = Record<string, string[]>;

interface RawSortData {
    version?: unknown;
    folder?: unknown;
    file?: unknown;
}

function readVaultLocalStorage(app: App, key: string): unknown {
    return app.loadLocalStorage(key);
}

function writeVaultLocalStorage(app: App, key: string, value: unknown): void {
    app.saveLocalStorage(key, value);
}

/** 取 path 的父目录（无 '/' 则 '' 表示根级） */
export function parentPathOf(path: string): string {
    const idx = path.lastIndexOf('/');
    return idx < 0 ? '' : path.slice(0, idx);
}

function normalizeNameArray(value: unknown): string[] | null {
    if (!Array.isArray(value)) return null;
    const result: string[] = [];
    for (const item of value) {
        if (typeof item === 'string' && item.length > 0) result.push(item);
    }
    return result.length > 0 ? result : null;
}

function normalizeSortMap(value: unknown): SortMap {
    if (!value || typeof value !== 'object') return {};
    const result: SortMap = {};
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
        const arr = normalizeNameArray(obj[key]);
        if (arr) result[key] = arr;
    }
    return result;
}

function emptySortData(): FileTreeSortData {
    return { version: SORT_DATA_VERSION, folder: {}, file: {} };
}

/** 读取完整排序数据（容错：字段非法/JSON 损坏时降级为空，绝不抛错） */
export function readSortOrder(app: App): FileTreeSortData {
    try {
        const stored = readVaultLocalStorage(app, SORT_STORAGE_KEY);
        if (!stored) return emptySortData();
        const parsed = (
            typeof stored === 'string' ? JSON.parse(stored) : stored
        ) as RawSortData;
        const folder = normalizeSortMap(parsed.folder);
        const file = normalizeSortMap(parsed.file);
        return { version: SORT_DATA_VERSION, folder, file };
    } catch (error) {
        console.error('GridNote: 读取文件树排序数据失败', error);
        return emptySortData();
    }
}

function writeSortOrder(app: App, data: FileTreeSortData): void {
    try {
        writeVaultLocalStorage(app, SORT_STORAGE_KEY, data);
    } catch (error) {
        console.error('GridNote: 写入文件树排序数据失败', error);
    }
}

/** 读-改-写 的事务化入口 */
function mutateOrder(app: App, mutate: (data: FileTreeSortData) => void): void {
    const data = readSortOrder(app);
    mutate(data);
    writeSortOrder(app, data);
}

function pickMap(data: FileTreeSortData, kind: SortKind): SortMap {
    return kind === 'folder' ? data.folder : data.file;
}

/** 取某文件夹某类的 order（无则 null） */
export function getOrder(app: App, parentPath: string, kind: SortKind): string[] | null {
    const arr = pickMap(readSortOrder(app), kind)[parentPath];
    return Array.isArray(arr) ? arr : null;
}

/** 写入某文件夹某类的完整顺序（空数组则清除该条） */
export function setOrder(app: App, parentPath: string, kind: SortKind, names: string[]): void {
    mutateOrder(app, (data) => {
        const map = pickMap(data, kind);
        if (names.length > 0) {
            map[parentPath] = [...names];
        } else {
            delete map[parentPath];
        }
    });
}

/** 清除某文件夹的 order（kind 省略则 folder/file 两套都清） */
export function clearOrder(app: App, parentPath: string, kind?: SortKind): void {
    mutateOrder(app, (data) => {
        const kinds: SortKind[] = kind ? [kind] : ['folder', 'file'];
        for (const k of kinds) {
            delete pickMap(data, k)[parentPath];
        }
    });
}

/**
 * 把 childName 移到 parentPath/kind 的新位置。
 * siblingNames = 当前显示的兄弟顺序（含 childName），每次以此为基准覆盖，
 * 保证 order 始终反映最新兄弟全集（新文件/删除自动同步），避免 order 残留幽灵。
 */
export function reorderTo(
    app: App,
    parentPath: string,
    kind: SortKind,
    childName: string,
    siblingNames: string[],
    referenceName: string | null,
    position: ReorderPosition,
): void {
    mutateOrder(app, (data) => {
        const map = pickMap(data, kind);
        const current = [...siblingNames];
        const idx = current.indexOf(childName);
        if (idx >= 0) current.splice(idx, 1);

        let insertAt: number;
        if (position === 'last-child' || referenceName === null) {
            insertAt = current.length;
        } else if (position === 'first-child') {
            insertAt = 0;
        } else {
            const refIdx = current.indexOf(referenceName);
            insertAt = refIdx < 0 ? current.length : position === 'before' ? refIdx : refIdx + 1;
        }
        current.splice(insertAt, 0, childName);
        map[parentPath] = current;
    });
}

/** delete 事件：从父 order 移除该 name（无 order 则无操作） */
export function removeChild(app: App, parentPath: string, kind: SortKind, childName: string): void {
    mutateOrder(app, (data) => {
        const map = pickMap(data, kind);
        const arr = map[parentPath];
        if (!Array.isArray(arr)) return;
        const idx = arr.indexOf(childName);
        if (idx >= 0) {
            arr.splice(idx, 1);
            if (arr.length === 0) delete map[parentPath];
        }
    });
}

/** 同目录改名：旧 name → 新 name（保持位置） */
export function renameChild(
    app: App,
    parentPath: string,
    kind: SortKind,
    oldName: string,
    newName: string,
): void {
    if (oldName === newName) return;
    mutateOrder(app, (data) => {
        const arr = pickMap(data, kind)[parentPath];
        if (!Array.isArray(arr)) return;
        const idx = arr.indexOf(oldName);
        if (idx >= 0) arr[idx] = newName;
    });
}

/**
 * 跨目录移动：从 oldParent 移除，加到 newParent 末尾（仅当 newParent 已有 order；
 * 若 newParent 无 order，则不动——让该项按默认规则排到末尾）。
 */
export function moveChild(
    app: App,
    oldParent: string,
    newParent: string,
    kind: SortKind,
    name: string,
): void {
    if (oldParent === newParent) return;
    mutateOrder(app, (data) => {
        const map = pickMap(data, kind);
        const oldArr = map[oldParent];
        if (Array.isArray(oldArr)) {
            const idx = oldArr.indexOf(name);
            if (idx >= 0) {
                oldArr.splice(idx, 1);
                if (oldArr.length === 0) delete map[oldParent];
            }
        }
        const newArr = map[newParent];
        if (Array.isArray(newArr) && !newArr.includes(name)) {
            newArr.push(name);
        }
    });
}

/**
 * 文件夹被移动：迁移所有相关 key 的前缀。
 * 如 oldPath="A" → newPath="B/A"：key "A"→"B/A"，"A/子"→"B/A/子"（folder/file 两套都处理）。
 */
export function moveFolderTree(app: App, oldPath: string, newPath: string): void {
    if (!oldPath || oldPath === newPath) return;
    mutateOrder(app, (data) => {
        for (const map of [data.folder, data.file]) {
            for (const key of Object.keys(map)) {
                let newKey: string | null = null;
                if (key === oldPath) {
                    newKey = newPath;
                } else if (key.startsWith(oldPath + '/')) {
                    newKey = newPath + key.slice(oldPath.length);
                }
                if (newKey !== null && newKey !== key) {
                    const arr = map[key];
                    delete map[key];
                    if (Array.isArray(arr)) map[newKey] = arr;
                }
            }
        }
    });
}

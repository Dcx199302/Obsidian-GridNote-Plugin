import type { App } from 'obsidian';

export interface PersistedFoldRange {
    from: number;
    to: number;
}

export interface PersistedFoldState {
    folds: PersistedFoldRange[];
    lines: number;
}

interface AppWithId extends App {
    appId?: string;
}

function readVaultLocalStorage(app: App, key: string): unknown {
    return app.loadLocalStorage(key);
}

function writeVaultLocalStorage(app: App, key: string, value: unknown): void {
    app.saveLocalStorage(key, value);
}

function normalizeFoldLine(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }

    return Math.max(0, Math.floor(value));
}

function getFoldStorageKey(sourcePath: string): string | null {
    if (!sourcePath) {
        return null;
    }

    // Obsidian 的 app.saveLocalStorage/loadLocalStorage 会自动追加 vault 级前缀，
    // 这里必须只传逻辑键名，避免写出 `${appId}-${appId}-note-fold-*`。
    return `note-fold-${sourcePath}`;
}

function getLegacyFoldStorageKey(app: App | null, sourcePath: string): string | null {
    if (!app || !sourcePath) {
        return null;
    }

    const appId = (app as AppWithId).appId;
    if (typeof appId !== 'string' || appId.length === 0) {
        return null;
    }

    return `${appId}-note-fold-${sourcePath}`;
}

export function readPersistedFoldState(
    app: App | null,
    sourcePath: string
): PersistedFoldState | null {
    const key = getFoldStorageKey(sourcePath);
    if (!app || !key) {
        return null;
    }

    try {
        let stored = readVaultLocalStorage(app, key);
        if (!stored) {
            const legacyKey = getLegacyFoldStorageKey(app, sourcePath);
            if (legacyKey) {
                stored = readVaultLocalStorage(app, legacyKey);
                if (stored) {
                    // 迁移历史错误 key，避免与原生 Markdown 折叠存储分裂。
                    writeVaultLocalStorage(app, key, stored);
                    writeVaultLocalStorage(app, legacyKey, null);
                }
            }
        }

        if (!stored) {
            return null;
        }

        const parsed = (
            typeof stored === 'string'
                ? JSON.parse(stored)
                : stored
        ) as {
            folds?: Array<{ from?: unknown; to?: unknown }>;
            lines?: unknown;
        };
        const folds = Array.isArray(parsed.folds)
            ? parsed.folds
                .map((item) => {
                    const from = normalizeFoldLine(item?.from);
                    const to = normalizeFoldLine(item?.to);
                    if (from === null || to === null || to < from) {
                        return null;
                    }

                    return { from, to };
                })
                .filter((item): item is PersistedFoldRange => item !== null)
                .sort((left, right) => left.from - right.from || left.to - right.to)
            : [];
        const lines = normalizeFoldLine(parsed.lines) ?? 0;

        return {
            folds,
            lines
        };
    } catch (error) {
        console.error('GridNote: 读取折叠状态失败', error);
        return null;
    }
}

export function writePersistedFoldState(
    app: App | null,
    sourcePath: string,
    folds: PersistedFoldRange[],
    lines: number
): void {
    const key = getFoldStorageKey(sourcePath);
    const legacyKey = getLegacyFoldStorageKey(app, sourcePath);
    if (!app || !key) {
        return;
    }

    const normalizedFolds = folds
        .map((item) => {
            const from = normalizeFoldLine(item.from);
            const to = normalizeFoldLine(item.to);
            if (from === null || to === null || to < from) {
                return null;
            }

            return { from, to };
        })
        .filter((item): item is PersistedFoldRange => item !== null)
        .sort((left, right) => left.from - right.from || left.to - right.to);

    try {
        if (normalizedFolds.length === 0) {
            writeVaultLocalStorage(app, key, null);
            if (legacyKey) {
                writeVaultLocalStorage(app, legacyKey, null);
            }
            return;
        }

        writeVaultLocalStorage(
            app,
            key,
            {
                folds: normalizedFolds,
                lines: normalizeFoldLine(lines) ?? 0
            } satisfies PersistedFoldState
        );
        if (legacyKey) {
            writeVaultLocalStorage(app, legacyKey, null);
        }
    } catch (error) {
        console.error('GridNote: 写入折叠状态失败', error);
    }
}

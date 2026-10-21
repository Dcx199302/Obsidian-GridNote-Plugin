import type { App, MarkdownView } from 'obsidian';
import { writePersistedFoldState, type PersistedFoldState } from '../../utils/foldStorage';
import { remapPersistedFoldState, type LineEdit } from './foldRangeEdit';

/**
 * 协调 GridNote 折叠状态持久化与原生编辑器的延迟同步。
 * 每个已挂载的 Markdown leaf 独立持有实例，避免定时器跨视图串扰。
 */
export class GridNoteFoldStateCoordinator {
    private latestState: PersistedFoldState | null = null;
    private latestSourcePath: string | null = null;
    private deferredWriteFrame = 0;
    private deferredWriteTimeout = 0;
    private nativeFoldSyncTimeout = 0;

    constructor(private readonly app: App) {}

    capture(nextState: PersistedFoldState | null, sourcePath: string | null): void {
        if (sourcePath) {
            this.latestSourcePath = sourcePath;
        }

        this.latestState = nextState;
    }

    captureSourcePath(sourcePath: string | null): void {
        if (sourcePath) {
            this.latestSourcePath = sourcePath;
        }
    }

    clearDeferredWrite(): void {
        if (this.deferredWriteFrame !== 0) {
            window.cancelAnimationFrame(this.deferredWriteFrame);
            this.deferredWriteFrame = 0;
        }

        if (this.deferredWriteTimeout !== 0) {
            window.clearTimeout(this.deferredWriteTimeout);
            this.deferredWriteTimeout = 0;
        }
    }

    remapLines(edit: LineEdit): void {
        if (!this.latestState) {
            return;
        }

        this.latestState = remapPersistedFoldState(this.latestState, edit);
        this.scheduleDeferredWrite();
    }

    scheduleDeferredWrite(): void {
        const sourcePath = this.latestSourcePath;
        if (!sourcePath || !this.latestState) {
            return;
        }

        this.clearDeferredWrite();
        this.deferredWriteFrame = window.requestAnimationFrame(() => {
            this.deferredWriteFrame = 0;
            this.deferredWriteTimeout = window.setTimeout(() => {
                this.deferredWriteTimeout = 0;
                const nextState = this.latestState;
                if (!sourcePath || !nextState) {
                    return;
                }

                // 始终写入最新快照，避免旧状态晚到覆盖后续编辑重新映射后的折叠范围。
                writePersistedFoldState(
                    this.app,
                    sourcePath,
                    nextState.folds,
                    nextState.lines
                );
            }, 96);
        });
    }

    clearNativeSync(): void {
        if (this.nativeFoldSyncTimeout !== 0) {
            window.clearTimeout(this.nativeFoldSyncTimeout);
            this.nativeFoldSyncTimeout = 0;
        }
    }

    scheduleNativeSync(
        view: MarkdownView,
        canSyncNow: () => boolean
    ): void {
        this.clearNativeSync();
        // 等待 overlay 卸载且原生 source editor 恢复可交互后再同步。
        this.nativeFoldSyncTimeout = window.setTimeout(() => {
            this.nativeFoldSyncTimeout = 0;
            this.applyToNativeEditor(view, canSyncNow());
        }, 48);
    }

    private applyToNativeEditor(
        view: MarkdownView,
        canSync: boolean
    ): void {
        const currentSourcePath = view.file?.path ?? null;
        const targetState = this.latestState;
        if (
            !currentSourcePath
            || !targetState
            || !view.editor
            || !canSync
            || (
                this.latestSourcePath !== null
                && this.latestSourcePath !== currentSourcePath
            )
        ) {
            return;
        }

        const targetFoldFromLines = Array.from(
            new Set(targetState.folds.map((fold) => fold.from))
        )
            .filter((line) => Number.isInteger(line) && line >= 0)
            .sort((left, right) => right - left);

        const previousCursor = view.editor.getCursor();
        try {
            // 先清空原生折叠，避免旧折叠破坏 GridNote 的目标状态。
            view.editor.exec('unfoldAll');
            for (const line of targetFoldFromLines) {
                view.editor.setCursor({ line, ch: 0 });
                view.editor.exec('toggleFold');
            }
        } catch (error) {
            console.error('GridNote: 同步原生编辑器折叠状态失败', error);
        } finally {
            view.editor.setCursor(previousCursor);
        }
    }
}

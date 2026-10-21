import type { Editor } from 'obsidian';
import { normalizeEditorText } from './editorText';

function readEditorNavigationKey(editor: Editor): string {
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    return `${from.line}:${from.ch}-${to.line}:${to.ch}`;
}

/**
 * 跟踪 Obsidian 在文件切换过渡期间的编辑器光标变化，
 * 供新内容挂载后重放搜索定位。
 */
export class SearchNavigationTracker {
    private cursorLine: number | null = null;
    private text: string | null = null;
    private navigationKey: string | null = null;
    private awaitingInitialExpectedText = true;

    get pendingCursorLine(): number | null {
        return this.cursorLine;
    }

    reset(): void {
        this.cursorLine = null;
        this.text = null;
        this.navigationKey = null;
        this.awaitingInitialExpectedText = true;
    }

    initialize(editor: Editor): void {
        this.cursorLine = null;
        this.text = normalizeEditorText(editor.getValue());
        this.navigationKey = readEditorNavigationKey(editor);
        this.awaitingInitialExpectedText = true;
    }

    capture(
        editor: Editor,
        expectedText: string | null,
        selectedCursorLine: number | null
    ): void {
        const currentText = normalizeEditorText(editor.getValue());
        const currentKey = readEditorNavigationKey(editor);

        if (this.text === null || this.navigationKey === null) {
            this.text = currentText;
            this.navigationKey = currentKey;
            return;
        }

        const normalizedExpectedText = expectedText === null
            ? null
            : normalizeEditorText(expectedText);

        // editor 仍显示旧文件时只更新观察基线，不能保存旧文件选区。
        if (normalizedExpectedText === null || currentText !== normalizedExpectedText) {
            this.text = currentText;
            this.navigationKey = currentKey;
            this.awaitingInitialExpectedText = true;
            return;
        }

        if (this.awaitingInitialExpectedText) {
            this.awaitingInitialExpectedText = false;
            this.text = currentText;
            this.navigationKey = currentKey;
            // Obsidian 自带搜索可能只落下 caret，不一定保留 somethingSelected()。
            // 第一次看到目标文件内容时记录原生 editor 的初始定位。
            this.cursorLine = selectedCursorLine ?? editor.getCursor().line;
            return;
        }

        if (currentKey !== this.navigationKey) {
            this.cursorLine = selectedCursorLine ?? editor.getCursor().line;
            this.navigationKey = currentKey;
        }
    }

    clearPendingCursorLine(): void {
        this.cursorLine = null;
    }
}

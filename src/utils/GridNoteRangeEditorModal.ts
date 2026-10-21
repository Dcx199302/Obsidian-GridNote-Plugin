import { App, Component, Modal, Notice, Setting } from 'obsidian';
import type { EventRef } from 'obsidian';
import { EmbeddableMarkdownEditor } from './EmbeddableMarkdownEditor';
import { useNativeModalHeader } from './modalHeader';

export interface GridNoteRangeEditorModalOptions {
    sourcePath?: string;
    value: string;
    placeholder?: string;
    onSave?: (value: string) => Promise<void> | void;
    onCancel?: () => void;
    onClose?: (reason: GridNoteRangeEditorModalCloseReason) => void;
}

export type GridNoteRangeEditorModalCloseReason =
    | 'save'
    | 'cancel'
    | 'source-change'
    | 'destroy'
    | 'unknown';

export class GridNoteRangeEditorModal extends Modal {
    private editor: EmbeddableMarkdownEditor | null = null;
    private readonly options: GridNoteRangeEditorModalOptions;
    private currentValue: string;
    private isSaving = false;
    private saveButtonEl: HTMLButtonElement | null = null;
    private cancelButtonEl: HTMLButtonElement | null = null;
    private eventScope: Component | null = null;
    private activeLeafChangeEventRef: EventRef | null = null;
    private fileOpenEventRef: EventRef | null = null;
    private focusFrame = 0;
    private focusRequestToken = 0;
    private closeReason: GridNoteRangeEditorModalCloseReason = 'unknown';
    private readonly blockOverlayClick = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
    };

    constructor(app: App, options: GridNoteRangeEditorModalOptions) {
        super(app);
        this.options = options;
        this.currentValue = options.value;
    }

    onOpen() {
        const { contentEl } = this;
        this.modalEl.addClass('gridnote-range-editor-modal');
        useNativeModalHeader(this);
        this.modalEl.setAttr('data-overlay-lock', 'true');
        this.lockOverlayDismiss();
        this.titleEl.setText('编辑节点内容');

        contentEl.empty();

        const editorContainer = contentEl.createDiv({
            cls: 'gridnote-range-editor-container'
        });

        this.editor = new EmbeddableMarkdownEditor(this.app, editorContainer, {
            value: this.currentValue,
            placeholder: this.options.placeholder ?? '在此编辑节点完整范围的 Markdown 内容...',
            cls: 'gridnote-range-editor',
            onChange: (value: string) => {
                this.currentValue = value;
            },
            onEnter: (_editor, mod) => {
                if (!mod) {
                    return false;
                }

                void this.handleSave();
                return true;
            },
            onEscape: () => {
                if (this.isSaving) {
                    return;
                }

                this.handleCancel();
            },
            onSubmit: () => {
                void this.handleSave();
            },
            onSave: () => {
                void this.handleSave();
            }
        });

        const buttonArea = contentEl.createDiv({
            cls: 'gridnote-range-editor-button-area'
        });

        new Setting(buttonArea)
            .addButton((button) => {
                button
                    .setButtonText('取消')
                    .onClick(() => this.handleCancel());
                this.cancelButtonEl = button.buttonEl;
            })
            .addButton((button) => {
                button
                    .setButtonText('保存')
                    .setCta()
                    .onClick(() => {
                        void this.handleSave();
                    });
                this.saveButtonEl = button.buttonEl;
            });

        this.activeLeafChangeEventRef = this.app.workspace.on('active-leaf-change', () => {
            if (!this.isSaving) {
                this.dismissWithoutSave();
            }
        });
        this.fileOpenEventRef = this.app.workspace.on('file-open', () => {
            if (!this.isSaving) {
                this.dismissWithoutSave();
            }
        });

        const currentEditor = this.editor;
        const currentFocusRequestToken = ++this.focusRequestToken;
        void currentEditor.whenReady().then(() => {
            if (
                this.editor !== currentEditor
                || this.focusRequestToken !== currentFocusRequestToken
            ) {
                return;
            }

            this.focusFrame = window.requestAnimationFrame(() => {
                this.focusFrame = 0;

                if (
                    this.editor !== currentEditor
                    || this.focusRequestToken !== currentFocusRequestToken
                ) {
                    return;
                }

                currentEditor.focus();
            });
        });
    }

    onClose() {
        if (this.activeLeafChangeEventRef) {
            this.app.workspace.offref(this.activeLeafChangeEventRef);
            this.activeLeafChangeEventRef = null;
        }
        if (this.fileOpenEventRef) {
            this.app.workspace.offref(this.fileOpenEventRef);
            this.fileOpenEventRef = null;
        }

        this.focusRequestToken += 1;
        if (this.focusFrame !== 0) {
            window.cancelAnimationFrame(this.focusFrame);
            this.focusFrame = 0;
        }

        this.releaseOverlayDismiss();
        this.editor?.destroy();
        this.editor = null;
        this.saveButtonEl = null;
        this.cancelButtonEl = null;
        this.contentEl.empty();
        this.options.onClose?.(this.closeReason);
        this.closeReason = 'unknown';

        GridNoteRangeEditorModalManager.getExistingInstance()?.onModalClosed(this);
    }

    private lockOverlayDismiss() {
        const container = this.modalEl.closest('.modal-container');
        if (!container) {
            return;
        }

        const overlay = container.querySelector<HTMLElement>('.modal-bg');
        if (!overlay) {
            return;
        }

        this.eventScope = new Component();
        this.eventScope.registerDomEvent(overlay, 'mousedown', this.blockOverlayClick, { capture: true });
        this.eventScope.registerDomEvent(overlay, 'click', this.blockOverlayClick, { capture: true });
    }

    private releaseOverlayDismiss() {
        this.eventScope?.unload();
        this.eventScope = null;
    }

    private setSavingState(isSaving: boolean) {
        this.isSaving = isSaving;

        if (this.saveButtonEl) {
            this.saveButtonEl.disabled = isSaving;
            this.saveButtonEl.textContent = isSaving ? '保存中...' : '保存';
        }

        if (this.cancelButtonEl) {
            this.cancelButtonEl.disabled = isSaving;
        }
    }

    private async handleSave() {
        if (this.isSaving) {
            return;
        }

        this.currentValue = this.editor?.value ?? this.currentValue;
        this.setSavingState(true);

        try {
            await this.options.onSave?.(this.currentValue);
            this.closeReason = 'save';
            this.close();
        } catch (error) {
            console.error('GridNote: 节点范围弹框保存失败', error);
            const message = error instanceof Error && error.message
                ? error.message
                : '保存节点内容失败';
            new Notice(message);
            this.setSavingState(false);
        }
    }

    private handleCancel(reason: GridNoteRangeEditorModalCloseReason = 'cancel') {
        if (this.isSaving) {
            return;
        }

        this.closeReason = reason;
        this.options.onCancel?.();
        this.close();
    }

    matchesSourcePath(sourcePath: string): boolean {
        return this.options.sourcePath === sourcePath;
    }

    dismissWithoutSave() {
        this.handleCancel('source-change');
    }

    isPersisting(): boolean {
        return this.isSaving;
    }
}

export class GridNoteRangeEditorModalManager {
    private static instance: GridNoteRangeEditorModalManager | null = null;
    private readonly app: App;
    private currentModal: GridNoteRangeEditorModal | null = null;
    private isOpening = false;
    private lastOpenTime = 0;
    private openingResetTimer = 0;

    private constructor(app: App) {
        this.app = app;
    }

    static getInstance(app: App): GridNoteRangeEditorModalManager {
        if (!GridNoteRangeEditorModalManager.instance) {
            GridNoteRangeEditorModalManager.instance = new GridNoteRangeEditorModalManager(app);
        }

        return GridNoteRangeEditorModalManager.instance;
    }

    static getExistingInstance(): GridNoteRangeEditorModalManager | null {
        return GridNoteRangeEditorModalManager.instance;
    }

    openEditor(options: GridNoteRangeEditorModalOptions) {
        const now = Date.now();
        if (now - this.lastOpenTime < 100 || this.isOpening || this.currentModal) {
            return;
        }

        this.isOpening = true;
        this.lastOpenTime = now;
        this.currentModal = new GridNoteRangeEditorModal(this.app, options);
        this.currentModal.open();

        if (this.openingResetTimer !== 0) {
            window.clearTimeout(this.openingResetTimer);
        }

        this.openingResetTimer = window.setTimeout(() => {
            this.isOpening = false;
            this.openingResetTimer = 0;
        }, 100);
    }

    onModalClosed(modal: GridNoteRangeEditorModal) {
        if (this.currentModal === modal) {
            if (this.openingResetTimer !== 0) {
                window.clearTimeout(this.openingResetTimer);
                this.openingResetTimer = 0;
            }

            this.currentModal = null;
            this.isOpening = false;
            this.lastOpenTime = 0;
        }
    }

    hasOpenModal(): boolean {
        return this.currentModal !== null;
    }

    dismissForSourceChange(sourcePath: string) {
        const modal = this.currentModal;
        if (!modal || modal.isPersisting() || !modal.matchesSourcePath(sourcePath)) {
            return;
        }

        modal.dismissWithoutSave();
    }

    destroy() {
        if (this.openingResetTimer !== 0) {
            window.clearTimeout(this.openingResetTimer);
            this.openingResetTimer = 0;
        }

        const modal = this.currentModal;
        this.currentModal = null;
        this.isOpening = false;
        this.lastOpenTime = 0;

        modal?.close();

        if (GridNoteRangeEditorModalManager.instance === this) {
            GridNoteRangeEditorModalManager.instance = null;
        }
    }
}

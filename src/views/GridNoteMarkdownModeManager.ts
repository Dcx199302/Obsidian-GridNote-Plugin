import {
    MarkdownView,
    Notice,
    TFile,
    WorkspaceLeaf
} from 'obsidian';
import type GridNotePlugin from '../main';
import GridNoteContent from '../components/GridNoteContent.svelte';
import { MarkdownDocumentProcessor } from '../processor';
import {
    DEFAULT_VISIBLE_TREE_LAYERS,
} from '../themes/treeModel';
import type { DocumentNode, DocumentStructure, TreeNode } from '../types';
import {
    performHistoryAction,
    readHistoryAvailability
} from '../utils/codemirrorHistory';
import {
    createHeadingLine,
    createMarkdownEditorReplacement,
    insertHeadingAtLine,
    insertHeadingInEditorBodyAtLine,
    replaceMarkdownLineRange
} from '../utils/markdownEdit';
import type {
    GridNoteCardEditDraft,
    GridNoteCardInsertPosition,
    GridNoteCardSelectionHint,
    GridNoteCardSelectionOptions
} from '../components/themes/shared/cardEditingContext';
import {
    getFrontmatterBodyStartLine,
    joinFrontmatterAndBody,
    joinMarkdownContent,
    splitPrefaceCompositeContent,
    splitMarkdownContent,
    type MarkdownContentSections
} from '../utils/markdownContent';
import {
    createRevealAnchorFromDocumentNode,
    type GridNoteRevealAnchor,
    findHistoryChangeRange,
    selectHistoryRevealLine,
    type GridNoteRevealSource,
    type GridNoteHistoryRevealRequest
} from '../utils/historyReveal';
import { GridNoteRangeEditorModalManager } from '../utils/GridNoteRangeEditorModal';
import type { GridNoteSearchResult } from '../utils/GridNoteTextSearch';
import { getSettingManager } from '../utils/obsidianInternal';
import { resolveCurrentTreeNodeRange } from '../utils/treeNodeRange';
import { isGridNotePrefaceNode } from '../utils/treeNodeKind';
import { resolveTreeInsertTarget } from '../utils/treeInsert';
import {
    copyMarkdownAsRichText,
    GridNoteCopyAction,
    readTreeNodeMarkdown
} from '../utils/gridNoteCopy';
import { GridNoteScreenshotModal } from '../utils/GridNoteScreenshotModal';
import { createActionButton } from './markdownMode/actionButton';
import { GridNoteFoldStateCoordinator } from './markdownMode/GridNoteFoldStateCoordinator';
import { SearchNavigationTracker } from './markdownMode/SearchNavigationTracker';
import { normalizeEditorText } from './markdownMode/editorText';
import { hasSourceEditorTransitioned } from './markdownMode/sourceEditorTransition';
import { describeLineEdit } from './markdownMode/foldRangeEdit';
import type { GridNoteMarkdownModeState } from './markdownMode/types';
import type { PersistedFoldState } from '../utils/foldStorage';

type GridNoteContentInstance = GridNoteContent & {
    selectNodeById(nodeId: string, options?: GridNoteCardSelectionOptions): boolean;
};

export class GridNoteMarkdownModeManager {
    private readonly plugin: GridNotePlugin;
    private readonly documentProcessor = new MarkdownDocumentProcessor();
    private historyRevealRequestId = 0;
    private destroyed = false;
    // 以 leaf 为粒度保存模式状态，避免不同标签页互相干扰。
    private readonly states = new Map<WorkspaceLeaf, GridNoteMarkdownModeState>();
    private readonly pendingGlobalFrames = new Set<number>();

    constructor(plugin: GridNotePlugin) {
        this.plugin = plugin;

        this.registerEvents();
        this.refreshAllMarkdownViews();
    }

    destroy(): void {
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;
        this.cancelPendingGlobalFrames();

        for (const [leaf, state] of this.states.entries()) {
            const view = leaf.view;
            if (view instanceof MarkdownView) {
                this.disableMode(view, state);
            }
            this.removeToggleButton(state);
        }

        const markdownLeaves = this.plugin.app.workspace.getLeavesOfType('markdown');
        for (const leaf of markdownLeaves) {
            if (!(leaf.view instanceof MarkdownView)) {
                continue;
            }

            const buttons = leaf.view.containerEl.querySelectorAll(
                '.gridnote-markdown-mode-toggle, .gridnote-markdown-mode-action'
            );
            buttons.forEach((button) => button.remove());
            leaf.view.contentEl.querySelectorAll('.gridnote-markdown-overlay')
                .forEach((overlay) => overlay.remove());
            this.toggleNativeMarkdownVisibility(leaf.view, false);
            leaf.view.containerEl.classList.remove('gridnote-markdown-mode-enabled');
            leaf.view.contentEl.classList.remove('gridnote-markdown-mode-enabled');
        }

        this.states.clear();
    }

    toggleForActiveMarkdownView(): boolean {
        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file || view.file.extension !== 'md') {
            return false;
        }

        if (!this.isSourceMarkdownView(view)) {
            new Notice('Grid note Markdown 模式仅支持源码视图');
            return false;
        }

        this.toggleMode(view);
        return true;
    }

    enableForActiveMarkdownView(): boolean {
        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file || view.file.extension !== 'md') {
            return false;
        }

        const state = this.getState(view.leaf);
        if (state.enabled) {
            return true;
        }

        state.manualEnabledFilePath = view.file.path;
        this.enableMode(view, state);
        return state.enabled;
    }

    syncModeForActiveMarkdownView(): void {
        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
            return;
        }

        this.syncModeWithGridNoteFrontmatter(view);
        const state = this.getState(view.leaf);
        if (state.enabled) {
            this.scheduleRefreshMountedView(view, state, true);
        }
    }

    /**
     * 打开设置面板
     */
    openSettings(): void {
        const setting = getSettingManager(this.plugin.app);
        const pluginId = this.plugin.manifest.id;
        if (!setting) {
            return;
        }

        setting.open();
        setting.openTabById(pluginId);
        // 部分场景会被上次设置页状态覆盖，下一帧再定位一次。
        window.requestAnimationFrame(() => {
            setting.openTabById(pluginId);
        });
    }

    openTextSearchForView(view: MarkdownView): boolean {
        const file = view.file;
        if (!file || file.extension !== 'md') {
            new Notice('仅支持 Markdown 文件');
            return false;
        }

        const state = this.states.get(view.leaf);
        if (!state?.enabled || !state.component) {
            new Notice('请先启用 GridNote Markdown 模式');
            return false;
        }

        const sections = this.getRenderableSections(view);
        state.foldLineOffset = sections.bodyStartLine;
        this.setMountedBodyState(state, sections.body);
        this.updateMountedComponent(view, state);

        if (!state.currentStructure) {
            new Notice('当前文档还没有可搜索的内容');
            return false;
        }

        this.plugin.openTextSearchModal({
            sourcePath: file.path,
            structure: state.currentStructure,
            onRevealResult: (result: GridNoteSearchResult) => {
                this.requestCardReveal(
                    state,
                    result.startLine,
                    'search',
                    result.anchor
                );
            }
        });
        return true;
    }

    private registerEvents(): void {
        // 工作区结构变化后，补齐按钮并清理已关闭的 leaf 状态。
        this.plugin.registerEvent(
            this.plugin.app.workspace.on('layout-change', () => {
                this.cleanupClosedLeafStates();
                this.refreshAllMarkdownViews();

                // 文件在同一 leaf 内切换时，layout-change 可能早于 file-open。
                // 此时立即同步 frontmatter，避免旧文件的 GridNote 覆盖层继续显示。
                for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
                    if (leaf.view instanceof MarkdownView) {
                        this.syncModeWithGridNoteFrontmatter(leaf.view);
                    }
                }
            })
        );

        this.plugin.registerEvent(
            this.plugin.app.workspace.on('active-leaf-change', (leaf) => {
                this.refreshAllMarkdownViews();

                if (!leaf || !(leaf.view instanceof MarkdownView)) {
                    return;
                }

                this.syncModeWithGridNoteFrontmatter(leaf.view);
                const state = this.getState(leaf);
                if (state.enabled) {
                    this.scheduleRefreshMountedView(leaf.view, state);
                }
            })
        );

        this.plugin.registerEvent(
            this.plugin.app.workspace.on('file-open', (file) => {
                this.scheduleGlobalFrame(() => {
                    this.refreshAllMarkdownViews();

                    if (file) {
                        this.syncModeForFilePath(file.path);
                        this.refreshMountedLeaves(file.path, true);
                    }
                });
            })
        );

        this.plugin.registerEvent(
            this.plugin.app.workspace.on('editor-change', (_editor, info) => {
                if (!(info instanceof MarkdownView)) {
                    return;
                }

                const state = this.states.get(info.leaf);
                if (!state?.enabled) {
                    return;
                }

                if (info.file) {
                    GridNoteRangeEditorModalManager.getInstance(this.plugin.app)
                        .dismissForSourceChange(info.file.path);
                }

                if (state.pendingSourceLoadPath) {
                    state.searchNavigation.capture(
                        info.editor,
                        state.pendingSourceExpectedText,
                        this.getSelectedCursorLine(info)
                    );
                    this.reconcilePendingSourceEditor(info, state);
                    return;
                }

                const previousFullMarkdown = joinFrontmatterAndBody(
                    state.currentFrontmatterText,
                    state.currentRawText
                );
                const lineEdit = describeLineEdit(
                    previousFullMarkdown,
                    info.editor.getValue()
                );
                if (lineEdit) {
                    state.foldState.remapLines(lineEdit);
                }

                // 当内容未变但 selection/cursor 移动时，检测搜索结果或大纲等外部跳转。
                const currentContent = this.getRenderableMarkdown(info);
                if (currentContent === state.currentRawText && state.currentStructure) {
                    const searchCursorLine = this.getSelectedCursorLine(info);
                    if (searchCursorLine !== null) {
                        state.lastKnownCursorLine = searchCursorLine;
                        this.handleExternalCursorNavigation(
                            state,
                            searchCursorLine,
                            'search'
                        );
                        return;
                    }

                    const cursorLine = _editor.getCursor().line;
                    if (cursorLine !== state.lastKnownCursorLine) {
                        state.lastKnownCursorLine = cursorLine;
                        this.handleExternalCursorNavigation(
                            state,
                            cursorLine,
                            'outline'
                        );
                    }
                    return;
                }

                // Overlay 的数据直接跟随原生 editor 文本刷新。
                state.lastKnownCursorLine = _editor.getCursor().line;
                this.scheduleRefreshMountedView(info, state);
            })
        );

        this.plugin.registerEvent(
            this.plugin.app.vault.on('modify', (file) => {
                if (!(file instanceof TFile) || file.extension !== 'md') {
                    return;
                }

                GridNoteRangeEditorModalManager.getInstance(this.plugin.app)
                    .dismissForSourceChange(file.path);

                this.scheduleGlobalFrame(() => {
                    this.refreshMountedLeaves(file.path, true);
                });
            })
        );

        this.plugin.registerEvent(
            this.plugin.app.metadataCache.on('changed', (file) => {
                if (file.extension !== 'md') {
                    return;
                }

                this.scheduleGlobalFrame(() => {
                    // frontmatter 缓存可能晚于 file-open 建立；缓存 ready 后再同步一次，
                    // 避免带 gridnote: true 的文件没有及时进入 GridNote。
                    this.syncModeForFilePath(file.path);
                    this.refreshMountedLeaves(file.path, true);
                });
            })
        );
    }

    private scheduleGlobalFrame(callback: () => void): void {
        if (this.destroyed) {
            return;
        }

        const frame = window.requestAnimationFrame(() => {
            this.pendingGlobalFrames.delete(frame);
            if (this.destroyed) {
                return;
            }

            callback();
        });

        this.pendingGlobalFrames.add(frame);
    }

    private cancelPendingGlobalFrames(): void {
        for (const frame of this.pendingGlobalFrames) {
            window.cancelAnimationFrame(frame);
        }

        this.pendingGlobalFrames.clear();
    }

    private getState(leaf: WorkspaceLeaf): GridNoteMarkdownModeState {
        const existingState = this.states.get(leaf);
        if (existingState) {
            return existingState;
        }

        // 默认状态只创建一次，后续在同一个 leaf 内复用。
        const state: GridNoteMarkdownModeState = {
            enabled: false,
            manualEnabledFilePath: null,
            manualDisabledFilePath: null,
            lastFrontmatterCheckFilePath: null,
            component: null,
            containerEl: null,
            currentRawText: '',
            currentFrontmatterText: '',
            currentRawLines: [],
            foldState: new GridNoteFoldStateCoordinator(this.plugin.app),
            currentStructure: null,
            foldLineOffset: 0,
            foldStateReloadRequest: 0,
            historySelectionClearRequest: 0,
            historyRevealRequest: null,
            renderedSourcePath: null,
            pendingSourceLoadPath: null,
            pendingSourceExpectedText: null,
            sourceEditorCheckTimeout: 0,
            sourceLoadVersion: 0,
            suppressRefresh: false,
            pendingFoldStateReload: false,
            refreshFrame: 0,
            lastKnownCursorLine: -1,
            searchNavigation: new SearchNavigationTracker(),
            externalNavigationCheckInterval: 0,
            buttons: {
                toggle: null
            }
        };

        this.states.set(leaf, state);
        return state;
    }

    private cleanupClosedLeafStates(): void {
        const openMarkdownLeaves = new Set(
            this.plugin.app.workspace
                .getLeavesOfType('markdown')
                .filter((leaf): leaf is WorkspaceLeaf => leaf.view instanceof MarkdownView)
        );

        for (const [leaf, state] of this.states.entries()) {
            if (!openMarkdownLeaves.has(leaf)) {
                if (leaf.view instanceof MarkdownView) {
                    this.disableMode(leaf.view, state);
                } else {
                    this.cancelScheduledRefresh(state);
                    this.cancelExternalNavigationCheck(state);
                }
                state.foldState.clearDeferredWrite();
                state.foldState.clearNativeSync();
                state.foldState.scheduleDeferredWrite();
                this.states.delete(leaf);
            }
        }
    }

    private refreshAllMarkdownViews(): void {
        const markdownLeaves = this.plugin.app.workspace
            .getLeavesOfType('markdown')
            .filter((leaf): leaf is WorkspaceLeaf => leaf.view instanceof MarkdownView);

        for (const leaf of markdownLeaves) {
            const view = leaf.view;
            if (!(view instanceof MarkdownView)) {
                continue;
            }

            const state = this.getState(leaf);

            this.ensureToggleButton(view, state);
            this.updateToggleButtonState(view, state);
            this.updateActionButtons(view, state);
        }
    }

    private refreshMountedLeaves(filePath?: string, reloadFoldState = false): void {
        for (const [leaf, state] of this.states.entries()) {
            if (!state.enabled || !(leaf.view instanceof MarkdownView)) {
                continue;
            }

            if (filePath && leaf.view.file?.path !== filePath) {
                continue;
            }

            this.scheduleRefreshMountedView(leaf.view, state, reloadFoldState);
        }
    }

    private toggleMode(view: MarkdownView): void {
        const state = this.getState(view.leaf);
        if (state.enabled) {
            state.manualEnabledFilePath = null;
            state.manualDisabledFilePath = view.file?.path ?? null;
            this.disableMode(view, state);
            return;
        }

        state.manualDisabledFilePath = null;
        state.manualEnabledFilePath = view.file?.path ?? null;
        this.enableMode(view, state);
    }

    private enableMode(
        view: MarkdownView,
        state: GridNoteMarkdownModeState,
        loadInitialContentFromVault = false
    ): void {
        if (!view.file || view.file.extension !== 'md') {
            new Notice('仅支持 Markdown 文件');
            return;
        }

        if (!this.isSourceMarkdownView(view)) {
            new Notice('Grid note Markdown 模式仅支持源码视图');
            return;
        }

        this.blurFocusedElementInsideView(view);
        state.enabled = true;
        // 只叠加一层 GridNote UI，底层原生 editor 仍然保留用于历史与内容同步。
        state.containerEl = this.ensureOverlayContainer(view);
        state.component = new GridNoteContent({
            target: state.containerEl,
            props: {
                documentStructure: null,
                frontmatterText: '',
                app: this.plugin.app,
                sourcePath: view.file.path,
                foldLineOffset: state.foldLineOffset,
                foldStateReloadRequest: state.foldStateReloadRequest,
                visibleTreeLayers: DEFAULT_VISIBLE_TREE_LAYERS,
                historySelectionClearRequest: state.historySelectionClearRequest,
                historyRevealRequest: state.historyRevealRequest,
                canUndo: readHistoryAvailability(view.editor).canUndo,
                canRedo: readHistoryAvailability(view.editor).canRedo,
                onSaveTitleEdit: (node: TreeNode, title: string) =>
                    this.handleTitleEditSave(view, state, node, title),
                onOpenNodeRangeEdit: (node: TreeNode) =>
                    this.handleNodeRangeEdit(view, state, node),
                onSaveCardEdit: (node: TreeNode, draft: GridNoteCardEditDraft) =>
                    this.handleCardEditSave(view, state, node, draft),
                onDeleteNode: (node: TreeNode) =>
                    this.handleNodeDelete(view, state, node),
                onCopyNodeAction: (node: TreeNode, action: GridNoteCopyAction, anchorEl: HTMLElement) =>
                    this.handleNodeCopyAction(view, state, node, action, anchorEl),
                onInsertNode: (node: TreeNode, position: GridNoteCardInsertPosition) =>
                    this.handleNodeInsert(view, state, node, position),
                onOpenTextSearch: () => {
                    this.openTextSearchForView(view);
                },
                onUndo: () => this.performMountedHistoryAction(view, state, 'undo'),
                onRedo: () => this.performMountedHistoryAction(view, state, 'redo'),
                onOpenSiblingFileSwitcher: () => {
                    this.plugin.openSiblingFileSwitcherForMarkdownView(view);
                },
                onOpenSettings: () => this.openSettings(),
                onPersistFoldState: (nextPersistedFoldState: PersistedFoldState | null) =>
                    this.handleMountedPersistedFoldState(view, state, nextPersistedFoldState),
                onCreateRootNode: () => this.handleCreateRootNode(view, state)
            }
        });

        view.containerEl.classList.add('gridnote-markdown-mode-enabled');
        this.setViewHeaderClass(view, true);
        this.toggleNativeMarkdownVisibility(view, true);
        state.lastKnownCursorLine = view.editor.getCursor().line;
        this.scheduleExternalNavigationCheck(view, state);
        if (loadInitialContentFromVault) {
            this.loadMountedViewFromVault(view, state);
        } else {
            this.scheduleRefreshMountedView(view, state);
        }
        this.updateToggleButtonState(view, state);
        this.updateActionButtons(view, state);
    }

    private disableMode(view: MarkdownView, state: GridNoteMarkdownModeState): void {
        state.foldState.captureSourcePath(
            view.file?.path ?? state.renderedSourcePath
        );
        state.foldState.clearDeferredWrite();
        state.foldState.clearNativeSync();
        this.cancelExternalNavigationCheck(state);
        state.lastKnownCursorLine = -1;
        state.searchNavigation.reset();
        state.enabled = false;
        state.manualEnabledFilePath = null;
        // 保留 manualDisabledFilePath，让 syncModeWithGridNoteFrontmatter 知道用户手动关闭过
        this.cancelScheduledRefresh(state);
        state.component?.$destroy();
        state.component = null;
        state.containerEl?.remove();
        state.containerEl = null;
        state.currentRawText = '';
        state.currentFrontmatterText = '';
        state.currentRawLines = [];
        state.currentStructure = null;
        state.foldLineOffset = 0;
        state.foldStateReloadRequest = 0;
        state.historySelectionClearRequest = 0;
        state.historyRevealRequest = null;
        state.renderedSourcePath = null;
        state.pendingSourceLoadPath = null;
        state.pendingSourceExpectedText = null;
        this.cancelPendingSourceEditorCheck(state);
        state.sourceLoadVersion += 1;
        state.suppressRefresh = false;
        state.pendingFoldStateReload = false;
        state.foldState.scheduleDeferredWrite();

        view.containerEl.classList.remove('gridnote-markdown-mode-enabled');
        this.setViewHeaderClass(view, false);
        this.toggleNativeMarkdownVisibility(view, false);
        state.foldState.scheduleNativeSync(
            view,
            () => this.isSourceMarkdownView(view)
        );
        this.updateToggleButtonState(view, state);
        this.removeActionButtons();
    }

    private setViewHeaderClass(view: MarkdownView, enabled: boolean): void {
        view.containerEl
            .querySelector('.view-header')
            ?.classList.toggle('gridnote-view-header', enabled);
    }

    private scheduleRefreshMountedView(
        view: MarkdownView,
        state: GridNoteMarkdownModeState,
        reloadFoldState = false
    ): void {
        if (!state.enabled || !state.component || !view.file) {
            return;
        }

        // 文件切换期间 editor 可能仍保留上一个文件的内容，
        // 此时等待 vault 数据完成首次装载，避免把旧文件解析成新文件。
        if (state.pendingSourceLoadPath === view.file.path) {
            return;
        }

        state.pendingFoldStateReload = state.pendingFoldStateReload || reloadFoldState;

        if (state.refreshFrame !== 0) {
            return;
        }

        state.refreshFrame = window.requestAnimationFrame(() => {
            state.refreshFrame = 0;
            const shouldReloadFoldState = state.pendingFoldStateReload;
            state.pendingFoldStateReload = false;

            if (!state.enabled || !state.component || !view.file) {
                return;
            }

            this.refreshMountedView(view, state, shouldReloadFoldState);
        });
    }

    private cancelScheduledRefresh(state: GridNoteMarkdownModeState): void {
        if (state.refreshFrame === 0) {
            return;
        }

        window.cancelAnimationFrame(state.refreshFrame);
        state.refreshFrame = 0;
    }

    private refreshMountedView(
        view: MarkdownView,
        state: GridNoteMarkdownModeState,
        reloadFoldState: boolean
    ): void {
        if (!state.enabled || !state.component || !view.file) {
            return;
        }

        if (state.suppressRefresh || state.pendingSourceLoadPath) {
            return;
        }

        const sections = this.getRenderableSections(view);
        const content = sections.body;
        const isStructureSynced = (
            content === state.currentRawText
            && sections.frontmatter === state.currentFrontmatterText
            && state.foldLineOffset === sections.bodyStartLine
            && Boolean(state.currentStructure)
        );
        const isSourcePathSynced = state.renderedSourcePath === view.file.path;

        if (isStructureSynced && isSourcePathSynced) {
            this.updateActionButtons(view, state);
            this.replayPendingSearchNavigation(state);
            return;
        }

        if (!isStructureSynced) {
            state.foldLineOffset = sections.bodyStartLine;
            // 只有文本确实变化时才重新解析树，减少无效刷新。
            this.setMountedBodyState(state, content, sections.frontmatter);

            if (reloadFoldState) {
                this.requestMountedFoldStateReload(state);
            }
        }

        this.updateMountedComponent(view, state);
        this.updateActionButtons(view, state);
        this.replayPendingSearchNavigation(state);
    }

    private getRenderableSections(view: MarkdownView): MarkdownContentSections {
        const rawContent = view.editor.getValue();
        const cache = view.file
            ? this.plugin.app.metadataCache.getFileCache(view.file)
            : null;

        return splitMarkdownContent(rawContent, cache);
    }

    private getRenderableMarkdown(view: MarkdownView): string {
        return this.getRenderableSections(view).body;
    }

    private async handleCardEditSave(
        view: MarkdownView,
        state: GridNoteMarkdownModeState,
        node: TreeNode,
        draft: GridNoteCardEditDraft
    ): Promise<void> {
        const file = view.file;
        if (!file) {
            return;
        }

        const nextText = draft.content;
        const fullMarkdown = view.editor.getValue();
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const sections = splitMarkdownContent(fullMarkdown, cache);
        const nextBody = replaceMarkdownLineRange(
            sections.body,
            node.editStartLine,
            node.editEndLine,
            nextText
        );

        if (nextBody === sections.body) {
            return;
        }

        const replacement = createMarkdownEditorReplacement(
            fullMarkdown,
            sections.bodyStartLine,
            node.editStartLine,
            node.editEndLine,
            nextText
        );

        state.suppressRefresh = true;
        // 保存卡片是明确的本地编辑过渡，不能让旧的历史 reveal 继续参与滚动。
        state.historyRevealRequest = null;
        this.applyParsedMountedBody(view, state, nextBody);

        try {
            view.editor.replaceRange(
                replacement.replacement,
                replacement.from,
                replacement.to
            );
            await view.save(false);
            state.lastKnownCursorLine = view.editor.getCursor().line;
            state.suppressRefresh = false;
            this.updateActionButtons(view, state);
        } catch (error) {
            state.lastKnownCursorLine = view.editor.getCursor().line;
            state.suppressRefresh = false;
            this.syncMountedStateFromEditor(view, state);
            throw error;
        }
    }

    private async handleTitleEditSave(
        view: MarkdownView,
        state: GridNoteMarkdownModeState,
        node: TreeNode,
        title: string
    ): Promise<void> {
        const file = view.file;
        if (!file || node.headingLevel === null) {
            return;
        }

        const fullMarkdown = view.editor.getValue();
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const sections = splitMarkdownContent(fullMarkdown, cache);
        const nextTitleLine = createHeadingLine(node.headingLevel, title);
        const nextBody = replaceMarkdownLineRange(
            sections.body,
            node.startLine,
            node.startLine,
            nextTitleLine
        );

        if (nextBody === sections.body) {
            return;
        }

        const replacement = createMarkdownEditorReplacement(
            fullMarkdown,
            sections.bodyStartLine,
            node.startLine,
            node.startLine,
            nextTitleLine
        );

        try {
            state.suppressRefresh = true;
            view.editor.replaceRange(
                replacement.replacement,
                replacement.from,
                replacement.to
            );
            await view.save(false);
            state.suppressRefresh = false;
            this.applyParsedMountedBody(view, state, nextBody);
            this.updateActionButtons(view, state);
        } catch (error) {
            state.suppressRefresh = false;
            this.syncMountedStateFromEditor(view, state);
            throw error;
        }
    }

    private async handleCreateRootNode(
        view: MarkdownView,
        state: GridNoteMarkdownModeState
    ): Promise<void> {
        const file = view.file;
        if (!file) {
            return;
        }

        try {
            view.editor.replaceRange('# 根节点\n\n', { line: 0, ch: 0 });
            const nextBody = this.getRenderableMarkdown(view);
            this.applyParsedMountedBody(view, state, nextBody);
            await view.save(false);
            this.updateActionButtons(view, state);
        } catch (error) {
            this.syncMountedStateFromEditor(view, state);
            throw error;
        }
    }

    private async handleNodeInsert(
        view: MarkdownView,
        state: GridNoteMarkdownModeState,
        node: TreeNode,
        position: GridNoteCardInsertPosition
    ): Promise<GridNoteCardSelectionHint | null> {
        const file = view.file;
        if (!file) {
            return null;
        }

        const insertTarget = resolveTreeInsertTarget(node, position);
        if (!insertTarget) {
            return null;
        }

        const cache = this.plugin.app.metadataCache.getFileCache(file);

        if (view.editor) {
            try {
                const insertedBodyLine = insertHeadingInEditorBodyAtLine(
                    view.editor,
                    insertTarget.insertLine,
                    state.foldLineOffset,
                    insertTarget.headingLevel
                );
                const nextBody = this.getRenderableMarkdown(view);
                this.applyParsedMountedBody(view, state, nextBody);
                await view.save(false);
                this.updateActionButtons(view, state);

                return {
                    identityKey: `heading:${insertedBodyLine}`,
                    startLine: insertedBodyLine,
                    headingLevel: insertTarget.headingLevel,
                    header: '新建标题'
                };
            } catch (error) {
                this.syncMountedStateFromEditor(view, state);
                throw error;
            }
        }

        const fullMarkdown = await this.plugin.app.vault.read(file);
        const sections = splitMarkdownContent(fullMarkdown, cache);
        const nextBody = insertHeadingAtLine(
            sections.body,
            insertTarget.insertLine,
            insertTarget.headingLevel
        );
        const nextMarkdown = joinMarkdownContent(sections, nextBody);
        if (nextMarkdown === fullMarkdown) {
            return null;
        }

        await this.plugin.app.vault.modify(file, nextMarkdown);
        this.applyParsedMountedBody(view, state, nextBody);
        this.updateActionButtons(view, state);

        return {
            identityKey: `heading:${insertTarget.insertLine}`,
            startLine: insertTarget.insertLine,
            headingLevel: insertTarget.headingLevel,
            header: '新建标题'
        };
    }

    private async handleNodeDelete(
        view: MarkdownView,
        state: GridNoteMarkdownModeState,
        node: TreeNode
    ): Promise<boolean> {
        const file = view.file;
        if (!file || node.headingLevel === null) {
            return false;
        }

        const fullMarkdown = view.editor?.getValue() ?? await this.plugin.app.vault.read(file);
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const sections = splitMarkdownContent(fullMarkdown, cache);
        const nextBody = replaceMarkdownLineRange(
            sections.body,
            node.startLine,
            node.endLine,
            ''
        );

        if (nextBody === sections.body) {
            return false;
        }

        if (view.editor) {
            const replacement = createMarkdownEditorReplacement(
                fullMarkdown,
                sections.bodyStartLine,
                node.startLine,
                node.endLine,
                ''
            );

            try {
                state.suppressRefresh = true;
                view.editor.replaceRange(
                    replacement.replacement,
                    replacement.from,
                    replacement.to
                );
                await view.save(false);
                state.suppressRefresh = false;
                this.applyParsedMountedBody(view, state, nextBody);
                this.updateActionButtons(view, state);
                new Notice(`已删除节点: ${node.header}`);
                return true;
            } catch (error) {
                state.suppressRefresh = false;
                this.syncMountedStateFromEditor(view, state);
                new Notice('删除节点失败，请重试');
                throw error;
            }
        }

        const nextMarkdown = joinMarkdownContent(sections, nextBody);
        await this.plugin.app.vault.modify(file, nextMarkdown);
        this.applyParsedMountedBody(view, state, nextBody);
        this.updateActionButtons(view, state);
        new Notice(`已删除节点: ${node.header}`);
        return true;
    }

    private handleNodeRangeEdit(
        view: MarkdownView,
        state: GridNoteMarkdownModeState,
        node: TreeNode
    ): void {
        const file = view.file;
        if (!file) {
            return;
        }

        const isPrefaceNode = isGridNotePrefaceNode(node);
        const modalManager = GridNoteRangeEditorModalManager.getInstance(this.plugin.app);
        const prefaceValue = this.readMountedBodyRange(state, node.startLine, node.endLine);
        const editValue = isPrefaceNode
            ? joinFrontmatterAndBody(state.currentFrontmatterText, prefaceValue)
            : prefaceValue;
        modalManager.openEditor({
            sourcePath: file.path,
            value: editValue,
            placeholder: isPrefaceNode
                ? '编辑笔记属性和前置内容...'
                : '编辑当前标题及其子节点的完整内容...',
            onSave: async (value: string) => {
                await this.handleNodeRangeEditSave(view, state, node, value);
            },
            onClose: (reason) => {
                if (reason === 'source-change' || reason === 'destroy') {
                    return;
                }

                const contentComponent = state.component as GridNoteContentInstance | null;
                window.requestAnimationFrame(() => {
                    contentComponent?.selectNodeById(node.viewId, {
                        focus: true,
                        scroll: false
                    });
                });
            }
        });
    }

    private async handleNodeRangeEditSave(
        view: MarkdownView,
        state: GridNoteMarkdownModeState,
        node: TreeNode,
        value: string
    ): Promise<void> {
        const file = view.file;
        if (!file) {
            return;
        }

        const fullMarkdown = view.editor?.getValue() ?? await this.plugin.app.vault.read(file);
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const sections = splitMarkdownContent(fullMarkdown, cache);
        if (isGridNotePrefaceNode(node)) {
            const parsedPreface = splitPrefaceCompositeContent(value);
            const structure = state.currentStructure?.rawText === sections.body
                ? state.currentStructure
                : this.documentProcessor.parse(sections.body);
            const currentRange = resolveCurrentTreeNodeRange(structure, node);
            if (!currentRange) {
                throw new Error('节点位置已变化，请重新打开弹框后再试');
            }

            const nextBody = replaceMarkdownLineRange(
                sections.body,
                currentRange.startLine,
                currentRange.endLine,
                parsedPreface.preface
            );
            const nextMarkdown = joinFrontmatterAndBody(
                parsedPreface.frontmatter,
                nextBody
            );

            if (nextMarkdown === fullMarkdown) {
                return;
            }

            if (view.editor) {
                const previousBody = state.currentRawText;
                const previousFrontmatter = state.currentFrontmatterText;

                try {
                    state.suppressRefresh = true;
                    view.editor.setValue(nextMarkdown);
                    await view.save(false);
                    state.suppressRefresh = false;
                    state.foldLineOffset = getFrontmatterBodyStartLine(parsedPreface.frontmatter);
                    this.setMountedBodyState(state, nextBody, parsedPreface.frontmatter);
                    this.requestMountedFoldStateReload(state);
                    this.updateMountedComponent(view, state);
                    this.updateActionButtons(view, state);
                    return;
                } catch (error) {
                    state.suppressRefresh = false;
                    state.foldLineOffset = getFrontmatterBodyStartLine(previousFrontmatter);
                    this.setMountedBodyState(state, previousBody, previousFrontmatter);
                    this.updateMountedComponent(view, state);
                    throw error;
                }
            }

            await this.plugin.app.vault.modify(file, nextMarkdown);
            state.foldLineOffset = getFrontmatterBodyStartLine(parsedPreface.frontmatter);
            this.setMountedBodyState(state, nextBody, parsedPreface.frontmatter);
            this.requestMountedFoldStateReload(state);
            this.updateMountedComponent(view, state);
            this.updateActionButtons(view, state);
            return;
        }

        const structure = state.currentStructure?.rawText === sections.body
            ? state.currentStructure
            : this.documentProcessor.parse(sections.body);
        const currentRange = resolveCurrentTreeNodeRange(structure, node);
        if (!currentRange) {
            throw new Error('节点位置已变化，请重新打开弹框后再试');
        }
        const nextBody = replaceMarkdownLineRange(
            sections.body,
            currentRange.startLine,
            currentRange.endLine,
            value
        );

        if (nextBody === sections.body) {
            return;
        }

        if (view.editor) {
            const replacement = createMarkdownEditorReplacement(
                fullMarkdown,
                sections.bodyStartLine,
                currentRange.startLine,
                currentRange.endLine,
                value
            );

            try {
                state.suppressRefresh = true;
                view.editor.replaceRange(
                    replacement.replacement,
                    replacement.from,
                    replacement.to
                );
                await view.save(false);
                state.suppressRefresh = false;
                this.applyParsedMountedBody(view, state, nextBody);
                this.updateActionButtons(view, state);
                return;
            } catch (error) {
                state.suppressRefresh = false;
                this.syncMountedStateFromEditor(view, state);
                throw error;
            }
        }

        const nextMarkdown = joinMarkdownContent(sections, nextBody);
        await this.plugin.app.vault.modify(file, nextMarkdown);
        this.applyParsedMountedBody(view, state, nextBody);
        this.updateActionButtons(view, state);
    }

    private async handleNodeCopyAction(
        view: MarkdownView,
        state: GridNoteMarkdownModeState,
        node: TreeNode,
        action: GridNoteCopyAction,
        anchorEl: HTMLElement
    ): Promise<void> {
        const file = view.file;
        if (!file) {
            return;
        }

        switch (action) {
            case GridNoteCopyAction.COPY_FULL_TEXT: {
                const fullMarkdown = view.editor?.getValue() ?? await this.plugin.app.vault.read(file);
                await navigator.clipboard.writeText(fullMarkdown);
                new Notice('整个文档已复制到剪贴板');
                return;
            }
            case GridNoteCopyAction.COPY_CURRENT_NODE: {
                await navigator.clipboard.writeText(node.fullText);
                new Notice('当前节点已复制到剪贴板');
                return;
            }
            case GridNoteCopyAction.COPY_WITH_CHILDREN: {
                const markdown = readTreeNodeMarkdown(
                    state.currentRawText,
                    state.currentStructure,
                    node
                );

                if (markdown === null) {
                    new Notice('节点位置已变化，请稍后重试');
                    return;
                }

                await navigator.clipboard.writeText(markdown);
                new Notice('节点及子节点已复制到剪贴板');
                return;
            }
            case GridNoteCopyAction.COPY_RENDERED_CURRENT_NODE: {
                await copyMarkdownAsRichText(this.plugin.app, node.fullText, file.path);
                new Notice('当前节点富文本已复制到剪贴板');
                return;
            }
            case GridNoteCopyAction.COPY_RENDERED_WITH_CHILDREN: {
                const markdown = readTreeNodeMarkdown(
                    state.currentRawText,
                    state.currentStructure,
                    node
                );

                if (markdown === null) {
                    new Notice('节点位置已变化，请稍后重试');
                    return;
                }

                await copyMarkdownAsRichText(this.plugin.app, markdown, file.path);
                new Notice('节点及子节点富文本已复制到剪贴板');
                return;
            }
            case GridNoteCopyAction.COPY_AS_IMAGE: {
                const sourceNodeEl = anchorEl.closest<HTMLElement>(
                    '.cascade-node'
                );

                if (!sourceNodeEl) {
                    new Notice('当前节点还未渲染完成，暂时无法生成图片');
                    return;
                }

                new GridNoteScreenshotModal(this.plugin.app, {
                    sourceEl: sourceNodeEl,
                    title: node.header,
                    screenshotFolder: this.plugin.settings.screenshotFolder
                }).open();
                return;
            }
            default:
                return;
        }
    }

    private updateMountedComponent(
        view: MarkdownView,
        state: GridNoteMarkdownModeState
    ): void {
        if (!state.component || !view.file) {
            return;
        }

        state.component.$set({
            documentStructure: state.currentStructure,
            frontmatterText: state.currentFrontmatterText,
            app: this.plugin.app,
            sourcePath: view.file.path,
            foldLineOffset: state.foldLineOffset,
            foldStateReloadRequest: state.foldStateReloadRequest,
            visibleTreeLayers: DEFAULT_VISIBLE_TREE_LAYERS,
            historySelectionClearRequest: state.historySelectionClearRequest,
            historyRevealRequest: state.historyRevealRequest,
            canUndo: readHistoryAvailability(view.editor).canUndo,
            canRedo: readHistoryAvailability(view.editor).canRedo,
            onSaveTitleEdit: (node: TreeNode, title: string) =>
                this.handleTitleEditSave(view, state, node, title),
            onOpenNodeRangeEdit: (node: TreeNode) =>
                this.handleNodeRangeEdit(view, state, node),
            onSaveCardEdit: (node: TreeNode, draft: GridNoteCardEditDraft) =>
                this.handleCardEditSave(view, state, node, draft),
            onDeleteNode: (node: TreeNode) =>
                this.handleNodeDelete(view, state, node),
            onCopyNodeAction: (node: TreeNode, action: GridNoteCopyAction, anchorEl: HTMLElement) =>
                this.handleNodeCopyAction(view, state, node, action, anchorEl),
            onInsertNode: (node: TreeNode, position: GridNoteCardInsertPosition) =>
                this.handleNodeInsert(view, state, node, position),
            onOpenTextSearch: () => {
                this.openTextSearchForView(view);
            },
            onUndo: () => this.performMountedHistoryAction(view, state, 'undo'),
            onRedo: () => this.performMountedHistoryAction(view, state, 'redo'),
            onOpenSiblingFileSwitcher: () => {
                this.plugin.openSiblingFileSwitcherForMarkdownView(view);
            },
            onOpenSettings: () => this.openSettings(),
            onPersistFoldState: (nextPersistedFoldState: PersistedFoldState | null) =>
                this.handleMountedPersistedFoldState(view, state, nextPersistedFoldState),
            onCreateRootNode: () => this.handleCreateRootNode(view, state)
        });
        state.renderedSourcePath = view.file.path;
    }

    private handleMountedPersistedFoldState(
        view: MarkdownView,
        state: GridNoteMarkdownModeState,
        nextPersistedFoldState: PersistedFoldState | null
    ): void {
        state.foldState.capture(
            nextPersistedFoldState,
            view.file?.path ?? state.renderedSourcePath
        );
    }

    private applyParsedMountedBody(
        view: MarkdownView,
        state: GridNoteMarkdownModeState,
        nextBody: string
    ): void {
        this.setMountedBodyState(state, nextBody);
        this.updateMountedComponent(view, state);
    }

    private createCursorRevealAnchor(
        state: GridNoteMarkdownModeState,
        bodyLine: number
    ): GridNoteRevealAnchor | null {
        if (!state.currentStructure || bodyLine < 0) {
            return null;
        }

        // 外部导航可能在大文档上高频触发；一次线性扫描避免 filter + sort 的额外分配。
        let anchorNode: DocumentNode | null = null;
        let anchorNodeSpan = Number.POSITIVE_INFINITY;
        for (const node of state.currentStructure.lineIndex) {
            if (
                bodyLine < node.range.startLine
                || bodyLine > node.range.endLine
            ) {
                continue;
            }

            const nodeSpan = node.range.endLine - node.range.startLine;
            if (nodeSpan < anchorNodeSpan) {
                anchorNode = node;
                anchorNodeSpan = nodeSpan;
            }
        }

        return anchorNode
            ? createRevealAnchorFromDocumentNode(anchorNode)
            : null;
    }

    private createHistoryRevealRequest(
        line: number | null,
        source: GridNoteRevealSource = 'history',
        anchor?: GridNoteRevealAnchor,
        revealLine?: number | null
    ): GridNoteHistoryRevealRequest | null {
        if (line === null && !anchor) {
            return null;
        }

        this.historyRevealRequestId += 1;
        return {
            requestId: this.historyRevealRequestId,
            line,
            anchor,
            source,
            revealLine: source === 'history' ? revealLine ?? line : undefined,
            scrollMode: source === 'history' ? 'change' : 'anchor'
        };
    }

    /**
     * 所有定位入口的收敛点：内部搜索、Obsidian 搜索/大纲、undo/redo
     * 都生成同一种 reveal request，由 GridNoteContent 统一处理展开与滚动。
     */
    private requestCardReveal(
        state: GridNoteMarkdownModeState,
        line: number | null,
        source: GridNoteRevealSource,
        anchor?: GridNoteRevealAnchor,
        revealLine?: number | null
    ): boolean {
        const request = this.createHistoryRevealRequest(
            line,
            source,
            anchor,
            revealLine
        );
        if (!request || state.suppressRefresh || !state.component) {
            return false;
        }

        state.historySelectionClearRequest += 1;
        state.historyRevealRequest = request;
        state.component.$set({
            historySelectionClearRequest: state.historySelectionClearRequest,
            historyRevealRequest: request
        });
        return true;
    }

    private requestMountedHistorySelectionClear(state: GridNoteMarkdownModeState): void {
        state.historySelectionClearRequest += 1;
        state.component?.$set({
            historySelectionClearRequest: state.historySelectionClearRequest
        });
    }

    private getSelectedCursorLine(view: MarkdownView): number | null {
        if (!view.editor.somethingSelected()) {
            return null;
        }

        return view.editor.getCursor('from').line;
    }

    private replayPendingSearchNavigation(state: GridNoteMarkdownModeState): void {
        const cursorLine = state.searchNavigation.pendingCursorLine;
        if (cursorLine === null || !state.currentStructure || !state.component) {
            return;
        }

        if (this.handleExternalCursorNavigation(state, cursorLine, 'search')) {
            state.searchNavigation.clearPendingCursorLine();
        }
    }

    private handleExternalCursorNavigation(
        state: GridNoteMarkdownModeState,
        cursorLine: number,
        source: GridNoteRevealSource
    ): boolean {
        if (!state.currentStructure) {
            return false;
        }

        const bodyLine = cursorLine - state.foldLineOffset;
        if (bodyLine < 0) {
            return false;
        }

        const anchor = this.createCursorRevealAnchor(state, bodyLine);
        const targetLine = anchor?.startLine
            ?? this.findNearestHeadingLine(state.currentStructure, bodyLine);
        if (targetLine === null) {
            return false;
        }

        return this.requestCardReveal(
            state,
            targetLine,
            source,
            anchor ?? undefined
        );
    }

    private findNearestHeadingLine(
        structure: DocumentStructure,
        bodyLine: number
    ): number | null {
        for (let i = structure.lineIndex.length - 1; i >= 0; i--) {
            const node = structure.lineIndex[i]!;
            if (node.range.startLine <= bodyLine && node.heading) {
                return node.range.startLine;
            }
        }
        return null;
    }

    private scheduleExternalNavigationCheck(
        view: MarkdownView,
        state: GridNoteMarkdownModeState
    ): void {
        this.cancelExternalNavigationCheck(state);

        state.externalNavigationCheckInterval = window.setInterval(() => {
            if (!state.enabled || !state.component || !view.file) {
                this.cancelExternalNavigationCheck(state);
                return;
            }

            if (state.suppressRefresh || state.pendingSourceLoadPath) {
                return;
            }

            const cursorLine = view.editor.getCursor().line;
            const searchCursorLine = this.getSelectedCursorLine(view);
            if (
                searchCursorLine !== null
                && searchCursorLine !== state.lastKnownCursorLine
            ) {
                state.lastKnownCursorLine = searchCursorLine;
                this.handleExternalCursorNavigation(
                    state,
                    searchCursorLine,
                    'search'
                );
                return;
            }

            if (state.lastKnownCursorLine === -1) {
                state.lastKnownCursorLine = cursorLine;
                return;
            }

            if (cursorLine === state.lastKnownCursorLine) {
                return;
            }

            state.lastKnownCursorLine = cursorLine;
            this.handleExternalCursorNavigation(state, cursorLine, 'outline');
        }, 250);
    }

    private cancelExternalNavigationCheck(state: GridNoteMarkdownModeState): void {
        if (state.externalNavigationCheckInterval !== 0) {
            window.clearInterval(state.externalNavigationCheckInterval);
            state.externalNavigationCheckInterval = 0;
        }
    }

    private requestMountedFoldStateReload(state: GridNoteMarkdownModeState): void {
        state.foldStateReloadRequest += 1;
        state.component?.$set({
            foldLineOffset: state.foldLineOffset,
            foldStateReloadRequest: state.foldStateReloadRequest
        });
    }

    private syncMountedStateFromEditor(
        view: MarkdownView,
        state: GridNoteMarkdownModeState
    ): void {
        const sections = this.getRenderableSections(view);
        state.foldLineOffset = sections.bodyStartLine;
        this.setMountedBodyState(state, sections.body, sections.frontmatter);
        this.updateMountedComponent(view, state);
    }

    private setMountedBodyState(
        state: GridNoteMarkdownModeState,
        nextBody: string,
        nextFrontmatterText: string = state.currentFrontmatterText
    ): void {
        state.currentFrontmatterText = nextFrontmatterText;
        state.currentRawText = nextBody;
        state.currentRawLines = nextBody === '' ? [] : nextBody.split('\n');
        state.currentStructure = this.documentProcessor.parse(nextBody);
    }

    private readMountedBodyRange(
        state: GridNoteMarkdownModeState,
        startLine: number,
        endLine: number
    ): string {
        const safeStartLine = Math.max(0, Math.min(startLine, state.currentRawLines.length));
        const safeEndLine = Math.max(
            safeStartLine - 1,
            Math.min(endLine, state.currentRawLines.length - 1)
        );

        if (safeEndLine < safeStartLine) {
            return '';
        }

        return state.currentRawLines.slice(safeStartLine, safeEndLine + 1).join('\n');
    }

    private performMountedHistoryAction(
        view: MarkdownView,
        state: GridNoteMarkdownModeState,
        action: 'undo' | 'redo'
    ): boolean {
        const beforeContent = this.getRenderableMarkdown(view);
        const beforeFullMarkdown = view.editor.getValue();
        state.historyRevealRequest = null;
        this.requestMountedHistorySelectionClear(state);

        const changed = performHistoryAction(view.editor, action);
        const currentFullMarkdown = view.editor.getValue();
        const contentChanged = currentFullMarkdown !== beforeFullMarkdown;
        state.lastKnownCursorLine = view.editor.getCursor().line;
        this.updateActionButtons(view, state);

        if (!changed && !contentChanged) {
            return false;
        }

        this.syncMountedStateFromEditor(view, state);

        const afterContent = this.getRenderableMarkdown(view);
        const bodyChanged = afterContent !== beforeContent;
        if (!bodyChanged) {
            this.updateActionButtons(view, state);
            return true;
        }

        const changeRange = findHistoryChangeRange(beforeContent, afterContent);
        const cursorBodyLine = view.editor.getCursor().line - state.foldLineOffset;
        const revealLine = selectHistoryRevealLine(
            changeRange,
            cursorBodyLine,
            afterContent
        );
        const anchor = revealLine === null
            ? null
            : this.createCursorRevealAnchor(state, revealLine);
        this.requestCardReveal(
            state,
            anchor?.startLine ?? revealLine,
            'history',
            anchor ?? undefined,
            revealLine
        );
        this.updateActionButtons(view, state);
        return true;
    }

    private ensureToggleButton(
        view: MarkdownView,
        state: GridNoteMarkdownModeState
    ): void {
        const actionContainer = view.containerEl.querySelector('.view-actions');
        if (!actionContainer?.instanceOf(HTMLElement)) {
            return;
        }

        if (state.buttons.toggle?.isConnected) {
            return;
        }

        const toggleButton = createActionButton({
            icon: 'layout-template',
            label: '切换 GridNote 模式',
            registerDomEvent: (element, type, callback) =>
                this.plugin.registerDomEvent(element, type, callback),
            onClick: () => this.toggleMode(view)
        });

        toggleButton.classList.add('gridnote-markdown-mode-toggle');
        actionContainer.insertBefore(toggleButton, actionContainer.firstChild);
        state.buttons.toggle = toggleButton;
    }

    private updateToggleButtonState(
        view: MarkdownView,
        state: GridNoteMarkdownModeState
    ): void {
        const toggleButton = state.buttons.toggle;
        if (!toggleButton) {
            return;
        }

        const shouldShow = Boolean(
            view.file &&
            view.file.extension === 'md' &&
            this.isSourceMarkdownView(view)
        );
        toggleButton.style.display = shouldShow ? '' : 'none';
        toggleButton.classList.toggle('is-active', state.enabled);

        const label = state.enabled
            ? '退出 GridNote Markdown 模式'
            : '进入 GridNote Markdown 模式';
        toggleButton.setAttribute('aria-label', label);
    }

    private updateActionButtons(
        view: MarkdownView,
        state: GridNoteMarkdownModeState
    ): void {
        if (state.enabled && !this.isSourceMarkdownView(view)) {
            this.disableMode(view, state);
            return;
        }

        if (!state.enabled) {
            this.removeActionButtons();
            return;
        }

        const toggleButton = state.buttons.toggle;
        const actionContainer = view.containerEl.querySelector('.view-actions');
        if (!toggleButton?.instanceOf(HTMLElement) || !actionContainer?.instanceOf(HTMLElement)) {
            return;
        }
        this.syncFloatingToolbarState(view);
    }

    private syncFloatingToolbarState(view: MarkdownView): void {
        const availability = readHistoryAvailability(view.editor);
        const state = this.getState(view.leaf);

        state.component?.$set({
            canUndo: availability.canUndo,
            canRedo: availability.canRedo
        });
    }

    private removeActionButtons(): void {
        const buttons: Array<HTMLElement | null> = [];

        for (const button of buttons) {
            button?.remove();
        }
    }

    private removeToggleButton(state: GridNoteMarkdownModeState): void {
        state.buttons.toggle?.remove();
        state.buttons.toggle = null;
    }

    private ensureOverlayContainer(view: MarkdownView): HTMLElement {
        const existingContainer = view.contentEl.querySelector('.gridnote-markdown-overlay');
        if (existingContainer?.instanceOf(HTMLElement)) {
            existingContainer.replaceChildren();
            return existingContainer;
        }

        const container = createEl('div');
        container.className = 'gridnote-markdown-overlay';
        container.tabIndex = -1;
        view.contentEl.appendChild(container);
        return container;
    }

    private toggleNativeMarkdownVisibility(
        view: MarkdownView,
        hidden: boolean
    ): void {
        const markdownContent = view.contentEl.querySelectorAll(
            '.markdown-source-view, .markdown-reading-view'
        );

        markdownContent.forEach((element) => {
            if (element.instanceOf(HTMLElement)) {
                element.classList.toggle('gridnote-markdown-native-hidden', hidden);
                // The native Markdown editor stays mounted for sync/history, but must be inert
                // while GridNote owns interaction, otherwise it can still capture focus/keyboard.
                element.toggleAttribute('inert', hidden);

                if (hidden) {
                    element.setAttribute('aria-hidden', 'true');

                    const activeElement = document.activeElement;
                    if (activeElement?.instanceOf(HTMLElement) && element.contains(activeElement)) {
                        activeElement.blur();
                    }
                } else {
                    element.removeAttribute('aria-hidden');
                }
            }
        });
    }

    private blurFocusedElementInsideView(view: MarkdownView): void {
        const activeElement = document.activeElement;
        if (!activeElement?.instanceOf(HTMLElement)) {
            return;
        }

        if (view.contentEl.contains(activeElement)) {
            activeElement.blur();
        }
    }

    private syncModeWithGridNoteFrontmatter(view: MarkdownView): void {
        const state = this.getState(view.leaf);
        const file = view.file;
        if (!file || file.extension !== 'md') {
            if (state.enabled) {
                this.disableMode(view, state);
            }
            return;
        }

        const isSwitchingFiles = state.lastFrontmatterCheckFilePath !== file.path;

        // 文件切换时清除上一个文件的手动标记
        if (isSwitchingFiles) {
            state.lastFrontmatterCheckFilePath = file.path;
            state.manualEnabledFilePath = null;
            state.manualDisabledFilePath = null;
        }

        if (state.enabled && state.renderedSourcePath !== file.path) {
            this.resetMountedViewForFileSwitch(view, state, file.path);
        }

        if (!this.isSourceMarkdownView(view)) {
            if (state.enabled) {
                this.disableMode(view, state);
            }
            this.updateToggleButtonState(view, state);
            this.updateActionButtons(view, state);
            return;
        }

        const shouldEnable = this.shouldEnableGridNoteModeForFile(file);
        const isManualEnabledForCurrentFile = (
            state.manualEnabledFilePath !== null
            && state.manualEnabledFilePath === file.path
        );
        const isManualDisabledForCurrentFile = (
            state.manualDisabledFilePath !== null
            && state.manualDisabledFilePath === file.path
        );
        if (shouldEnable && !state.enabled) {
            if (isManualDisabledForCurrentFile) {
                this.updateToggleButtonState(view, state);
                this.updateActionButtons(view, state);
                return;
            }
            state.manualEnabledFilePath = null;
            this.enableMode(view, state, true);
            return;
        }

        if (!shouldEnable && state.enabled) {
            if (isManualEnabledForCurrentFile) {
                this.updateToggleButtonState(view, state);
                this.updateActionButtons(view, state);
                return;
            }
            this.disableMode(view, state);
            return;
        }

        this.updateToggleButtonState(view, state);
        this.updateActionButtons(view, state);
    }

    private resetMountedViewForFileSwitch(
        view: MarkdownView,
        state: GridNoteMarkdownModeState,
        nextSourcePath: string
    ): void {
        this.cancelScheduledRefresh(state);
        this.cancelExternalNavigationCheck(state);
        state.lastKnownCursorLine = -1;
        state.searchNavigation.reset();
        state.currentRawText = '';
        state.currentFrontmatterText = '';
        state.currentRawLines = [];
        state.currentStructure = null;
        state.foldLineOffset = 0;
        state.historyRevealRequest = null;
        state.suppressRefresh = false;
        state.pendingFoldStateReload = false;
        state.renderedSourcePath = nextSourcePath;

        // 先切断旧文档的渲染数据，避免下一帧刷新前继续显示文件 A。
        state.component?.$set({
            documentStructure: null,
            frontmatterText: '',
            sourcePath: nextSourcePath,
            foldLineOffset: 0,
            historyRevealRequest: null
        });
        this.loadMountedViewFromVault(view, state);
    }

    private loadMountedViewFromVault(
        view: MarkdownView,
        state: GridNoteMarkdownModeState
    ): void {
        const file = view.file;
        if (!file || file.extension !== 'md' || !state.component) {
            return;
        }

        this.cancelPendingSourceEditorCheck(state);
        const requestVersion = ++state.sourceLoadVersion;
        const sourcePath = file.path;
        state.searchNavigation.initialize(view.editor);
        state.pendingSourceLoadPath = sourcePath;
        state.pendingSourceExpectedText = null;

        void this.plugin.app.vault.cachedRead(file)
            .then((markdown) => {
                if (
                    this.destroyed
                    || requestVersion !== state.sourceLoadVersion
                    || !state.enabled
                    || !state.component
                    || view.file?.path !== sourcePath
                ) {
                    return;
                }

                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const sections = splitMarkdownContent(markdown, cache);
                state.pendingSourceExpectedText = markdown;
                state.foldLineOffset = sections.bodyStartLine;
                state.foldStateReloadRequest += 1;
                this.setMountedBodyState(
                    state,
                    sections.body,
                    sections.frontmatter
                );
                this.updateMountedComponent(view, state);
                this.updateActionButtons(view, state);
                // 此处 editor 可能尚未完成装载；等 reconcile 清除 pendingSourceLoadPath
                // 并触发最终 fold reload 后，再由 refreshMountedView 重放搜索定位。
                this.reconcilePendingSourceEditor(view, state);
            })
            .catch((error) => {
                if (
                    this.destroyed
                    || requestVersion !== state.sourceLoadVersion
                    || !state.enabled
                    || !state.component
                    || view.file?.path !== sourcePath
                ) {
                    return;
                }

                this.clearPendingSourceLoad(state);
                console.error('GridNote: 文件切换后读取笔记失败', error);
                this.scheduleRefreshMountedView(view, state, true);
            });
    }

    private reconcilePendingSourceEditor(
        view: MarkdownView,
        state: GridNoteMarkdownModeState
    ): void {
        const pendingSourcePath = state.pendingSourceLoadPath;
        if (
            !pendingSourcePath
            || !state.enabled
            || !state.component
            || view.file?.path !== pendingSourcePath
        ) {
            state.searchNavigation.reset();
            this.clearPendingSourceLoad(state);
            return;
        }

        // 文件首次打开过程中，搜索选区可能在 editor 内容过渡完成后才出现。
        state.searchNavigation.capture(
            view.editor,
            state.pendingSourceExpectedText,
            this.getSelectedCursorLine(view)
        );

        const currentEditorText = normalizeEditorText(
            view.editor.getValue()
        );
        const editorTransitioned = hasSourceEditorTransitioned(
            currentEditorText,
            state.pendingSourceExpectedText
        );

        if (editorTransitioned) {
            state.lastKnownCursorLine = view.editor.getCursor().line;
            this.clearPendingSourceLoad(state);
            this.refreshMountedView(view, state, true);
            return;
        }

        this.schedulePendingSourceEditorCheck(view, state);
    }

    private schedulePendingSourceEditorCheck(
        view: MarkdownView,
        state: GridNoteMarkdownModeState
    ): void {
        if (state.sourceEditorCheckTimeout !== 0 || !state.pendingSourceLoadPath) {
            return;
        }

        state.sourceEditorCheckTimeout = window.setTimeout(() => {
            state.sourceEditorCheckTimeout = 0;
            this.reconcilePendingSourceEditor(view, state);
        }, 50);
    }

    private cancelPendingSourceEditorCheck(state: GridNoteMarkdownModeState): void {
        if (state.sourceEditorCheckTimeout === 0) {
            return;
        }

        window.clearTimeout(state.sourceEditorCheckTimeout);
        state.sourceEditorCheckTimeout = 0;
    }

    private clearPendingSourceLoad(state: GridNoteMarkdownModeState): void {
        this.cancelPendingSourceEditorCheck(state);
        state.pendingSourceLoadPath = null;
        state.pendingSourceExpectedText = null;
    }

    private syncModeForFilePath(filePath: string): void {
        const markdownLeaves = this.plugin.app.workspace
            .getLeavesOfType('markdown');

        for (const leaf of markdownLeaves) {
            if (!(leaf.view instanceof MarkdownView)) {
                continue;
            }

            if (leaf.view.file?.path !== filePath) {
                continue;
            }

            this.syncModeWithGridNoteFrontmatter(leaf.view);
        }
    }

    private shouldEnableGridNoteModeForFile(file: TFile): boolean {
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        return cache?.frontmatter?.gridnote === true;
    }

    private isSourceMarkdownView(view: MarkdownView): boolean {
        return view.getMode() === 'source';
    }
}

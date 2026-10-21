<script lang="ts">
    import type { App } from 'obsidian';
    import { Notice, Scope } from 'obsidian';
    import { getContext, onDestroy, tick } from 'svelte';
    import { get, readable } from 'svelte/store';
    import { EmbeddableMarkdownEditor } from '../../../utils/EmbeddableMarkdownEditor';
    import {
        gridNoteCardEditingContextKey,
        type GridNoteCardEditingContext,
        type GridNoteCardEditDraft,
        type GridNoteCardRegistration
    } from './cardEditingContext';

    export let app: App | null = null;
    export let placeholder: string = '在此编辑 Markdown 内容...';

    type IdleCapableWindow = Window & typeof globalThis & {
        requestIdleCallback?: (
            callback: () => void,
            options?: { timeout: number }
        ) => number;
        cancelIdleCallback?: (handle: number) => void;
    };

    const editingContext = getContext<GridNoteCardEditingContext | undefined>(
        gridNoteCardEditingContextKey
    );
    const activeEditorId = editingContext?.activeEditorId
        ?? readable<string | null>(null);
    const activeEditorReady = editingContext?.activeEditorReady;
    const activeEditingCard = editingContext?.activeEditingCard
        ?? readable<GridNoteCardRegistration | null>(null);

    let parkingEl: HTMLDivElement | null = null;
    let layerEl: HTMLDivElement | null = null;
    let shellEl: HTMLDivElement | null = null;
    let editorHostEl: HTMLDivElement | null = null;
    let editor: EmbeddableMarkdownEditor | null = null;
    let activeRegistration: GridNoteCardRegistration | null = null;
    let currentHostEl: HTMLDivElement | null = null;
    let initializeEditorTimer = 0;
    let registeredSaveHandlerNodeId: string | null = null;
    let isInitializingEditor = false;
    let isEditorReady = false;
    let isSaving = false;
    let loadedNodeId: string | null = null;
    let draftText = '';
    let baselineDraftText = '';
    let hasGlobalKeyListener = false;
    let hasGlobalPointerListener = false;
    let editorScope: Scope | null = null;
    let hasScopeCaptureBlocker = false;
    let recoveryAttempts = 0;
    let prewarmHandle = 0;
    let prewarmUsesIdleCallback = false;
    let valueApplyFrame = 0;
    let cursorApplyFrame = 0;

    const PREWARM_FALLBACK_DELAY = 180;
    const cardPreviewInteractiveSelector = [
        'a',
        'button',
        'input',
        'textarea',
        'select',
        'summary',
        'details',
        'img',
        'video',
        'audio',
        '[role="button"]',
        '[role="link"]',
        '.internal-link',
        '.external-link',
        '.markdown-embed-link',
        '.internal-embed',
        '.copy-code-button'
    ].join(',');

    function resolveActiveRegistration(
        card: GridNoteCardRegistration | null
    ): GridNoteCardRegistration | null {
        if (!card?.editorHostEl || !card.editorHostEl.isConnected) {
            return null;
        }

        return card;
    }

    $: activeRegistration = resolveActiveRegistration($activeEditingCard);
    $: isActive = Boolean($activeEditorId && activeRegistration);

    $: if (editingContext) {
        const nextNodeId = $activeEditorId;
        if (registeredSaveHandlerNodeId !== nextNodeId) {
            if (registeredSaveHandlerNodeId) {
                editingContext.unregisterSaveHandler(
                    registeredSaveHandlerNodeId,
                    saveAndClose
                );
            }

            if (nextNodeId) {
                editingContext.registerSaveHandler(nextNodeId, saveAndClose);
            }

            registeredSaveHandlerNodeId = nextNodeId;
        }
    }

    $: if (layerEl && parkingEl) {
        moveLayerTo(activeRegistration?.editorHostEl ?? parkingEl);
    }

    $: if (!isActive) {
        releaseEditorFocus();
        isEditorReady = false;
        recoveryAttempts = 0;
        baselineDraftText = '';
        cancelEditorValueApply();
        cancelEditorCursorApply();
        cancelEditorInitialization();
        // CodeMirror 的 addToHistory(false) 只能避免载入内容入栈，不能清空旧栈。
        // 已进入过编辑会话的 editor 关闭时必须销毁，避免下次打开继承 undo/redo。
        if (loadedNodeId !== null) {
            destroyEditor();
        } else {
            loadedNodeId = null;
        }
    }

    $: activeEditorReady?.set(isActive && isEditorReady);

    $: if ($activeEditorId && !activeRegistration && !isSaving && !isInitializingEditor) {
        editingContext?.finishEdit($activeEditorId);
    }

    $: if (isActive && editorHostEl && !editor && !isInitializingEditor && app) {
        scheduleEditorInitialization();
    }

    $: if (!isActive && editorHostEl && !editor && !isInitializingEditor && app) {
        scheduleEditorPrewarm();
    }

    $: if ((!isActive || !editorHostEl || editor || isInitializingEditor || !app) && initializeEditorTimer !== 0) {
        cancelEditorInitialization();
    }

    $: if ((isActive || !editorHostEl || editor || isInitializingEditor || !app) && prewarmHandle !== 0) {
        cancelEditorPrewarm();
    }

    $: if (isActive && editor && !isInitializingEditor && !editor.isUsable()) {
        recoverBrokenEditor();
    }

    $: if (isActive && editor && $activeEditorId && loadedNodeId !== $activeEditorId && activeRegistration && editor.isUsable()) {
        if (loadedNodeId !== null) {
            destroyEditor();
            scheduleEditorInitialization();
        } else {
            draftText = createEditorValue(activeRegistration.node);
            scheduleEditorDraftLoad($activeEditorId, draftText);
        }
    }

    $: if (isActive) {
        setupEditorScope();
        setupGlobalKeyListener();
        setupGlobalPointerListener();
    } else {
        teardownEditorScope();
        teardownGlobalKeyListener();
        teardownGlobalPointerListener();
    }

    function moveLayerTo(targetHostEl: HTMLDivElement) {
        if (!layerEl || currentHostEl === targetHostEl) {
            return;
        }

        targetHostEl.appendChild(layerEl);
        currentHostEl = targetHostEl;
    }

    function releaseEditorFocus() {
        editor?.blur();

        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && shellEl?.contains(activeElement)) {
            activeElement.blur();
        }
    }

    function cancelEditorInitialization() {
        if (initializeEditorTimer === 0) {
            return;
        }

        window.clearTimeout(initializeEditorTimer);
        initializeEditorTimer = 0;
    }

    function cancelEditorValueApply() {
        if (valueApplyFrame === 0) {
            return;
        }

        window.cancelAnimationFrame(valueApplyFrame);
        valueApplyFrame = 0;
    }

    function cancelEditorCursorApply() {
        if (cursorApplyFrame === 0) {
            return;
        }

        window.cancelAnimationFrame(cursorApplyFrame);
        cursorApplyFrame = 0;
    }

    function scheduleEditorInitialization() {
        if (initializeEditorTimer !== 0) {
            return;
        }

        initializeEditorTimer = window.setTimeout(() => {
            initializeEditorTimer = 0;

            if (!isActive || !editorHostEl || editor || isInitializingEditor || !app) {
                return;
            }

            void initializeEditor();
        }, 0);
    }

    function scheduleEditorPrewarm() {
        if (prewarmHandle !== 0) {
            return;
        }

        const idleWindow = window as IdleCapableWindow;
        const runPrewarm = () => {
            prewarmHandle = 0;

            if (isActive || !editorHostEl || editor || isInitializingEditor || !app) {
                return;
            }

            void initializeEditor({ prewarm: true });
        };

        if (typeof idleWindow.requestIdleCallback === 'function') {
            prewarmUsesIdleCallback = true;
            prewarmHandle = idleWindow.requestIdleCallback(runPrewarm);
            return;
        }

        prewarmUsesIdleCallback = false;
        prewarmHandle = window.setTimeout(runPrewarm, PREWARM_FALLBACK_DELAY);
    }

    function cancelEditorPrewarm() {
        if (prewarmHandle === 0) {
            return;
        }

        const idleWindow = window as IdleCapableWindow;
        if (prewarmUsesIdleCallback && typeof idleWindow.cancelIdleCallback === 'function') {
            idleWindow.cancelIdleCallback(prewarmHandle);
        } else {
            window.clearTimeout(prewarmHandle);
        }

        prewarmHandle = 0;
    }

    function scheduleEditorDraftLoad(nodeId: string, nextValue: string) {
        cancelEditorValueApply();
        cancelEditorCursorApply();

        valueApplyFrame = window.requestAnimationFrame(() => {
            valueApplyFrame = 0;

            if (!isActive || get(activeEditorId) !== nodeId || !editor?.isUsable()) {
                return;
            }

            if (!editor.hasValue(nextValue)) {
                editor.setValue(nextValue);
            }

            draftText = editor.value;
            baselineDraftText = draftText;
            loadedNodeId = nodeId;
            isEditorReady = true;
            recoveryAttempts = 0;

            void tick().then(() => {
                if (
                    !isActive
                    || get(activeEditorId) !== nodeId
                    || loadedNodeId !== nodeId
                    || !editor?.isUsable()
                ) {
                    return;
                }

                scheduleEditorCursor(nodeId);
            });
        });
    }

    function scheduleEditorCursor(nodeId: string) {
        cancelEditorCursorApply();
        cursorApplyFrame = window.requestAnimationFrame(() => {
            cursorApplyFrame = 0;

            if (
                !isActive
                || get(activeEditorId) !== nodeId
                || loadedNodeId !== nodeId
                || !editor?.isUsable()
            ) {
                return;
            }

            editor.setCursorToEnd(false);
            editor.focus();
        });
    }
    function requestSaveAndClose() {
        void saveAndClose().catch((error) => {
            console.error('GridNote: 卡片编辑提交失败', error);
            new Notice('GridNote 卡片保存失败');
        });
    }

    function createEditorValue(node: GridNoteCardRegistration['node']): string {
        return node.editableText;
    }

    function createDraftFromEditorValue(value: string): GridNoteCardEditDraft {
        return {
            content: value
        };
    }

    function handleSaveShortcut(evt: KeyboardEvent) {
        evt.preventDefault();
        evt.stopPropagation();
        requestSaveAndClose();
    }

    function setupEditorScope() {
        if (!app || editorScope) {
            return;
        }

        editorScope = new Scope();
        editorScope.register([], 'Escape', handleSaveShortcut);
        editorScope.register(['Mod'], 'Enter', handleSaveShortcut);
        app.keymap.pushScope(editorScope);

        if (!hasScopeCaptureBlocker) {
            document.addEventListener('keydown', scopeCaptureBlocker, true);
            hasScopeCaptureBlocker = true;
        }
    }

    function teardownEditorScope() {
        if (editorScope && app) {
            app.keymap.popScope(editorScope);
            editorScope = null;
        }

        if (hasScopeCaptureBlocker) {
            document.removeEventListener('keydown', scopeCaptureBlocker, true);
            hasScopeCaptureBlocker = false;
        }
    }

    function scopeCaptureBlocker(evt: KeyboardEvent) {
        if (!isActive || isSaving) {
            return;
        }
        if (evt.key === 'Escape' || (evt.key === 'Enter' && (evt.ctrlKey || evt.metaKey))) {
            evt.stopImmediatePropagation();
        }
    }

    function isTargetInsideEditor(target: EventTarget | null): boolean {
        return target instanceof Node && Boolean(shellEl?.contains(target));
    }

    function isTargetInsideActiveCard(target: EventTarget | null): boolean {
        return target instanceof Node && Boolean(activeRegistration?.cardEl?.contains(target));
    }

    function shouldDeferToCardSwitch(target: EventTarget | null): boolean {
        if (!(target instanceof Element)) {
            return false;
        }

        const cardRoot = target.closest('.editable-markdown-card[role="button"]');
        if (!cardRoot) {
            return false;
        }

        const previewRoot = target.closest('.editable-markdown-card-preview');
        if (!previewRoot || !cardRoot.contains(previewRoot)) {
            return false;
        }

        if (target === previewRoot) {
            return true;
        }

        const interactiveAncestor = target.closest(cardPreviewInteractiveSelector);
        return !Boolean(
            interactiveAncestor
            && interactiveAncestor !== previewRoot
            && previewRoot.contains(interactiveAncestor)
        );
    }

    function handleWindowPointerdown(event: PointerEvent) {
        if (!isActive || isSaving) {
            return;
        }

        if (!event.isPrimary) {
            return;
        }

        if (event.pointerType === 'mouse' && event.button !== 0) {
            return;
        }

        if (isTargetInsideEditor(event.target) || isTargetInsideActiveCard(event.target)) {
            return;
        }

        if (shouldDeferToCardSwitch(event.target)) {
            return;
        }

        requestSaveAndClose();
    }

    function setupGlobalKeyListener() {
        if (hasGlobalKeyListener) {
            return;
        }

        hasGlobalKeyListener = true;
    }

    function teardownGlobalKeyListener() {
        if (!hasGlobalKeyListener) {
            return;
        }

        hasGlobalKeyListener = false;
    }

    function setupGlobalPointerListener() {
        if (hasGlobalPointerListener) {
            return;
        }

        window.addEventListener('pointerdown', handleWindowPointerdown, true);
        hasGlobalPointerListener = true;
    }

    function teardownGlobalPointerListener() {
        if (!hasGlobalPointerListener) {
            return;
        }

        window.removeEventListener('pointerdown', handleWindowPointerdown, true);
        hasGlobalPointerListener = false;
    }

    async function initializeEditor(options: { prewarm?: boolean } = {}): Promise<void> {
        const isPrewarm = options.prewarm === true;
        if (!app || !editorHostEl) {
            return;
        }

        if (!isPrewarm && (!activeRegistration || !$activeEditorId)) {
            return;
        }

        cancelEditorInitialization();
        cancelEditorPrewarm();
        isInitializingEditor = true;
        const requestedNodeId = isPrewarm ? null : $activeEditorId;
        const nextDraftValue = isPrewarm || !activeRegistration
            ? ''
            : createEditorValue(activeRegistration.node);
        draftText = nextDraftValue;

        try {
            // 原生嵌入编辑器自身也会在初始化阶段灌入内容。
            // 这里统一用空值建 editor，待 ready 后再走单点赋值，
            // 避免快速点击时出现初始化值与后续赋值重叠，导致内容重复。
            const nextEditor = new EmbeddableMarkdownEditor(app, editorHostEl, {
                value: '',
                placeholder,
                cls: 'gridnote-embedded-markdown-editor',
                skipInitialCursor: true,
                onChange: (value) => {
                    draftText = value;
                },
                onEnter: (_editor, mod) => {
                    if (!mod) {
                        return false;
                    }

                    requestSaveAndClose();
                    return true;
                },
                onEscape: () => {
                    requestSaveAndClose();
                },
                onSubmit: () => {
                    requestSaveAndClose();
                },
                onSave: () => {
                    requestSaveAndClose();
                }
            });
            editor = nextEditor;

            await nextEditor.whenReady();

            if (editor !== nextEditor) {
                nextEditor.destroy();
                return;
            }

            if (!nextEditor.isUsable()) {
                throw new Error('共享卡片编辑器未能挂载可用 DOM');
            }

            recoveryAttempts = 0;

            if (isPrewarm || !requestedNodeId) {
                return;
            }

            if (get(activeEditorId) !== requestedNodeId) {
                loadedNodeId = null;
                return;
            }

            scheduleEditorDraftLoad(requestedNodeId, nextDraftValue);
        } catch (error) {
            destroyEditor();

            if (isPrewarm) {
                console.warn('GridNote: 共享卡片编辑器预热失败', error);
                return;
            }

            if (isActive && recoveryAttempts < 1) {
                recoveryAttempts += 1;
                scheduleEditorInitialization();
                return;
            }

            console.error('GridNote: 创建共享卡片编辑器失败', error);
            new Notice('GridNote 卡片编辑器初始化失败');
            if ($activeEditorId) {
                editingContext?.finishEdit($activeEditorId);
            }
        } finally {
            isInitializingEditor = false;
        }
    }

    function recoverBrokenEditor() {
        if (!isActive || isInitializingEditor) {
            return;
        }

        destroyEditor();

        if (recoveryAttempts >= 1) {
            console.error('GridNote: 共享卡片编辑器恢复失败，编辑器 DOM 仍不可用');
            editingContext?.finishEdit(get(activeEditorId) ?? '');
            return;
        }

        recoveryAttempts += 1;
        scheduleEditorInitialization();
    }

    async function saveAndClose(): Promise<void> {
        const nodeId = get(activeEditorId);
        if (!editingContext || !nodeId || isSaving) {
            return;
        }

        const registration = get(activeEditingCard);
        if (!registration || registration.node.viewId !== nodeId) {
            releaseEditorFocus();
            editingContext.finishEdit(nodeId);
            return;
        }

        const nextDraft = createDraftFromEditorValue(draftText);
        if (
            nextDraft.content === baselineDraftText
        ) {
            releaseEditorFocus();
            editingContext.finishEdit(nodeId);
            return;
        }

        isSaving = true;

        try {
            await editingContext.saveCardEdit(registration.node, nextDraft);
            releaseEditorFocus();
            editingContext.finishEdit(nodeId);
        } catch (error) {
            console.error('GridNote: 保存卡片编辑内容失败', error);
            throw error;
        } finally {
            isSaving = false;
        }
    }

    function destroyEditor() {
        cancelEditorPrewarm();
        cancelEditorValueApply();
        cancelEditorCursorApply();
        isEditorReady = false;
        loadedNodeId = null;
        editor?.destroy();
        editor = null;
    }

    onDestroy(() => {
        if (registeredSaveHandlerNodeId) {
            editingContext?.unregisterSaveHandler(
                registeredSaveHandlerNodeId,
                saveAndClose
            );
            registeredSaveHandlerNodeId = null;
        }

        cancelEditorInitialization();
        cancelEditorPrewarm();
        cancelEditorValueApply();
        cancelEditorCursorApply();
        teardownEditorScope();
        teardownGlobalKeyListener();
        teardownGlobalPointerListener();
        destroyEditor();
    });
</script>

<div class="floating-card-editor-parking" bind:this={parkingEl}>
    <div
        class="floating-card-editor-layer"
        class:is-visible={isActive && isEditorReady}
        aria-hidden={!isActive}
        bind:this={layerEl}
    >
        <div class="floating-card-editor-shell" bind:this={shellEl}>
            <div class="floating-card-editor-host" bind:this={editorHostEl}></div>
        </div>
    </div>
</div>

<style>
    .floating-card-editor-parking {
        position: fixed;
        top: 0;
        left: -200vw;
        width: min(680px, max(320px, calc(100vw - 48px)));
        min-height: 64px;
        overflow: hidden;
        visibility: hidden;
        pointer-events: none;
    }

    .floating-card-editor-layer {
        display: block;
        width: 100%;
        min-width: 0;
        z-index: 40;
        overflow: visible;
        overflow-anchor: none;
        height: 0;
        visibility: hidden;
        opacity: 0;
        pointer-events: none;
    }

    .floating-card-editor-layer.is-visible {
        display: flex;
        flex-direction: column;
        height: 100%;
        visibility: visible;
        opacity: 1;
        pointer-events: auto;
    }

    .floating-card-editor-shell {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        width: 100%;
        min-width: 0;
        min-height: 60px;
        height: 100%;
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        overflow: hidden;
        border: none;
        border-radius: 6px;
        background: var(--gridnote-card-surface);
        box-shadow: none;
    }

    .floating-card-editor-host {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-width: 0;
        min-height: 60px;
        overflow-anchor: none;
        border-inline-start: none !important;
        border-inline-start-width: 0 !important;
        box-shadow: none !important;
        padding-inline-start: 0 !important;
        overflow: hidden;
        overscroll-behavior: contain;
        color: var(--text-normal);
        font-family:
            var(--font-text),
            var(--font-interface),
            system-ui,
            -apple-system,
            sans-serif;
        font-size: var(--font-text-size);
    }

    .floating-card-editor-host :global(.gridnote-embedded-markdown-editor),
    .floating-card-editor-host :global(.cm-editor),
    .floating-card-editor-host :global(textarea) {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        width: 100%;
        min-height: 60px;
        box-sizing: border-box;
    }

    .floating-card-editor-host :global(.gridnote-embedded-markdown-editor),
    .floating-card-editor-host :global(.cm-editor) {
        overflow: hidden;
        font-family: inherit;
        font-size: var(--font-text-size) !important;
    }

    .floating-card-editor-host :global(textarea) {
        min-height: 60px;
        box-sizing: border-box;
        resize: none;
        overflow: auto;
        font-family: inherit;
    }

    .floating-card-editor-host :global(.cm-content),
    .floating-card-editor-host :global(textarea) {
        padding: 0.625rem 0.75rem;
        font-family: inherit;
        font-size: var(--font-text-size) !important;
    }

    .floating-card-editor-host :global(.cm-scroller) {
        flex: 1 1 auto;
        min-height: 60px;
        max-height: 100%;
        overflow: auto;
        font-family: inherit;
        font-size: var(--font-text-size) !important;
    }

    .floating-card-editor-host :global(.inline-title) {
        display: none;
    }

    .floating-card-editor-host :global(.markdown-embed-link) {
        display: none;
    }

    .floating-card-editor-host :global(.internal-embed),
    .floating-card-editor-host :global(.markdown-embed),
    .floating-card-editor-host :global(.internal-embed.markdown-embed) {
        border-inline-start: none !important;
        border-inline-start-width: 0 !important;
        box-shadow: none !important;
        padding-inline-start: 0;
    }
</style>

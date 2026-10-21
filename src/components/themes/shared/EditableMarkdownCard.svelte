<script lang="ts">
    import type { App } from 'obsidian';
    import { getContext, onDestroy } from 'svelte';
    import { readable } from 'svelte/store';
    import CardFloatingActions from '../../controls/CardFloatingActions.svelte';
    import type { TreeNode } from '../../../types';
    import {
        gridNoteCardEditingContextKey,
        type GridNoteCardEditingContext,
        type GridNoteCardInsertPosition
    } from './cardEditingContext';

    export let node: TreeNode;
    export let app: App | null = null;
    export let className: string = '';
    export let selectable: boolean = true;
    export let editable: boolean = true;
    export let isDocumentHeadingRoot: boolean = false;
    export let onActivatePreview: ((node: TreeNode) => Promise<void> | void) | null = null;

    const editingContext = getContext<GridNoteCardEditingContext | undefined>(
        gridNoteCardEditingContextKey
    );
    const activeEditorId = editingContext?.activeEditorId
        ?? readable<string | null>(null);
    const activeEditorReady = editingContext?.activeEditorReady
        ?? readable(false);
    const selectedCardId = editingContext?.selectedCardId
        ?? readable<string | null>(null);
    type BottomActionKind = 'after' | 'child';
    const previewInteractiveSelector = [
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

    let previewEl: HTMLDivElement | null = null;
    let editorHostEl: HTMLDivElement | null = null;
    let cardEl: HTMLDivElement | null = null;
    let registeredViewId: string | null = null;
    let bottomActionKind: BottomActionKind = 'after';

    $: isEditing = $activeEditorId === node.viewId;
    $: isEditorDisplayReady = isEditing && $activeEditorReady;
    $: isEditable = Boolean(editingContext?.isEditable && app && editable);
    $: canTriggerEdit = isEditable && !isEditing;
    $: canActivatePreview = !isEditing && Boolean(onActivatePreview);
    $: isSelected = selectable && $selectedCardId === node.viewId;
    $: isDocumentRootHeading = isDocumentHeadingRoot && node.headingLevel !== null;
    $: canInsertChild = node.headingLevel !== null && node.headingLevel < 6;
    $: shouldShowFloatingActions = selectable && isSelected && !isEditing && node.headingLevel !== null;
    $: showTopAction = !isDocumentRootHeading;
    $: showBottomAction = isDocumentRootHeading ? canInsertChild : true;
    $: showRightAction = !isDocumentRootHeading;
    $: bottomActionKind = isDocumentRootHeading ? 'child' : 'after';

    $: if (editingContext && (cardEl || editorHostEl)) {
        if (registeredViewId && registeredViewId !== node.viewId) {
            editingContext.unregisterCard(registeredViewId, cardEl);
        }

        editingContext.registerCard({
            node,
            editorHostEl,
            cardEl
        });
        registeredViewId = node.viewId;
    }

    function requestBeginEdit() {
        if (!isEditable || isEditing || !editingContext || !editorHostEl) {
            return;
        }

        window.requestAnimationFrame(() => {
            if (!editingContext || !editorHostEl) {
                return;
            }

            void editingContext.beginEdit({
                node,
                editorHostEl,
                cardEl
            });
        });
    }

    function resolveEventTargetElement(target: EventTarget | null): Element | null {
        if (target instanceof Element) {
            return target;
        }

        if (target instanceof Node) {
            return target.parentElement;
        }

        return null;
    }

    function hasSelectedText(): boolean {
        const selection = window.getSelection();
        return Boolean(selection && selection.toString().trim().length > 0);
    }

    function isInteractiveTarget(targetEl: Element): boolean {
        if (!previewEl) {
            return false;
        }

        const interactiveAncestor = targetEl.closest(previewInteractiveSelector);
        return Boolean(
            interactiveAncestor
            && interactiveAncestor !== previewEl
            && previewEl.contains(interactiveAncestor)
        );
    }

    function isTaskListCheckboxTarget(target: EventTarget | null): boolean {
        const targetEl = resolveEventTargetElement(target);
        if (!targetEl || !previewEl || !previewEl.contains(targetEl)) {
            return false;
        }

        const checkbox = targetEl.closest('input[type="checkbox"]');
        if (!(checkbox instanceof HTMLInputElement)) {
            return false;
        }

        return Boolean(checkbox.closest('li.task-list-item'));
    }

    function isNestedInteractiveControl(target: EventTarget | null): boolean {
        const targetEl = resolveEventTargetElement(target);
        if (!targetEl || !cardEl || targetEl === cardEl) {
            return false;
        }

        const interactiveAncestor = targetEl.closest(
            'button, a, input, textarea, select, [role="button"], [role="link"]'
        );

        return Boolean(
            interactiveAncestor
            && interactiveAncestor !== cardEl
            && cardEl.contains(interactiveAncestor)
        );
    }

    function shouldEnterEditFromClick(event: MouseEvent): boolean {
        const targetEl = resolveEventTargetElement(event.target);

        if (!canTriggerEdit && !canActivatePreview) {
            return false;
        }

        if (event.button !== 0 || event.defaultPrevented) {
            return false;
        }

        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return false;
        }

        if (hasSelectedText()) {
            return false;
        }

        if (!targetEl || !previewEl || !previewEl.contains(targetEl)) {
            return false;
        }

        if (targetEl === previewEl) {
            return true;
        }

        if (isInteractiveTarget(targetEl)) {
            return false;
        }

        return true;
    }

    function selectCurrentCard(options: { focus?: boolean; scroll?: boolean } = {}) {
        if (!selectable) {
            return;
        }

        editingContext?.selectCard(node, options);
    }

    async function requestInsertNode(position: GridNoteCardInsertPosition) {
        if (!editingContext) {
            return;
        }

        selectCurrentCard({ focus: true, scroll: false });
        await editingContext.insertNode(node, position);
    }

    function handleContainerClick(event: MouseEvent) {
        if (isTaskListCheckboxTarget(event.target) && (canTriggerEdit || canActivatePreview)) {
            event.preventDefault();
            event.stopPropagation();
            selectCurrentCard({ focus: false, scroll: false });

            if (canActivatePreview) {
                void Promise.resolve(onActivatePreview?.(node));
                return;
            }

            requestBeginEdit();
            return;
        }

        if (canActivatePreview && shouldEnterEditFromClick(event)) {
            event.preventDefault();
            event.stopPropagation();
            selectCurrentCard({ focus: false, scroll: false });
            void Promise.resolve(onActivatePreview?.(node));
            return;
        }

        if (!shouldEnterEditFromClick(event)) {
            return;
        }

        if (isSelected) {
            requestBeginEdit();
        } else {
            selectCurrentCard({ focus: false, scroll: false });
        }
    }

    function handleContainerKeydown(event: KeyboardEvent) {
        if (!canTriggerEdit && !canActivatePreview) {
            return;
        }

        if (isNestedInteractiveControl(event.target)) {
            return;
        }

        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (canActivatePreview) {
            selectCurrentCard({ focus: false, scroll: false });
            void Promise.resolve(onActivatePreview?.(node));
            return;
        }

        selectCurrentCard({ focus: false, scroll: false });
        requestBeginEdit();
    }

    onDestroy(() => {
        if (registeredViewId) {
            editingContext?.unregisterCard(registeredViewId, cardEl);
        }
    });
</script>

<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
<div
    bind:this={cardEl}
    class={`editable-markdown-card ${className}`.trim()}
    class:is-editing={isEditing}
    class:is-editor-display-ready={isEditorDisplayReady}
    class:is-selected={isSelected}
    class:is-activatable={canActivatePreview}
    data-gridnote-card-id={node.viewId}
    role={canTriggerEdit || canActivatePreview ? 'button' : undefined}
    tabindex={canTriggerEdit || canActivatePreview ? 0 : undefined}
    on:click={handleContainerClick}
    on:keydown={handleContainerKeydown}
>
    <CardFloatingActions
        visible={shouldShowFloatingActions}
        {canInsertChild}
        {showTopAction}
        {showBottomAction}
        {showRightAction}
        {bottomActionKind}
        onInsertBefore={() => requestInsertNode('before')}
        onInsertAfter={() => requestInsertNode('after')}
        onInsertChild={() => requestInsertNode('child')}
    />
    <div
        class="editable-markdown-card-preview"
        aria-hidden={isEditorDisplayReady}
        bind:this={previewEl}
    >
        <slot />
    </div>
    <div
        class="editable-markdown-card-editor-host"
        class:is-visible={isEditing}
        bind:this={editorHostEl}
    ></div>
</div>

<style>
    .editable-markdown-card {
        --gridnote-card-selection-radius: 8px;
        position: relative;
        display: flex;
        flex-direction: column;
        min-width: 0;
        box-sizing: border-box;
        overflow: visible;
        border: 2px solid color-mix(in srgb, var(--text-normal) 7%, transparent);
        border-radius: var(--gridnote-card-selection-radius);
        background: var(--gridnote-card-surface);
    }

    .editable-markdown-card:focus,
    .editable-markdown-card:focus-visible {
        outline: none;
        box-shadow: none;
    }

    .editable-markdown-card.is-selected,
    .editable-markdown-card.is-editing {
        border-color: var(--interactive-accent);
    }

    .editable-markdown-card.is-editing {
        cursor: text;
        z-index: 30;
        isolation: isolate;
    }

    .editable-markdown-card.is-activatable:not(.is-editing) {
        cursor: pointer;
    }

    .editable-markdown-card-preview {
        height: 100%;
        display: flex;
        flex-direction: column;
        min-width: 0;
        box-sizing: border-box;
        padding: var(--gridnote-card-preview-padding, 0);
        border-radius: inherit;
    }

    .editable-markdown-card.is-editor-display-ready .editable-markdown-card-preview {
        display: none;
    }

    .editable-markdown-card-editor-host {
        display: none;
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
        border-radius: inherit;
    }

    .editable-markdown-card-editor-host.is-visible {
        display: flex;
        flex-direction: column;
        min-height: 100%;
    }
</style>

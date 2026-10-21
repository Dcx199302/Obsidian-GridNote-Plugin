<script lang="ts">
    import { Notice } from 'obsidian';
    import type { App } from 'obsidian';
    import { tick, onDestroy } from 'svelte';
    import InlineMarkdownText from './InlineMarkdownText.svelte';
    import {
        normalizeHeadingText,
        sanitizeHeadingDraftText
    } from '../../utils/markdownEdit';

    export let value: string = '';
    export let app: App | null = null;
    export let sourcePath: string = '';
    export let parseAsHeading: boolean = false;
    export let placeholder: string = '空标题';
    export let editable: boolean = true;
    export let className: string = '';
    export let onSave: ((nextTitle: string) => Promise<void>) | null = null;

    let titleEl: HTMLDivElement | null = null;
    let isEditing = false;
    let isSaving = false;
    let commitGeneration = 0;
    let draftValue = value;
    let displayValue = value;

    $: if (!isEditing && !isSaving) {
        displayValue = value;
        draftValue = value;
    }

    $: isEmptyDisplay = !isEditing && displayValue.trim().length === 0;

    onDestroy(() => {
        if (isEditing) {
            isEditing = false;
        }
    });

    async function startEditing() {
        if (!editable || !onSave || isEditing || isSaving) {
            return;
        }

        commitGeneration += 1;
        isEditing = true;
        draftValue = value;
        await tick();

        if (!titleEl) {
            return;
        }

        titleEl.textContent = draftValue;
        titleEl.focus();
        placeCaretAtEnd(titleEl);
    }

    async function commitEdit() {
        if (!isEditing) {
            return;
        }

        const previousValue = value;
        const capturedGeneration = commitGeneration;
        const nextValue = normalizeHeadingText(titleEl?.textContent ?? draftValue);
        isEditing = false;

        if (!onSave || nextValue === '' || nextValue === previousValue) {
            displayValue = previousValue;
            draftValue = previousValue;
            return;
        }

        displayValue = nextValue;
        draftValue = nextValue;
        isSaving = true;

        try {
            await onSave(nextValue);
        } catch (error) {
            if (commitGeneration !== capturedGeneration) {
                return;
            }
            displayValue = previousValue;
            draftValue = previousValue;
            console.error('GridNote: 标题保存失败', error);
            new Notice('GridNote: 标题保存失败');
        } finally {
            if (commitGeneration === capturedGeneration) {
                isSaving = false;
            }
        }
    }

    function cancelEdit() {
        if (!isEditing) {
            return;
        }

        isEditing = false;
        draftValue = value;
        displayValue = value;
    }

    function placeCaretAtEnd(targetEl: HTMLDivElement) {
        const selection = window.getSelection();
        if (!selection) {
            return;
        }

        const range = document.createRange();
        range.selectNodeContents(targetEl);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function insertPlainText(targetEl: HTMLDivElement, text: string) {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            targetEl.textContent = `${targetEl.textContent ?? ''}${text}`;
            placeCaretAtEnd(targetEl);
            return;
        }

        const range = selection.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function insertPlainTextPreservingUndo(targetEl: HTMLDivElement, text: string) {
        const documentWithLegacyCommands = document as Document & {
            execCommand?: (
                commandId: string,
                showUI?: boolean,
                value?: string
            ) => boolean;
        };

        targetEl.focus();
        if (typeof documentWithLegacyCommands.execCommand === 'function') {
            const inserted = documentWithLegacyCommands.execCommand(
                'insertText',
                false,
                text
            );
            if (inserted) {
                return;
            }
        }

        insertPlainText(targetEl, text);
    }

    function handleDisplayClick(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        void startEditing();
    }

    function handleEditorInput() {
        if (!titleEl) {
            return;
        }

        draftValue = titleEl.textContent ?? '';
    }

    function handleEditorPaste(event: ClipboardEvent) {
        if (!titleEl) {
            return;
        }

        const pastedText = sanitizeHeadingDraftText(
            event.clipboardData?.getData('text/plain') ?? ''
        );

        event.preventDefault();
        insertPlainTextPreservingUndo(titleEl, pastedText);
        draftValue = titleEl.textContent ?? '';
    }

    function handleEditorBlur() {
        void commitEdit();
    }

    function handleEditorKeydown(event: KeyboardEvent) {
        if (event.key === 'Enter') {
            event.preventDefault();
            void commitEdit();
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancelEdit();
        }
    }
</script>

<div
    class={`editable-tree-title ${className}`.trim()}
    class:is-editing={isEditing}
    class:is-empty={isEmptyDisplay}
>
    {#if isEditing}
        <div
            bind:this={titleEl}
            class="editable-tree-title-content editable-tree-title-editor"
            contenteditable="true"
            role="textbox"
            tabindex="0"
            spellcheck="false"
            on:input={handleEditorInput}
            on:paste={handleEditorPaste}
            on:blur={handleEditorBlur}
            on:keydown={handleEditorKeydown}
        ></div>
    {:else if editable && onSave}
        <button
            type="button"
            class="editable-tree-title-content editable-tree-title-button editable-tree-title-display"
            on:click={handleDisplayClick}
        >
            {#if isEmptyDisplay}
                {placeholder}
            {:else}
                <InlineMarkdownText markdown={displayValue} parseAsHeading={parseAsHeading} {app} {sourcePath} />
            {/if}
        </button>
    {:else}
        <div
            class="editable-tree-title-content editable-tree-title-display"
        >
            {#if isEmptyDisplay}
                {placeholder}
            {:else}
                <InlineMarkdownText markdown={displayValue} parseAsHeading={parseAsHeading} {app} {sourcePath} />
            {/if}
        </div>
    {/if}
</div>

<style>
    .editable-tree-title {
        display: flex;
        align-items: stretch;
        min-width: 0;
        min-height: 1.5em;
    }

    .editable-tree-title-content {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        width: 100%;
        min-width: 0;
        min-height: 1.5em;
        height: 1.5em;
        padding: 0;
        margin: 0;
        border: none;
        outline: none;
        border-radius: 0;
        box-sizing: border-box;
        background: transparent;
        box-shadow: none;
        color: inherit;
        font: inherit;
        line-height: inherit;
        text-align: start;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .editable-tree-title-button {
        appearance: none;
        -webkit-appearance: none;
        justify-content: flex-start;
        cursor: text;
    }

    .editable-tree-title-display {
        cursor: text;
        letter-spacing: var(--gridnote-heading-letter-spacing, normal);
    }

    .editable-tree-title-editor {
        cursor: text;
        caret-color: currentColor;
        user-select: text;
    }

    .editable-tree-title.is-editing {
        color: var(--interactive-accent);
    }

    .editable-tree-title.is-empty:not(.is-editing) {
        color: var(--text-muted);
        font-style: italic;
    }
</style>

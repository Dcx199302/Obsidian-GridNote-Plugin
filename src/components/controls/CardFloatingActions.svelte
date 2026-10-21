<script lang="ts">
    import { setIcon } from 'obsidian';

    type BottomActionKind = 'after' | 'child';

    export let visible: boolean = false;
    export let canInsertChild: boolean = true;
    export let showTopAction: boolean = true;
    export let showBottomAction: boolean = true;
    export let showRightAction: boolean = true;
    export let bottomActionKind: BottomActionKind = 'after';
    export let onInsertBefore: (() => void | Promise<void>) | null = null;
    export let onInsertAfter: (() => void | Promise<void>) | null = null;
    export let onInsertChild: (() => void | Promise<void>) | null = null;

    let beforeIconEl: HTMLSpanElement | null = null;
    let afterIconEl: HTMLSpanElement | null = null;
    let childIconEl: HTMLSpanElement | null = null;

    $: if (beforeIconEl) {
        setIcon(beforeIconEl, 'plus');
    }

    $: if (afterIconEl) {
        setIcon(afterIconEl, 'plus');
    }

    $: if (childIconEl) {
        setIcon(childIconEl, 'plus');
    }

    $: bottomActionLabel = bottomActionKind === 'child'
        ? '插入节点（Ctrl+Shift+↓）'
        : '插入节点（Ctrl+Shift+↓）';
    $: bottomActionHandler = bottomActionKind === 'child'
        ? onInsertChild
        : onInsertAfter;

    function handleActionClick(
        event: MouseEvent,
        action: (() => void | Promise<void>) | null,
        disabled: boolean = false
    ) {
        event.preventDefault();
        event.stopPropagation();

        if (disabled || !action) {
            return;
        }

        void action();
    }
</script>

<div
    class="card-floating-actions"
    class:is-visible={visible}
    aria-hidden={!visible}
>
    {#if showTopAction}
        <button
            type="button"
            class="card-floating-action-button is-top"
            aria-label="插入节点（Ctrl+Shift+↑）"
            tabindex="-1"
            on:click={(event) => handleActionClick(event, onInsertBefore)}
        >
            <span class="card-floating-action-icon" bind:this={beforeIconEl}></span>
        </button>
    {/if}

    {#if showBottomAction}
        <button
            type="button"
            class="card-floating-action-button is-bottom"
            aria-label={bottomActionLabel}
            tabindex="-1"
            on:click={(event) => handleActionClick(event, bottomActionHandler)}
        >
            <span class="card-floating-action-icon" bind:this={afterIconEl}></span>
        </button>
    {/if}

    {#if canInsertChild && showRightAction}
        <button
            type="button"
            class="card-floating-action-button is-right"
            aria-label="插入节点（Ctrl+Shift+→）"
            tabindex="-1"
            on:click={(event) => handleActionClick(event, onInsertChild)}
        >
            <span class="card-floating-action-icon" bind:this={childIconEl}></span>
        </button>
    {/if}
</div>

<style>
    .card-floating-actions {
        pointer-events: none;
        position: absolute;
        inset: 0;
        z-index: 70;
        overflow: visible;
        visibility: hidden;
    }

    .card-floating-actions.is-visible {
        visibility: visible;
    }

    .card-floating-action-button {
        --gridnote-card-action-size: 28px;
        --gridnote-card-action-translate-x: 0;
        --gridnote-card-action-translate-y: 0;
        position: absolute;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--gridnote-card-action-size);
        height: var(--gridnote-card-action-size);
        min-width: var(--gridnote-card-action-size);
        min-height: var(--gridnote-card-action-size);
        padding: 0;
        border: 2px solid var(--background-primary);
        border-radius: 999px;
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        cursor: pointer;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform:
            translate(
                var(--gridnote-card-action-translate-x),
                var(--gridnote-card-action-translate-y)
            )
            scale(0.9);
    }

    :global(.editable-markdown-card.is-selected:hover)
        .card-floating-actions.is-visible
        .card-floating-action-button {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        transform:
            translate(
                var(--gridnote-card-action-translate-x),
                var(--gridnote-card-action-translate-y)
            )
            scale(1);
    }

    .card-floating-action-button:hover:not(.is-disabled) {
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
        transform:
            translate(
                var(--gridnote-card-action-translate-x),
                var(--gridnote-card-action-translate-y)
            )
            scale(1.12);
    }

    .card-floating-action-button:active:not(.is-disabled) {
        transform:
            translate(
                var(--gridnote-card-action-translate-x),
                var(--gridnote-card-action-translate-y)
            )
            scale(0.96);
    }

    .card-floating-action-button:focus-visible {
        outline: 2px solid var(--interactive-accent);
        outline-offset: 2px;
    }

    .card-floating-action-button.is-top {
        top: 0;
        left: 50%;
        --gridnote-card-action-translate-x: -50%;
        --gridnote-card-action-translate-y: -50%;
    }

    .card-floating-action-button.is-bottom {
        bottom: 0;
        left: 50%;
        --gridnote-card-action-translate-x: -50%;
        --gridnote-card-action-translate-y: 50%;
    }

    .card-floating-action-button.is-right {
        top: 50%;
        right: 0;
        --gridnote-card-action-translate-x: 50%;
        --gridnote-card-action-translate-y: -50%;
    }

    .card-floating-action-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    .card-floating-action-icon :global(svg) {
        width: var(--icon-size);
        height: var(--icon-size);
        stroke-width: var(--icon-stroke);
    }

    @media (max-width: 900px) {
        .card-floating-action-button {
            --gridnote-card-action-size: 26px;
        }
    }
</style>

<script lang="ts">
    import { setIcon } from 'obsidian';

    export let icon: string;
    export let ariaLabel: string;
    export let disabled: boolean = false;
    export let className: string = '';
    export let stopPropagation: boolean = true;
    export let onPress: ((event: MouseEvent) => unknown | Promise<unknown>) | null = null;

    let iconEl: HTMLSpanElement | null = null;

    $: if (iconEl) {
        setIcon(iconEl, icon);
    }

    function handleClick(event: MouseEvent) {
        if (stopPropagation) {
            event.preventDefault();
            event.stopPropagation();
        }

        if (disabled || !onPress) {
            return;
        }

        void onPress(event);
    }
</script>

<button
    class={`clickable-icon gridnote-heading-icon-button ${className}`.trim()}
    type="button"
    aria-label={ariaLabel}
    disabled={disabled}
    tabindex="-1"
    on:click={handleClick}
>
    <span class="gridnote-heading-icon-button-icon" bind:this={iconEl}></span>
</button>

<style>
    .gridnote-heading-icon-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--gridnote-heading-icon-size, 22px);
        height: var(--gridnote-heading-icon-size, 22px);
        min-width: var(--gridnote-heading-icon-size, 22px);
        min-height: var(--gridnote-heading-icon-size, 22px);
        padding: 0;
        color: inherit;
    }

    .gridnote-heading-icon-button:disabled {
        opacity: 0.45;
        cursor: default;
    }

    .gridnote-heading-icon-button-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    .gridnote-heading-icon-button-icon :global(svg) {
        width: var(--icon-size);
        height: var(--icon-size);
        stroke-width: var(--icon-stroke);
    }
</style>

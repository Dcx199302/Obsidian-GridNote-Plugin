<script lang="ts">
    import { setIcon } from 'obsidian';

    export let headingLevel: number | null = null;

    let iconEl: HTMLSpanElement | null = null;

    $: normalizedHeadingLevel = headingLevel === null
        ? null
        : Math.max(1, Math.min(6, headingLevel));

    $: if (iconEl && normalizedHeadingLevel !== null) {
        setIcon(iconEl, `heading-${normalizedHeadingLevel}`);
    }
</script>

{#if normalizedHeadingLevel !== null}
    <span class="heading-level-icon" aria-hidden="true">
        <span class="heading-level-icon-inner" bind:this={iconEl}></span>
    </span>
{/if}

<style>
    .heading-level-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--gridnote-heading-icon-size, 22px);
        height: var(--gridnote-heading-icon-size, 22px);
        min-width: var(--gridnote-heading-icon-size, 22px);
        min-height: var(--gridnote-heading-icon-size, 22px);
        color: inherit;
        opacity: 0.9;
        flex: 0 0 auto;
    }

    .heading-level-icon-inner {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--gridnote-heading-icon-size, 22px);
        height: var(--gridnote-heading-icon-size, 22px);
    }

    .heading-level-icon-inner :global(svg) {
        width: var(--icon-size);
        height: var(--icon-size);
        stroke-width: var(--icon-stroke);
    }
</style>

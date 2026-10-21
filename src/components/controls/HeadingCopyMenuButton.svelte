<script lang="ts">
    import { Menu, setIcon } from 'obsidian';
    import {
        GRID_NOTE_COPY_MENU_ITEMS,
        type GridNoteCopyAction
    } from '../../utils/gridNoteCopy';

    export let ariaLabel: string = '复制';
    export let disabled: boolean = false;
    export let onSelect: ((
        action: GridNoteCopyAction,
        anchorEl: HTMLButtonElement
    ) => unknown | Promise<unknown>) | null = null;

    let buttonEl: HTMLButtonElement | null = null;
    let iconEl: HTMLSpanElement | null = null;

    $: if (iconEl) {
        setIcon(iconEl, 'copy');
    }

    function openMenu(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        if (disabled || !buttonEl || !onSelect) {
            return;
        }

        const menu = new Menu();

        for (const item of GRID_NOTE_COPY_MENU_ITEMS) {
            if (item.separatorBefore) {
                menu.addSeparator();
            }

            menu.addItem((menuItem) =>
                menuItem
                    .setTitle(item.title)
                    .setIcon(item.icon)
                    .onClick(() => {
                        if (!buttonEl || !onSelect) {
                            return;
                        }

                        void onSelect(item.action, buttonEl);
                    })
            );
        }

        const rect = buttonEl.getBoundingClientRect();
        menu.showAtPosition({
            x: rect.right,
            y: rect.bottom
        });
    }
</script>

<button
    bind:this={buttonEl}
    class="clickable-icon gridnote-heading-icon-button heading-copy-menu-button"
    type="button"
    aria-label={ariaLabel}
    disabled={disabled}
    tabindex="-1"
    on:click={openMenu}
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

<script lang="ts">
    import { setIcon } from 'obsidian';
    import { onDestroy, onMount } from 'svelte';

    type ToolbarAction = (() => Promise<boolean | void> | boolean | void) | null;

    export let canUndo: boolean = false;
    export let canRedo: boolean = false;
    export let onOpenTextSearch: ToolbarAction = null;
    export let onOpenSiblingFileSwitcher: ToolbarAction = null;
    export let onOpenSettings: ToolbarAction = null;
    export let onUndo: ToolbarAction = null;
    export let onRedo: ToolbarAction = null;

    let searchIconEl: HTMLSpanElement | null = null;
    let fileSwitchIconEl: HTMLSpanElement | null = null;
    let settingsIconEl: HTMLSpanElement | null = null;
    let undoIconEl: HTMLSpanElement | null = null;
    let redoIconEl: HTMLSpanElement | null = null;
    let shortcutsIconEl: HTMLSpanElement | null = null;
    let toolbarShellEl: HTMLDivElement | null = null;
    let shortcutsPanelOpen = false;
    let isMacPlatform = false;

    if (typeof window !== 'undefined') {
        isMacPlatform = /Mac|iPhone|iPad/i.test(window.navigator.platform);
    }

    $: if (searchIconEl) {
        setIcon(searchIconEl, 'search');
    }

    $: if (fileSwitchIconEl) {
        setIcon(fileSwitchIconEl, 'files');
    }

    $: if (settingsIconEl) {
        setIcon(settingsIconEl, 'settings');
    }

    $: if (undoIconEl) {
        setIcon(undoIconEl, 'undo');
    }

    $: if (redoIconEl) {
        setIcon(redoIconEl, 'redo');
    }

    $: if (shortcutsIconEl) {
        setIcon(shortcutsIconEl, 'keyboard');
    }

    $: primaryModifierLabel = isMacPlatform ? 'Cmd' : 'Ctrl';
    $: hasSearchGroup = Boolean(onOpenTextSearch || onOpenSiblingFileSwitcher);
    $: hasHistoryGroup = Boolean(onUndo || onRedo);
    $: showToolbar = hasSearchGroup || hasHistoryGroup || Boolean(onOpenSettings);

    function invokeAction(action: ToolbarAction) {
        if (!action) {
            return;
        }

        void Promise.resolve(action()).catch((error) => {
            console.error('GridNote: 底部工具栏操作失败', error);
        });
    }

    function toggleShortcutsPanel(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        shortcutsPanelOpen = !shortcutsPanelOpen;
    }

    function handleWindowPointerDown(event: PointerEvent) {
        if (!shortcutsPanelOpen || !toolbarShellEl) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Node)) {
            return;
        }

        if (!toolbarShellEl.contains(target)) {
            shortcutsPanelOpen = false;
        }
    }

    function handleWindowKeydown(event: KeyboardEvent) {
        if (!shortcutsPanelOpen) {
            return;
        }

        if (event.key === 'Escape') {
            shortcutsPanelOpen = false;
        }
    }

    onMount(() => {
        window.addEventListener('pointerdown', handleWindowPointerDown, true);
        window.addEventListener('keydown', handleWindowKeydown, true);
    });

    onDestroy(() => {
        window.removeEventListener('pointerdown', handleWindowPointerDown, true);
        window.removeEventListener('keydown', handleWindowKeydown, true);
    });
</script>

{#if showToolbar}
    <div class="gridnote-floating-toolbar-shell" aria-hidden="false" bind:this={toolbarShellEl}>
        <div class="gridnote-floating-toolbar" role="toolbar" aria-label="GridNote 工具栏">
            {#if hasSearchGroup}
                <div class="gridnote-floating-toolbar-section" aria-label="搜索">
                    {#if onOpenTextSearch}
                        <button
                            type="button"
                            class="gridnote-floating-toolbar-button"
                            aria-label={`搜索（${primaryModifierLabel}+F）`}
                            on:click={() => invokeAction(onOpenTextSearch)}
                        >
                            <span class="gridnote-floating-toolbar-icon" bind:this={searchIconEl}></span>
                        </button>
                    {/if}

                    {#if onOpenSiblingFileSwitcher}
                        <button
                            type="button"
                            class="gridnote-floating-toolbar-button"
                            aria-label={`打开文件（${primaryModifierLabel}+O）`}
                            on:click={() => invokeAction(onOpenSiblingFileSwitcher)}
                        >
                            <span class="gridnote-floating-toolbar-icon" bind:this={fileSwitchIconEl}></span>
                        </button>
                    {/if}
                </div>
            {/if}

            {#if hasSearchGroup && hasHistoryGroup}
                <div class="gridnote-floating-toolbar-divider" aria-hidden="true"></div>
            {/if}

            {#if hasHistoryGroup}
                <div class="gridnote-floating-toolbar-section" aria-label="历史">
                    {#if onUndo}
                        <button
                            type="button"
                            class="gridnote-floating-toolbar-button"
                            disabled={!canUndo}
                            aria-label={canUndo ? '撤销' : '没有可撤销的文本修改'}
                            on:click={() => invokeAction(onUndo)}
                        >
                            <span class="gridnote-floating-toolbar-icon" bind:this={undoIconEl}></span>
                        </button>
                    {/if}

                    {#if onRedo}
                        <button
                            type="button"
                            class="gridnote-floating-toolbar-button"
                            disabled={!canRedo}
                            aria-label={canRedo ? '重做' : '没有可重做的文本修改'}
                            on:click={() => invokeAction(onRedo)}
                        >
                            <span class="gridnote-floating-toolbar-icon" bind:this={redoIconEl}></span>
                        </button>
                    {/if}
                </div>
            {/if}

            {#if hasSearchGroup || hasHistoryGroup || onOpenSettings}
                <div class="gridnote-floating-toolbar-divider" aria-hidden="true"></div>
            {/if}
            <div class="gridnote-floating-toolbar-section" aria-label="快捷键提示">
                <button
                    type="button"
                    class="gridnote-floating-toolbar-button"
                    class:is-active={shortcutsPanelOpen}
                    aria-label="快捷键提示"
                    aria-expanded={shortcutsPanelOpen}
                    on:click={toggleShortcutsPanel}
                >
                    <span class="gridnote-floating-toolbar-icon" bind:this={shortcutsIconEl}></span>
                </button>
            </div>

            {#if onOpenSettings}
                <div class="gridnote-floating-toolbar-divider" aria-hidden="true"></div>
                <div class="gridnote-floating-toolbar-section" aria-label="设置">
                    <button
                        type="button"
                        class="gridnote-floating-toolbar-button"
                        aria-label="打开设置"
                        on:click={() => invokeAction(onOpenSettings)}
                    >
                        <span class="gridnote-floating-toolbar-icon" bind:this={settingsIconEl}></span>
                    </button>
                </div>
            {/if}
        </div>

        {#if shortcutsPanelOpen}
            <section class="gridnote-shortcuts-panel" aria-label="GridNote 快捷键说明">
                <div class="gridnote-shortcuts-row">
                    <span class="gridnote-shortcuts-title">F 选中首个可见卡片</span>
                    <kbd>F</kbd>
                </div>
                <div class="gridnote-shortcuts-row">
                    <span class="gridnote-shortcuts-title">搜索</span>
                    <kbd>{primaryModifierLabel} + F</kbd>
                </div>
                <div class="gridnote-shortcuts-row">
                    <span class="gridnote-shortcuts-title">创建节点</span>
                    <kbd>Shift + {primaryModifierLabel} + ↑/↓/→</kbd>
                </div>
                <div class="gridnote-shortcuts-row">
                    <span class="gridnote-shortcuts-title">修改标题</span>
                    <kbd>T(选中状态)</kbd>
                </div>
                <div class="gridnote-shortcuts-divider" aria-hidden="true"></div>
                <div class="gridnote-shortcuts-row">
                    <span class="gridnote-shortcuts-title">卡片编辑</span>
                    <kbd>Enter / Space</kbd>
                </div>
                <div class="gridnote-shortcuts-row">
                    <span class="gridnote-shortcuts-title">卡片导航</span>
                    <kbd>↑ / ↓ / ← / →</kbd>
                </div>
                <div class="gridnote-shortcuts-row">
                    <span class="gridnote-shortcuts-title">删除节点</span>
                    <kbd>Backspace / Delete</kbd>
                </div>
                <div class="gridnote-shortcuts-row">
                    <span class="gridnote-shortcuts-title">清除选中</span>
                    <kbd>Esc</kbd>
                </div>
                <div class="gridnote-shortcuts-row">
                    <span class="gridnote-shortcuts-title">文件切换</span>
                    <kbd>{primaryModifierLabel} + O</kbd>
                </div>
                <div class="gridnote-shortcuts-row">
                    <span class="gridnote-shortcuts-title">撤销 / 重做</span>
                    <kbd>
                        {isMacPlatform
                            ? `${primaryModifierLabel} + Z / Shift + ${primaryModifierLabel} + Z`
                            : `${primaryModifierLabel} + Z / ${primaryModifierLabel} + Y`}
                    </kbd>
                </div>
            </section>
        {/if}
    </div>
{/if}

<style>
    .gridnote-floating-toolbar-shell {
        position: absolute;
        inset-inline: 0;
        bottom: 0;
        z-index: 140;
        display: flex;
        justify-content: center;
        padding: 0 12px calc(14px + max(0px, env(safe-area-inset-bottom, 0px)));
        pointer-events: none;
        box-sizing: border-box;
    }

    .gridnote-floating-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        max-width: min(100%, 420px);
        min-height: 46px;
        padding: 8px 12px;
        border: 1px solid color-mix(in srgb, var(--background-modifier-border) 92%, transparent);
        border-radius: 12px;
        background: color-mix(in srgb, var(--background-primary) 92%, transparent);
        backdrop-filter: blur(10px);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.18);
        opacity: 0.7;
        pointer-events: auto;
        box-sizing: border-box;
        transition:
            opacity 0.18s ease,
            transform 0.18s ease,
            box-shadow 0.18s ease;
    }

    .gridnote-floating-toolbar:hover {
        opacity: 1;
        transform: translateY(-1px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    }

    .gridnote-floating-toolbar-section {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
    }

    .gridnote-floating-toolbar-divider {
        width: 1px;
        align-self: stretch;
        background: color-mix(
            in srgb,
            var(--background-modifier-border) 84%,
            transparent
        );
    }

    .gridnote-floating-toolbar-button {
        width: 30px;
        height: 30px;
        border: none;
        border-radius: 6px;
        background: var(--interactive-normal);
        color: var(--text-normal);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition:
            transform 0.2s ease,
            background-color 0.2s ease,
            box-shadow 0.2s ease,
            color 0.2s ease,
            opacity 0.2s ease;
        box-sizing: border-box;
    }

    .gridnote-floating-toolbar-button:hover:not(:disabled) {
        background: var(--interactive-hover);
        transform: translateY(-1px);
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
    }

    .gridnote-floating-toolbar-button:active:not(:disabled) {
        transform: translateY(0);
        background: var(--interactive-accent);
        color: var(--text-on-accent);
    }

    .gridnote-floating-toolbar-button.is-active:not(:disabled) {
        background: color-mix(in srgb, var(--interactive-accent) 24%, var(--interactive-normal));
        color: var(--text-on-accent);
    }

    .gridnote-floating-toolbar-button:disabled {
        cursor: not-allowed;
        opacity: 0.5;
        background: var(--background-modifier-border);
        color: var(--text-muted);
        box-shadow: none;
    }

    .gridnote-floating-toolbar-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
    }

    .gridnote-floating-toolbar-icon :global(svg) {
        width: 14px;
        height: 14px;
        stroke-width: var(--icon-stroke);
        flex-shrink: 0;
    }

    .gridnote-shortcuts-panel {
        position: absolute;
        left: 50%;
        bottom: calc(100% + 8px);
        transform: translateX(-50%);
        width: min(460px, calc(100vw - 24px));
        display: grid;
        gap: 6px;
        padding: 10px 12px;
        border: 1px solid color-mix(in srgb, var(--background-modifier-border) 90%, transparent);
        border-radius: 10px;
        background: color-mix(in srgb, var(--background-primary) 95%, transparent);
        backdrop-filter: blur(10px);
        box-shadow: 0 10px 32px rgba(0, 0, 0, 0.22);
        pointer-events: auto;
        box-sizing: border-box;
    }

    .gridnote-shortcuts-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-width: 0;
    }

    .gridnote-shortcuts-title {
        color: var(--text-muted);
        font-size: var(--font-text-size);
        line-height: 1.35;
    }

    .gridnote-shortcuts-divider {
        height: 1px;
        background: color-mix(in srgb, var(--background-modifier-border) 85%, transparent);
        margin: 2px 0;
    }

    .gridnote-shortcuts-panel kbd {
        border: 1px solid color-mix(in srgb, var(--background-modifier-border) 88%, transparent);
        border-radius: 6px;
        padding: 2px 6px;
        background: color-mix(in srgb, var(--background-secondary) 90%, transparent);
        color: var(--text-normal);
        font-size: var(--font-smallest);
        line-height: 1.35;
        white-space: nowrap;
        font-family: var(--font-monospace), monospace;
    }

    @media (max-width: 900px) {
        .gridnote-floating-toolbar-shell {
            padding-bottom: calc(12px + max(0px, env(safe-area-inset-bottom, 0px)));
        }

        .gridnote-floating-toolbar {
            gap: 4px;
            padding: 6px 10px;
            min-height: 44px;
        }

        .gridnote-floating-toolbar-button {
            width: 32px;
            height: 32px;
        }
    }

    @media (max-width: 480px) {
        .gridnote-floating-toolbar {
            max-width: calc(100vw - 24px);
            overflow-x: auto;
            scrollbar-width: none;
        }

        .gridnote-floating-toolbar::-webkit-scrollbar {
            display: none;
        }

        .gridnote-floating-toolbar-button {
            flex-shrink: 0;
        }

        .gridnote-shortcuts-panel {
            gap: 5px;
            padding: 9px 10px;
        }
    }
</style>

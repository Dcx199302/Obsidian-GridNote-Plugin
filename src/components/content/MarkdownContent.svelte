<script lang="ts">
    import { Component, MarkdownRenderer } from 'obsidian';
    import type { App } from 'obsidian';
    import { onDestroy } from 'svelte';
    import { applyGridNoteImagePreviewToElement } from '../../utils/GridNoteImagePreviewPostProcessor';
    import { openInternalLinkWithLeafReuse } from '../../utils/internalLinkNavigation';

    export let content: string = '';
    export let startLine: number = 0;
    export let app: App | null = null;
    export let sourcePath: string = '';
    export let className: string = '';

    let containerEl: HTMLDivElement | null = null;
    let clickBoundContainerEl: HTMLDivElement | null = null;
    let renderComponent: Component | null = null;
    let renderVersion = 0;
    let lastRenderedSignature: string | null = null;

    function unloadRenderComponent(component: Component | null = renderComponent) {
        if (!component) {
            return;
        }

        component.unload();

        if (renderComponent === component) {
            renderComponent = null;
        }
    }

    function parseObsidianLineAttribute(value: string | null): number | null {
        if (typeof value !== 'string' || value.trim() === '') {
            return null;
        }

        const line = Number.parseInt(value.split(',')[0] ?? '', 10);
        return Number.isNaN(line) ? null : line;
    }

    function markRenderedLineAnchors(renderHostEl: HTMLElement) {
        const renderedSections = renderHostEl.querySelectorAll<HTMLElement>('[data-line]');
        for (const sectionEl of renderedSections) {
            const relativeLine = parseObsidianLineAttribute(
                sectionEl.getAttribute('data-line')
            );
            if (relativeLine !== null) {
                sectionEl.dataset.gridnoteBodyLine = String(startLine + relativeLine);
            }
        }
    }

    function notifyRenderComplete(targetEl: HTMLElement) {
        targetEl.dispatchEvent(new CustomEvent('gridnote-markdown-rendered', {
            bubbles: true
        }));
    }

    function createLoadingElement(markdown: string): HTMLDivElement {
        const loadingEl = createEl('div');
        const lineCount = Math.max(1, markdown.split('\n').length);
        const estimatedHeight = Math.min(
            640,
            Math.max(36, lineCount * 24)
        );

        loadingEl.className = 'markdown-content-loading';
        loadingEl.style.setProperty(
            '--gridnote-markdown-loading-height',
            `${estimatedHeight}px`
        );
        loadingEl.setAttribute('aria-hidden', 'true');
        return loadingEl;
    }

    function createPlainTextElement(markdown: string): HTMLDivElement {
        const plainTextEl = createEl('div');
        plainTextEl.className = 'markdown-content-plain';
        plainTextEl.textContent = markdown;
        return plainTextEl;
    }

    function resolveInternalLinkText(linkEl: HTMLAnchorElement): string | null {
        const dataHref = linkEl.getAttribute('data-href');
        if (typeof dataHref === 'string' && dataHref.trim().length > 0) {
            return dataHref.trim();
        }

        const href = linkEl.getAttribute('href');
        if (typeof href === 'string' && href.trim().length > 0 && !href.startsWith('obsidian://')) {
            return href.trim();
        }

        return null;
    }

    function handleContainerClick(event: MouseEvent) {
        if (
            event.defaultPrevented
            || event.button !== 0
            || event.metaKey
            || event.ctrlKey
            || event.shiftKey
            || event.altKey
        ) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Element) || !containerEl?.contains(target) || !app || !sourcePath) {
            return;
        }

        const linkEl = target.closest('a.internal-link');
        if (!(linkEl instanceof HTMLAnchorElement) || !containerEl.contains(linkEl)) {
            return;
        }

        const linktext = resolveInternalLinkText(linkEl);
        if (!linktext) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        void openInternalLinkWithLeafReuse(app, sourcePath, linktext).catch((error) => {
            console.error('GridNote: 处理内部链接跳转失败', error);
        });
    }

    async function renderContent(
        markdown: string,
        currentApp: App | null,
        currentSourcePath: string,
        requestVersion: number
    ) {
        const targetEl = containerEl;
        if (!targetEl) {
            return;
        }

        const nextSignature = [
            currentApp ? 'app:1' : 'app:0',
            `path:${currentSourcePath}`,
            `content:${markdown}`
        ].join('\n');

        if (nextSignature === lastRenderedSignature) {
            return;
        }

        unloadRenderComponent();

        if (!markdown.trim()) {
            targetEl.replaceChildren();
            lastRenderedSignature = nextSignature;
            return;
        }

        if (!currentApp) {
            targetEl.replaceChildren(createPlainTextElement(markdown));
            lastRenderedSignature = nextSignature;
            notifyRenderComplete(targetEl);
            return;
        }

        const renderHostEl = createEl('div');
        renderHostEl.className = 'markdown-rendered markdown-preview-view gridnote-markdown-content';

        const component = new Component();
        component.load();
        renderComponent = component;
        targetEl.replaceChildren(createLoadingElement(markdown));

        try {
            await MarkdownRenderer.render(
                currentApp,
                markdown,
                renderHostEl,
                currentSourcePath,
                component
            );
        } catch (error) {
            unloadRenderComponent(component);

            if (requestVersion !== renderVersion || containerEl !== targetEl) {
                return;
            }

            targetEl.replaceChildren(createPlainTextElement(markdown));
            notifyRenderComplete(targetEl);
            return;
        }

        if (requestVersion !== renderVersion || containerEl !== targetEl) {
            unloadRenderComponent(component);
            return;
        }

        targetEl.replaceChildren(renderHostEl);
        markRenderedLineAnchors(renderHostEl);
        applyGridNoteImagePreviewToElement(renderHostEl);
        notifyRenderComplete(targetEl);
        window.requestAnimationFrame(() => {
            if (requestVersion !== renderVersion || containerEl !== targetEl) {
                return;
            }

            applyGridNoteImagePreviewToElement(renderHostEl);
            markRenderedLineAnchors(renderHostEl);
            notifyRenderComplete(targetEl);
        });
        lastRenderedSignature = nextSignature;
    }

    $: if (containerEl) {
        const requestVersion = ++renderVersion;
        void renderContent(content, app, sourcePath, requestVersion);
    }
    $: if (clickBoundContainerEl !== containerEl) {
        clickBoundContainerEl?.removeEventListener('click', handleContainerClick);
        clickBoundContainerEl = containerEl;
        clickBoundContainerEl?.addEventListener('click', handleContainerClick);
    }

    onDestroy(() => {
        renderVersion += 1;
        clickBoundContainerEl?.removeEventListener('click', handleContainerClick);
        clickBoundContainerEl = null;
        unloadRenderComponent();
        containerEl?.replaceChildren();
    });
</script>

<div
    class={`markdown-content ${className}`.trim()}
    bind:this={containerEl}
></div>

<style>
    .markdown-content {
        min-width: 0;
    }

    .markdown-content :global(.markdown-content-loading) {
        display: block;
        width: 100%;
        min-height: var(--gridnote-markdown-loading-height, 48px);
        border-radius: 8px;
        background: color-mix(
            in srgb,
            var(--background-modifier-hover, rgba(128, 128, 128, 0.18)) 48%,
            transparent
        );
    }

    .markdown-content :global(.markdown-content-loading),
    .markdown-content :global(.markdown-content-plain) {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }


    .markdown-content :global(.gridnote-markdown-content.markdown-preview-view) {
        padding: 0 !important;
        margin: 0;
        height: auto;
        background: transparent;
        overflow: visible;
        scrollbar-gutter: auto;
        color: var(--text-normal);
        font-family:
            var(--font-text),
            var(--font-interface),
            system-ui,
            -apple-system,
            sans-serif;
        font-size: var(--font-text-size);
        max-width: 100%;
        user-select: text;
    }

    .markdown-content :global(.gridnote-markdown-content h1) {
        color: var(
            --gridnote-heading-color-h1,
            var(--gridnote-heading-color-default, var(--text-normal))
        );
        font-size: calc(var(--font-text-size) * 2);
    }

    .markdown-content :global(.gridnote-markdown-content h2) {
        color: var(
            --gridnote-heading-color-h2,
            var(--gridnote-heading-color-default, var(--text-normal))
        );
        font-size: calc(var(--font-text-size) * 1.6);
    }

    .markdown-content :global(.gridnote-markdown-content h3) {
        color: var(
            --gridnote-heading-color-h3,
            var(--gridnote-heading-color-default, var(--text-normal))
        );
        font-size: calc(var(--font-text-size) * 1.4);
    }

    .markdown-content :global(.gridnote-markdown-content h4) {
        color: var(
            --gridnote-heading-color-h4,
            var(--gridnote-heading-color-default, var(--text-normal))
        );
        font-size: calc(var(--font-text-size) * 1.2);
    }

    .markdown-content :global(.gridnote-markdown-content h5) {
        color: var(
            --gridnote-heading-color-h5,
            var(--gridnote-heading-color-default, var(--text-normal))
        );
        font-size: calc(var(--font-text-size) * 1.1);
    }

    .markdown-content :global(.gridnote-markdown-content h6) {
        color: var(
            --gridnote-heading-color-h6,
            var(--gridnote-heading-color-default, var(--text-normal))
        );
        font-size: var(--font-text-size);
    }

    .markdown-content :global(.gridnote-markdown-content p),
    .markdown-content :global(.gridnote-markdown-content ul),
    .markdown-content :global(.gridnote-markdown-content ol),
    .markdown-content :global(.gridnote-markdown-content blockquote),
    .markdown-content :global(.gridnote-markdown-content pre) {
        margin-top: 0.25rem;
        margin-bottom: 0.25rem;
    }

    .markdown-content :global(.markdown-rendered > :first-child) {
        margin-top: 0;
    }

    .markdown-content :global(.markdown-rendered > :last-child) {
        margin-bottom: 0;
    }

    .markdown-content :global(.markdown-content-plain) {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
    }

    .markdown-content :global(.markdown-rendered ul > li) {
        margin-inline-start: 3.5ch;
    }
</style>

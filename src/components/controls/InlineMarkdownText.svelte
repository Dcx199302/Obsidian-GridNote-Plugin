<script lang="ts">
    import { Component, MarkdownRenderer } from 'obsidian';
    import type { App } from 'obsidian';
    import { onDestroy } from 'svelte';

    export let markdown: string = '';
    export let parseAsHeading: boolean = false;
    export let app: App | null = null;
    export let sourcePath: string = '';

    let containerEl: HTMLSpanElement | null = null;
    let renderComponent: Component | null = null;
    let renderVersion = 0;
    let lastRenderedSignature: string | null = null;

    onDestroy(() => {
        renderVersion += 1;
        unloadRenderComponent();
        containerEl?.replaceChildren();
    });

    function unloadRenderComponent(component: Component | null = renderComponent) {
        if (!component) {
            return;
        }

        component.unload();
        if (renderComponent === component) {
            renderComponent = null;
        }
    }

    function createPlainTextElement(text: string): HTMLSpanElement {
        const plainTextEl = document.createElement('span');
        plainTextEl.className = 'inline-markdown-text-plain';
        plainTextEl.textContent = text;
        return plainTextEl;
    }

    function createInlineNodes(renderHostEl: HTMLElement, markdownText: string): Node[] {
        const inlineContainerEls = Array.from(renderHostEl.children)
            .filter((childEl): childEl is HTMLHeadingElement | HTMLParagraphElement => (
                childEl instanceof HTMLHeadingElement
                || childEl instanceof HTMLParagraphElement
            ));

        if (inlineContainerEls.length === 0) {
            return [createPlainTextElement(renderHostEl.textContent || markdownText)];
        }

        const inlineNodes: Node[] = [];
        inlineContainerEls.forEach((inlineContainerEl, index) => {
            if (index > 0) {
                inlineNodes.push(document.createTextNode(' '));
            }
            inlineNodes.push(...Array.from(inlineContainerEl.childNodes));
        });
        return inlineNodes;
    }

    function createRenderSource(markdownText: string, shouldParseAsHeading: boolean): string {
        return shouldParseAsHeading ? `# ${markdownText}` : markdownText;
    }

    async function renderInlineMarkdown(
        markdownText: string,
        shouldParseAsHeading: boolean,
        currentApp: App | null,
        currentSourcePath: string,
        requestVersion: number
    ) {
        const targetEl = containerEl;
        if (!targetEl) {
            unloadRenderComponent();
            lastRenderedSignature = null;
            return;
        }

        const nextSignature = [
            currentApp ? 'app:1' : 'app:0',
            `heading:${shouldParseAsHeading ? '1' : '0'}`,
            `path:${currentSourcePath}`,
            `content:${markdownText}`
        ].join('\n');

        if (nextSignature === lastRenderedSignature) {
            return;
        }

        unloadRenderComponent();
        const renderSource = createRenderSource(markdownText, shouldParseAsHeading);

        if (!markdownText.trim() || !currentApp) {
            targetEl.replaceChildren(createPlainTextElement(markdownText));
            lastRenderedSignature = nextSignature;
            return;
        }

        const renderHostEl = document.createElement('div');
        renderHostEl.className = 'markdown-rendered markdown-preview-view';

        const component = new Component();
        component.load();
        renderComponent = component;

        try {
            await MarkdownRenderer.render(
                currentApp,
                renderSource,
                renderHostEl,
                currentSourcePath,
                component
            );
        } catch (error) {
            console.error('GridNote: 标题 Markdown 渲染失败', error);
            unloadRenderComponent(component);

            if (requestVersion !== renderVersion || containerEl !== targetEl) {
                return;
            }

            targetEl.replaceChildren(createPlainTextElement(markdownText));
            lastRenderedSignature = nextSignature;
            return;
        }

        if (requestVersion !== renderVersion || containerEl !== targetEl) {
            unloadRenderComponent(component);
            return;
        }

        targetEl.replaceChildren(...createInlineNodes(renderHostEl, markdownText));
        lastRenderedSignature = nextSignature;
    }

    $: if (containerEl) {
        const requestVersion = ++renderVersion;
        void renderInlineMarkdown(markdown, parseAsHeading, app, sourcePath, requestVersion);
    }
</script>

<span bind:this={containerEl} class="inline-markdown-text"></span>

<style>
    .inline-markdown-text,
    .inline-markdown-text :global(.inline-markdown-text-plain) {
        display: block;
        width: 100%;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 1em !important;
        line-height: inherit !important;
    }

    .inline-markdown-text :global(*) {
        font-size: inherit !important;
        line-height: inherit !important;
    }
</style>

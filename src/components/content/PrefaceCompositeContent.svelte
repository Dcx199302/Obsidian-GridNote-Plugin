<script lang="ts">
    import type { App } from 'obsidian';
    import MarkdownContent from './MarkdownContent.svelte';
    import { splitPrefaceCompositeContent } from '../../utils/markdownContent';

    interface FrontmatterEntry {
        key: string;
        value: string;
    }

    export let content: string = '';
    export let app: App | null = null;
    export let sourcePath: string = '';
    export let className: string = '';

    function parseFrontmatterEntries(frontmatter: string): FrontmatterEntry[] {
        const lines = frontmatter.split('\n');
        if (lines.length < 3) {
            return [];
        }

        const bodyLines = lines.slice(1, -1);
        const entries: FrontmatterEntry[] = [];
        let activeEntry: FrontmatterEntry | null = null;

        for (const rawLine of bodyLines) {
            const line = rawLine ?? '';
            const keyMatch = line.match(/^([A-Za-z0-9_\-\u4e00-\u9fa5 ]+)\s*:\s*(.*)$/);
            if (keyMatch) {
                if (activeEntry) {
                    entries.push(activeEntry);
                }

                activeEntry = {
                    key: (keyMatch[1] ?? '').trim(),
                    value: (keyMatch[2] ?? '').trim()
                };
                continue;
            }

            if (activeEntry) {
                const continuation = line.trim();
                if (continuation.length > 0) {
                    activeEntry.value = activeEntry.value
                        ? `${activeEntry.value}\n${continuation}`
                        : continuation;
                }
            }
        }

        if (activeEntry) {
            entries.push(activeEntry);
        }

        return entries.filter((entry) => entry.key.length > 0);
    }

    $: sections = splitPrefaceCompositeContent(content);
    $: hasFrontmatter = sections.hasFrontmatter;
    $: prefaceBody = sections.preface;
    $: hasPrefaceBody = prefaceBody.trim().length > 0;
    $: frontmatterEntries = parseFrontmatterEntries(sections.frontmatter);
</script>

<div class={`preface-composite-content ${className}`.trim()}>
    {#if hasFrontmatter}
        <section class="preface-properties" aria-label="笔记属性">
            <div class="preface-properties-title">笔记属性</div>
            {#if frontmatterEntries.length > 0}
                <dl class="preface-properties-list">
                    {#each frontmatterEntries as entry (entry.key)}
                        <div class="preface-properties-item">
                            <dt>{entry.key}</dt>
                            <dd>{entry.value || '—'}</dd>
                        </div>
                    {/each}
                </dl>
            {:else}
                <pre class="preface-properties-raw">{sections.frontmatter}</pre>
            {/if}
        </section>
    {/if}

    {#if hasPrefaceBody}
        <MarkdownContent
            content={prefaceBody}
            {app}
            {sourcePath}
            className="preface-body"
        />
    {:else if hasFrontmatter}
        <div class="preface-empty-state">仅包含笔记属性</div>
    {:else}
        <div class="preface-empty-state">暂无前置内容</div>
    {/if}
</div>

<style>
    .preface-composite-content {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
    }

    .preface-properties {
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        background: var(--background-secondary);
        padding: 10px 12px;
    }

    .preface-properties-title {
        margin-bottom: 8px;
        font-size: var(--font-ui-small);
        font-weight: 600;
        color: var(--text-muted);
    }

    .preface-properties-list {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .preface-properties-item {
        display: grid;
        grid-template-columns: minmax(72px, auto) minmax(0, 1fr);
        column-gap: 12px;
        align-items: start;
    }

    .preface-properties-item dt {
        margin: 0;
        color: var(--text-muted);
        font-size: var(--font-ui-small);
        line-height: 1.45;
        word-break: break-word;
    }

    .preface-properties-item dd {
        margin: 0;
        color: var(--text-normal);
        font-size: var(--font-text-size);
        line-height: 1.45;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
    }

    .preface-properties-raw {
        margin: 0;
        font-family: var(--font-monospace);
        font-size: var(--font-ui-smaller);
        line-height: 1.45;
        color: var(--text-muted);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }

    .preface-empty-state {
        min-height: 1.4rem;
        color: var(--text-muted);
        font-size: var(--font-ui-small);
        line-height: 1.5;
    }
</style>

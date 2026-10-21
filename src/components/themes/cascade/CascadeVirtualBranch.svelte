<script context="module" lang="ts">
    interface SharedIntersectionObserverState {
        callbacks: Map<Element, (entry: IntersectionObserverEntry) => void>;
        observer: IntersectionObserver;
    }

    const sharedIntersectionObservers = new WeakMap<HTMLElement, SharedIntersectionObserverState>();

    function observeWithSharedIntersectionObserver(
        rootEl: HTMLElement,
        targetEl: Element,
        callback: (entry: IntersectionObserverEntry) => void,
        rootMargin: string
    ): () => void {
        let state = sharedIntersectionObservers.get(rootEl);

        if (!state) {
            const callbacks = new Map<Element, (entry: IntersectionObserverEntry) => void>();
            const observer = new IntersectionObserver(
                (entries) => {
                    for (const entry of entries) {
                        callbacks.get(entry.target)?.(entry);
                    }
                },
                {
                    root: rootEl,
                    rootMargin,
                    threshold: 0
                }
            );

            state = {
                callbacks,
                observer
            };
            sharedIntersectionObservers.set(rootEl, state);
        }

        state.callbacks.set(targetEl, callback);
        state.observer.observe(targetEl);

        return () => {
            const currentState = sharedIntersectionObservers.get(rootEl);
            if (!currentState) {
                return;
            }

            currentState.callbacks.delete(targetEl);
            currentState.observer.unobserve(targetEl);

            if (currentState.callbacks.size === 0) {
                currentState.observer.disconnect();
                sharedIntersectionObservers.delete(rootEl);
            }
        };
    }
</script>

<script lang="ts">
    import { getContext, onDestroy } from 'svelte';
    import { readable } from 'svelte/store';
    import type { TreeNode } from '../../../types';
    import {
        gridNoteCardEditingContextKey,
        type GridNoteCardEditingContext
    } from '../shared/cardEditingContext';

    const branchHeightCache = new Map<string, number>();
    // 快速滚动时给异步 Markdown 渲染预留约两屏的准备时间。
    const ROOT_MARGIN = '1600px 0px';
    const UNMOUNT_DELAY_MS = 1000;

    export let node: TreeNode;
    export let viewportElement: HTMLElement | null = null;
    export let className: string = '';
    export let fallbackHeight: number = 360;
    export let virtualized: boolean = true;

    const editingContext = getContext<GridNoteCardEditingContext | undefined>(
        gridNoteCardEditingContextKey
    );
    const activeEditingPathKeys = editingContext?.activeEditingPathKeys
        ?? readable<Set<string>>(new Set());
    const selectedCardId = editingContext?.selectedCardId
        ?? readable<string | null>(null);
    const revealPinnedNodeId = editingContext?.revealPinnedNodeId
        ?? readable<string | null>(null);

    let containerEl: HTMLDivElement | null = null;
    let contentEl: HTMLDivElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let intersectionObserverRoot: HTMLElement | null = null;
    let intersectionObserverCleanup: (() => void) | null = null;
    let measuredHeightCacheKey: string | null = null;
    let measuredHeight = fallbackHeight;
    let isNearViewport = false;
    let retainRenderedContent = false;
    let unmountTimeout = 0;

    function subtreeContainsNode(root: TreeNode, nodeId: string | null): boolean {
        if (!nodeId) {
            return false;
        }

        if (root.viewId === nodeId) {
            return true;
        }

        return root.children.some((child) => subtreeContainsNode(child, nodeId));
    }

    function disconnectResizeObserver() {
        resizeObserver?.disconnect();
        resizeObserver = null;
    }

    function disconnectIntersectionObserver() {
        intersectionObserverCleanup?.();
        intersectionObserverCleanup = null;
        intersectionObserverRoot = null;
    }

    function clearScheduledUnmount() {
        if (unmountTimeout === 0) {
            return;
        }

        window.clearTimeout(unmountTimeout);
        unmountTimeout = 0;
    }

    function handleIntersectionChange(isIntersecting: boolean) {
        isNearViewport = isIntersecting;

        if (isIntersecting) {
            clearScheduledUnmount();
            retainRenderedContent = true;
            return;
        }

        if (unmountTimeout !== 0) {
            return;
        }

        // 快速滚动穿越 root margin 时保留已渲染 DOM，避免卸载/重挂载造成闪烁。
        unmountTimeout = window.setTimeout(() => {
            unmountTimeout = 0;
            if (!isNearViewport && !isPinned) {
                retainRenderedContent = false;
            }
        }, UNMOUNT_DELAY_MS);
    }

    function updateMeasuredHeight(nextHeight: number) {
        if (nextHeight <= 0) {
            return;
        }

        measuredHeight = Math.ceil(nextHeight);
        branchHeightCache.set(node.viewId, measuredHeight);
    }

    function ensureResizeObserver(targetEl: HTMLDivElement) {
        if (resizeObserver) {
            return;
        }

        updateMeasuredHeight(targetEl.offsetHeight);
        resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) {
                return;
            }

            updateMeasuredHeight(entry.contentRect.height);
        });
        resizeObserver.observe(targetEl);
    }

    function ensureIntersectionObserver(
        targetEl: HTMLDivElement,
        rootEl: HTMLElement | null
    ) {
        if (!virtualized || !rootEl) {
            disconnectIntersectionObserver();
            handleIntersectionChange(true);
            return;
        }

        if (intersectionObserverCleanup && intersectionObserverRoot === rootEl) {
            return;
        }

        disconnectIntersectionObserver();
        intersectionObserverRoot = rootEl;
        intersectionObserverCleanup = observeWithSharedIntersectionObserver(
            rootEl,
            targetEl,
            (entry) => {
                handleIntersectionChange(
                    entry.isIntersecting || entry.intersectionRatio > 0
                );
            },
            ROOT_MARGIN
        );
    }

    $: isPinned = (
        $activeEditingPathKeys.has(node.viewId)
        || subtreeContainsNode(node, $selectedCardId)
        || subtreeContainsNode(node, $revealPinnedNodeId)
    );
    $: shouldRender = !virtualized || isPinned || isNearViewport || retainRenderedContent;

    $: if (measuredHeightCacheKey !== node.viewId) {
        measuredHeightCacheKey = node.viewId;
        measuredHeight = branchHeightCache.get(node.viewId) ?? fallbackHeight;
    }

    $: if (containerEl) {
        ensureIntersectionObserver(containerEl, viewportElement);
    }

    $: if (contentEl && shouldRender) {
        ensureResizeObserver(contentEl);
    } else {
        disconnectResizeObserver();
    }

    onDestroy(() => {
        clearScheduledUnmount();
        disconnectResizeObserver();
        disconnectIntersectionObserver();
    });
</script>

<div
    bind:this={containerEl}
    class={`cascade-virtual-branch ${className}`.trim()}
    data-gridnote-branch-id={node.viewId}
    style={!shouldRender && virtualized ? `height: ${measuredHeight}px;` : ''}
>
    {#if shouldRender}
        <div bind:this={contentEl} class="cascade-virtual-branch-content">
            <slot />
        </div>
    {:else}
        <div class="cascade-virtual-branch-placeholder" aria-hidden="true"></div>
    {/if}
</div>

<style>
    .cascade-virtual-branch {
        width: 100%;
        min-width: 0;
    }

    .cascade-virtual-branch-content,
    .cascade-virtual-branch-placeholder {
        width: 100%;
        min-width: 0;
    }

    .cascade-virtual-branch-placeholder {
        height: 100%;
        min-height: 96px;
        box-sizing: border-box;
        border-radius: 12px;
        background: color-mix(
            in srgb,
            var(--background-modifier-hover, rgba(128, 128, 128, 0.18)) 55%,
            transparent
        );
    }
</style>

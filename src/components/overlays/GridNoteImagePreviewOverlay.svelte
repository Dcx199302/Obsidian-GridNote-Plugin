<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from 'svelte';
    import { setIcon } from 'obsidian';

    export let isOpen: boolean = false;
    export let imageSrc: string = '';
    export let imageAlt: string = '';

    const MIN_SCALE = 0.5;
    const MAX_SCALE = 2.5;
    const SCALE_STEP = 0.1;

    const dispatch = createEventDispatcher<{ close: void }>();

    interface ZoomAnchor {
        clientX: number;
        clientY: number;
    }

    let scale = 1;
    let previousImageSrc = '';
    let viewportEl: HTMLDivElement | null = null;
    let imageEl: HTMLImageElement | null = null;
    let scaleIndicatorVisible = false;
    let scaleIndicatorTimer = 0;
    let isDragging = false;
    let dragPointerId: number | null = null;
    let dragStartClientX = 0;
    let dragStartClientY = 0;
    let panX = 0;
    let panY = 0;
    let dragStartPanX = 0;
    let dragStartPanY = 0;
    let closeButtonEl: HTMLButtonElement | null = null;

    $: if (isOpen && imageSrc !== previousImageSrc) {
        previousImageSrc = imageSrc;
        scale = 1;
        panX = 0;
        panY = 0;
    }

    $: if (closeButtonEl) setIcon(closeButtonEl, 'x');

    function clampScale(value: number): number {
        return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
    }

    function closeOverlay(): void {
        dispatch('close');
    }

    function getMaxPanOffset(axis: 'x' | 'y'): number {
        if (!viewportEl || !imageEl) {
            return 0;
        }

        const viewportSize = axis === 'x' ? viewportEl.clientWidth : viewportEl.clientHeight;
        const imageSize = axis === 'x' ? imageEl.clientWidth : imageEl.clientHeight;
        return Math.max(0, (imageSize * scale - viewportSize) / 2);
    }

    function clampPanOffset(value: number, axis: 'x' | 'y'): number {
        const maxOffset = getMaxPanOffset(axis);
        return Math.min(maxOffset, Math.max(-maxOffset, value));
    }

    function setScale(nextScale: number, showIndicator: boolean = true, anchor?: ZoomAnchor): void {
        const previousScale = scale;
        scale = clampScale(nextScale);

        if (anchor && viewportEl && scale !== previousScale) {
            const viewportRect = viewportEl.getBoundingClientRect();
            const anchorX = anchor.clientX - (viewportRect.left + viewportRect.width / 2);
            const anchorY = anchor.clientY - (viewportRect.top + viewportRect.height / 2);
            const scaleRatio = scale / previousScale;

            panX = anchorX - scaleRatio * (anchorX - panX);
            panY = anchorY - scaleRatio * (anchorY - panY);
        }

        panX = clampPanOffset(panX, 'x');
        panY = clampPanOffset(panY, 'y');
        if (!showIndicator) {
            return;
        }

        if (scaleIndicatorTimer !== 0) {
            window.clearTimeout(scaleIndicatorTimer);
            scaleIndicatorTimer = 0;
        }

        scaleIndicatorVisible = true;
        scaleIndicatorTimer = window.setTimeout(() => {
            scaleIndicatorVisible = false;
            scaleIndicatorTimer = 0;
        }, 850);
    }

    function zoomIn(): void {
        setScale(scale + SCALE_STEP);
    }

    function zoomOut(): void {
        setScale(scale - SCALE_STEP);
    }

    function resetZoom(): void {
        setScale(1);
        panX = 0;
        panY = 0;
    }

    function handleViewportWheel(event: WheelEvent): void {
        event.preventDefault();
        setScale(scale + (event.deltaY > 0 ? -SCALE_STEP : SCALE_STEP), true, event);
    }

    function viewportWheel(node: HTMLDivElement): { destroy: () => void } {
        node.addEventListener('wheel', handleViewportWheel, { passive: false });
        return {
            destroy() {
                node.removeEventListener('wheel', handleViewportWheel);
            }
        };
    }

    function handleViewportPointerDown(event: PointerEvent): void {
        if (event.button !== 0 || !viewportEl) {
            return;
        }

        isDragging = true;
        dragPointerId = event.pointerId;
        dragStartClientX = event.clientX;
        dragStartClientY = event.clientY;
        dragStartPanX = panX;
        dragStartPanY = panY;
        viewportEl.setPointerCapture(event.pointerId);
    }

    function handleViewportPointerMove(event: PointerEvent): void {
        if (!isDragging || dragPointerId !== event.pointerId || !viewportEl) {
            return;
        }

        const deltaX = event.clientX - dragStartClientX;
        const deltaY = event.clientY - dragStartClientY;
        panX = clampPanOffset(dragStartPanX + deltaX, 'x');
        panY = clampPanOffset(dragStartPanY + deltaY, 'y');
    }

    function endViewportDragging(event: PointerEvent): void {
        if (!isDragging || dragPointerId !== event.pointerId || !viewportEl) {
            return;
        }

        if (viewportEl.hasPointerCapture(event.pointerId)) {
            viewportEl.releasePointerCapture(event.pointerId);
        }

        isDragging = false;
        dragPointerId = null;
    }

    function handleWindowKeydown(event: KeyboardEvent): void {
        if (!isOpen) {
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            closeOverlay();
            return;
        }

        if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            zoomIn();
            return;
        }

        if (event.key === '-') {
            event.preventDefault();
            zoomOut();
            return;
        }

        if (event.key === '0') {
            event.preventDefault();
            resetZoom();
        }
    }

    onMount(() => {
        window.addEventListener('keydown', handleWindowKeydown, true);
        return () => {
            window.removeEventListener('keydown', handleWindowKeydown, true);
        };
    });

    onDestroy(() => {
        if (scaleIndicatorTimer !== 0) {
            window.clearTimeout(scaleIndicatorTimer);
            scaleIndicatorTimer = 0;
        }
    });
</script>

{#if isOpen}
    <div class="gridnote-image-preview-overlay">
        <button
            type="button"
            class="gridnote-image-preview-backdrop"
            aria-label="关闭图片预览"
            on:click={closeOverlay}
        ></button>
        <section class="gridnote-image-preview-panel" role="dialog" aria-modal="true">
            {#if scaleIndicatorVisible}
                <div class="gridnote-image-preview-scale-indicator">{Math.round(scale * 100)}%</div>
            {/if}
            <header class="gridnote-image-preview-toolbar">
                <button
                    type="button"
                    class="clickable-icon gridnote-image-preview-modal-action"
                    aria-label="关闭预览"
                    title="关闭预览"
                    bind:this={closeButtonEl}
                    on:click={closeOverlay}
                ></button>
            </header>
            <div
                class="gridnote-image-preview-viewport"
                class:is-dragging={isDragging}
                bind:this={viewportEl}
                use:viewportWheel
                on:pointerdown={handleViewportPointerDown}
                on:pointermove={handleViewportPointerMove}
                on:pointerup={endViewportDragging}
                on:pointercancel={endViewportDragging}
            >
                <img
                    class="gridnote-image-preview-image"
                    src={imageSrc}
                    alt={imageAlt}
                    style={`transform: translate(${panX}px, ${panY}px) scale(${scale});`}
                    bind:this={imageEl}
                    draggable="false"
                />
            </div>
        </section>
    </div>
{/if}

<style>
    :global(.gridnote-image-preview-overlay-host) {
        position: fixed;
        inset: 0;
        z-index: var(--layer-modal);
        pointer-events: none;
    }

    .gridnote-image-preview-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
    }

    .gridnote-image-preview-backdrop {
        position: absolute;
        inset: 0;
        border: 0;
        padding: 0;
        margin: 0;
        background: color-mix(in srgb, black 58%, transparent);
        backdrop-filter: blur(4px);
        cursor: zoom-out;
    }

    .gridnote-image-preview-panel {
        width: min(94vw, 1600px);
        height: min(92vh, 980px);
        position: relative;
        display: flex;
        flex-direction: column;
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        border-radius: var(--radius-l);
        box-shadow: var(--shadow-l);
        overflow: hidden;
    }

    .gridnote-image-preview-toolbar {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 0.25rem;
        padding: 0.25rem 0.5rem;
        border-bottom: 1px solid var(--background-modifier-border);
        background: var(--background-secondary);
    }

    .gridnote-image-preview-modal-action {
        width: 28px;
        height: 28px;
        border-radius: var(--radius-s);
        color: var(--text-muted);
    }

    .gridnote-image-preview-modal-action:hover {
        color: var(--text-normal);
        background: var(--background-modifier-hover);
    }

    .gridnote-image-preview-viewport {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        overflow: auto;
        cursor: grab;
        user-select: none;
        touch-action: none;
    }

    .gridnote-image-preview-viewport.is-dragging {
        cursor: grabbing;
    }

    .gridnote-image-preview-image {
        display: block;
        transform-origin: center center;
        max-width: min(88vw, 1500px);
        max-height: min(82vh, 900px);
        width: auto;
        height: auto;
        object-fit: contain;
        user-select: none;
        -webkit-user-drag: none;
        pointer-events: none;
    }

    .gridnote-image-preview-scale-indicator {
        position: absolute;
        top: 52px;
        right: 12px;
        z-index: 2;
        min-width: 56px;
        padding: 4px 8px;
        border-radius: var(--radius-s);
        font-size: 0.82rem;
        text-align: center;
        color: var(--text-on-accent);
        background: color-mix(in srgb, var(--interactive-accent) 86%, black 14%);
        box-shadow: var(--shadow-s);
        pointer-events: none;
    }
</style>

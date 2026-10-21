import { MarkdownRenderChild, setIcon } from 'obsidian';
import type { Plugin } from 'obsidian';
import GridNoteImagePreviewOverlay from '../components/overlays/GridNoteImagePreviewOverlay.svelte';

const ROOT_SELECTOR = '.gridnote-markdown-content';
const EMBED_SELECTOR = '.internal-embed.image-embed, .image-embed, .media-embed';
const BOUND_DATA_ATTR = 'data-gridnoteImagePreviewBound';

const MIN_DISPLAY_EDGE = 44;
const MIN_NATURAL_EDGE = 120;
const MIN_NATURAL_AREA = 36_000;
const MAX_VISIBILITY_RETRY = 20;

interface PreviewBinding {
    wrapperEl: HTMLSpanElement;
    hostEl: HTMLElement;
    imageEl: HTMLImageElement;
    buttonEl: HTMLButtonElement;
    resizeObserver: ResizeObserver | null;
    onImageLoad: () => void;
    onButtonClick: (event: MouseEvent) => void;
    onButtonPointerDown: (event: PointerEvent) => void;
    onButtonPointerUp: (event: PointerEvent) => void;
    onButtonMouseDown: (event: MouseEvent) => void;
    onButtonMouseUp: (event: MouseEvent) => void;
    onButtonDoubleClick: (event: MouseEvent) => void;
    onButtonContextMenu: (event: MouseEvent) => void;
    retryFrame: number;
    retryCount: number;
}

type CandidateState = 'eligible' | 'ineligible' | 'pending';

let activeManager: GridNoteImagePreviewManager | null = null;

function getDisplayMaxEdge(imageEl: HTMLImageElement): number {
    const rect = imageEl.getBoundingClientRect();
    const width = Math.round(rect.width || imageEl.clientWidth || imageEl.width);
    const height = Math.round(rect.height || imageEl.clientHeight || imageEl.height);
    return Math.max(width, height);
}

function getCandidateState(imageEl: HTMLImageElement): CandidateState {
    if (!imageEl.isConnected) {
        return 'pending';
    }

    const displayMaxEdge = getDisplayMaxEdge(imageEl);
    if (displayMaxEdge <= 0) {
        return imageEl.complete ? 'ineligible' : 'pending';
    }

    if (displayMaxEdge <= MIN_DISPLAY_EDGE) {
        return 'ineligible';
    }

    const naturalWidth = imageEl.naturalWidth;
    const naturalHeight = imageEl.naturalHeight;
    if (naturalWidth > 0 && naturalHeight > 0) {
        const naturalMaxEdge = Math.max(naturalWidth, naturalHeight);
        const naturalArea = naturalWidth * naturalHeight;
        if (naturalMaxEdge <= MIN_NATURAL_EDGE || naturalArea <= MIN_NATURAL_AREA) {
            return 'ineligible';
        }

        return 'eligible';
    }

    return imageEl.complete ? 'eligible' : 'pending';
}

function scheduleVisibilityRetry(binding: PreviewBinding): void {
    if (binding.retryCount >= MAX_VISIBILITY_RETRY || binding.retryFrame !== 0) {
        return;
    }

    binding.retryFrame = window.requestAnimationFrame(() => {
        binding.retryFrame = 0;
        binding.retryCount += 1;
        updateButtonVisibility(binding);
    });
}

function cancelVisibilityRetry(binding: PreviewBinding): void {
    if (binding.retryFrame === 0) {
        return;
    }

    window.cancelAnimationFrame(binding.retryFrame);
    binding.retryFrame = 0;
}

function updateButtonVisibility(binding: PreviewBinding): void {
    const state = getCandidateState(binding.imageEl);
    if (state === 'pending') {
        binding.buttonEl.hidden = true;
        scheduleVisibilityRetry(binding);
        return;
    }

    cancelVisibilityRetry(binding);
    binding.retryCount = 0;
    binding.buttonEl.hidden = state !== 'eligible';
}

class GridNoteImagePreviewOverlayController {
    private hostEl: HTMLDivElement | null = null;
    private overlay: GridNoteImagePreviewOverlay | null = null;
    private isOpen = false;
    private imageSrc = '';
    private imageAlt = '';

    openWithImage(imageEl: HTMLImageElement): void {
        const src = imageEl.currentSrc || imageEl.getAttribute('src') || '';
        if (!src) {
            return;
        }

        this.ensureOverlay();
        this.isOpen = true;
        this.imageSrc = src;
        this.imageAlt = imageEl.getAttribute('alt')?.trim() || 'Image preview';
        this.render();
    }

    destroy(): void {
        this.overlay?.$destroy();
        this.overlay = null;
        this.hostEl?.remove();
        this.hostEl = null;
    }

    private close(): void {
        if (!this.overlay) {
            return;
        }

        this.isOpen = false;
        this.render();
    }

    private ensureOverlay(): void {
        if (this.overlay && this.hostEl) {
            return;
        }

        this.hostEl = createEl('div');
        this.hostEl.className = 'gridnote-image-preview-overlay-host';
        document.body.appendChild(this.hostEl);

        this.overlay = new GridNoteImagePreviewOverlay({
            target: this.hostEl,
            props: {
                isOpen: this.isOpen,
                imageSrc: this.imageSrc,
                imageAlt: this.imageAlt
            }
        });

        this.overlay.$on('close', () => {
            this.close();
        });
    }

    private render(): void {
        this.overlay?.$set({
            isOpen: this.isOpen,
            imageSrc: this.imageSrc,
            imageAlt: this.imageAlt
        });
    }
}

// ─── Path A: lifecycle-managed child (post-processor with ctx) ───

class GridNoteImagePreviewChild extends MarkdownRenderChild {
    private readonly overlayController: GridNoteImagePreviewOverlayController;
    private readonly manager: GridNoteImagePreviewManager;
    private readonly bindings: PreviewBinding[] = [];

    constructor(
        containerEl: HTMLElement,
        overlayController: GridNoteImagePreviewOverlayController,
        manager: GridNoteImagePreviewManager
    ) {
        super(containerEl);
        this.overlayController = overlayController;
        this.manager = manager;
    }

    onload(): void {
        this.manager.addChild(this);
        this.scanAndBind();
    }

    onunload(): void {
        this.manager.removeChild(this);
        for (const binding of this.bindings) {
            cancelVisibilityRetry(binding);
            binding.resizeObserver?.disconnect();

            if (binding.buttonEl.parentElement) {
                binding.buttonEl.remove();
            }
            binding.hostEl.removeAttribute(BOUND_DATA_ATTR);

            const wrapperParent = binding.wrapperEl.parentElement;
            if (wrapperParent) {
                wrapperParent.insertBefore(binding.hostEl, binding.wrapperEl);
                binding.wrapperEl.remove();
            }
        }
        this.bindings.length = 0;
    }

    updateAllButtonVisibility(): void {
        for (const binding of this.bindings) {
            updateButtonVisibility(binding);
        }
    }

    private scanAndBind(): void {
        const containerEl = this.containerEl;
        const rootEls = new Set<HTMLElement>();

        if (containerEl.matches(ROOT_SELECTOR)) {
            rootEls.add(containerEl);
        }

        const closestRoot = containerEl.closest<HTMLElement>(ROOT_SELECTOR);
        if (closestRoot) {
            rootEls.add(closestRoot);
        }

        for (const nested of Array.from(containerEl.querySelectorAll<HTMLElement>(ROOT_SELECTOR))) {
            rootEls.add(nested);
        }

        if (rootEls.size === 0) {
            return;
        }

        for (const rootEl of rootEls) {
            const hostEls = Array.from(rootEl.querySelectorAll<HTMLElement>(EMBED_SELECTOR));
            for (const hostEl of hostEls) {
                const imageEl = hostEl.querySelector('img');
                if (!(imageEl instanceof HTMLImageElement)) {
                    continue;
                }

                this.bindImageEmbed(hostEl, imageEl);
            }
        }
    }

    private bindImageEmbed(hostEl: HTMLElement, imageEl: HTMLImageElement): void {
        if (hostEl.getAttribute(BOUND_DATA_ATTR) === '1') {
            const existingBinding = this.bindings.find((item) => item.hostEl === hostEl);
            if (existingBinding) {
                updateButtonVisibility(existingBinding);
            }
            return;
        }

        const parentEl = hostEl.parentElement;
        if (!parentEl) {
            return;
        }

        const wrapperEl = createEl('span');
        wrapperEl.className = 'gridnote-image-preview-anchor';
        parentEl.insertBefore(wrapperEl, hostEl);
        wrapperEl.appendChild(hostEl);

        const buttonEl = createEl('button');
        buttonEl.type = 'button';
        buttonEl.className = 'clickable-icon gridnote-image-preview-trigger';
        buttonEl.ariaLabel = '放大预览图片';
        buttonEl.title = '放大预览图片';
        buttonEl.hidden = true;
        setIcon(buttonEl, 'zoom-in');

        const swallowEvent = (event: Event): void => {
            event.preventDefault();
            event.stopPropagation();
            if ('stopImmediatePropagation' in event) {
                event.stopImmediatePropagation();
            }
        };

        const binding: PreviewBinding = {
            wrapperEl,
            hostEl,
            imageEl,
            buttonEl,
            resizeObserver: null,
            onImageLoad: () => {},
            onButtonClick: () => {},
            onButtonPointerDown: () => {},
            onButtonPointerUp: () => {},
            onButtonMouseDown: () => {},
            onButtonMouseUp: () => {},
            onButtonDoubleClick: () => {},
            onButtonContextMenu: () => {},
            retryFrame: 0,
            retryCount: 0
        };

        // All button events registered through Component lifecycle for auto-cleanup
        this.registerDomEvent(buttonEl, 'click', ((event: MouseEvent): void => {
            swallowEvent(event);
            this.overlayController.openWithImage(imageEl);
        }) as EventListener);
        this.registerDomEvent(buttonEl, 'pointerdown', ((event: PointerEvent): void => {
            swallowEvent(event);
        }) as EventListener);
        this.registerDomEvent(buttonEl, 'pointerup', ((event: PointerEvent): void => {
            swallowEvent(event);
        }) as EventListener);
        this.registerDomEvent(buttonEl, 'mousedown', ((event: MouseEvent): void => {
            swallowEvent(event);
        }) as EventListener);
        this.registerDomEvent(buttonEl, 'mouseup', ((event: MouseEvent): void => {
            swallowEvent(event);
        }) as EventListener);
        this.registerDomEvent(buttonEl, 'dblclick', ((event: MouseEvent): void => {
            swallowEvent(event);
        }) as EventListener);
        this.registerDomEvent(buttonEl, 'contextmenu', ((event: MouseEvent): void => {
            swallowEvent(event);
        }) as EventListener);

        // Image load event
        this.registerDomEvent(imageEl, 'load', (): void => {
            updateButtonVisibility(binding);
        });

        // ResizeObserver with Component-registered cleanup
        if (typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver((): void => {
                updateButtonVisibility(binding);
            });
            observer.observe(imageEl);
            binding.resizeObserver = observer;
            this.register(() => observer.disconnect());
        }

        wrapperEl.appendChild(buttonEl);
        hostEl.setAttribute(BOUND_DATA_ATTR, '1');
        this.bindings.push(binding);
        updateButtonVisibility(binding);
    }
}

// ─── Manager (renamed from Enhancer) ───

class GridNoteImagePreviewManager {
    private readonly children = new Set<GridNoteImagePreviewChild>();
    private readonly pathBBindings = new Set<PreviewBinding>();
    private readonly overlayController = new GridNoteImagePreviewOverlayController();

    private readonly onWindowResize = (): void => {
        for (const child of this.children) {
            child.updateAllButtonVisibility();
        }
        for (const binding of this.pathBBindings) {
            updateButtonVisibility(binding);
        }
    };

    addChild(child: GridNoteImagePreviewChild): void {
        this.children.add(child);
    }

    removeChild(child: GridNoteImagePreviewChild): void {
        this.children.delete(child);
    }

    register(plugin: Plugin): void {
        plugin.registerMarkdownPostProcessor((el, ctx) => {
            const child = new GridNoteImagePreviewChild(el, this.overlayController, this);
            ctx.addChild(child);
        });

        plugin.registerDomEvent(window, 'resize', this.onWindowResize);

        plugin.register(() => {
            this.destroy();
        });
    }

    processElementWithoutLifecycle(el: HTMLElement): void {
        // Clean up stale path B bindings
        for (const binding of this.pathBBindings) {
            if (!binding.hostEl.isConnected) {
                teardownPathBBinding(binding);
                this.pathBBindings.delete(binding);
            }
        }

        const rootEls = new Set<HTMLElement>();

        if (el.matches(ROOT_SELECTOR)) {
            rootEls.add(el);
        }

        const closestRoot = el.closest<HTMLElement>(ROOT_SELECTOR);
        if (closestRoot) {
            rootEls.add(closestRoot);
        }

        for (const nested of Array.from(el.querySelectorAll<HTMLElement>(ROOT_SELECTOR))) {
            rootEls.add(nested);
        }

        if (rootEls.size === 0) {
            return;
        }

        for (const rootEl of rootEls) {
            const hostEls = Array.from(rootEl.querySelectorAll<HTMLElement>(EMBED_SELECTOR));
            for (const hostEl of hostEls) {
                const imageEl = hostEl.querySelector('img');
                if (!(imageEl instanceof HTMLImageElement)) {
                    continue;
                }

                this.bindPathBImageEmbed(hostEl, imageEl);
            }
        }
    }

    private bindPathBImageEmbed(hostEl: HTMLElement, imageEl: HTMLImageElement): void {
        if (hostEl.getAttribute(BOUND_DATA_ATTR) === '1') {
            const existingBinding = Array.from(this.pathBBindings).find((item) => item.hostEl === hostEl);
            if (existingBinding) {
                updateButtonVisibility(existingBinding);
            }
            return;
        }

        const parentEl = hostEl.parentElement;
        if (!parentEl) {
            return;
        }

        const wrapperEl = createEl('span');
        wrapperEl.className = 'gridnote-image-preview-anchor';
        parentEl.insertBefore(wrapperEl, hostEl);
        wrapperEl.appendChild(hostEl);

        const buttonEl = createEl('button');
        buttonEl.type = 'button';
        buttonEl.className = 'clickable-icon gridnote-image-preview-trigger';
        buttonEl.ariaLabel = '放大预览图片';
        buttonEl.title = '放大预览图片';
        buttonEl.hidden = true;
        setIcon(buttonEl, 'zoom-in');

        const swallowEvent = (event: Event): void => {
            event.preventDefault();
            event.stopPropagation();
            if ('stopImmediatePropagation' in event) {
                event.stopImmediatePropagation();
            }
        };

        const binding: PreviewBinding = {
            wrapperEl,
            hostEl,
            imageEl,
            buttonEl,
            resizeObserver: null,
            onImageLoad: (): void => updateButtonVisibility(binding),
            onButtonClick: (event: MouseEvent): void => {
                swallowEvent(event);
                this.overlayController.openWithImage(imageEl);
            },
            onButtonPointerDown: (event: PointerEvent): void => {
                swallowEvent(event);
            },
            onButtonPointerUp: (event: PointerEvent): void => {
                swallowEvent(event);
            },
            onButtonMouseDown: (event: MouseEvent): void => {
                swallowEvent(event);
            },
            onButtonMouseUp: (event: MouseEvent): void => {
                swallowEvent(event);
            },
            onButtonDoubleClick: (event: MouseEvent): void => {
                swallowEvent(event);
            },
            onButtonContextMenu: (event: MouseEvent): void => {
                swallowEvent(event);
            },
            retryFrame: 0,
            retryCount: 0
        };

        // Path B: native addEventListener (cleaned up via isConnected checks + destroy)
        buttonEl.addEventListener('click', binding.onButtonClick);
        buttonEl.addEventListener('pointerdown', binding.onButtonPointerDown);
        buttonEl.addEventListener('pointerup', binding.onButtonPointerUp);
        buttonEl.addEventListener('mousedown', binding.onButtonMouseDown);
        buttonEl.addEventListener('mouseup', binding.onButtonMouseUp);
        buttonEl.addEventListener('dblclick', binding.onButtonDoubleClick);
        buttonEl.addEventListener('contextmenu', binding.onButtonContextMenu);

        if (typeof ResizeObserver !== 'undefined') {
            binding.resizeObserver = new ResizeObserver((): void => {
                updateButtonVisibility(binding);
            });
            binding.resizeObserver.observe(imageEl);
        }

        imageEl.addEventListener('load', binding.onImageLoad);
        wrapperEl.appendChild(buttonEl);
        hostEl.setAttribute(BOUND_DATA_ATTR, '1');
        this.pathBBindings.add(binding);
        updateButtonVisibility(binding);
    }

    destroy(): void {
        for (const binding of this.pathBBindings) {
            teardownPathBBinding(binding);
        }
        this.pathBBindings.clear();

        this.children.clear();
        this.overlayController.destroy();
    }
}

function teardownPathBBinding(binding: PreviewBinding): void {
    cancelVisibilityRetry(binding);
    binding.resizeObserver?.disconnect();
    binding.imageEl.removeEventListener('load', binding.onImageLoad);
    binding.buttonEl.removeEventListener('click', binding.onButtonClick);
    binding.buttonEl.removeEventListener('pointerdown', binding.onButtonPointerDown);
    binding.buttonEl.removeEventListener('pointerup', binding.onButtonPointerUp);
    binding.buttonEl.removeEventListener('mousedown', binding.onButtonMouseDown);
    binding.buttonEl.removeEventListener('mouseup', binding.onButtonMouseUp);
    binding.buttonEl.removeEventListener('dblclick', binding.onButtonDoubleClick);
    binding.buttonEl.removeEventListener('contextmenu', binding.onButtonContextMenu);

    if (binding.buttonEl.parentElement) {
        binding.buttonEl.remove();
    }

    binding.hostEl.removeAttribute(BOUND_DATA_ATTR);

    const wrapperParent = binding.wrapperEl.parentElement;
    if (wrapperParent) {
        wrapperParent.insertBefore(binding.hostEl, binding.wrapperEl);
        binding.wrapperEl.remove();
    }
}

// ─── Public API (signatures unchanged) ───

export function registerGridNoteImagePreviewPostProcessor(plugin: Plugin): void {
    activeManager?.destroy();

    const manager = new GridNoteImagePreviewManager();
    activeManager = manager;
    manager.register(plugin);

    plugin.register(() => {
        if (activeManager === manager) {
            activeManager = null;
        }
    });
}

export function applyGridNoteImagePreviewToElement(el: HTMLElement): void {
    activeManager?.processElementWithoutLifecycle(el);
}

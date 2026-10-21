import {
    App,
    Component,
    Modal,
    Notice,
    setIcon
} from 'obsidian';
import type { DocumentStructure } from '../types';
import {
    searchDocumentStructure,
    type GridNoteSearchResponse,
    type GridNoteSearchResult,
    type GridNoteSearchSnippet,
    type GridNoteSearchTextRange
} from './GridNoteTextSearch';
import SpatialNavigation from 'spatial-navigation-js';
import { useNativeModalHeader } from './modalHeader';

interface GridNoteTextSearchModalOptions {
    sourcePath: string;
    structure: DocumentStructure;
    onChooseResult: (result: GridNoteSearchResult) => Promise<void> | void;
}

interface GridNoteTextSearchMemoryState {
    query: string;
    selectedResultKey: string | null;
    scrollTop: number;
    isResultsNavigationActive: boolean;
}

const textSearchStateMemory = new Map<string, GridNoteTextSearchMemoryState>();
const SEARCH_DEBOUNCE_MS = 180;
let textSearchModalInstanceCount = 0;

interface GridNoteSearchResultGroup {
    label: string;
    results: GridNoteSearchResult[];
}

interface GridNoteSearchCardEntry {
    key: string;
    result: GridNoteSearchResult;
    buttonEl: HTMLButtonElement;
    order: number;
    rect: DOMRect;
}

export class GridNoteTextSearchModal extends Modal {
    private static activeInstance: GridNoteTextSearchModal | null = null;
    private readonly sourcePath: string;
    private readonly structure: DocumentStructure;
    private readonly onChooseResult: (result: GridNoteSearchResult) => Promise<void> | void;
    private readonly navigationSectionId: string;
    private query = '';
    private response: GridNoteSearchResponse | null = null;
    private inputEl: HTMLInputElement | null = null;
    private summaryEl: HTMLDivElement | null = null;
    private resultsEl: HTMLDivElement | null = null;
    private emptyEl: HTMLDivElement | null = null;
    private searchDebounceTimeout = 0;
    private resultsResizeObserver: ResizeObserver | null = null;
    private layoutRefreshFrame = 0;
    private renderedColumnCount = 0;
    private renderedResultsWidth = 0;
    private selectedResultKey: string | null = null;
    private isResultsNavigationActive = false;
    private resultCardEntries: GridNoteSearchCardEntry[] = [];
    private resultCardHeightCache = new Map<string, number>();
    private hasSpatialNavigationSection = false;
    private eventScope: Component | null = null;
    private shouldRestoreRememberedViewport = false;
    private restoreViewportFrame = 0;

    constructor(app: App, options: GridNoteTextSearchModalOptions) {
        super(app);
        this.sourcePath = options.sourcePath;
        this.structure = options.structure;
        this.onChooseResult = options.onChooseResult;
        textSearchModalInstanceCount += 1;
        this.navigationSectionId = `gridnote-text-search-results-${textSearchModalInstanceCount}`;
    }

    static getActiveInstance(): GridNoteTextSearchModal | null {
        return GridNoteTextSearchModal.activeInstance;
    }

    matchesSourcePath(sourcePath: string): boolean {
        return this.sourcePath === sourcePath;
    }

    focusSearchInput(): void {
        this.focusInput();
    }

    onOpen(): void {
        GridNoteTextSearchModal.activeInstance = this;
        const rememberedState = this.readMemoryState();
        this.query = rememberedState.query;
        this.selectedResultKey = rememberedState.selectedResultKey;
        this.isResultsNavigationActive = rememberedState.isResultsNavigationActive;
        this.shouldRestoreRememberedViewport = true;
        this.titleEl.setText(this.sourcePath);
        this.titleEl.setAttr('title', this.sourcePath);
        this.modalEl.addClass('gridnote-text-search-modal');
        useNativeModalHeader(this);
        this.modalEl.setAttr('data-overlay-lock', 'true');
        this.contentEl.empty();
        this.eventScope = new Component();

        const shellEl = this.contentEl.createDiv({
            cls: 'gridnote-text-search-shell'
        });
        const searchBarEl = shellEl.createDiv({
            cls: 'gridnote-text-search-bar'
        });
        const inputShellEl = searchBarEl.createDiv({
            cls: 'gridnote-text-search-input-shell'
        });
        const inputIconEl = inputShellEl.createSpan({
            cls: 'gridnote-text-search-input-icon'
        });
        setIcon(inputIconEl, 'search');
        this.inputEl = inputShellEl.createEl('input', {
            cls: 'gridnote-text-search-input',
            attr: {
                type: 'search',
                spellcheck: 'false',
                placeholder: '搜索标题、正文内容…'
            }
        });
        this.eventScope.registerDomEvent(this.inputEl, 'keydown', (event: KeyboardEvent) => {
            this.handleInputKeydown(event);
        });
        this.eventScope.registerDomEvent(this.inputEl, 'input', () => {
            this.cancelRememberedViewportRestore();
            this.shouldRestoreRememberedViewport = false;
            this.query = this.inputEl?.value ?? '';
            this.isResultsNavigationActive = false;
            this.selectedResultKey = null;
            if (this.resultsEl) {
                this.resultsEl.scrollTop = 0;
            }
            this.writeMemoryState({
                query: this.query,
                selectedResultKey: null,
                scrollTop: 0,
                isResultsNavigationActive: false
            });
            this.scheduleRenderResults();
        });
        this.eventScope.registerDomEvent(this.inputEl, 'focus', () => {
            this.isResultsNavigationActive = false;
            this.writeMemoryState({
                isResultsNavigationActive: false
            });
        });
        this.summaryEl = inputShellEl.createDiv({
            cls: 'gridnote-text-search-summary'
        });

        this.emptyEl = shellEl.createDiv({
            cls: 'gridnote-text-search-empty'
        });
        this.resultsEl = shellEl.createDiv({
            cls: 'gridnote-text-search-results'
        });
        this.eventScope.registerDomEvent(this.resultsEl, 'scroll', () => {
            this.writeMemoryState({
                scrollTop: this.resultsEl?.scrollTop ?? 0
            });
        }, { passive: true });
        this.observeResultsLayout();
        this.ensureSpatialNavigation();

        this.inputEl.value = this.query;
        this.renderResults();
        window.setTimeout(() => {
            if (this.isResultsNavigationActive && this.selectedResultKey) {
                this.focusSelectedResult({ shouldScroll: false });
                return;
            }
            this.inputEl?.focus();
            const queryLength = this.inputEl?.value.length ?? 0;
            this.inputEl?.setSelectionRange(queryLength, queryLength);
        }, 0);
    }

    onClose(): void {
        if (this.eventScope) {
            this.eventScope.unload();
            this.eventScope = null;
        }
        if (GridNoteTextSearchModal.activeInstance === this) {
            GridNoteTextSearchModal.activeInstance = null;
        }
        this.clearSearchDebounceTimeout();
        this.cancelRememberedViewportRestore();
        this.writeMemoryState();
        this.disconnectResultsLayoutObserver();
        this.teardownSpatialNavigation();
        this.resultCardEntries = [];
        this.selectedResultKey = null;
        this.isResultsNavigationActive = false;
        this.shouldRestoreRememberedViewport = false;
        this.contentEl.empty();
    }

    private scheduleRenderResults(): void {
        this.clearSearchDebounceTimeout();
        if (this.query.trim() === '') {
            this.renderResults();
            return;
        }

        this.searchDebounceTimeout = window.setTimeout(() => {
            this.searchDebounceTimeout = 0;
            this.renderResults();
        }, SEARCH_DEBOUNCE_MS);
    }

    private clearSearchDebounceTimeout(): void {
        if (this.searchDebounceTimeout === 0) {
            return;
        }

        window.clearTimeout(this.searchDebounceTimeout);
        this.searchDebounceTimeout = 0;
    }

    private observeResultsLayout(): void {
        if (!this.resultsEl || typeof ResizeObserver === 'undefined') {
            return;
        }

        this.disconnectResultsLayoutObserver();
        this.resultsResizeObserver = new ResizeObserver(() => {
            this.scheduleLayoutRefresh();
        });
        this.resultsResizeObserver.observe(this.resultsEl);
    }

    private disconnectResultsLayoutObserver(): void {
        if (this.layoutRefreshFrame !== 0) {
            window.cancelAnimationFrame(this.layoutRefreshFrame);
            this.layoutRefreshFrame = 0;
        }

        this.resultsResizeObserver?.disconnect();
        this.resultsResizeObserver = null;
        this.renderedColumnCount = 0;
        this.renderedResultsWidth = 0;
    }

    private cancelRememberedViewportRestore(): void {
        if (this.restoreViewportFrame === 0) {
            return;
        }

        window.cancelAnimationFrame(this.restoreViewportFrame);
        this.restoreViewportFrame = 0;
    }

    private scheduleLayoutRefresh(): void {
        if (!this.response || !this.resultsEl || this.layoutRefreshFrame !== 0) {
            return;
        }

        this.layoutRefreshFrame = window.requestAnimationFrame(() => {
            this.layoutRefreshFrame = 0;
            const nextColumnCount = this.resolveResultsColumnCount();
            const nextWidth = Math.round(this.resultsEl?.getBoundingClientRect().width ?? 0);
            if (
                nextColumnCount !== this.renderedColumnCount
                || nextWidth !== this.renderedResultsWidth
            ) {
                this.captureRenderedCardHeights();
                this.renderResultCards();
            }
        });
    }

    private renderResults(): void {
        const normalizedQuery = this.query.trim();
        if (normalizedQuery === '') {
            this.response = null;
        } else {
            this.response = searchDocumentStructure(this.structure, normalizedQuery);
        }

        this.updateMeta();
        this.renderResultCards();
    }

    private updateMeta(): void {
        if (!this.summaryEl) {
            return;
        }

        if (!this.response) {
            this.summaryEl.textContent = '';
            return;
        }

        const visibleCount = this.response.results.length;
        const totalCount = this.response.total;
        this.summaryEl.textContent = `${visibleCount}/${totalCount} 节点`;
    }

    private renderResultCards(): void {
        if (!this.resultsEl || !this.emptyEl) {
            return;
        }

        const previousScrollTop = this.resultsEl.scrollTop;
        this.resultsEl.empty();
        this.resultCardEntries = [];

        if (!this.response) {
            this.cancelRememberedViewportRestore();
            this.shouldRestoreRememberedViewport = false;
            this.resultsEl.hidden = true;
            this.emptyEl.empty();
            this.emptyEl.hidden = false;
            this.resultCardEntries = [];
            this.resultCardHeightCache.clear();
            this.selectedResultKey = null;
            this.isResultsNavigationActive = false;
            this.writeMemoryState({
                selectedResultKey: null,
                scrollTop: 0,
                isResultsNavigationActive: false
            });
            this.refreshSpatialNavigationSection();
            const emptyIconEl = this.emptyEl.createSpan({
                cls: 'gridnote-text-search-empty-icon'
            });
            setIcon(emptyIconEl, 'search');
            this.emptyEl.createDiv({
                cls: 'gridnote-text-search-empty-title',
                text: '输入关键词开始搜索'
            });
            this.emptyEl.createDiv({
                cls: 'gridnote-text-search-empty-copy',
                text: '搜索会在标题和正文中查找匹配内容。'
            });
            return;
        }

        if (this.response.results.length === 0) {
            this.cancelRememberedViewportRestore();
            this.shouldRestoreRememberedViewport = false;
            this.resultsEl.hidden = true;
            this.emptyEl.empty();
            this.emptyEl.hidden = false;
            this.resultCardEntries = [];
            this.resultCardHeightCache.clear();
            this.selectedResultKey = null;
            this.isResultsNavigationActive = false;
            this.writeMemoryState({
                selectedResultKey: null,
                scrollTop: 0,
                isResultsNavigationActive: false
            });
            this.refreshSpatialNavigationSection();
            const emptyIconEl = this.emptyEl.createSpan({
                cls: 'gridnote-text-search-empty-icon'
            });
            setIcon(emptyIconEl, 'search-x');
            this.emptyEl.createDiv({
                cls: 'gridnote-text-search-empty-title',
                text: '没有找到匹配内容'
            });
            this.emptyEl.createDiv({
                cls: 'gridnote-text-search-empty-copy',
                text: '试试更短的关键词，或者拆成多个词重新搜索。'
            });
            return;
        }

        this.emptyEl.hidden = true;
        this.resultsEl.hidden = false;

        const groupedResults = groupResultsByPath(this.response.results);
        const columnCount = this.resolveResultsColumnCount();
        this.renderedColumnCount = columnCount;
        let cardOrder = 0;
        groupedResults.forEach((group) => {
            const groupEl = this.resultsEl?.createDiv({
                cls: 'gridnote-text-search-group'
            });
            if (!groupEl) {
                return;
            }

            groupEl.createDiv({
                cls: 'gridnote-text-search-group-title',
                text: group.label
            });

            const groupCardsEl = groupEl.createDiv({
                cls: 'gridnote-text-search-group-cards'
            });
            const columnEls = Array.from({ length: columnCount }, () =>
                groupCardsEl.createDiv({
                    cls: 'gridnote-text-search-card-column'
                })
            );
            const columnWeights = Array.from({ length: columnCount }, () => 0);

            group.results.forEach((result) => {
                const cardButtonEl = this.createCardButton(result, cardOrder);
                const columnIndex = findLightestColumnIndex(columnWeights);
                columnEls[columnIndex]?.appendChild(cardButtonEl);
                columnWeights[columnIndex] = (columnWeights[columnIndex] ?? 0)
                    + this.resolveCardWeight(result);
                cardOrder += 1;
            });
        });

        this.refreshResultCardEntries();
        this.captureRenderedCardHeights();
        this.syncSelectionAfterRender();
        this.refreshSpatialNavigationSection();
        this.updateSelectedCardState();
        if (this.shouldRestoreRememberedViewport) {
            this.scheduleRememberedViewportRestore();
            return;
        }
        const maxScrollTop = Math.max(0, this.resultsEl.scrollHeight - this.resultsEl.clientHeight);
        this.resultsEl.scrollTop = Math.min(previousScrollTop, maxScrollTop);
        if (this.isResultsNavigationActive) {
            this.focusSelectedResult({ shouldScroll: false });
        }
    }

    private scheduleRememberedViewportRestore(): void {
        if (this.restoreViewportFrame !== 0) {
            return;
        }

        this.restoreViewportFrame = window.requestAnimationFrame(() => {
            this.restoreViewportFrame = 0;
            this.restoreRememberedViewport();
        });
    }

    private createCardButton(result: GridNoteSearchResult, order: number): HTMLButtonElement {
        const resultKey = createSearchResultKey(result);
        const cardButtonEl = document.createElement('button');
        cardButtonEl.type = 'button';
        cardButtonEl.className = 'gridnote-text-search-card';
        cardButtonEl.dataset.gridnoteSearchResultKey = resultKey;
        cardButtonEl.dataset.gridnoteSearchResultOrder = String(order);
        this.eventScope!.registerDomEvent(cardButtonEl, 'keydown', (event) => {
            this.handleResultKeydown(event);
        });
        this.eventScope!.registerDomEvent(cardButtonEl, 'focus', () => {
            this.isResultsNavigationActive = true;
            this.selectedResultKey = resultKey;
            this.updateSelectedCardState();
            this.writeMemoryState({
                selectedResultKey: resultKey,
                isResultsNavigationActive: true
            });
        });
        this.eventScope!.registerDomEvent(cardButtonEl, 'click', () => {
            void this.chooseResult(result);
        });
        this.renderCard(cardButtonEl, result);
        return cardButtonEl;
    }

    private resolveResultsColumnCount(): number {
        if (!this.resultsEl) {
            return 1;
        }

        const rawValue = getComputedStyle(this.resultsEl)
            .getPropertyValue('--gridnote-text-search-columns')
            .trim();
        const parsedValue = Number.parseInt(rawValue, 10);
        return Number.isFinite(parsedValue) && parsedValue > 0
            ? parsedValue
            : 1;
    }

    private renderCard(cardButtonEl: HTMLButtonElement, result: GridNoteSearchResult): void {
        const titleRowEl = cardButtonEl.createDiv({
            cls: 'gridnote-text-search-card-title-row'
        });
        const titleEl = titleRowEl.createDiv({
            cls: 'gridnote-text-search-card-title'
        });
        appendHighlightedText(titleEl, result.title, result.titleMatches);

        titleRowEl.createSpan({
            cls: 'gridnote-text-search-card-badge is-line',
            text: `L${result.startLine + 1}`
        });

        const snippetListEl = cardButtonEl.createDiv({
            cls: 'gridnote-text-search-card-snippets'
        });
        result.snippets.forEach((snippet) => {
            const snippetEl = snippetListEl.createDiv({
                cls: 'gridnote-text-search-card-snippet'
            });
            renderSnippet(snippetEl, snippet);
        });
    }

    private handleInputKeydown(event: KeyboardEvent): void {
        if (event.defaultPrevented || event.isComposing) {
            return;
        }

        if (
            event.key !== 'ArrowDown'
            || event.ctrlKey
            || event.metaKey
            || event.altKey
            || event.shiftKey
        ) {
            return;
        }

        const hasFocused = this.focusSelectedResult({ fallbackToFirstVisible: true });
        if (!hasFocused) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
    }

    private handleResultKeydown(event: KeyboardEvent): void {
        if (event.defaultPrevented || event.isComposing) {
            return;
        }

        if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey) {
            this.isResultsNavigationActive = false;
            event.preventDefault();
            event.stopPropagation();
            this.focusInput();
            return;
        }

        if (
            !event.ctrlKey
            && !event.metaKey
            && !event.altKey
            && !event.shiftKey
            && event.key === 'Enter'
        ) {
            const selectedEntry = this.getSelectedResultEntry();
            if (!selectedEntry) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            void this.chooseResult(selectedEntry.result);
            return;
        }
    }

    private refreshResultCardEntries(): void {
        if (!this.resultsEl || this.resultsEl.hidden) {
            this.resultCardEntries = [];
            return;
        }

        const buttonEls = Array.from(
            this.resultsEl.querySelectorAll<HTMLButtonElement>('.gridnote-text-search-card')
        );
        const resultsByKey = new Map(
            (this.response?.results ?? []).map((result) => [createSearchResultKey(result), result])
        );
        this.resultCardEntries = buttonEls
            .map((buttonEl) => {
                const resultKey = buttonEl.dataset.gridnoteSearchResultKey;
                const order = Number.parseInt(
                    buttonEl.dataset.gridnoteSearchResultOrder ?? '',
                    10
                );
                if (!resultKey || !Number.isFinite(order)) {
                    return null;
                }

                const result = resultsByKey.get(resultKey);
                if (!result) {
                    return null;
                }

                const rect = buttonEl.getBoundingClientRect();
                return {
                    key: resultKey,
                    result,
                    buttonEl,
                    order,
                    rect
                };
            })
            .filter((entry): entry is GridNoteSearchCardEntry => entry !== null)
            .sort(compareCardEntriesByVisualOrder);
    }

    private captureRenderedCardHeights(): void {
        if (!this.resultsEl || this.resultsEl.hidden) {
            this.renderedResultsWidth = 0;
            return;
        }

        this.renderedResultsWidth = Math.round(this.resultsEl.getBoundingClientRect().width);
        this.resultCardEntries.forEach((entry) => {
            this.resultCardHeightCache.set(entry.key, Math.max(1, entry.buttonEl.offsetHeight));
        });
    }

    private resolveCardWeight(result: GridNoteSearchResult): number {
        const resultKey = createSearchResultKey(result);
        const cachedHeight = this.resultCardHeightCache.get(resultKey);
        if (cachedHeight !== undefined) {
            return cachedHeight;
        }

        return estimateCardWeight(result);
    }

    private ensureSpatialNavigation(): void {
        SpatialNavigation.init();
        SpatialNavigation.resume();
    }

    private teardownSpatialNavigation(): void {
        if (this.hasSpatialNavigationSection) {
            SpatialNavigation.remove(this.navigationSectionId);
            this.hasSpatialNavigationSection = false;
        }

        SpatialNavigation.uninit();
    }

    private refreshSpatialNavigationSection(): void {
        if (this.resultCardEntries.length === 0) {
            if (this.hasSpatialNavigationSection) {
                SpatialNavigation.remove(this.navigationSectionId);
                this.hasSpatialNavigationSection = false;
            }
            SpatialNavigation.setDefaultSection();
            return;
        }

        const selector = this.resultCardEntries.map((entry) => entry.buttonEl);
        const config = {
            selector,
            rememberSource: true,
            straightOnly: false,
            straightOverlapThreshold: 0.25,
            restrict: 'self-only' as const,
            enterTo: 'last-focused' as const
        };

        if (this.hasSpatialNavigationSection) {
            SpatialNavigation.set(this.navigationSectionId, config);
        } else {
            SpatialNavigation.add(this.navigationSectionId, config);
            this.hasSpatialNavigationSection = true;
        }

        SpatialNavigation.makeFocusable(this.navigationSectionId);
        SpatialNavigation.setDefaultSection(this.navigationSectionId);
        SpatialNavigation.resume();
    }

    private syncSelectionAfterRender(): void {
        if (this.resultCardEntries.length === 0) {
            this.selectedResultKey = null;
            this.isResultsNavigationActive = false;
            return;
        }

        if (!this.selectedResultKey) {
            return;
        }

        if (this.resultCardEntries.some((entry) => entry.key === this.selectedResultKey)) {
            return;
        }

        this.selectedResultKey = this.isResultsNavigationActive
            ? this.resultCardEntries[0]?.key ?? null
            : null;
    }

    private updateSelectedCardState(): void {
        const selectedKey = this.selectedResultKey;
        this.resultCardEntries.forEach((entry) => {
            const isSelected = selectedKey !== null && entry.key === selectedKey;
            entry.buttonEl.classList.toggle('is-selected', isSelected);
            entry.buttonEl.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        });
    }

    private getSelectedResultEntry(): GridNoteSearchCardEntry | null {
        if (!this.selectedResultKey) {
            return null;
        }

        return this.resultCardEntries.find((entry) => entry.key === this.selectedResultKey) ?? null;
    }

    private focusSelectedResult(options: {
        shouldScroll?: boolean;
        fallbackToFirstVisible?: boolean;
    } = {}): boolean {
        this.refreshResultCardEntries();
        if (this.resultCardEntries.length === 0) {
            return false;
        }

        const currentEntry = this.getSelectedResultEntry();
        const targetEntry = currentEntry ?? (
            options.fallbackToFirstVisible
                ? this.findFirstVisibleResultEntry() ?? this.resultCardEntries[0] ?? null
                : null
        );
        if (!targetEntry) {
            return false;
        }

        this.selectedResultKey = targetEntry.key;
        this.isResultsNavigationActive = true;
        this.updateSelectedCardState();
        targetEntry.buttonEl.focus({ preventScroll: true });
        if (options.shouldScroll !== false) {
            targetEntry.buttonEl.scrollIntoView({
                block: 'nearest',
                inline: 'nearest'
            });
        }
        this.writeMemoryState({
            selectedResultKey: targetEntry.key,
            isResultsNavigationActive: true
        });

        return true;
    }

    private findFirstVisibleResultEntry(): GridNoteSearchCardEntry | null {
        if (!this.resultsEl) {
            return this.resultCardEntries[0] ?? null;
        }

        const containerRect = this.resultsEl.getBoundingClientRect();
        const visibleEntries = this.resultCardEntries
            .filter((entry) => isCardEntryVisible(entry, containerRect))
            .sort(compareCardEntriesByVisualOrder);
        return visibleEntries[0] ?? this.resultCardEntries[0] ?? null;
    }

    private focusInput(): void {
        if (!this.inputEl) {
            return;
        }

        this.inputEl.focus();
        const queryLength = this.inputEl.value.length;
        this.inputEl.setSelectionRange(queryLength, queryLength);
    }

    private readMemoryState(): GridNoteTextSearchMemoryState {
        return textSearchStateMemory.get(this.sourcePath) ?? {
            query: '',
            selectedResultKey: null,
            scrollTop: 0,
            isResultsNavigationActive: false
        };
    }

    private writeMemoryState(
        partial: Partial<GridNoteTextSearchMemoryState> = {}
    ): void {
        const currentState = this.readMemoryState();
        const nextScrollTop = this.shouldRestoreRememberedViewport && partial.scrollTop === undefined
            ? currentState.scrollTop
            : (this.resultsEl?.scrollTop ?? currentState.scrollTop);
        const nextState: GridNoteTextSearchMemoryState = {
            query: this.query,
            selectedResultKey: this.selectedResultKey,
            scrollTop: nextScrollTop,
            isResultsNavigationActive: this.isResultsNavigationActive,
            ...partial
        };
        nextState.scrollTop = Math.max(0, nextState.scrollTop);
        textSearchStateMemory.set(this.sourcePath, nextState);
    }

    private restoreRememberedViewport(): void {
        if (!this.shouldRestoreRememberedViewport) {
            return;
        }

        this.shouldRestoreRememberedViewport = false;
        if (!this.resultsEl || this.resultsEl.hidden) {
            return;
        }

        const rememberedState = this.readMemoryState();
        this.refreshResultCardEntries();
        const hasScrolledToRememberedCard = this.scrollToRememberedResultCard(rememberedState.selectedResultKey);
        if (hasScrolledToRememberedCard) {
            this.updateSelectedCardState();
            this.writeMemoryState({
                selectedResultKey: rememberedState.selectedResultKey,
                scrollTop: this.resultsEl.scrollTop
            });
            return;
        }

        const maxScrollTop = Math.max(0, this.resultsEl.scrollHeight - this.resultsEl.clientHeight);
        this.resultsEl.scrollTop = Math.min(rememberedState.scrollTop, maxScrollTop);
        this.refreshResultCardEntries();
        this.updateSelectedCardState();
        this.writeMemoryState({
            scrollTop: this.resultsEl.scrollTop
        });
    }

    private scrollToRememberedResultCard(resultKey: string | null): boolean {
        if (!resultKey) {
            return false;
        }

        const entry = this.resultCardEntries.find((item) => item.key === resultKey);
        if (!entry) {
            return false;
        }

        this.selectedResultKey = resultKey;
        entry.buttonEl.scrollIntoView({
            block: 'center',
            inline: 'nearest'
        });
        return true;
    }

    private async chooseResult(result: GridNoteSearchResult): Promise<void> {
        const resultKey = createSearchResultKey(result);
        this.selectedResultKey = resultKey;
        this.isResultsNavigationActive = true;
        this.writeMemoryState({
            selectedResultKey: resultKey,
            isResultsNavigationActive: true
        });
        try {
            await this.onChooseResult(result);
            this.close();
        } catch (error) {
            console.error('GridNote: 搜索结果跳转失败', error);
            new Notice('跳转失败，请重试');
        }
    }
}

function appendHighlightedText(
    containerEl: HTMLElement,
    text: string,
    matches: GridNoteSearchTextRange[]
): void {
    if (matches.length === 0) {
        containerEl.setText(text);
        return;
    }

    let cursor = 0;
    for (const match of matches) {
        if (match.start > cursor) {
            containerEl.append(document.createTextNode(text.slice(cursor, match.start)));
        }

        const markEl = containerEl.createEl('mark');
        markEl.setText(text.slice(match.start, match.end));
        cursor = match.end;
    }

    if (cursor < text.length) {
        containerEl.append(document.createTextNode(text.slice(cursor)));
    }
}

function renderSnippet(
    containerEl: HTMLElement,
    snippet: GridNoteSearchSnippet
): void {
    if (snippet.isTrimmedStart) {
        containerEl.append(document.createTextNode('…'));
    }

    appendHighlightedText(containerEl, snippet.text, snippet.matches);

    if (snippet.isTrimmedEnd) {
        containerEl.append(document.createTextNode('…'));
    }
}

function groupResultsByPath(results: GridNoteSearchResult[]): GridNoteSearchResultGroup[] {
    const groupMap = new Map<string, GridNoteSearchResultGroup>();

    for (const result of results) {
        const label = result.breadcrumb.length > 0
            ? result.breadcrumb.join(' / ')
            : '顶层节点';
        const existingGroup = groupMap.get(label);
        if (existingGroup) {
            existingGroup.results.push(result);
            continue;
        }

        groupMap.set(label, {
            label,
            results: [result]
        });
    }

    return Array.from(groupMap.values());
}

function estimateCardWeight(result: GridNoteSearchResult): number {
    const titleWeight = Math.max(1, Math.ceil(result.title.length / 16));
    const snippetWeight = result.snippets.reduce((total, snippet) => {
        return total + Math.max(2, Math.ceil(snippet.text.length / 42));
    }, 0);
    return titleWeight + snippetWeight;
}

function findLightestColumnIndex(columnWeights: number[]): number {
    let lightestIndex = 0;
    let lightestWeight = columnWeights[0] ?? 0;

    for (let index = 1; index < columnWeights.length; index += 1) {
        const weight = columnWeights[index] ?? 0;
        if (weight < lightestWeight) {
            lightestWeight = weight;
            lightestIndex = index;
        }
    }

    return lightestIndex;
}

function createSearchResultKey(result: GridNoteSearchResult): string {
    return [
        result.startLine,
        result.endLine,
        result.headingLevel ?? 'root',
        result.title
    ].join(':');
}

function compareCardEntriesByVisualOrder(
    left: GridNoteSearchCardEntry,
    right: GridNoteSearchCardEntry
): number {
    const topDistance = left.rect.top - right.rect.top;
    if (Math.abs(topDistance) > 1) {
        return topDistance;
    }

    const leftDistance = left.rect.left - right.rect.left;
    if (Math.abs(leftDistance) > 1) {
        return leftDistance;
    }

    return left.order - right.order;
}

function isCardEntryVisible(
    entry: GridNoteSearchCardEntry,
    containerRect: DOMRect
): boolean {
    return (
        entry.rect.bottom > containerRect.top
        && entry.rect.top < containerRect.bottom
        && entry.rect.right > containerRect.left
        && entry.rect.left < containerRect.right
    );
}

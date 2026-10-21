<script lang="ts">
    import { onDestroy, onMount, setContext, tick } from 'svelte';
    import { get, writable } from 'svelte/store';
    import type { App } from 'obsidian';
    import CascadeTheme from './themes/cascade/CascadeTheme.svelte';
    import GridNoteFloatingToolbar from './controls/GridNoteFloatingToolbar.svelte';
    import FloatingCardEditor from './themes/shared/FloatingCardEditor.svelte';
    import {
        gridNoteCardEditingContextKey,
        type GridNoteCardRegistration,
        type GridNoteCardEditingContext,
        type GridNoteCardEditDraft,
        type GridNoteCardInsertPosition,
        type GridNoteCardSelectionHint,
        type GridNoteCardSelectionOptions
    } from './themes/shared/cardEditingContext';
    import {
        buildTreeThemeModel,
        DEFAULT_VISIBLE_TREE_LAYERS,
        type VisibleTreeLayersSetting
    } from '../themes/treeModel';
    import {
        writePersistedFoldState,
        type PersistedFoldState
    } from '../utils/foldStorage';
    import { GridNoteRangeEditorModalManager } from '../utils/GridNoteRangeEditorModal';
    import { isGridNotePrefaceNode } from '../utils/treeNodeKind';
    import {
        createRevealAnchorFromTreeNode,
        type GridNoteHistoryRevealRequest,
        type GridNoteRevealAnchor
    } from '../utils/historyReveal';
    import type { DocumentStructure, TreeNode, TreeThemeModel } from '../types';
    import type { GridNoteCopyAction } from '../utils/gridNoteCopy';
    import {
        buildCardNavigation,
        createSelectionHint,
        findNodeBySelectionHint,
        resolveCardNavigationTarget,
        resolveSelectableNode as resolveSelectableNavigationNode,
        type GridNoteCardNavigationEntry,
        type GridNoteCardNavigationContext
    } from './gridNoteContent/cardNavigation';
    import { resolveRevealTargetNode as resolveRevealTargetNodeFromLookup } from './gridNoteContent/revealTarget';
    import {
        areSetsEqual,
        buildNodeLookup,
        buildNodeParentMap,
        buildVisibleCollapsedNodeIds
    } from './gridNoteContent/nodeIndex';
    import {
        createPersistedFoldState,
        readCollapsedHeadingLines,
        reconcileCollapsedHeadingLines
    } from './gridNoteContent/foldProjection';
    import { StageScroller } from './gridNoteContent/StageScroller';
    import { resolveProgressiveBatchSize } from './gridNoteContent/progressiveRender';
    import {
        isEditableElement,
        isFileSwitcherShortcutEvent,
        isFloatingEditorElement,
        isInsertShortcutEvent,
        isKeyboardEventFromModalOrFloatingEditor,
        isRedoShortcutEvent,
        isSearchShortcutEvent,
        isUndoShortcutEvent,
        resolveInsertShortcutPosition
    } from './gridNoteContent/keyboardInteraction';

    export let documentStructure: DocumentStructure | null = null;
    export let frontmatterText: string = '';
    export let app: App | null = null;
    export let sourcePath: string = '';
    export let foldLineOffset: number = 0;
    export let foldStateReloadRequest: number = 0;
    export let visibleTreeLayers: VisibleTreeLayersSetting = DEFAULT_VISIBLE_TREE_LAYERS;
    export let historySelectionClearRequest: number = 0;
    export let historyRevealRequest: GridNoteHistoryRevealRequest | null = null;
    export let onSaveCardEdit: ((node: TreeNode, draft: GridNoteCardEditDraft) => Promise<void>) | null = null;
    export let onSaveTitleEdit: ((node: TreeNode, title: string) => Promise<void>) | null = null;
    export let onOpenNodeRangeEdit: ((node: TreeNode) => Promise<void> | void) | null = null;
    export let onDeleteNode: ((node: TreeNode) => Promise<boolean> | boolean) | null = null;
    export let onCopyNodeAction: ((
        node: TreeNode,
        action: GridNoteCopyAction,
        anchorEl: HTMLElement
    ) => Promise<void> | void) | null = null;
    export let onInsertNode: ((
        node: TreeNode,
        position: GridNoteCardInsertPosition
    ) => Promise<GridNoteCardSelectionHint | null>) | null = null;
    export let onOpenTextSearch: (() => Promise<void> | void) | null = null;
    export let onOpenSiblingFileSwitcher: (() => Promise<void> | void) | null = null;
    export let onOpenSettings: (() => Promise<void> | void) | null = null;
    export let onUndo: (() => Promise<boolean> | boolean) | null = null;
    export let onRedo: (() => Promise<boolean> | boolean) | null = null;
    export let onCreateRootNode: (() => Promise<void> | void) | null = null;
    export let onPersistFoldState: ((state: PersistedFoldState | null) => void) | null = null;
    export let canUndo: boolean = false;
    export let canRedo: boolean = false;

    const INITIAL_SECTION_BATCH = 6;
    const KEYBOARD_SELECTION_THROTTLE_MS = 120;
    const STAGE_SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End']);
    const STAGE_FOCUS_SCROLL_KEYS = new Set([' ', 'ArrowUp', 'ArrowDown']);
    type GridNoteRevealOutcome = 'revealed' | 'pending';
    type GridNotePendingRevealPhase = 'coarse' | 'awaiting-target';

    interface GridNotePendingSelectedReveal {
        requestId: number;
        targetNodeId: string;
        anchor: GridNoteRevealAnchor;
        phase: GridNotePendingRevealPhase;
    }

    interface GridNotePendingHistoryReveal {
        request: GridNoteHistoryRevealRequest;
        targetNodeId: string;
        revealNodeId: string;
        phase: GridNotePendingRevealPhase;
        startedAt: number;
    }

    interface GridNoteDeferredPreciseReveal {
        targetNodeId: string;
        remainingPasses: number;
        revealLine: number | null;
        immediate: boolean;
        scrollMode: GridNoteHistoryRevealRequest['scrollMode'];
    }

    interface GridNoteEditSaveViewportAnchor {
        nodeId: string;
        viewportOffset: number;
    }

    let previousThemeModel: TreeThemeModel | null = null;
    let renderedNodes: TreeNode[] = [];
    let progressiveSourceNodes: TreeNode[] = [];
    let progressiveSourcePath: string | null = null;
    let progressiveRenderFrame = 0;
    // Guard the tick -> rAF focus pipeline so stale selection work cannot refocus a card.
    let selectedCardFocusFrame = 0;
    let selectedCardFocusRequestId = 0;
    let selectedCardRevealRequestId = 0;
    let historyRevealFrame = 0;
    let historyRevealRequestToken = 0;
    let pendingRevealRetryFrame = 0;
    let pendingRevealRetryToken = 0;
    let previousHistoryRevealRequestId = 0;
    let previousHistoryRevealActive = false;
    let previousHistoryRevealSourcePath: string | null = null;
    let previousFoldSourcePath: string | null = null;
    let previousFoldStateReloadRequest = 0;
    let previousHistorySelectionClearRequest = 0;
    let previousPendingRevealViewportStableVersion = -1;
    let previousPendingRevealRenderedNodes: TreeNode[] | null = null;
    let editTransitionInProgress = false;
    let queuedEditCard: GridNoteCardRegistration | null = null;
    let nodeParentMap = new Map<string, string | null>();
    let fullNodeLookup = new Map<string, TreeNode>();
    let renderedNodeLookup = new Map<string, TreeNode>();
    let cardNavigationMap = new Map<string, GridNoteCardNavigationEntry>();
    let cardRegistrations = new Map<string, GridNoteCardRegistration>();
    let selectedCardSnapshot: GridNoteCardSelectionHint | null = null;
    let pendingSelectionHint: GridNoteCardSelectionHint | null = null;
    let pendingSelectedCardReveal: GridNotePendingSelectedReveal | null = null;
    let pendingHistoryReveal: GridNotePendingHistoryReveal | null = null;
    let deferredPreciseReveal: GridNoteDeferredPreciseReveal | null = null;
    let pendingFoldStateReloadToken = 0;
    let appliedFoldStateReloadToken = 0;
    let previousActiveEditorId: string | null = null;
    let lastKeyboardSelectionAt = 0;
    let stageEl: HTMLElement | null = null;
    const stageScroller = new StageScroller();
    let viewportScrollIdleTimeout = 0;
    let pendingEditSaveViewportAnchor: GridNoteEditSaveViewportAnchor | null = null;
    const activeEditorId = writable<string | null>(null);
    const activeEditorReady = writable(false);
    const activeEditingCard = writable<GridNoteCardRegistration | null>(null);
    const activeEditingPathKeys = writable<Set<string>>(new Set());
    const collapsedNodeIds = writable<Set<string>>(new Set());
    const selectedCardId = writable<string | null>(null);
    const isViewportScrolling = writable(false);
    const viewportStableVersion = writable(0);
    const revealPinnedNodeId = writable<string | null>(null);
    const saveHandlers = new Map<string, () => Promise<void>>();
    let collapsedHeadingLines = new Set<number>();

    const editingContext: GridNoteCardEditingContext = {
        isEditable: false,
        activeEditorId,
        activeEditorReady,
        activeEditingCard,
        activeEditingPathKeys,
        collapsedNodeIds,
        selectedCardId,
        isViewportScrolling,
        viewportStableVersion,
        revealPinnedNodeId,
        async beginEdit(card: GridNoteCardRegistration): Promise<boolean> {
            pendingEditSaveViewportAnchor = null;
            queuedEditCard = card;

            if (editTransitionInProgress) {
                return false;
            }

            editTransitionInProgress = true;

            try {
                let lastResult = false;

                while (queuedEditCard) {
                    const nextCard = queuedEditCard;
                    queuedEditCard = null;
                    lastResult = await switchEditingCard(nextCard);
                    if (!lastResult) {
                        queuedEditCard = null;
                        break;
                    }
                }

                return lastResult;
            } finally {
                editTransitionInProgress = false;
            }
        },
        finishEdit(nodeId: string): void {
            if (get(activeEditorId) === nodeId) {
                activeEditorReady.set(false);
                activeEditorId.set(null);
                activeEditingCard.set(null);
            }
        },
        registerCard(card: GridNoteCardRegistration): void {
            cardRegistrations.set(card.node.viewId, card);

            if (get(selectedCardId) === card.node.viewId && get(activeEditorId) === null) {
                if (!completePendingSelectedCardReveal(card.node.viewId, card)) {
                    scheduleSelectedCardFocus(card.node.viewId, false);
                }
            }

            // 大文档会分批挂载大量卡片；只在目标/粗定位节点出现时重试，
            // 避免 pending reveal 在初始渲染期间退化成 O(nodes × cards)。
            if (
                pendingHistoryReveal
                && (
                    card.node.viewId === pendingHistoryReveal.targetNodeId
                    || card.node.viewId === pendingHistoryReveal.revealNodeId
                )
            ) {
                retryPendingHistoryReveal();
            }

            if (
                pendingSelectedCardReveal
                && card.node.viewId === pendingSelectedCardReveal.targetNodeId
            ) {
                retryPendingSelectedCardReveal();
            }
        },
        unregisterCard(nodeId: string, cardEl?: HTMLDivElement | null): void {
            const registeredCard = cardRegistrations.get(nodeId);
            if (!registeredCard) {
                return;
            }

            if (!cardEl || registeredCard.cardEl === cardEl) {
                cardRegistrations.delete(nodeId);
            }
        },
        selectCard(node: TreeNode | null, options: GridNoteCardSelectionOptions = {}): void {
            applySelectedCard(node, options);
        },
        clearSelectedCard(): void {
            clearSelectedCardState();
        },
        setNodeExpanded(nodeId: string, expanded: boolean): void {
            const node = fullNodeLookup.get(nodeId);
            if (!node || node.headingLevel === null) {
                return;
            }

            const currentIds = get(collapsedNodeIds);
            const isCurrentlyExpanded = !currentIds.has(nodeId);
            if (isCurrentlyExpanded === expanded) {
                return;
            }

            const nextIds = new Set(currentIds);
            if (expanded) {
                nextIds.delete(nodeId);
            } else {
                nextIds.add(nodeId);
            }

            const nextLines = new Set(collapsedHeadingLines);
            if (expanded) {
                nextLines.delete(node.startLine);
            } else {
                nextLines.add(node.startLine);
            }

            collapsedHeadingLines = nextLines;
            collapsedNodeIds.set(nextIds);
            persistCollapsedFoldState(nextLines);
        },
        registerSaveHandler(nodeId: string, handler: () => Promise<void>): void {
            saveHandlers.set(nodeId, handler);
        },
        unregisterSaveHandler(nodeId: string, handler?: () => Promise<void>): void {
            if (!handler || saveHandlers.get(nodeId) === handler) {
                saveHandlers.delete(nodeId);
            }
        },
        async saveCardEdit(node: TreeNode, draft: GridNoteCardEditDraft): Promise<void> {
            if (!onSaveCardEdit) {
                return;
            }

            pendingEditSaveViewportAnchor = createEditSaveViewportAnchor(node.viewId);
            await onSaveCardEdit(node, draft);
            scheduleEditSaveViewportAnchorRestore(2);
        },
        async insertNode(
            node: TreeNode,
            position: GridNoteCardInsertPosition
        ): Promise<boolean> {
            if (!onInsertNode) {
                return false;
            }

            try {
                const nextSelectionHint = await onInsertNode(node, position);
                if (!nextSelectionHint) {
                    return false;
                }

                pendingSelectionHint = nextSelectionHint;
                selectedCardSnapshot = nextSelectionHint;
                return true;
            } catch (error) {
                console.error('GridNote: 插入节点失败', error);
                return false;
            }
        }
    };

    setContext(gridNoteCardEditingContextKey, editingContext);

    function updateThemeModel(
        structure: DocumentStructure | null,
        nextVisibleTreeLayers: VisibleTreeLayersSetting,
        nextFrontmatterText: string
    ): TreeThemeModel {
        const nextThemeModel = buildTreeThemeModel(
            structure,
            previousThemeModel,
            nextVisibleTreeLayers,
            nextFrontmatterText
        );
        previousThemeModel = nextThemeModel;
        return nextThemeModel;
    }

    function readCollapsedHeadingLinesFromStorage(): Set<number> {
        return readCollapsedHeadingLines({
            app,
            sourcePath,
            structure: documentStructure,
            foldLineOffset
        });
    }

    function persistCollapsedFoldState(lines: Set<number>) {
        const persistedFoldState = createPersistedFoldState({
            sourcePath,
            structure: documentStructure,
            foldLineOffset,
            lines
        });

        if (!persistedFoldState) {
            onPersistFoldState?.(null);
            return;
        }

        writePersistedFoldState(
            app,
            sourcePath,
            persistedFoldState.folds,
            persistedFoldState.lines
        );
        onPersistFoldState?.(persistedFoldState);
    }

    function syncCollapsedStateFromTree() {
        const currentIds = get(collapsedNodeIds);
        const nextState = reconcileCollapsedHeadingLines(
            currentIds,
            collapsedHeadingLines,
            fullNodeLookup
        );

        if (!areSetsEqual(currentIds, nextState.nodeIds)) {
            collapsedNodeIds.set(nextState.nodeIds);
        }

        if (!areSetsEqual(collapsedHeadingLines, nextState.headingLines)) {
            collapsedHeadingLines = nextState.headingLines;
        }
    }

    function applyPersistedCollapsedState() {
        if (!app || !sourcePath || !documentStructure) {
            collapsedHeadingLines = new Set<number>();
            if (get(collapsedNodeIds).size > 0) {
                collapsedNodeIds.set(new Set<string>());
            }
            onPersistFoldState?.(null);
            return;
        }

        collapsedHeadingLines = readCollapsedHeadingLinesFromStorage();
        collapsedNodeIds.set(buildVisibleCollapsedNodeIds(
            collapsedHeadingLines,
            fullNodeLookup
        ));
        persistCollapsedFoldState(collapsedHeadingLines);
    }

    function getCardNavigationContext(): GridNoteCardNavigationContext {
        return {
            renderedNodes,
            renderedNodeLookup,
            fullNodeLookup,
            nodeParentMap,
            navigationMap: cardNavigationMap,
            collapsedNodeIds: get(collapsedNodeIds)
        };
    }

    function resolveSelectableNode(node: TreeNode | null): TreeNode | null {
        return resolveSelectableNavigationNode(node, getCardNavigationContext());
    }

    function createEditingPathKeys(
        activeNodeId: string | null,
        parentMap: Map<string, string | null>
    ): Set<string> {
        const pathKeys = new Set<string>();
        let currentNodeId = activeNodeId;

        while (currentNodeId) {
            pathKeys.add(currentNodeId);
            currentNodeId = parentMap.get(currentNodeId) ?? null;
        }

        return pathKeys;
    }

    function cancelSelectedCardFocus() {
        selectedCardFocusRequestId += 1;

        if (selectedCardFocusFrame === 0) {
            return;
        }

        window.cancelAnimationFrame(selectedCardFocusFrame);
        selectedCardFocusFrame = 0;
    }

    function cancelSelectedCardScrollAnimation() {
        stageScroller.cancelAnimation();
    }

    function cancelHistoryRevealSchedule() {
        historyRevealRequestToken += 1;

        if (historyRevealFrame === 0) {
            return;
        }

        window.cancelAnimationFrame(historyRevealFrame);
        historyRevealFrame = 0;
    }

    function cancelPendingRevealRetrySchedule() {
        pendingRevealRetryToken += 1;

        if (pendingRevealRetryFrame === 0) {
            return;
        }

        window.cancelAnimationFrame(pendingRevealRetryFrame);
        pendingRevealRetryFrame = 0;
    }

    function resetHistoryRevealState(options: { suppressRequestId?: number | null } = {}) {
        pendingHistoryReveal = null;
        clearDeferredPreciseReveal();
        revealPinnedNodeId.set(null);
        cancelHistoryRevealSchedule();
        cancelPendingRevealRetrySchedule();
        // 新定位会经过 tick + rAF 调度；先停止旧动画，避免旧目标再滚动 1-2 帧。
        cancelSelectedCardScrollAnimation();

        if (typeof options.suppressRequestId === 'number') {
            previousHistoryRevealRequestId = options.suppressRequestId;
        }
    }

    function createPendingSelectedCardReveal(
        node: TreeNode,
        phase: GridNotePendingRevealPhase = 'coarse'
    ): GridNotePendingSelectedReveal {
        selectedCardRevealRequestId += 1;
        return {
            requestId: selectedCardRevealRequestId,
            targetNodeId: node.viewId,
            anchor: createRevealAnchorFromTreeNode(node),
            phase
        };
    }

    function updatePendingSelectedCardRevealPhase(
        phase: GridNotePendingRevealPhase
    ): GridNotePendingSelectedReveal | null {
        if (!pendingSelectedCardReveal) {
            return null;
        }

        pendingSelectedCardReveal = {
            ...pendingSelectedCardReveal,
            phase
        };
        return pendingSelectedCardReveal;
    }

    function clearPendingSelectedCardReveal(options: { requestId?: number } = {}) {
        if (
            typeof options.requestId === 'number'
            && pendingSelectedCardReveal?.requestId !== options.requestId
        ) {
            return;
        }

        pendingSelectedCardReveal = null;
    }

    function queueDeferredPreciseReveal(
        targetNodeId: string,
        remainingPasses: number = 2,
        scrollMode: GridNoteHistoryRevealRequest['scrollMode'] = 'anchor',
        revealLine: number | null = null,
        immediate = false
    ) {
        deferredPreciseReveal = {
            targetNodeId,
            remainingPasses,
            revealLine,
            immediate,
            scrollMode
        };
    }

    function clearDeferredPreciseReveal() {
        deferredPreciseReveal = null;
    }

    function tryFocusSelectedCard(nodeId: string, scroll: boolean): boolean {
        const registration = cardRegistrations.get(nodeId);
        if (!registration?.cardEl) {
            return false;
        }

        focusCardRegistration(registration, scroll);
        return true;
    }

    function completePendingSelectedCardReveal(
        nodeId: string,
        registration?: GridNoteCardRegistration | null
    ): boolean {
        const pendingReveal = pendingSelectedCardReveal;
        if (!pendingReveal || pendingReveal.targetNodeId !== nodeId) {
            return false;
        }

        if (get(activeEditorId) !== null || get(selectedCardId) !== nodeId) {
            return false;
        }

        const resolvedRegistration = registration ?? cardRegistrations.get(nodeId);
        if (!resolvedRegistration?.cardEl) {
            return false;
        }

        clearPendingSelectedCardReveal({ requestId: pendingReveal.requestId });
        focusCardRegistration(resolvedRegistration, true);
        return true;
    }

    function createPendingHistoryReveal(
        request: GridNoteHistoryRevealRequest,
        targetNodeId: string,
        revealNodeId: string
    ): GridNotePendingHistoryReveal {
        return {
            request,
            targetNodeId,
            revealNodeId,
            phase: 'coarse',
            startedAt: performance.now()
        };
    }

    function updatePendingHistoryRevealPhase(
        phase: GridNotePendingRevealPhase
    ): GridNotePendingHistoryReveal | null {
        if (!pendingHistoryReveal) {
            return null;
        }

        pendingHistoryReveal = {
            ...pendingHistoryReveal,
            phase
        };
        return pendingHistoryReveal;
    }

    function retryDeferredPreciseReveal(): boolean {
        const queuedReveal = deferredPreciseReveal;
        if (!queuedReveal) {
            return false;
        }

        if (stageEl && stageScroller.isProgrammaticScrollActive()) {
            // 程序动画期间的布局重试不丢弃；等滚动停止后再修正。
            return false;
        }

        if (stageScroller.hasUserScrolledPastProgrammaticTarget()) {
            clearDeferredPreciseReveal();
            return false;
        }

        const targetNode = fullNodeLookup.get(queuedReveal.targetNodeId) ?? null;
        const revealOutcome = revealHistoryNodePrecisely(
            queuedReveal.targetNodeId,
            true,
            queuedReveal.scrollMode,
            queuedReveal.revealLine,
            targetNode,
            queuedReveal.immediate
        );
        if (revealOutcome !== 'revealed') {
            return false;
        }

        if (queuedReveal.remainingPasses <= 1) {
            clearDeferredPreciseReveal();
        } else {
            deferredPreciseReveal = {
                ...queuedReveal,
                remainingPasses: queuedReveal.remainingPasses - 1
            };
        }
        return true;
    }

    function clearViewportScrollIdleTimeout() {
        if (viewportScrollIdleTimeout === 0) {
            return;
        }

        window.clearTimeout(viewportScrollIdleTimeout);
        viewportScrollIdleTimeout = 0;
    }

    function scheduleViewportScrollIdle() {
        isViewportScrolling.set(true);
        clearViewportScrollIdleTimeout();
        viewportScrollIdleTimeout = window.setTimeout(() => {
            viewportScrollIdleTimeout = 0;
            isViewportScrolling.set(false);
            viewportStableVersion.update((value) => value + 1);
        }, 120);
    }

    function createEditSaveViewportAnchor(nodeId: string): GridNoteEditSaveViewportAnchor | null {
        const targetEl = cardRegistrations.get(nodeId)?.cardEl;
        if (!stageEl || !targetEl?.isConnected) {
            return null;
        }

        return {
            nodeId,
            viewportOffset: targetEl.getBoundingClientRect().top
                - stageEl.getBoundingClientRect().top
        };
    }

    function scheduleEditSaveViewportAnchorRestore(remainingPasses: number): void {
        if (remainingPasses <= 0) {
            pendingEditSaveViewportAnchor = null;
            return;
        }

        window.requestAnimationFrame(() => {
            const anchor = pendingEditSaveViewportAnchor;
            if (!anchor || !stageEl) {
                pendingEditSaveViewportAnchor = null;
                return;
            }

            if (remainingPasses <= 1) {
                pendingEditSaveViewportAnchor = null;
            }

            const targetEl = cardRegistrations.get(anchor.nodeId)?.cardEl;
            if (!targetEl?.isConnected) {
                return;
            }

            const currentOffset = targetEl.getBoundingClientRect().top
                - stageEl.getBoundingClientRect().top;
            stageScroller.restoreViewportOffset(
                currentOffset,
                anchor.viewportOffset
            );
        });
    }

    function escapeAttributeValue(value: string): string {
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
            return CSS.escape(value);
        }

        return value.replace(/["\\]/g, '\\$&');
    }

    function resolvePreciseRevealElement(
        nodeId: string,
        registration?: GridNoteCardRegistration | null
    ): HTMLElement | null {
        const headingRowEl = getHeadingRowElement(nodeId);
        if (headingRowEl) {
            return headingRowEl;
        }

        return registration?.cardEl ?? cardRegistrations.get(nodeId)?.cardEl ?? null;
    }

    function focusCardRegistration(registration: GridNoteCardRegistration, scroll: boolean) {
        const targetEl = registration.cardEl;
        if (!targetEl) {
            return;
        }

        // 选中卡片只进入舒适区滚动；搜索/历史的精确锚点定位走独立 reveal 管线。
        if (scroll) {
            stageScroller.scrollCardIntoComfortZone(targetEl);
        }

        focusStageContainer();
    }

    function getHeadingRowElement(nodeId: string): HTMLElement | null {
        if (!stageEl) {
            return null;
        }

        const escapedNodeId = escapeAttributeValue(nodeId);
        return stageEl.querySelector<HTMLElement>(
            `[id="cascade-node-${escapedNodeId}"] > .cascade-node-heading-row`
        );
    }

    function findNearestVirtualizedBranchId(nodeId: string): string | null {
        let currentNodeId: string | null = nodeId;
        let topLevelNodeId: string | null = null;

        while (currentNodeId) {
            topLevelNodeId = currentNodeId;
            const parentNodeId = nodeParentMap.get(currentNodeId) ?? null;
            const grandparentNodeId = parentNodeId
                ? nodeParentMap.get(parentNodeId) ?? null
                : null;
            if (grandparentNodeId === null && parentNodeId !== null) {
                return currentNodeId;
            }

            currentNodeId = nodeParentMap.get(currentNodeId) ?? null;
        }

        return topLevelNodeId;
    }

    function findTopLevelAncestorId(nodeId: string): string | null {
        let currentNodeId: string | null = nodeId;
        let topLevelNodeId: string | null = null;

        while (currentNodeId) {
            topLevelNodeId = currentNodeId;
            currentNodeId = nodeParentMap.get(currentNodeId) ?? null;
        }

        return topLevelNodeId;
    }

    function ensureRenderedRootIncludes(nodeId: string): boolean {
        const topLevelNodeId = findTopLevelAncestorId(nodeId);
        if (!topLevelNodeId) {
            return false;
        }

        const targetIndex = progressiveSourceNodes.findIndex(
            (node) => node.viewId === topLevelNodeId
        );
        if (targetIndex === -1) {
            return false;
        }

        if (targetIndex < renderedNodes.length) {
            return true;
        }

        renderedNodes = progressiveSourceNodes.slice(0, targetIndex + 1);
        if (targetIndex + 1 < progressiveSourceNodes.length) {
            scheduleNextSectionBatch(progressiveSourceNodes);
        }
        return true;
    }

    function scrollBranchAnchorIntoView(nodeId: string): boolean {
        if (!stageEl) {
            return false;
        }

        const branchCandidates = [
            findNearestVirtualizedBranchId(nodeId),
            findTopLevelAncestorId(nodeId)
        ].filter((branchId, index, candidates): branchId is string =>
            Boolean(branchId) && candidates.indexOf(branchId) === index
        );

        for (const branchNodeId of branchCandidates) {
            const anchorSelector = `[data-gridnote-branch-id="${escapeAttributeValue(branchNodeId)}"]`;
            const anchorEl = stageEl.querySelector(anchorSelector);
            if (!(anchorEl instanceof HTMLElement)) {
                continue;
            }

            stageScroller.scrollCardIntoComfortZone(anchorEl);
            return true;
        }

        return false;
    }

    function resolveRevealTargetNode(
        request: Pick<GridNoteHistoryRevealRequest, 'line' | 'anchor'>
    ): TreeNode | null {
        return resolveRevealTargetNodeFromLookup(request, fullNodeLookup);
    }

    function resolveHistoryRevealNodeId(nodeId: string): string {
        let revealNodeId = nodeId;
        let currentNodeId: string | null = nodeId;

        while (currentNodeId) {
            const parentId: string | null = nodeParentMap.get(currentNodeId) ?? null;
            if (!parentId) {
                break;
            }

            if (get(collapsedNodeIds).has(parentId)) {
                revealNodeId = parentId;
            }

            currentNodeId = parentId;
        }

        return revealNodeId;
    }

    function expandAncestorsForReveal(nodeId: string): void {
        const currentCollapsed = get(collapsedNodeIds);
        const idsToExpand: string[] = [];

        let currentNodeId: string | null = nodeId;
        while (currentNodeId) {
            const parentId: string | null = nodeParentMap.get(currentNodeId) ?? null;
            if (!parentId) {
                break;
            }
            if (currentCollapsed.has(parentId)) {
                idsToExpand.push(parentId);
            }
            currentNodeId = parentId;
        }

        if (idsToExpand.length === 0) {
            return;
        }

        const nextIds = new Set(currentCollapsed);
        const nextLines = new Set(collapsedHeadingLines);
        for (const id of idsToExpand) {
            nextIds.delete(id);
            const node = fullNodeLookup.get(id);
            if (node) {
                nextLines.delete(node.startLine);
            }
        }

        collapsedNodeIds.set(nextIds);
        collapsedHeadingLines = nextLines;
        persistCollapsedFoldState(nextLines);
    }

    function syncSelectionToRevealNode(
        revealNodeId: string,
        fallbackNode: TreeNode
    ) {
        const visibleRevealNode = resolveSelectableNode(fullNodeLookup.get(revealNodeId) ?? null);
        applySelectedCard(visibleRevealNode ?? fallbackNode, {
            focus: true,
            scroll: false,
            preserveReveal: true
        });
    }

    function resolveHistoryRevealPoint(
        nodeId: string,
        revealLine: number | null,
        targetNode: TreeNode | null
    ): { targetEl: HTMLElement; pointOffset: number } | null {
        const registration = cardRegistrations.get(nodeId);
        const cardEl = registration?.cardEl;
        if (!cardEl || revealLine === null || !targetNode) {
            return null;
        }

        const headingRowEl = getHeadingRowElement(nodeId);
        if (headingRowEl && revealLine <= targetNode.startLine) {
            return { targetEl: headingRowEl, pointOffset: 0 };
        }

        const lineAnchors = Array.from(
            cardEl.querySelectorAll<HTMLElement>('[data-gridnote-body-line]')
        );
        let nearestAnchor: HTMLElement | null = null;
        let nearestAnchorLine = Number.NEGATIVE_INFINITY;
        for (const anchorEl of lineAnchors) {
            const anchorLine = Number.parseInt(
                anchorEl.dataset.gridnoteBodyLine ?? '',
                10
            );
            if (Number.isNaN(anchorLine) || anchorLine > revealLine) {
                continue;
            }
            if (anchorLine > nearestAnchorLine) {
                nearestAnchor = anchorEl;
                nearestAnchorLine = anchorLine;
            }
        }
        if (nearestAnchor) {
            return { targetEl: nearestAnchor, pointOffset: 0 };
        }

        const contentEl = cardEl.querySelector<HTMLElement>('.markdown-content');
        const fallbackEl = contentEl ?? cardEl;
        const lineCount = Math.max(
            1,
            targetNode.editEndLine - targetNode.editStartLine + 1
        );
        const lineRatio = Math.max(
            0,
            Math.min(
                1,
                (revealLine - targetNode.editStartLine + 1) / lineCount
            )
        );
        return {
            targetEl: fallbackEl,
            pointOffset: fallbackEl.getBoundingClientRect().height * lineRatio
        };
    }

    function revealHistoryNodePrecisely(
        nodeId: string,
        scroll: boolean,
        scrollMode: GridNoteHistoryRevealRequest['scrollMode'] = 'anchor',
        revealLine: number | null = null,
        targetNode: TreeNode | null = null,
        immediate = false
    ): GridNoteRevealOutcome {
        const registration = cardRegistrations.get(nodeId);
        if (registration?.cardEl) {
            if (scroll) {
                if (scrollMode === 'change') {
                    const revealPoint = resolveHistoryRevealPoint(
                        nodeId,
                        revealLine,
                        targetNode
                    );
                    if (revealPoint) {
                        stageScroller.scrollPointIntoChangeZone(
                            revealPoint.targetEl,
                            revealPoint.pointOffset
                        );
                    } else {
                        stageScroller.scrollCardIntoComfortZone(registration.cardEl);
                    }
                } else {
                    const targetEl = resolvePreciseRevealElement(nodeId, registration)
                        ?? registration.cardEl;
                    if (scrollMode === 'comfort') {
                        stageScroller.scrollCardIntoComfortZone(targetEl);
                    } else {
                        stageScroller.scrollToRevealAnchor(targetEl, immediate);
                    }
                }
            }

            queueDeferredPreciseReveal(
                nodeId,
                scrollMode === 'change' ? 4 : 2,
                scrollMode,
                revealLine,
                immediate
            );
            return 'revealed';
        }

        const headingRowEl = getHeadingRowElement(nodeId);
        if (headingRowEl) {
            if (scroll) {
                if (scrollMode === 'change') {
                    stageScroller.scrollPointIntoChangeZone(headingRowEl);
                } else if (scrollMode === 'comfort') {
                    stageScroller.scrollCardIntoComfortZone(headingRowEl);
                } else {
                    stageScroller.scrollToRevealAnchor(headingRowEl, immediate);
                }
            }

            queueDeferredPreciseReveal(
                nodeId,
                scrollMode === 'change' ? 4 : 2,
                scrollMode,
                revealLine,
                immediate
            );
            return 'revealed';
        }

        return 'pending';
    }

    function findNearestRenderedAncestorId(nodeId: string): string | null {
        let currentNodeId: string | null = nodeParentMap.get(nodeId) ?? null;
        while (currentNodeId) {
            if (cardRegistrations.get(currentNodeId)?.cardEl) {
                return currentNodeId;
            }
            currentNodeId = nodeParentMap.get(currentNodeId) ?? null;
        }
        return null;
    }

    function isNodeRendered(nodeId: string): boolean {
        return Boolean(cardRegistrations.get(nodeId)?.cardEl)
            || Boolean(getHeadingRowElement(nodeId));
    }

    function performHistoryReveal(request: GridNoteHistoryRevealRequest) {
        if (request.line === null && !request.anchor) {
            pendingHistoryReveal = null;
            revealPinnedNodeId.set(null);
            return;
        }

        const revealTargetNode = resolveRevealTargetNode(request);
        if (!revealTargetNode) {
            pendingHistoryReveal = null;
            revealPinnedNodeId.set(null);
            return;
        }

        expandAncestorsForReveal(revealTargetNode.viewId);
        revealPinnedNodeId.set(revealTargetNode.viewId);
        ensureRenderedRootIncludes(revealTargetNode.viewId);

        // 用 cardRegistrations 判断目标是否真正渲染到了 DOM，
        // 而非仅依赖 collapsedNodeIds 状态（展开后状态已更新但 DOM 尚未渲染）。
        const targetViewId = revealTargetNode.viewId;
        const revealNodeId = isNodeRendered(targetViewId)
            ? targetViewId
            : (findNearestRenderedAncestorId(targetViewId)
                ?? resolveHistoryRevealNodeId(targetViewId));

        const pendingReveal = createPendingHistoryReveal(
            request,
            targetViewId,
            revealNodeId
        );
        pendingHistoryReveal = pendingReveal;

        syncSelectionToRevealNode(revealNodeId, revealTargetNode);
        retryPendingHistoryReveal();
    }

    function scheduleHistoryReveal(request: GridNoteHistoryRevealRequest) {
        cancelHistoryRevealSchedule();
        const requestToken = historyRevealRequestToken;

        void tick().then(() => {
            if (requestToken !== historyRevealRequestToken) {
                return;
            }

            historyRevealFrame = window.requestAnimationFrame(() => {
                if (requestToken !== historyRevealRequestToken) {
                    return;
                }

                historyRevealFrame = 0;
                performHistoryReveal(request);
            });
        });
    }

    function shouldWaitForTargetContent(
        pendingReveal: GridNotePendingHistoryReveal,
        targetNode: TreeNode
    ): boolean {
        // 搜索/大纲属于远距离跳转：先渲染目标内容，再切换视口，避免动画穿越占位分支。
        if (
            pendingReveal.request.source === 'history'
            || targetNode.content.trim() === ''
        ) {
            return false;
        }

        // 兜底超时：不能因为渲染器没有发出完成事件而永久停留在旧视口。
        if (performance.now() - pendingReveal.startedAt > 1200) {
            return false;
        }

        const cardEl = cardRegistrations.get(targetNode.viewId)?.cardEl;
        if (!cardEl) {
            return true;
        }

        const contentEl = cardEl.querySelector('.markdown-content');
        return !contentEl || Boolean(contentEl.querySelector('.markdown-content-loading'));
    }

    function retryPendingHistoryReveal() {
        const currentPendingReveal = pendingHistoryReveal;
        if (!currentPendingReveal) {
            return false;
        }

        const revealTargetNode = resolveRevealTargetNode(currentPendingReveal.request);
        if (!revealTargetNode) {
            pendingHistoryReveal = null;
            revealPinnedNodeId.set(null);
            return false;
        }

        revealPinnedNodeId.set(revealTargetNode.viewId);
        ensureRenderedRootIncludes(revealTargetNode.viewId);

        const targetViewId = revealTargetNode.viewId;
        const revealNodeId = isNodeRendered(targetViewId)
            ? targetViewId
            : (findNearestRenderedAncestorId(targetViewId)
                ?? resolveHistoryRevealNodeId(targetViewId));

        const pendingReveal = {
            ...currentPendingReveal,
            targetNodeId: targetViewId,
            revealNodeId
        };
        pendingHistoryReveal = pendingReveal;

        if (shouldWaitForTargetContent(pendingReveal, revealTargetNode)) {
            updatePendingHistoryRevealPhase('awaiting-target');
            return false;
        }

        // 先尝试精确 reveal
        const revealOutcome = revealHistoryNodePrecisely(
            revealNodeId,
            true,
            pendingReveal.request.scrollMode,
            pendingReveal.request.source === 'history'
                ? pendingReveal.request.revealLine ?? null
                : null,
            revealTargetNode,
            pendingReveal.request.source !== 'history'
        );

        if (revealOutcome === 'revealed') {
            syncSelectionToRevealNode(revealNodeId, revealTargetNode);
            // 只有定位到了真正目标才算完成，否则继续等待子卡片渲染
            if (revealNodeId === targetViewId) {
                pendingHistoryReveal = null;
                revealPinnedNodeId.set(null);
                return true;
            }
        }

        // 目标尚未渲染，粗略滚动到可见祖先
        if (pendingReveal.phase === 'coarse') {
            const didCoarseScroll = scrollBranchAnchorIntoView(revealNodeId);
            if (didCoarseScroll) {
                updatePendingHistoryRevealPhase('awaiting-target');
            }
        }

        return false;
    }

    function resolvePendingSelectedCardNode(): TreeNode | null {
        if (pendingSelectedCardReveal?.anchor) {
            const anchoredNode = resolveRevealTargetNode({
                line: pendingSelectedCardReveal.anchor.startLine,
                anchor: pendingSelectedCardReveal.anchor
            });
            const selectableAnchoredNode = resolveSelectableNode(anchoredNode);
            if (selectableAnchoredNode) {
                return selectableAnchoredNode;
            }
        }

        const currentSelectedId = get(selectedCardId);
        const selectedNode = currentSelectedId
            ? resolveSelectableNode(fullNodeLookup.get(currentSelectedId) ?? null)
            : null;
        if (selectedNode) {
            return selectedNode;
        }

        return resolveSelectableNode(
            findNodeBySelectionHint(selectedCardSnapshot, fullNodeLookup)
        );
    }

    function retryPendingSelectedCardReveal() {
        const currentPendingReveal = pendingSelectedCardReveal;
        if (!currentPendingReveal || get(activeEditorId) !== null) {
            return false;
        }

        const targetNode = resolvePendingSelectedCardNode();
        if (!targetNode) {
            return false;
        }

        const pendingReveal = currentPendingReveal.targetNodeId === targetNode.viewId
            ? currentPendingReveal
            : {
                ...currentPendingReveal,
                targetNodeId: targetNode.viewId,
                anchor: createRevealAnchorFromTreeNode(targetNode)
            };
        pendingSelectedCardReveal = pendingReveal;

        if (get(selectedCardId) !== targetNode.viewId) {
            selectedCardId.set(targetNode.viewId);
        }

        ensureRenderedRootIncludes(targetNode.viewId);

        if (completePendingSelectedCardReveal(targetNode.viewId)) {
            return true;
        }

        if (pendingReveal.phase === 'coarse') {
            const didCoarseScroll = scrollBranchAnchorIntoView(targetNode.viewId);
            if (didCoarseScroll) {
                updatePendingSelectedCardRevealPhase('awaiting-target');
            }
        }

        return false;
    }

    function schedulePendingRevealRetry() {
        cancelPendingRevealRetrySchedule();
        const retryToken = pendingRevealRetryToken;

        void tick().then(() => {
            if (retryToken !== pendingRevealRetryToken) {
                return;
            }

            pendingRevealRetryFrame = window.requestAnimationFrame(() => {
                if (retryToken !== pendingRevealRetryToken) {
                    return;
                }

                pendingRevealRetryFrame = 0;
                retryPendingHistoryReveal();
                retryPendingSelectedCardReveal();
                retryDeferredPreciseReveal();
            });
        });
    }

    function scheduleSelectedCardFocus(nodeId: string, scroll: boolean) {
        cancelSelectedCardFocus();
        const requestId = selectedCardFocusRequestId;

        void tick().then(() => {
            if (requestId !== selectedCardFocusRequestId) {
                return;
            }

            selectedCardFocusFrame = window.requestAnimationFrame(() => {
                if (requestId !== selectedCardFocusRequestId) {
                    return;
                }

                selectedCardFocusFrame = 0;

                if (get(activeEditorId) !== null) {
                    return;
                }

                if (get(selectedCardId) !== nodeId) {
                    return;
                }

                if (scroll) {
                    if (tryFocusSelectedCard(nodeId, true)) {
                        clearPendingSelectedCardReveal();
                        return;
                    }
                } else if (tryFocusSelectedCard(nodeId, false)) {
                    return;
                }

                if (!scroll) {
                    return;
                }

                const targetNode = resolvePendingSelectedCardNode()
                    ?? resolveSelectableNode(fullNodeLookup.get(nodeId) ?? null);
                if (!targetNode) {
                    return;
                }

                pendingSelectedCardReveal = createPendingSelectedCardReveal(targetNode);
                retryPendingSelectedCardReveal();
            });
        });
    }

    function applySelectedCard(
        node: TreeNode | null,
        options: GridNoteCardSelectionOptions = {}
    ) {
        if (!node) {
            clearSelectedCardState();
            return;
        }

        const nextNode = resolveSelectableNode(node);
        if (!nextNode) {
            clearSelectedCardState();
            return;
        }

        selectedCardSnapshot = createSelectionHint(nextNode);
        pendingSelectionHint = null;
        selectedCardId.set(nextNode.viewId);

        if ((options.focus ?? true) && get(activeEditorId) === null) {
            if (options.scroll ?? false) {
                resetHistoryRevealState();
                pendingSelectedCardReveal = createPendingSelectedCardReveal(nextNode);
            } else {
                clearPendingSelectedCardReveal();
                if (!options.preserveReveal) {
                    clearDeferredPreciseReveal();
                }
            }
            scheduleSelectedCardFocus(nextNode.viewId, options.scroll ?? false);
        }
    }

    export function selectNodeById(
        nodeId: string,
        options: GridNoteCardSelectionOptions = {}
    ): boolean {
        const targetNode = resolveSelectableNode(fullNodeLookup.get(nodeId) ?? null);
        if (!targetNode) {
            return false;
        }

        applySelectedCard(targetNode, options);
        return true;
    }

    function focusStageContainer() {
        if (!stageEl) {
            return;
        }

        try {
            stageEl.focus({ preventScroll: true });
        } catch (_error) {
            stageEl.focus();
        }
    }

    function clearSelectedCardState(options: {
        focusStage?: boolean;
        clearReveal?: boolean;
    } = {}) {
        cancelSelectedCardFocus();
        pendingSelectionHint = null;
        clearPendingSelectedCardReveal();
        clearDeferredPreciseReveal();
        if (options.clearReveal ?? true) {
            resetHistoryRevealState();
        }
        selectedCardSnapshot = null;
        selectedCardId.set(null);

        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && stageEl?.contains(activeElement)) {
            activeElement.blur();
        }

        if (options.focusStage) {
            focusStageContainer();
        }
    }

    function shouldThrottleKeyboardSelection(event: KeyboardEvent): boolean {
        if (!event.repeat) {
            lastKeyboardSelectionAt = 0;
            return false;
        }

        const now = performance.now();
        if (now - lastKeyboardSelectionAt < KEYBOARD_SELECTION_THROTTLE_MS) {
            return true;
        }

        lastKeyboardSelectionAt = now;
        return false;
    }

    function invokeHistoryHandler(
        handler: (() => Promise<boolean> | boolean) | null
    ) {
        if (!handler) {
            return;
        }

        void Promise.resolve(handler()).catch((error) => {
            console.error('GridNote: 历史操作失败', error);
        });
    }

    function requestTitleEdit(nodeId: string): boolean {
        if (!stageEl) {
            return false;
        }

        const escapedNodeId = escapeAttributeValue(nodeId);
        const titleTrigger = stageEl.querySelector(
            `[id="cascade-node-${escapedNodeId}"] .editable-tree-title-button`
        );

        if (!(titleTrigger instanceof HTMLButtonElement)) {
            return false;
        }

        titleTrigger.click();
        return true;
    }

    function requestSelectedCardEdit(nodeId: string): boolean {
        if (get(activeEditorId) !== null) {
            return false;
        }

        const targetNode = fullNodeLookup.get(nodeId);
        if (!targetNode) {
            return false;
        }

        if (!editingContext.isEditable) {
            return false;
        }

        const registration = cardRegistrations.get(nodeId);
        if (!registration) {
            return false;
        }

        void editingContext.beginEdit(registration);
        return true;
    }

    function isElementVisibleInStage(targetEl: HTMLElement): boolean {
        if (!stageEl || !targetEl.isConnected || targetEl.offsetParent === null) {
            return false;
        }

        const stageRect = stageEl.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const verticallyVisible = (
            (targetRect.top >= stageRect.top && targetRect.top < stageRect.bottom)
            || (targetRect.bottom > stageRect.top && targetRect.bottom <= stageRect.bottom)
            || (targetRect.top < stageRect.top && targetRect.bottom > stageRect.bottom)
        );
        const horizontallyVisible = (
            (targetRect.left >= stageRect.left && targetRect.left < stageRect.right)
            || (targetRect.right > stageRect.left && targetRect.right <= stageRect.right)
            || (targetRect.left < stageRect.left && targetRect.right > stageRect.right)
        );

        return verticallyVisible && horizontallyVisible;
    }

    function findFirstVisibleNode(): TreeNode | null {
        if (!stageEl) {
            return null;
        }

        const cardElements = Array.from(
            stageEl.querySelectorAll<HTMLElement>('.editable-markdown-card[data-gridnote-card-id]')
        );
        const visibleCards = cardElements
            .filter(isElementVisibleInStage)
            .sort((left, right) => {
                const leftRect = left.getBoundingClientRect();
                const rightRect = right.getBoundingClientRect();
                const topDistance = leftRect.top - rightRect.top;
                if (Math.abs(topDistance) > 1) {
                    return topDistance;
                }

                return leftRect.left - rightRect.left;
            });

        for (const cardEl of visibleCards) {
            const nodeId = cardEl.dataset.gridnoteCardId;
            if (!nodeId) {
                continue;
            }

            const node = renderedNodeLookup.get(nodeId) ?? fullNodeLookup.get(nodeId);
            if (node && !isGridNotePrefaceNode(node)) {
                return node;
            }
        }

        return null;
    }

    function shouldClearSelectionFromStageClick(target: EventTarget | null): boolean {
        if (!stageEl) {
            return false;
        }

        if (!(target instanceof Element) || !stageEl.contains(target)) {
            return false;
        }

        return !target.closest(
            '.editable-markdown-card, .cascade-node-heading-row'
        );
    }

    function handleStageClick(event: MouseEvent) {
        if (event.defaultPrevented || get(activeEditorId) !== null) {
            return;
        }

        if (!get(selectedCardId)) {
            return;
        }

        if (!shouldClearSelectionFromStageClick(event.target)) {
            return;
        }

        clearSelectedCardState({ focusStage: true });
    }

    function isCurrentGridNoteScopeActive(event: KeyboardEvent): boolean {
        if (!stageEl || !stageEl.isConnected) {
            return false;
        }

        const workspaceLeaf = stageEl.closest('.workspace-leaf');
        if (workspaceLeaf instanceof HTMLElement) {
            return workspaceLeaf.classList.contains('mod-active');
        }

        if (typeof event.composedPath === 'function') {
            const eventPath = event.composedPath();
            if (eventPath.includes(stageEl)) {
                return true;
            }
        }

        const activeElement = document.activeElement;
        return activeElement instanceof HTMLElement
            ? stageEl.contains(activeElement)
            : false;
    }

    function isStageScrollKey(event: KeyboardEvent): boolean {
        if (event.ctrlKey || event.metaKey || event.altKey) {
            return false;
        }

        if (STAGE_SCROLL_KEYS.has(event.key)) {
            return true;
        }

        return event.target === stageEl && STAGE_FOCUS_SCROLL_KEYS.has(event.key);
    }

    function handleGlobalCardKeydown(event: KeyboardEvent) {
        if (GridNoteRangeEditorModalManager.getExistingInstance()?.hasOpenModal()) {
            return;
        }

        if (isKeyboardEventFromModalOrFloatingEditor(event.target)) {
            const isEscape = event.key === 'Escape';
            const isSaveShortcut = event.key === 'Enter'
                && (event.ctrlKey || event.metaKey);

            if (isEscape || isSaveShortcut) {
                event.stopPropagation();
                event.stopImmediatePropagation();
                const nodeId = get(activeEditorId);
                const handler = nodeId ? saveHandlers.get(nodeId) : undefined;
                if (handler) {
                    void handler().catch((error) => {
                        console.error('GridNote: 卡片编辑提交失败', error);
                    });
                }
            }
            return;
        }

        const hasSelectedNode = get(selectedCardId) !== null;
        const isEscClearSelection = hasSelectedNode
            && !event.ctrlKey
            && !event.metaKey
            && !event.altKey
            && event.key === 'Escape';
        if (event.defaultPrevented) {
            return;
        }

        if (!isCurrentGridNoteScopeActive(event) && !isEscClearSelection) {
            return;
        }

        const activeElement = document.activeElement;
        if (
            get(activeEditorId) !== null
            || (isEditableElement(activeElement) && !isFloatingEditorElement(activeElement))
        ) {
            return;
        }

        if (isStageScrollKey(event)) {
            stageScroller.markUserScrollIntent();
        }

        if (isUndoShortcutEvent(event)) {
            if (!onUndo) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            invokeHistoryHandler(onUndo);
            return;
        }

        if (isRedoShortcutEvent(event)) {
            if (!onRedo) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            invokeHistoryHandler(onRedo);
            return;
        }

        if (isSearchShortcutEvent(event)) {
            if (!onOpenTextSearch) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            void Promise.resolve(onOpenTextSearch()).catch((error) => {
                console.error('GridNote: 搜索操作失败', error);
            });
            return;
        }

        if (isFileSwitcherShortcutEvent(event)) {
            if (!onOpenSiblingFileSwitcher) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            void Promise.resolve(onOpenSiblingFileSwitcher()).catch((error) => {
                console.error('GridNote: 文件切换操作失败', error);
            });
            return;
        }

        const currentSelectedId = get(selectedCardId);
        if (!currentSelectedId) {
            if (
                !event.ctrlKey
                && !event.metaKey
                && !event.altKey
                && !event.shiftKey
                && (event.key === 'f' || event.key === 'F')
            ) {
                const firstVisibleNode = findFirstVisibleNode();
                if (!firstVisibleNode) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                applySelectedCard(firstVisibleNode, { focus: true, scroll: false });
            }
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            clearSelectedCardState({ focusStage: true });
            return;
        }

        const currentSelectedNode = fullNodeLookup.get(currentSelectedId);
        if (!currentSelectedNode) {
            return;
        }

        if (isInsertShortcutEvent(event)) {
            if (event.repeat) {
                return;
            }

            const insertPosition = resolveInsertShortcutPosition(
                currentSelectedNode,
                event.key,
                currentSelectedNode.headingLevel === 1
            );
            if (!insertPosition) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            void editingContext.insertNode(currentSelectedNode, insertPosition);
            return;
        }

        if (
            !event.ctrlKey
            && !event.metaKey
            && !event.altKey
            && (event.key === 'Enter' || event.key === ' ')
        ) {
            if (event.repeat) {
                return;
            }

            const editRequested = requestSelectedCardEdit(currentSelectedId);
            if (!editRequested) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }

        if (event.key === 't' || event.key === 'T') {
            if (!currentSelectedNode || currentSelectedNode.headingLevel === null) {
                return;
            }

            const titleEditRequested = requestTitleEdit(currentSelectedId);
            if (!titleEditRequested) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (event.key === 'Backspace' || event.key === 'Delete') {
            if (!onDeleteNode || event.repeat) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            void Promise.resolve(onDeleteNode(currentSelectedNode)).catch((error) => {
                console.error('GridNote: 删除节点失败', error);
            });
            return;
        }

        const direction = event.key === 'ArrowUp'
            ? 'up'
            : event.key === 'ArrowDown'
                ? 'down'
                : event.key === 'ArrowLeft'
                    ? 'left'
                    : event.key === 'ArrowRight'
                        ? 'right'
                        : null;

        if (!direction) {
            return;
        }

        if (shouldThrottleKeyboardSelection(event)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        const targetNodeId = resolveCardNavigationTarget(
            currentSelectedId,
            direction,
            getCardNavigationContext()
        );
        if (!targetNodeId) {
            return;
        }

        const targetNode = renderedNodeLookup.get(targetNodeId);
        if (!targetNode) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        applySelectedCard(targetNode, { focus: true, scroll: true });
    }

    async function switchEditingCard(card: GridNoteCardRegistration): Promise<boolean> {
        if (!onSaveCardEdit) {
            return false;
        }

        const currentEditorId = get(activeEditorId);
        if (currentEditorId === card.node.viewId) {
            activeEditingCard.set(card);
            return true;
        }

        if (currentEditorId) {
            const currentSaveHandler = saveHandlers.get(currentEditorId);
            if (currentSaveHandler) {
                try {
                    await currentSaveHandler();
                } catch (error) {
                    console.error('GridNote: 切换编辑卡片前保存失败', error);
                    return false;
                }
            } else {
                activeEditorReady.set(false);
                activeEditorId.set(null);
                activeEditingCard.set(null);
            }
        }

        activeEditorReady.set(false);
        activeEditingCard.set(card);
        activeEditorId.set(card.node.viewId);
        return true;
    }

    function cancelProgressiveRender() {
        if (progressiveRenderFrame === 0) {
            return;
        }

        window.cancelAnimationFrame(progressiveRenderFrame);
        progressiveRenderFrame = 0;
    }

    function scheduleNextSectionBatch(expectedNodes: TreeNode[]) {
        if (progressiveRenderFrame !== 0) {
            return;
        }

        progressiveRenderFrame = window.requestAnimationFrame(() => {
            progressiveRenderFrame = 0;

            if (progressiveSourceNodes !== expectedNodes) {
                return;
            }

            const nextCount = Math.min(
                renderedNodes.length + resolveProgressiveBatchSize(expectedNodes.length),
                expectedNodes.length
            );
            if (nextCount === renderedNodes.length) {
                return;
            }

            renderedNodes = expectedNodes.slice(0, nextCount);

            if (nextCount < expectedNodes.length) {
                scheduleNextSectionBatch(expectedNodes);
            }
        });
    }

    function resetRenderedNodes(nextNodes: TreeNode[]) {
        const sourceChanged = progressiveSourcePath !== sourcePath;
        progressiveSourcePath = sourcePath;
        const previousRenderedCount = sourceChanged ? 0 : renderedNodes.length;
        cancelProgressiveRender();
        progressiveSourceNodes = nextNodes;

        const initialBatchCount = Math.max(
            INITIAL_SECTION_BATCH,
            resolveProgressiveBatchSize(nextNodes.length)
        );
        if (nextNodes.length <= initialBatchCount) {
            renderedNodes = nextNodes;
            return;
        }

        // 根节点增删时也保留已渲染范围，避免瞬时高度塌缩触发滚动位置被 clamp。
        const nextRenderedCount = Math.min(
            Math.max(previousRenderedCount, initialBatchCount),
            nextNodes.length
        );
        renderedNodes = nextNodes.slice(0, nextRenderedCount);

        if (nextRenderedCount < nextNodes.length) {
            scheduleNextSectionBatch(nextNodes);
        }
    }

    $: stageScroller.stage = stageEl;
    $: themeModel = updateThemeModel(documentStructure, visibleTreeLayers, frontmatterText);
    $: nodeParentMap = buildNodeParentMap(themeModel.nodes);
    $: fullNodeLookup = buildNodeLookup(themeModel.nodes);
    $: syncCollapsedStateFromTree();
    $: activeEditingPathKeys.set(createEditingPathKeys($activeEditorId, nodeParentMap));
    $: if (themeModel.nodes !== progressiveSourceNodes) {
        resetRenderedNodes(themeModel.nodes);
    }
    $: ({
        lookup: renderedNodeLookup,
        navigationMap: cardNavigationMap
    } = buildCardNavigation(renderedNodes, $collapsedNodeIds));
    $: hasContent = themeModel.nodes.length > 0;
    $: editingContext.isEditable = Boolean(onSaveCardEdit);
    $: if (!editingContext.isEditable && get(activeEditorId) !== null) {
        activeEditorReady.set(false);
        activeEditorId.set(null);
        activeEditingCard.set(null);
    }
    $: {
        const currentSelectedId = $selectedCardId;
        const currentCollapsedIds = $collapsedNodeIds;

        void currentCollapsedIds;

        if (pendingSelectionHint) {
            const insertedNode = findNodeBySelectionHint(pendingSelectionHint, fullNodeLookup);
            if (insertedNode) {
                applySelectedCard(insertedNode, { focus: true, scroll: true });
            }
        } else if (currentSelectedId) {
            const selectedNode = resolveSelectableNode(
                fullNodeLookup.get(currentSelectedId) ?? null
            );
            if (selectedNode) {
                if (selectedNode.viewId !== currentSelectedId) {
                    applySelectedCard(selectedNode, {
                        focus: false,
                        scroll: false,
                        preserveReveal: true
                    });
                } else {
                    selectedCardSnapshot = createSelectionHint(selectedNode);
                }
            } else {
                const fallbackNode = resolveSelectableNode(
                    findNodeBySelectionHint(selectedCardSnapshot, fullNodeLookup)
                );
                if (fallbackNode) {
                    applySelectedCard(fallbackNode, {
                        focus: false,
                        scroll: false,
                        preserveReveal: true
                    });
                } else {
                    selectedCardId.set(null);
                    selectedCardSnapshot = null;
                }
            }
        }
    }
    $: if (previousActiveEditorId !== $activeEditorId) {
        if (previousActiveEditorId && !$activeEditorId) {
            const currentSelectedId = get(selectedCardId);
            if (currentSelectedId) {
                scheduleSelectedCardFocus(currentSelectedId, false);
            }
        }

        previousActiveEditorId = $activeEditorId;
    }
    $: if (previousHistoryRevealSourcePath !== sourcePath) {
        previousHistoryRevealSourcePath = sourcePath;
        resetHistoryRevealState({
            suppressRequestId: historyRevealRequest?.requestId ?? null
        });
    }
    $: if (previousFoldSourcePath !== sourcePath) {
        previousFoldSourcePath = sourcePath;
        pendingFoldStateReloadToken += 1;

        if (!sourcePath) {
            collapsedHeadingLines = new Set<number>();
            collapsedNodeIds.set(new Set<string>());
        }
    }
    $: if (foldStateReloadRequest !== previousFoldStateReloadRequest) {
        previousFoldStateReloadRequest = foldStateReloadRequest;
        pendingFoldStateReloadToken += 1;
    }
    $: if (
        pendingFoldStateReloadToken !== appliedFoldStateReloadToken
        && sourcePath
        && documentStructure
    ) {
        appliedFoldStateReloadToken = pendingFoldStateReloadToken;
        applyPersistedCollapsedState();
    }
    $: if (historySelectionClearRequest !== previousHistorySelectionClearRequest) {
        previousHistorySelectionClearRequest = historySelectionClearRequest;
        clearSelectedCardState({ focusStage: true });
    }
    $: if (!historyRevealRequest && previousHistoryRevealActive) {
        resetHistoryRevealState();
    }
    $: previousHistoryRevealActive = historyRevealRequest !== null;
    $: if (historyRevealRequest && historyRevealRequest.requestId !== previousHistoryRevealRequestId) {
        previousHistoryRevealRequestId = historyRevealRequest.requestId;
        scheduleHistoryReveal(historyRevealRequest);
    }
    $: {
        const currentViewportStableVersion = $viewportStableVersion;
        const hasPendingReveal = Boolean(
            pendingHistoryReveal
            || pendingSelectedCardReveal
            || deferredPreciseReveal
        );

        if (!hasPendingReveal) {
            previousPendingRevealViewportStableVersion = currentViewportStableVersion;
            previousPendingRevealRenderedNodes = renderedNodes;
        } else {
            const renderedNodesChanged = previousPendingRevealRenderedNodes !== renderedNodes;
            const viewportStableChanged =
                previousPendingRevealViewportStableVersion !== currentViewportStableVersion;

            previousPendingRevealViewportStableVersion = currentViewportStableVersion;
            previousPendingRevealRenderedNodes = renderedNodes;

            if (renderedNodesChanged || viewportStableChanged) {
                schedulePendingRevealRetry();
            }
        }
    }

    onMount(() => {
        const handleStageScroll = () => {
            scheduleViewportScrollIdle();
        };
        const handleUserScrollIntent = () => {
            stageScroller.markUserScrollIntent();
        };
        const handleUserPointerScrollIntent = (event: PointerEvent) => {
            // 内容点击/选区拖拽不是滚动；只把滚动条上的 pointerdown 视为用户滚动。
            if (event.target === stageEl) {
                stageScroller.markUserScrollIntent();
            }
        };
        const handleMarkdownRendered = (event: Event) => {
            if (!(event.target instanceof Node) || !stageEl?.contains(event.target)) {
                return;
            }

            if (pendingHistoryReveal || pendingSelectedCardReveal || deferredPreciseReveal) {
                schedulePendingRevealRetry();
            }
        };

        stageEl?.addEventListener('scroll', handleStageScroll, { passive: true });
        stageEl?.addEventListener('wheel', handleUserScrollIntent, {
            passive: true,
            capture: true
        });
        stageEl?.addEventListener('touchstart', handleUserScrollIntent, {
            passive: true,
            capture: true
        });
        stageEl?.addEventListener('pointerdown', handleUserPointerScrollIntent, {
            capture: true
        });
        stageEl?.addEventListener(
            'gridnote-markdown-rendered',
            handleMarkdownRendered,
            true
        );
        stageEl?.addEventListener('click', handleStageClick);
        window.addEventListener('keydown', handleGlobalCardKeydown, true);

        return () => {
            clearViewportScrollIdleTimeout();
            isViewportScrolling.set(false);
            stageEl?.removeEventListener('scroll', handleStageScroll);
            stageEl?.removeEventListener('wheel', handleUserScrollIntent, true);
            stageEl?.removeEventListener('touchstart', handleUserScrollIntent, true);
            stageEl?.removeEventListener(
                'pointerdown',
                handleUserPointerScrollIntent,
                true
            );
            stageEl?.removeEventListener(
                'gridnote-markdown-rendered',
                handleMarkdownRendered,
                true
            );
            stageEl?.removeEventListener('click', handleStageClick);
            window.removeEventListener('keydown', handleGlobalCardKeydown, true);
        };
    });

    onDestroy(() => {
        clearViewportScrollIdleTimeout();
        resetHistoryRevealState();
        cancelPendingRevealRetrySchedule();
        cancelProgressiveRender();
        cancelSelectedCardFocus();
        cancelSelectedCardScrollAnimation();
    });
</script>

<div class="gridnote-shell">
    <main class="gridnote-stage" tabindex="-1" bind:this={stageEl}>
        {#if hasContent}
            <CascadeTheme
                nodes={renderedNodes}
                maxDepth={themeModel.maxDepth}
                nodeCount={themeModel.nodeCount}
                visibleTreeLayers={visibleTreeLayers}
                viewportElement={stageEl}
                {onSaveTitleEdit}
                {onOpenNodeRangeEdit}
                {onDeleteNode}
                {onCopyNodeAction}
                {app}
                {sourcePath}
            />
            <FloatingCardEditor {app} />
        {:else}
            <div class="gridnote-empty-state">
                <strong class="gridnote-empty-title">No tree data</strong>
                <span class="gridnote-empty-copy">
                    打开 Markdown 文件后，这里会展示主题化的树结构。
                </span>
                {#if onCreateRootNode}
                    <button class="gridnote-empty-create-root-btn" on:click={onCreateRootNode}>
                        创建根节点
                    </button>
                {/if}
            </div>
        {/if}
    </main>
    <GridNoteFloatingToolbar
        {canUndo}
        {canRedo}
        {onOpenTextSearch}
        {onOpenSiblingFileSwitcher}
        {onOpenSettings}
        {onUndo}
        {onRedo}
    />
</div>

<style>
    .gridnote-shell {
        position: relative;
        height: 100%;
        min-width: 0;
        font-family:
            var(--font-text),
            var(--font-interface),
            system-ui,
            -apple-system,
            sans-serif;
        color: var(--text-normal);
    }

    .gridnote-stage {
        --gridnote-stage-safe-padding: 18px;
        position: relative;
        isolation: isolate;
        height: 100%;
        min-height: 0;
        min-width: 0;
        padding-bottom: calc(96px + max(0px, env(safe-area-inset-bottom, 0px)));
        overflow: auto;
        overflow-anchor: auto;
        box-sizing: border-box;
    }

    .gridnote-stage:focus,
    .gridnote-stage:focus-visible {
        outline: none;
    }

    .gridnote-empty-state {
        min-height: 280px;
        max-width: min(72%, 960px);
        min-width: min(100%, 360px);
        margin-inline: auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        border-radius: 12px;
        border: 1px dashed var(--background-modifier-border);
        background-color: var(--background-secondary);
        color: var(--text-muted);
        text-align: center;
        padding: 32px;
    }

    .gridnote-empty-title {
        color: var(--text-normal);
        font-size: 1rem;
    }

    .gridnote-empty-copy {
        max-width: 420px;
        line-height: 1.6;
    }

    .gridnote-empty-create-root-btn {
        margin-top: 10px;
        padding: 8px 20px;
        border: 1px solid var(--interactive-accent);
        border-radius: 8px;
        background-color: var(--interactive-accent);
        color: var(--text-on-accent);
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: opacity 0.2s ease;
    }

    .gridnote-empty-create-root-btn:hover {
        opacity: 0.88;
    }

    @media (max-width: 900px) {
        .gridnote-stage {
            --gridnote-stage-safe-padding: 20px;
        }
    }
</style>

import type GridNoteContent from '../../components/GridNoteContent.svelte';
import type { GridNoteHistoryRevealRequest } from '../../utils/historyReveal';
import type { DocumentStructure } from '../../types';
import type { GridNoteFoldStateCoordinator } from './GridNoteFoldStateCoordinator';
import type { SearchNavigationTracker } from './SearchNavigationTracker';

export interface GridNoteMarkdownModeButtons {
    toggle: HTMLElement | null;
}

export interface GridNoteMarkdownModeState {
    enabled: boolean;
    manualEnabledFilePath: string | null;
    manualDisabledFilePath: string | null;
    lastFrontmatterCheckFilePath: string | null;
    component: GridNoteContent | null;
    containerEl: HTMLElement | null;
    currentRawText: string;
    currentFrontmatterText: string;
    currentRawLines: string[];
    foldState: GridNoteFoldStateCoordinator;
    currentStructure: DocumentStructure | null;
    foldLineOffset: number;
    foldStateReloadRequest: number;
    historySelectionClearRequest: number;
    historyRevealRequest: GridNoteHistoryRevealRequest | null;
    renderedSourcePath: string | null;
    pendingSourceLoadPath: string | null;
    pendingSourceExpectedText: string | null;
    sourceEditorCheckTimeout: number;
    sourceLoadVersion: number;
    suppressRefresh: boolean;
    pendingFoldStateReload: boolean;
    refreshFrame: number;
    lastKnownCursorLine: number;
    searchNavigation: SearchNavigationTracker;
    externalNavigationCheckInterval: number;
    buttons: GridNoteMarkdownModeButtons;
}

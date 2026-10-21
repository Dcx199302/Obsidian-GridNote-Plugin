import type { Writable } from 'svelte/store';
import type { TreeNode } from '../../../types';

export interface GridNoteCardRegistration {
	node: TreeNode;
	editorHostEl: HTMLDivElement | null;
	cardEl: HTMLDivElement | null;
}

export interface GridNoteCardEditDraft {
    content: string;
}

export type GridNoteCardInsertPosition = 'before' | 'after' | 'child';

export interface GridNoteCardSelectionHint {
    viewId?: string;
    identityKey: string;
    startLine: number;
    headingLevel: number | null;
    header: string;
}

export interface GridNoteCardSelectionOptions {
    focus?: boolean;
    scroll?: boolean;
    /** 内部 reveal 管线使用；结构重映射时保留正在进行的精确定位重试。 */
    preserveReveal?: boolean;
}

export interface GridNoteCardEditingContext {
    isEditable: boolean;
    activeEditorId: Writable<string | null>;
    activeEditorReady: Writable<boolean>;
    activeEditingCard: Writable<GridNoteCardRegistration | null>;
    activeEditingPathKeys: Writable<Set<string>>;
    collapsedNodeIds: Writable<Set<string>>;
    selectedCardId: Writable<string | null>;
    isViewportScrolling: Writable<boolean>;
    viewportStableVersion: Writable<number>;
    revealPinnedNodeId: Writable<string | null>;
    beginEdit(card: GridNoteCardRegistration): Promise<boolean>;
    finishEdit(nodeId: string): void;
    registerCard(card: GridNoteCardRegistration): void;
    unregisterCard(nodeId: string, cardEl?: HTMLDivElement | null): void;
    selectCard(node: TreeNode | null, options?: GridNoteCardSelectionOptions): void;
    clearSelectedCard(): void;
    setNodeExpanded(nodeId: string, expanded: boolean): void;
    registerSaveHandler(nodeId: string, handler: () => Promise<void>): void;
    unregisterSaveHandler(nodeId: string, handler?: () => Promise<void>): void;
    saveCardEdit(node: TreeNode, draft: GridNoteCardEditDraft): Promise<void>;
    insertNode(node: TreeNode, position: GridNoteCardInsertPosition): Promise<boolean>;
}

export const gridNoteCardEditingContextKey = Symbol('gridnote-card-editing');

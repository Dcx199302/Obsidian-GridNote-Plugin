import type { TreeNode } from '../../types';
import type { GridNoteCardInsertPosition } from '../themes/shared/cardEditingContext';

export function isEditableElement(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    if (target.isContentEditable) {
        return true;
    }

    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        return true;
    }

    return Boolean(target.closest('.cm-editor, [contenteditable="true"]'));
}

export function isFloatingEditorElement(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    return Boolean(target.closest('.floating-card-editor-layer'));
}

function resolveKeyboardTargetElement(target: EventTarget | null): HTMLElement | null {
    if (target instanceof HTMLElement) {
        return target;
    }

    if (target instanceof Node) {
        return target.parentElement;
    }

    return null;
}

export function isKeyboardEventFromModalOrFloatingEditor(target: EventTarget | null): boolean {
    const targetEl = resolveKeyboardTargetElement(target);
    if (!targetEl) {
        return false;
    }

    return Boolean(
        targetEl.closest('.modal-container, .floating-card-editor-layer')
    );
}

export function isInsertShortcutEvent(event: KeyboardEvent): boolean {
    return event.shiftKey
        && (event.metaKey || event.ctrlKey)
        && !event.altKey;
}

export function isUndoShortcutEvent(event: KeyboardEvent): boolean {
    return (event.metaKey || event.ctrlKey)
        && !event.shiftKey
        && !event.altKey
        && event.key.toLowerCase() === 'z';
}

export function isRedoShortcutEvent(event: KeyboardEvent): boolean {
    const key = event.key.toLowerCase();
    if (event.altKey) {
        return false;
    }

    return ((event.metaKey || event.ctrlKey) && event.shiftKey && key === 'z')
        || (event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'y');
}

export function isSearchShortcutEvent(event: KeyboardEvent): boolean {
    return (event.metaKey || event.ctrlKey)
        && !event.shiftKey
        && !event.altKey
        && event.key.toLowerCase() === 'f';
}

export function isFileSwitcherShortcutEvent(event: KeyboardEvent): boolean {
    return (event.metaKey || event.ctrlKey)
        && !event.shiftKey
        && !event.altKey
        && event.key.toLowerCase() === 'o';
}

export function resolveInsertShortcutPosition(
    node: TreeNode,
    key: string,
    isDocumentHeadingRoot = false
): GridNoteCardInsertPosition | null {
    if (node.headingLevel === null) {
        return null;
    }

    const canInsertChild = node.headingLevel < 6;
    const isDocumentRootHeading = isDocumentHeadingRoot && node.headingLevel !== null;

    if (key === 'ArrowUp') {
        return isDocumentRootHeading ? null : 'before';
    }

    if (key === 'ArrowDown') {
        if (isDocumentRootHeading) {
            return canInsertChild ? 'child' : null;
        }

        return 'after';
    }

    if (key === 'ArrowRight') {
        if (isDocumentRootHeading || !canInsertChild) {
            return null;
        }

        return 'child';
    }

    return null;
}

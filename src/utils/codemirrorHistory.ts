import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands';

interface EditorViewLike {
    state: unknown;
    dispatch(transaction: unknown): void;
}

interface NativeEditorLike {
    cm?: EditorViewLike | null;
    getValue?(): string;
    undo?: () => void;
    redo?: () => void;
}

export interface HistoryAvailability {
    canUndo: boolean;
    canRedo: boolean;
}

function getCodeMirrorEditor(
    editor: NativeEditorLike | null | undefined
): EditorViewLike | null {
    return editor?.cm ?? null;
}

export function readHistoryAvailability(
    editor: NativeEditorLike | null | undefined
): HistoryAvailability {
    const cm = getCodeMirrorEditor(editor);
    if (!cm) {
        return {
            canUndo: false,
            canRedo: false
        };
    }

    return {
        canUndo: undoDepth(cm.state) > 0,
        canRedo: redoDepth(cm.state) > 0
    };
}

export function performHistoryAction(
    editor: NativeEditorLike | null | undefined,
    action: 'undo' | 'redo'
): boolean {
    const cm = getCodeMirrorEditor(editor);
    if (cm) {
        return action === 'undo' ? undo(cm) : redo(cm);
    }

    const valueBeforeAction = editor?.getValue?.() ?? '';
    if (action === 'undo') {
        editor?.undo?.();
    } else {
        editor?.redo?.();
    }

    return (editor?.getValue?.() ?? valueBeforeAction) !== valueBeforeAction;
}

declare module '@codemirror/commands' {
    export const historyField: unknown;

    export function undoDepth(state: unknown): number;
    export function redoDepth(state: unknown): number;

    export function undo(target: {
        state: unknown;
        dispatch(transaction: unknown): void;
    }): boolean;

    export function redo(target: {
        state: unknown;
        dispatch(transaction: unknown): void;
    }): boolean;
}

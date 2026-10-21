import { setIcon } from 'obsidian';

type ActionButtonIcon = 'layout-template';

interface CreateActionButtonOptions {
    icon: ActionButtonIcon;
    label: string;
    registerDomEvent: <K extends keyof HTMLElementEventMap>(
        element: HTMLElement,
        type: K,
        callback: (event: HTMLElementEventMap[K]) => void
    ) => void;
    onClick: (button: HTMLElement, event?: MouseEvent | KeyboardEvent) => void;
}

export function createActionButton({
    icon,
    label,
    registerDomEvent,
    onClick
}: CreateActionButtonOptions): HTMLElement {
    const button = document.createElement('div');
    button.className = 'clickable-icon gridnote-markdown-mode-action';
    button.setAttribute('aria-label', label);
    button.tabIndex = 0;
    setIcon(button, icon);

    registerDomEvent(button, 'click', (event) => {
        event.preventDefault();
        onClick(button, event);
    });

    registerDomEvent(button, 'keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        event.preventDefault();
        onClick(button, event);
    });

    return button;
}

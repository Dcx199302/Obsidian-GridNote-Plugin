import type { Modal } from 'obsidian';

const nativeModalHeaderSelector = [
    '.modal-header',
    '.modal-header-button',
    '.modal-close-button'
].join(',');

/**
 * Switches a modal to a plugin-owned header. Obsidian has used different
 * native close-button structures across app versions, so remove all of them.
 */
export function useCustomModalHeader(modal: Modal): void {
    modal.modalEl.addClass('gridnote-custom-header-modal');
    modal.modalEl
        .querySelectorAll(nativeModalHeaderSelector)
        .forEach((element) => element.remove());
}

/**
 * Keeps Obsidian's native header and moves newer close buttons into it.
 */
export function useNativeModalHeader(modal: Modal): void {
    const normalizeHeader = () => {
        const headerEl = modal.modalEl.querySelector<HTMLElement>('.modal-header');
        const headerButtonEl = modal.modalEl.querySelector<HTMLElement>('.modal-header-button');
        if (!headerEl) {
            return;
        }

        headerEl.addClass('gridnote-native-modal-header');
        if (headerButtonEl && headerButtonEl.parentElement !== headerEl) {
            headerEl.appendChild(headerButtonEl);
        }
    };

    normalizeHeader();
    window.requestAnimationFrame(normalizeHeader);
}

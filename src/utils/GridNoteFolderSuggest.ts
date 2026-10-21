import { AbstractInputSuggest, TFolder } from 'obsidian';
import type { App } from 'obsidian';

export class GridNoteFolderSuggest extends AbstractInputSuggest<TFolder> {
    private onChoose: (path: string) => void | Promise<void>;

    constructor(
        app: App,
        inputEl: HTMLInputElement,
        onChoose: (path: string) => void | Promise<void>
    ) {
        super(app, inputEl);
        this.onChoose = onChoose;
    }

    getSuggestions(query: string): TFolder[] {
        return this.app.vault.getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder)
            .filter((folder) => {
                if (!query) return true;
                return folder.path.toLowerCase().contains(query.toLowerCase());
            })
            .sort((left, right) => left.path.localeCompare(right.path));
    }

    renderSuggestion(folder: TFolder, el: HTMLElement): void {
        el.setText(folder.path || '/');
    }

    selectSuggestion(folder: TFolder): void {
        void this.onChoose(folder.path);
    }
}

import { FuzzySuggestModal, TFolder } from 'obsidian';
import type { App } from 'obsidian';

interface GridNoteFolderSuggestModalOptions {
    currentPath: string;
    onChoose: (path: string) => void | Promise<void>;
}

export class GridNoteFolderSuggestModal extends FuzzySuggestModal<TFolder> {
    private readonly options: GridNoteFolderSuggestModalOptions;

    constructor(app: App, options: GridNoteFolderSuggestModalOptions) {
        super(app);
        this.options = options;
        this.setPlaceholder('选择截图保存文件夹...');
    }

    getItems(): TFolder[] {
        return this.app.vault.getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder)
            .sort((left, right) => left.path.localeCompare(right.path));
    }

    getItemText(item: TFolder): string {
        return item.path || '/';
    }

    onChooseItem(item: TFolder): void {
        void this.options.onChoose(item.path);
    }

    onOpen(): void {
        super.onOpen();
        if (!this.options.currentPath) {
            return;
        }

        this.inputEl.value = this.options.currentPath;
        this.inputEl.dispatchEvent(new Event('input'));
    }
}

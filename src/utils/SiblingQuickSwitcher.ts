import {
    App,
    Component,
    Notice,
    SuggestModal,
    TFile,
    TFolder,
    setIcon
} from 'obsidian';

type SearchMode = 'files' | 'folders';

type SwitcherItem =
    | { type: 'file'; file: TFile }
    | { type: 'folder'; folder: TFolder; matchedFiles?: TFile[] };

interface SiblingQuickSwitcherOptions {
    activeFile: TFile | null;
    openTarget: (file: TFile) => Promise<void> | void;
    initialFolder?: TFolder | null;
}

const MAX_SEARCH_RESULTS = 100;
const MAX_VISIBLE_FOLDERS = 60;
const MAX_MATCHED_FILES_PER_FOLDER = 24;

export class SiblingQuickSwitcher extends SuggestModal<SwitcherItem> {
    private readonly activeFile: TFile | null;
    private readonly openTarget: (file: TFile) => Promise<void> | void;
    private readonly allFolders: TFolder[];
    private readonly folderFileCache = new Map<string, TFile[]>();
    private readonly queryCache = new Map<string, SwitcherItem[]>();
    private currentFolder: TFolder;
    private mode: SearchMode = 'files';
    private actionsContainer: HTMLDivElement | null = null;
    private modeBadgeEl: HTMLSpanElement | null = null;
    private currentFolderLabelEl: HTMLDivElement | null = null;
    private createFileButtonEl: HTMLButtonElement | null = null;
    private eventScope: Component | null = null;
    private pendingMatchedFiles: TFile[] = [];
    private pendingSearchQuery = '';

    constructor(app: App, options: SiblingQuickSwitcherOptions) {
        super(app);

        this.activeFile = options.activeFile;
        this.openTarget = options.openTarget;
        this.currentFolder = options.initialFolder
            ?? this.activeFile?.parent
            ?? this.app.vault.getRoot();
        this.allFolders = this.collectFolders();
        this.limit = MAX_SEARCH_RESULTS;
        this.modalEl.addClass('gridnote-sibling-switcher');
        this.eventScope = new Component();

        this.registerModeHotkeys();
        this.registerActionHotkeys();
        this.registerEscapeHandler();
        this.setInstructions([
            { command: 'Tab', purpose: '切换文件 / 文件夹模式' },
            { command: 'Enter', purpose: '打开文件或进入文件夹' },
            { command: 'Shift+Enter', purpose: '新建 Markdown 文件' }
        ]);
        this.updatePlaceholder();
        this.updateEmptyState();
    }

    onOpen(): void {
        super.onOpen();
        this.renderActionFooter();
        this.updateFooter();
        this.triggerInputRefresh();
    }

    onClose(): void {
        if (this.eventScope) {
            this.eventScope.unload();
            this.eventScope = null;
        }
        super.onClose();
    }

    getSuggestions(query: string): SwitcherItem[] {
        const normalizedQuery = this.normalizeQuery(query);
        const cacheKey = this.buildCacheKey(this.mode, normalizedQuery);
        const cachedResult = this.queryCache.get(cacheKey);
        if (cachedResult) {
            return cachedResult;
        }

        const results = this.mode === 'files'
            ? this.getFileSuggestions(normalizedQuery)
            : this.getFolderSuggestions(normalizedQuery);
        this.queryCache.set(cacheKey, results);
        return results;
    }

    renderSuggestion(value: SwitcherItem, el: HTMLElement): void {
        const container = el.createDiv({ cls: 'suggestion-content' });

        if (value.type === 'folder') {
            const { folderName, parentPath } = this.getFolderDisplayParts(value.folder);
            const row = container.createDiv({ cls: 'gridnote-folder-row' });
            const info = row.createDiv({ cls: 'gridnote-folder-info' });
            const iconEl = info.createDiv({ cls: 'gridnote-folder-icon' });
            setIcon(iconEl, 'folder');

            const folderNameEl = info.createDiv({
                cls: 'suggestion-title gridnote-folder-name',
                text: folderName
            });

            if ((value.matchedFiles?.length ?? 0) > 0) {
                folderNameEl.createSpan({
                    cls: 'gridnote-folder-match-count',
                    text: `${value.matchedFiles?.length ?? 0} 个匹配`
                });
            }

            row.createDiv({
                cls: 'gridnote-folder-path',
                text: parentPath
            });
            return;
        }

        const isCurrentFile = this.isActiveFile(value.file);
        const row = container.createDiv({ cls: 'gridnote-file-row' });
        if (isCurrentFile) {
            row.classList.add('is-current-file');
        }

        const iconEl = row.createDiv({ cls: 'gridnote-file-icon' });
        setIcon(iconEl, 'file-text');

        row.createDiv({
            cls: 'suggestion-title gridnote-file-name',
            text: value.file.basename
        });

        row.createDiv({
            cls: 'gridnote-file-path',
            text: this.getDisplayFolderPath(value.file.parent)
        });

        if (isCurrentFile) {
            row.createSpan({
                cls: 'gridnote-file-badge',
                text: '当前'
            });
        }
    }

    selectSuggestion(value: SwitcherItem, evt: MouseEvent | KeyboardEvent): void {
        if (value.type === 'folder') {
            evt.preventDefault();
            evt.stopPropagation();
            this.onChooseSuggestion(value, evt);
            this.inputEl?.focus();
            return;
        }

        super.selectSuggestion(value, evt);
    }

    onChooseSuggestion(item: SwitcherItem, _evt: MouseEvent | KeyboardEvent): void {
        if (item.type === 'folder') {
            this.enterFolder(item.folder, item.matchedFiles ?? []);
            return;
        }

        void this.openSelectedFile(item.file);
    }

    private async openSelectedFile(file: TFile): Promise<void> {
        if (this.activeFile && file.path === this.activeFile.path) {
            this.close();
            return;
        }

        try {
            await this.openTarget(file);
            this.close();
        } catch (error) {
            console.error('GridNote: 文件快速切换打开失败', error);
            new Notice('打开文件失败，请重试');
        }
    }

    private getFileSuggestions(normalizedQuery: string): SwitcherItem[] {
        let files: TFile[];

        if (
            this.pendingMatchedFiles.length > 0
            && normalizedQuery === this.pendingSearchQuery
        ) {
            files = this.pendingMatchedFiles;
        } else {
            const folderFiles = this.collectFilesInFolder(this.currentFolder);
            files = normalizedQuery === ''
                ? folderFiles
                : this.searchFilesWithLimit(folderFiles, normalizedQuery);
        }

        return files
            .slice(0, MAX_SEARCH_RESULTS)
            .map((file) => ({ type: 'file' as const, file }));
    }

    private getFolderSuggestions(normalizedQuery: string): SwitcherItem[] {
        if (normalizedQuery === '') {
            return this.allFolders
                .slice(0, MAX_VISIBLE_FOLDERS)
                .map((folder) => ({ type: 'folder' as const, folder }));
        }

        const results: SwitcherItem[] = [];

        for (const folder of this.allFolders) {
            if (results.length >= MAX_SEARCH_RESULTS) {
                break;
            }

            const folderMatches = this.getDisplayFolderPath(folder)
                .toLowerCase()
                .includes(normalizedQuery);
            const matchedFiles = this.searchFilesInFolder(folder, normalizedQuery);

            if (!folderMatches && matchedFiles.length === 0) {
                continue;
            }

            results.push({
                type: 'folder',
                folder,
                matchedFiles: matchedFiles.length > 0 ? matchedFiles : undefined
            });
        }

        return results;
    }

    private searchFilesWithLimit(files: TFile[], normalizedQuery: string): TFile[] {
        const results: TFile[] = [];

        for (const file of files) {
            if (!file.basename.toLowerCase().includes(normalizedQuery)) {
                continue;
            }

            results.push(file);
            if (results.length >= MAX_SEARCH_RESULTS) {
                break;
            }
        }

        return results;
    }

    private searchFilesInFolder(folder: TFolder, normalizedQuery: string): TFile[] {
        const results: TFile[] = [];

        for (const file of this.collectFilesInFolder(folder)) {
            if (!file.basename.toLowerCase().includes(normalizedQuery)) {
                continue;
            }

            results.push(file);
            if (results.length >= MAX_MATCHED_FILES_PER_FOLDER) {
                break;
            }
        }

        return results;
    }

    private collectFilesInFolder(folder: TFolder): TFile[] {
        const cacheKey = this.getFolderCacheKey(folder);
        const cachedFiles = this.folderFileCache.get(cacheKey);
        if (cachedFiles) {
            return cachedFiles;
        }

        const files = folder.children
            .filter((child): child is TFile => child instanceof TFile)
            .filter((file) => file.extension === 'md')
            .sort((left, right) =>
                left.basename.localeCompare(right.basename, undefined, {
                    numeric: true,
                    sensitivity: 'base'
                })
            );

        this.folderFileCache.set(cacheKey, files);
        return files;
    }

    private collectFolders(): TFolder[] {
        const folders = this.app.vault
            .getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder);
        const rootFolder = this.app.vault.getRoot();

        if (!folders.some((folder) => folder.path === rootFolder.path)) {
            folders.push(rootFolder);
        }

        return folders.sort((left, right) =>
            this.getDisplayFolderPath(left).localeCompare(
                this.getDisplayFolderPath(right),
                undefined,
                {
                    numeric: true,
                    sensitivity: 'base'
                }
            )
        );
    }

    private enterFolder(folder: TFolder, matchedFiles: TFile[]): void {
        this.currentFolder = folder;
        this.mode = 'files';
        this.pendingMatchedFiles = matchedFiles;
        this.pendingSearchQuery = matchedFiles.length > 0
            ? this.normalizeQuery(this.inputEl?.value ?? '')
            : '';
        this.queryCache.clear();
        this.updatePlaceholder();
        this.updateEmptyState();
        this.updateFooter();

        if (this.inputEl) {
            this.inputEl.value = this.pendingSearchQuery;
        }

        this.triggerInputRefresh();
    }

    private registerModeHotkeys(): void {
        const handler = (evt: KeyboardEvent) => {
            evt.preventDefault();
            this.toggleMode();
        };

        this.scope.register([], 'Tab', handler);
        this.scope.register(['Shift'], 'Tab', handler);
    }

    private registerActionHotkeys(): void {
        this.scope.register(['Shift'], 'Enter', (evt) => {
            if (this.mode !== 'files') {
                return;
            }

            evt.preventDefault();
            evt.stopPropagation();
            void this.handleCreateFileAction();
        });
    }

    private registerEscapeHandler(): void {
        const handler = (evt: KeyboardEvent) => {
            evt.preventDefault();
            evt.stopPropagation();
            this.close();
        };

        this.scope.register([], 'Escape', handler);

        const captureBlocker = (evt: KeyboardEvent) => {
            if (evt.key === 'Escape') {
                evt.stopImmediatePropagation();
            }
        };

        this.eventScope!.registerDomEvent(document, 'keydown', captureBlocker, true);
    }

    private toggleMode(): void {
        this.mode = this.mode === 'files' ? 'folders' : 'files';

        if (this.mode === 'folders') {
            this.pendingMatchedFiles = [];
            this.pendingSearchQuery = '';
        }

        this.queryCache.clear();
        this.updatePlaceholder();
        this.updateEmptyState();
        this.updateFooter();

        if (this.inputEl) {
            this.inputEl.value = '';
        }

        this.triggerInputRefresh();
    }

    private updatePlaceholder(): void {
        if (this.mode === 'folders') {
            this.setPlaceholder('搜索文件夹或包含目标文件的目录…');
            return;
        }

        this.setPlaceholder(`选择“${this.getCurrentFolderLabel()}”中的文件…`);
    }

    private updateEmptyState(): void {
        if (this.mode === 'folders') {
            this.emptyStateText = '没有匹配的文件夹';
            return;
        }

        this.emptyStateText = '当前目录没有可显示的 Markdown 文件';
    }

    private renderActionFooter(): void {
        if (this.actionsContainer || !this.resultContainerEl) {
            return;
        }

        const host = this.resultContainerEl.parentElement ?? this.resultContainerEl;
        this.actionsContainer = host.createDiv({
            cls: 'gridnote-switcher-actions'
        });

        const footer = this.actionsContainer.createDiv({
            cls: 'setting-item gridnote-switcher-footer'
        });
        const info = footer.createDiv({ cls: 'setting-item-info' });
        const metaRow = info.createDiv({ cls: 'gridnote-switcher-meta' });
        this.modeBadgeEl = metaRow.createSpan({ cls: 'gridnote-switcher-mode' });
        this.currentFolderLabelEl = info.createDiv({
            cls: 'setting-item-description gridnote-current-folder'
        });

        const controls = footer.createDiv({ cls: 'setting-item-control' });
        this.createFileButtonEl = controls.createEl('button', {
            cls: 'mod-cta gridnote-action-button',
            text: '新建 Markdown 文件'
        });
        this.eventScope!.registerDomEvent(this.createFileButtonEl, 'click', () => {
            void this.handleCreateFileAction();
        });
    }

    private updateFooter(): void {
        if (!this.actionsContainer || !this.modeBadgeEl || !this.currentFolderLabelEl) {
            return;
        }

        const isFileMode = this.mode === 'files';
        this.actionsContainer.toggleClass('is-folder-mode', !isFileMode);
        this.modeBadgeEl.textContent = isFileMode ? '文件模式' : '文件夹模式';
        this.currentFolderLabelEl.textContent = isFileMode
            ? `当前目录：${this.getCurrentFolderLabel()}`
            : '搜索目录后按回车进入，进入后自动切回文件模式';

        if (this.createFileButtonEl) {
            this.createFileButtonEl.hidden = !isFileMode;
        }
    }

    private async handleCreateFileAction(): Promise<void> {
        try {
            const file = await this.createUniqueMarkdownFile(this.currentFolder);
            this.folderFileCache.delete(this.getFolderCacheKey(this.currentFolder));
            this.queryCache.clear();
            await this.openTarget(file);
            this.close();
        } catch (error) {
            console.error('GridNote: 创建 Markdown 文件失败', error);
            new Notice('创建文件失败，请重试');
        }
    }

    private async createUniqueMarkdownFile(folder: TFolder): Promise<TFile> {
        const path = this.generateAvailableChildPath(folder, '新建笔记', '.md');
        return this.app.vault.create(path, '');
    }

    private generateAvailableChildPath(
        folder: TFolder,
        baseName: string,
        extension = ''
    ): string {
        const prefix = folder.path === '' ? '' : `${folder.path}/`;
        const normalizedExtension = extension === ''
            ? ''
            : extension.startsWith('.')
                ? extension
                : `.${extension}`;

        for (let attempt = 0; attempt < 10_000; attempt += 1) {
            const suffix = attempt === 0 ? '' : ` ${attempt}`;
            const candidatePath = `${prefix}${baseName}${suffix}${normalizedExtension}`;
            if (!this.app.vault.getAbstractFileByPath(candidatePath)) {
                return candidatePath;
            }
        }

        throw new Error('Unable to generate unique Markdown path');
    }

    private triggerInputRefresh(): void {
        this.inputEl?.dispatchEvent(new Event('input'));
    }

    private isActiveFile(file: TFile): boolean {
        return this.activeFile?.path === file.path;
    }

    private buildCacheKey(mode: SearchMode, normalizedQuery: string): string {
        if (mode === 'files') {
            return `${mode}:${this.getFolderCacheKey(this.currentFolder)}:${normalizedQuery}`;
        }

        return `${mode}:${normalizedQuery}`;
    }

    private normalizeQuery(query: string): string {
        return query.trim().toLowerCase();
    }

    private getFolderDisplayParts(folder: TFolder): { folderName: string; parentPath: string } {
        const folderPath = this.getDisplayFolderPath(folder);
        if (folderPath === '/') {
            return {
                folderName: '/',
                parentPath: '/'
            };
        }

        const parts = folderPath.split('/');
        return {
            folderName: parts[parts.length - 1] ?? folderPath,
            parentPath: parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : '/'
        };
    }

    private getCurrentFolderLabel(): string {
        return this.getDisplayFolderPath(this.currentFolder);
    }

    private getDisplayFolderPath(folder: TFolder | null): string {
        if (!folder || folder.path === '') {
            return '/';
        }

        return folder.path;
    }

    private getFolderCacheKey(folder: TFolder): string {
        return folder.path === '' ? '/' : folder.path;
    }
}

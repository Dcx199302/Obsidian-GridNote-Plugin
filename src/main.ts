import { MarkdownView, Notice, Plugin } from 'obsidian';
import type { TFile } from 'obsidian';
import { DEFAULT_SETTINGS, GridNoteSettingTab } from "./settings";
import type { GridNoteSettings } from "./settings";
import type { DocumentStructure } from './types';
import { GridNoteMarkdownModeManager } from './views/GridNoteMarkdownModeManager';
import { GridNoteRangeEditorModalManager } from './utils/GridNoteRangeEditorModal';
import { GridNoteTextSearchModal } from './utils/GridNoteTextSearchModal';
import type { GridNoteSearchResult } from './utils/GridNoteTextSearch';
import { SiblingQuickSwitcher } from './utils/SiblingQuickSwitcher';
import { registerGridNoteImagePreviewPostProcessor } from './utils/GridNoteImagePreviewPostProcessor';
import { GridNoteFileTreeModal } from './utils/GridNoteFileTreeModal';
import { getLocalizedCommandText } from './utils/i18n';

interface GridNoteTextSearchOpenOptions {
	sourcePath: string;
	structure: DocumentStructure;
	onRevealResult: (result: GridNoteSearchResult) => Promise<void> | void;
}

export default class GridNotePlugin extends Plugin {
	settings!: GridNoteSettings;
	markdownModeManager: GridNoteMarkdownModeManager | null = null;

	async onload() {
		await this.loadSettings();

		// 清理历史版本遗留的本地激活数据
		this.app.saveLocalStorage('GRID_NOTE_VIP', null);

		const toggleGridNoteMarkdownModeText = getLocalizedCommandText('toggleGridNoteMarkdownMode');
		const openGridNoteFileSwitcherText = getLocalizedCommandText('openGridNoteFileSwitcher');
		const setGridNoteDefaultOpenText = getLocalizedCommandText('setGridNoteDefaultOpen');
		const openFileTreeText = getLocalizedCommandText('openGridNoteFileTree');

		this.markdownModeManager = new GridNoteMarkdownModeManager(this);

		this.addCommand({
			id: 'toggle-markdown-mode',
			name: toggleGridNoteMarkdownModeText.name,
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return false;

				const file = view.file;
				if (!file || file.extension !== 'md') return false;

				if (checking) return true;

				this.markdownModeManager?.toggleForActiveMarkdownView();
				return true;
			}
		});

		this.addCommand({
			id: 'open-gridnote-file-switcher',
			name: openGridNoteFileSwitcherText.name,
			checkCallback: (checking: boolean) => {
				if (!this.hasSupportedActiveView()) {
					return false;
				}

				if (checking) {
					return true;
				}

				return this.openSiblingFileSwitcherForActiveLeaf();
			}
		});

		this.addCommand({
			id: 'set-gridnote-default-open',
			name: setGridNoteDefaultOpenText.name,
			checkCallback: (checking: boolean) => {
				if (!this.hasSupportedActiveView()) {
					return false;
				}

				if (checking) {
					return true;
				}

				void this.toggleGridNoteDefaultOpenForActiveFile();
				return true;
			}
		});

		this.addCommand({
			id: 'open-gridnote-file-tree',
			name: openFileTreeText.name,
			callback: () => {
				new GridNoteFileTreeModal(this.app, this).open();
			}
		});

	// 左侧栏快捷按钮（ribbon icon）
	this.addRibbonIcon('layout-template', openFileTreeText.name, () => {
		new GridNoteFileTreeModal(this.app, this).open();
	});

		// 添加设置面板
		this.addSettingTab(new GridNoteSettingTab(this.app, this));
		registerGridNoteImagePreviewPostProcessor(this);
	}

	onunload() {
		this.markdownModeManager?.destroy();
		this.markdownModeManager = null;
		GridNoteRangeEditorModalManager.getExistingInstance()?.destroy();
		// 视图会在插件卸载时自动清理
	}

	async loadSettings() {
		const storedSettings = (await this.loadData() ?? {}) as Record<string, unknown>;
		// 迁移：清理历史版本的 VIP 激活字段
		if ('isVip' in storedSettings || 'activationCode' in storedSettings) {
			delete storedSettings.isVip;
			delete storedSettings.activationCode;
			await this.saveData(storedSettings);
		}
		this.settings = Object.assign({}, DEFAULT_SETTINGS, storedSettings);
		this.applyHeadingColors();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	applyHeadingColors(): void {
		const style = document.documentElement.style;
		if (this.settings.headingColorLight) {
			style.setProperty('--gridnote-heading-color-light', this.settings.headingColorLight);
		} else {
			style.removeProperty('--gridnote-heading-color-light');
		}
		if (this.settings.headingColorDark) {
			style.setProperty('--gridnote-heading-color-dark', this.settings.headingColorDark);
		} else {
			style.removeProperty('--gridnote-heading-color-dark');
		}
	}

	openSiblingFileSwitcherForActiveLeaf(): boolean {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (markdownView) {
			return this.openSiblingFileSwitcherForMarkdownView(markdownView);
		}

		new Notice('仅支持 Markdown 文件');
		return false;
	}

	openSiblingFileSwitcherForMarkdownView(view: MarkdownView): boolean {
		const file = view.file;
		if (!file || file.extension !== 'md') {
			new Notice('仅支持 Markdown 文件');
			return false;
		}

		this.openSiblingFileSwitcher(
			file,
			(nextFile) => view.leaf.openFile(nextFile)
		);
		return true;
	}

	openTextSearchForMarkdownView(view: MarkdownView): boolean {
		return this.markdownModeManager?.openTextSearchForView(view) ?? false;
	}

	openTextSearchModal(options: GridNoteTextSearchOpenOptions): void {
		const activeModal = GridNoteTextSearchModal.getActiveInstance();
		if (activeModal) {
			if (activeModal.matchesSourcePath(options.sourcePath)) {
				activeModal.focusSearchInput();
				return;
			}

			activeModal.close();
		}

		new GridNoteTextSearchModal(this.app, {
			sourcePath: options.sourcePath,
			structure: options.structure,
			onChooseResult: (result) => options.onRevealResult(result)
		}).open();
	}

	private hasSupportedActiveView(): boolean {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		return markdownView?.file?.extension === 'md';
	}

	private async toggleGridNoteDefaultOpenForActiveFile(): Promise<void> {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = markdownView?.file;
		if (!file || file.extension !== 'md') {
			new Notice('仅支持 Markdown 文件');
			return;
		}

		const currentValue = this.app.metadataCache.getFileCache(file)?.frontmatter?.gridnote === true;
		const nextValue = !currentValue;

		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
				frontmatter.gridnote = nextValue;
			});

			this.markdownModeManager?.syncModeForActiveMarkdownView();

			new Notice(
				nextValue
					? '已设置为默认使用 GridNote View 打开（gridnote: true）'
					: '已取消默认使用 GridNote View 打开（gridnote: false）'
			);
		} catch (error) {
			console.error('[GridNote] Failed to set gridnote frontmatter:', error);
			new Notice('设置 gridnote 属性失败，请检查笔记 YAML 格式');
		}
	}

	private openSiblingFileSwitcher(
		file: TFile,
		openTarget: (file: TFile) => Promise<void> | void
	): void {
		new SiblingQuickSwitcher(this.app, {
			activeFile: file,
			initialFolder: file.parent,
			openTarget
		}).open();
	}

}

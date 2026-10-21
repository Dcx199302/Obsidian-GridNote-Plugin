import { App, Notice, PluginSettingTab, Setting, normalizePath } from 'obsidian';

import MyPlugin from './main';
import { GridNoteFolderSuggest } from './utils/GridNoteFolderSuggest';

export interface GridNoteSettings {
	screenshotFolder: string;
	headingColorLight: string;
	headingColorDark: string;
	/** 文件树浏览器最大可见层级上限。实际渲染层级会按容器宽度动态收缩，不超过此值。 */
	fileTreeMaxVisibleLayers: number;
}

export const DEFAULT_SETTINGS: GridNoteSettings = {
	screenshotFolder: '',
	headingColorLight: '',
	headingColorDark: '',
	fileTreeMaxVisibleLayers: 5
};

export class GridNoteSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// 功能介绍
		new Setting(containerEl).setName("功能介绍").setHeading();

		new Setting(containerEl)
			.setDesc("GridNote 将 Markdown 文档转换为聚焦式树状结构视图，结合康奈尔笔记法和卡片盒笔记系统，提升知识组织和阅读理解效率。");

		const screenshotFolder = (this.plugin.settings.screenshotFolder || '').trim();
		new Setting(containerEl)
			.setName('截图保存文件夹')
			.setDesc(
				screenshotFolder
					? `当前：${screenshotFolder}`
					: '当前：未设置（将使用默认文件夹 GridNote-Screenshots）'
			)
			.addText((text) => {
				text.setPlaceholder('输入文件夹路径...')
					.setValue(screenshotFolder)
					.onChange(async (_value) => {
						// handled by suggest selection
					});
				new GridNoteFolderSuggest(this.app, text.inputEl, async (path) => {
					this.plugin.settings.screenshotFolder = normalizePath(path);
					await this.plugin.saveSettings();
					this.display();
				});
			})
			.addButton((button) =>
				button
					.setButtonText('重置')
					.onClick(async () => {
						this.plugin.settings.screenshotFolder = '';
						await this.plugin.saveSettings();
						new Notice('已恢复默认截图文件夹');
						this.display();
					})
			);

		// 标题颜色
		new Setting(containerEl)
			.setName('标题颜色')
			.setDesc('自定义深色/浅色模式下的卡片标题颜色')
			.then((setting) => {
				const controlEl = setting.controlEl;

				controlEl.createSpan({ text: '浅色', cls: 'gridnote-color-label' });
				controlEl.createEl('input', {
					attr: {
						type: 'color',
						value: this.plugin.settings.headingColorLight || '#1e1e1e',
					},
					cls: 'gridnote-heading-color-picker'
				}, (input) => {
					input.addEventListener('input', async (e) => {
						this.plugin.settings.headingColorLight = (e.target as HTMLInputElement).value;
						await this.plugin.saveSettings();
						this.plugin.applyHeadingColors();
					});
				});

				controlEl.createSpan({ text: '深色', cls: 'gridnote-color-label' });
				controlEl.createEl('input', {
					attr: {
						type: 'color',
						value: this.plugin.settings.headingColorDark || '#8ab4ff',
					},
					cls: 'gridnote-heading-color-picker'
				}, (input) => {
					input.addEventListener('input', async (e) => {
						this.plugin.settings.headingColorDark = (e.target as HTMLInputElement).value;
						await this.plugin.saveSettings();
						this.plugin.applyHeadingColors();
					});
				});
			})
			.addButton((button) =>
				button.setButtonText('重置').onClick(async () => {
					this.plugin.settings.headingColorLight = '';
					this.plugin.settings.headingColorDark = '';
					await this.plugin.saveSettings();
					this.plugin.applyHeadingColors();
					new Notice('已恢复默认标题颜色');
					this.display();
				})
			);

		// 文件树浏览器
		new Setting(containerEl).setName('文件树浏览器').setHeading();

		const maxLayersSetting = new Setting(containerEl)
			.setName('最大显示层级')
			.setDesc(`文件树浏览器同时渲染的文件夹嵌套层级上限（当前：${this.plugin.settings.fileTreeMaxVisibleLayers}）。窄窗口下会自动收缩避免溢出。`)
			.addSlider((slider) => {
				slider
					.setLimits(2, 8, 1)
					.setValue(this.plugin.settings.fileTreeMaxVisibleLayers)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.fileTreeMaxVisibleLayers = value;
						await this.plugin.saveSettings();
						maxLayersSetting.setDesc(`文件树浏览器同时渲染的文件夹嵌套层级上限（当前：${value}）。窄窗口下会自动收缩避免溢出。`);
					});
			})
			.addButton((button) =>
				button.setButtonText('重置').onClick(async () => {
					this.plugin.settings.fileTreeMaxVisibleLayers = 5;
					await this.plugin.saveSettings();
					this.display();
				})
			);

	}

}

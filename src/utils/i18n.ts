import { getLanguage } from 'obsidian';

interface LocalizedText {
	zh: string;
	en: string;
}

interface CommandI18nItem {
	name: LocalizedText;
	description: LocalizedText;
}

export const COMMAND_I18N = {
	toggleGridNoteMarkdownMode: {
		name: {
			zh: '切换 GridNote 模式',
			en: 'Toggle GridNote mode'
		},
		description: {
			zh: '在 Markdown 源码视图中切换 GridNote 渲染模式',
			en: 'Toggle GridNote rendering mode in Markdown source view'
		}
	},
	openGridNoteFileSwitcher: {
		name: {
			zh: '快速切换文件',
			en: 'Quick file switcher'
		},
		description: {
			zh: '快速查找和打开文件',
			en: 'Quickly find and open files'
		}
	},
	setGridNoteDefaultOpen: {
		name: {
			zh: '默认使用 GridNote View 打开',
			en: 'Default to GridNote View'
		},
		description: {
			zh: '为当前笔记切换 gridnote: true/false 属性',
			en: 'Toggle gridnote: true/false frontmatter on current note'
		}
	},
	openGridNoteFileTree: {
		name: {
			zh: '打开文件树浏览器',
			en: 'Open file tree explorer'
		},
		description: {
			zh: '以卡片树结构浏览和管理 Vault 文件',
			en: 'Browse and manage vault files in a card tree'
		}
	}
} as const satisfies Record<string, CommandI18nItem>;

type CommandI18nKey = keyof typeof COMMAND_I18N;

function isChineseLanguage(language: string): boolean {
	return language.toLowerCase().startsWith('zh');
}

function resolveLocalizedText(text: LocalizedText, language: string): string {
	return isChineseLanguage(language) ? text.zh : text.en;
}

export function getLocalizedCommandText(key: CommandI18nKey): { name: string; description: string } {
	const language = getLanguage();
	const item = COMMAND_I18N[key];
	return {
		name: resolveLocalizedText(item.name, language),
		description: resolveLocalizedText(item.description, language)
	};
}

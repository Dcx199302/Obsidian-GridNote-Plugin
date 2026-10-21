import { App, Modal, Setting } from 'obsidian';

/**
 * 替代 window.prompt 的 Obsidian 原生输入模态框。
 * Electron/Obsidian 不支持 window.prompt，所有文本输入必须走 Modal。
 */
export class PromptModal extends Modal {
	private inputEl: HTMLInputElement | null = null;

	constructor(
		app: App,
		message: string,
		private readonly defaultValue: string,
		private readonly onSubmit: (value: string) => void,
	) {
		super(app);
		this.modalEl.addClass('gridnote-prompt-modal');
		this.titleEl.setText(message);
	}

	onOpen(): void {
		const { contentEl } = this;

		this.inputEl = contentEl.createEl('input', {
			type: 'text',
			cls: 'gridnote-prompt-input',
			value: this.defaultValue,
		});

		this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.submit();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				this.close();
			}
		});

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText('取消').onClick(() => this.close()),
			)
			.addButton((btn) =>
				btn.setButtonText('确认').setCta().onClick(() => this.submit()),
			);

		// 自动聚焦并全选，方便快速替换文件名
		window.requestAnimationFrame(() => {
			this.inputEl?.focus();
			this.inputEl?.select();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submit(): void {
		const value = this.inputEl?.value.trim() ?? '';
		this.close();
		if (value) {
			this.onSubmit(value);
		}
	}
}

/**
 * 替代 window.confirm 的 Obsidian 原生确认模态框。
 */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		message: string,
		private readonly onConfirm: () => void,
		private readonly confirmText: string = '确认',
	) {
		super(app);
		this.titleEl.setText(message);
	}

	onOpen(): void {
		const { contentEl } = this;

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText('取消').onClick(() => this.close()),
			)
			.addButton((btn) =>
				btn
					.setButtonText(this.confirmText)
					.setWarning()
					.onClick(() => {
						this.onConfirm();
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

import { Component, Modal, Notice, Setting, TFolder, setIcon } from 'obsidian';
import type { App } from 'obsidian';
import { snapdom } from '@zumer/snapdom';
import { useNativeModalHeader } from './modalHeader';

export interface GridNoteScreenshotModalOptions {
    sourceEl: HTMLElement;
    title: string;
    screenshotFolder?: string;
}

const SCREENSHOT_REMOVED_SELECTORS = [
    '.card-floating-actions',
    '.editable-markdown-card-editor-host',
    '.gridnote-heading-icon-button',
    '.tree-toggle-button',
    '.cascade-node-heading-mask',
    '.copy-code-button'
].join(',');

const SCREENSHOT_STATE_CLASSES = [
    'is-selected',
    'is-editing',
    'is-editor-display-ready',
    'is-activatable',
    'has-editing-descendant'
];

const DEFAULT_SCREENSHOT_FOLDER = 'GridNote-Screenshots';

function sanitizeFileStem(value: string): string {
    const nextValue = value
        .trim()
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 64);

    return nextValue || 'GridNote';
}

export class GridNoteScreenshotModal extends Modal {
    private readonly options: GridNoteScreenshotModalOptions;
    private previewContainerEl!: HTMLElement;
    private fontSizeLabelEl: HTMLElement | null = null;
    private scaleLabelEl: HTMLElement | null = null;
    private fontSize = 16;
    private captureScale = 1;
    private isCapturing = false;
    private hiddenNodeKeys = new Set<string>();
    private eventScope: Component | null = null;

    constructor(app: App, options: GridNoteScreenshotModalOptions) {
        super(app);
        this.options = options;
    }

    onOpen(): void {
        this.modalEl.addClass('gridnote-screenshot-modal');
        useNativeModalHeader(this);
        this.eventScope = new Component();

        this.titleEl.setText('预览分享图片');

        this.contentEl.empty();
        this.contentEl.addClass('gridnote-screenshot-modal-content');

        this.previewContainerEl = this.contentEl.createDiv({
            cls: 'gridnote-screenshot-preview-container'
        });

        this.loadSystemFontSize();
        this.captureScale = 1;
        this.renderPreview();
        this.createFooter();
    }

    onClose(): void {
        if (this.eventScope) {
            this.eventScope.unload();
            this.eventScope = null;
        }
        this.contentEl.empty();
    }

    private loadSystemFontSize(): void {
        const computedStyle = getComputedStyle(this.options.sourceEl);
        const fontSizeValue = computedStyle.getPropertyValue('--font-text-size').trim();
        const match = fontSizeValue.match(/^(\d+(?:\.\d+)?)(px|em|rem)?$/);
        if (!match) {
            this.fontSize = 16;
            return;
        }

        const numericPart = match[1];
        const unit = match[2] ?? 'px';
        if (!numericPart) {
            this.fontSize = 16;
            return;
        }

        const parsed = Number.parseFloat(numericPart);
        if (!Number.isFinite(parsed)) {
            this.fontSize = 16;
            return;
        }

        this.fontSize = unit === 'px' ? parsed : parsed * 16;
        this.fontSize = Math.max(10, Math.min(32, this.fontSize));
    }

    private detectContentMinWidth(clonedRoot: HTMLElement): number {
        const nodeEls = this.getScreenshotNodeElements(clonedRoot);
        const levels = nodeEls
            .map((el) => Number.parseInt(el.dataset.headingLevel ?? '', 10))
            .filter((v) => Number.isFinite(v) && v > 0);

        if (levels.length === 0) {
            return 900;
        }

        const depthSpan = Math.max(...levels) - Math.min(...levels) + 1;

        const widthMap: Record<number, number> = {
            1: 900,
            2: 1000,
            3: 1100,
            4: 1200,
            5: 1300,
            6: 1400
        };

        return widthMap[Math.min(depthSpan, 6)] ?? 900;
    }

    private renderPreview(): void {
        this.previewContainerEl.empty();
        this.previewContainerEl.style.setProperty('--font-text-size', `${Math.round(this.fontSize)}px`);

        const stageEl = this.previewContainerEl.createDiv({
            cls: 'gridnote-screenshot-preview-stage'
        });
        const wrapperEl = stageEl.createDiv({
            cls: 'gridnote-screenshot-wrapper'
        });
        const borderEl = wrapperEl.createDiv({
            cls: 'gridnote-screenshot-border'
        });
        const containerEl = borderEl.createDiv({
            cls: 'gridnote-screenshot-container full-height'
        });

        const clonedRoot = this.createSanitizedClone();

        const sourceWidth = Math.ceil(this.options.sourceEl.getBoundingClientRect().width);
        const minWidth = this.detectContentMinWidth(clonedRoot);
        borderEl.style.width = `${Math.max(sourceWidth, minWidth)}px`;

        containerEl.appendChild(clonedRoot);
        this.attachNodeHideButtons(clonedRoot);
    }

    private createSanitizedClone(): HTMLElement {
        const clonedRoot = this.options.sourceEl.cloneNode(true) as HTMLElement;
        this.assignNodeKeys(clonedRoot);
        this.applyHiddenNodeFilter(clonedRoot);

        clonedRoot.querySelectorAll(SCREENSHOT_REMOVED_SELECTORS).forEach((element) => {
            element.remove();
        });

        const allElements = [clonedRoot, ...clonedRoot.querySelectorAll<HTMLElement>('*')];
        for (const element of allElements) {
            // SVG 内部元素（marker, gradient, clipPath 等）依赖 id 做 url(#...) 引用，
            // 移除 id 会破坏 mermaid 等图表的渲染
            const isInsideSvg = element.closest('svg') !== null;
            if (!isInsideSvg) {
                element.removeAttribute('id');
            }
            element.removeAttribute('tabindex');
            element.removeAttribute('aria-hidden');
            element.removeAttribute('aria-label');
            element.removeAttribute('role');
            element.removeAttribute('data-gridnote-card-id');

            for (const className of SCREENSHOT_STATE_CLASSES) {
                element.classList.remove(className);
            }
        }

        return clonedRoot;
    }

    private getScreenshotNodeElements(rootEl: HTMLElement): HTMLElement[] {
        const elements = Array.from(
            rootEl.querySelectorAll<HTMLElement>('.cascade-node')
        );
        if (rootEl.matches('.cascade-node')) {
            elements.unshift(rootEl);
        }
        return elements;
    }

    private assignNodeKeys(rootEl: HTMLElement): void {
        const nodeEls = this.getScreenshotNodeElements(rootEl);
        nodeEls.forEach((nodeEl, index) => {
            nodeEl.dataset.gridnoteScreenshotNodeKey = `node-${index}`;
        });
    }

    private applyHiddenNodeFilter(rootEl: HTMLElement): void {
        if (this.hiddenNodeKeys.size === 0) {
            return;
        }

        const nodeEls = this.getScreenshotNodeElements(rootEl);
        for (const nodeEl of nodeEls) {
            const key = nodeEl.dataset.gridnoteScreenshotNodeKey;
            if (!key) {
                continue;
            }

            if (this.hiddenNodeKeys.has(key)) {
                nodeEl.remove();
            }
        }
    }

    private attachNodeHideButtons(rootEl: HTMLElement): void {
        const nodeEls = this.getScreenshotNodeElements(rootEl);
        for (const nodeEl of nodeEls) {
            const key = nodeEl.dataset.gridnoteScreenshotNodeKey;
            if (!key) {
                continue;
            }

            const headingRow = nodeEl.querySelector<HTMLElement>(
                '.cascade-node-heading-row'
            );
            if (!headingRow) {
                continue;
            }

            // Remove empty left/right containers
            headingRow.querySelector('.cascade-node-heading-left')?.remove();
            headingRow.querySelector('.cascade-node-heading-right')?.remove();

            // Flatten center: move children to heading-row, remove heading-level-icon, remove center wrapper
            const headingCenter = headingRow.querySelector<HTMLElement>(
                '.cascade-node-heading-center'
            );
            if (headingCenter) {
                headingCenter.querySelector('.heading-level-icon')?.remove();
                while (headingCenter.firstChild) {
                    headingRow.appendChild(headingCenter.firstChild);
                }
                headingCenter.remove();
            }

            // Insert eye-off button at the beginning
            const buttonEl = createEl('button');
            buttonEl.type = 'button';
            buttonEl.className = 'gridnote-screenshot-hide-node-btn';
            setIcon(buttonEl, 'eye-off');
            buttonEl.setAttribute('aria-label', '隐藏此节点');
            this.eventScope!.registerDomEvent(buttonEl, 'click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.hiddenNodeKeys.add(key);
                this.renderPreview();
            });
            headingRow.appendChild(buttonEl);
        }
    }

    private createFooter(): void {
        const footerEl = this.contentEl.createDiv({
            cls: 'gridnote-screenshot-button-area'
        });

        new Setting(footerEl)
            .addButton((button) =>
                button
                    .setButtonText('A−')
                    .setTooltip('减小字体')
                    .onClick(() => {
                        if (this.fontSize <= 10) {
                            return;
                        }

                        this.fontSize = Math.max(10, this.fontSize - 2);
                        this.updateFontSizeDisplay();
                        this.renderPreview();
                    })
            )
            .addExtraButton((button) => {
                button.setIcon('type').setTooltip('当前字体大小');
                this.fontSizeLabelEl = button.extraSettingsEl.createSpan({
                    text: `${Math.round(this.fontSize)}px`,
                    cls: 'gridnote-screenshot-scale-label'
                });
                return button;
            })
            .addButton((button) =>
                button
                    .setButtonText('A+')
                    .setTooltip('增大字体')
                    .onClick(() => {
                        if (this.fontSize >= 32) {
                            return;
                        }

                        this.fontSize = Math.min(32, this.fontSize + 2);
                        this.updateFontSizeDisplay();
                        this.renderPreview();
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText('−')
                    .setTooltip('降低图片清晰度')
                    .onClick(() => {
                        if (this.captureScale <= 0.6) {
                            return;
                        }

                        this.captureScale = Math.max(0.6, this.captureScale - 0.2);
                        this.updateScaleDisplay();
                    })
            )
            .addExtraButton((button) => {
                button.setIcon('image').setTooltip('当前图片清晰度');
                this.scaleLabelEl = button.extraSettingsEl.createSpan({
                    text: this.getScaleLabel(),
                    cls: 'gridnote-screenshot-scale-label'
                });
                return button;
            })
            .addButton((button) =>
                button
                    .setButtonText('+')
                    .setTooltip('提高图片清晰度')
                    .onClick(() => {
                        if (this.captureScale >= 2) {
                            return;
                        }

                        this.captureScale = Math.min(2, this.captureScale + 0.2);
                        this.updateScaleDisplay();
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText('显示重置')
                    .setTooltip('重置隐藏节点与显示设置')
                    .onClick(() => {
                        this.captureScale = 1;
                        this.hiddenNodeKeys.clear();
                        this.loadSystemFontSize();
                        this.updateFontSizeDisplay();
                        this.updateScaleDisplay();
                        this.renderPreview();
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText('复制图片')
                    .setTooltip('复制图片到剪贴板')
                    .setCta()
                    .onClick(() => {
                        void this.copyImageToClipboard();
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText('保存到 Vault')
                    .setTooltip('保存图片到 Obsidian 仓库')
                    .onClick(() => {
                        void this.saveImageToVault();
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText('关闭')
                    .onClick(() => this.close())
            );
    }

    private getScaleLabel(): string {
        return `${Math.round(this.captureScale * 100)}%`;
    }

    private updateFontSizeDisplay(): void {
        if (this.fontSizeLabelEl) {
            this.fontSizeLabelEl.textContent = `${Math.round(this.fontSize)}px`;
        }
    }

    private updateScaleDisplay(): void {
        if (this.scaleLabelEl) {
            this.scaleLabelEl.textContent = this.getScaleLabel();
        }
    }

    private getCaptureElement(): HTMLElement {
        const captureEl = this.previewContainerEl.querySelector<HTMLElement>('.gridnote-screenshot-wrapper');
        if (!captureEl) {
            throw new Error('截图预览尚未准备完成');
        }

        return captureEl;
    }

    private async captureToBlob(): Promise<Blob> {
        const captureEl = this.getCaptureElement();
        captureEl.classList.add('gridnote-screenshot-capturing');
        let canvas: HTMLCanvasElement;
        try {
            const result = await snapdom(captureEl, {
                scale: this.captureScale,
                embedFonts: true
            });
            canvas = await result.toCanvas();
        } finally {
            captureEl.classList.remove('gridnote-screenshot-capturing');
        }

        return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Canvas 导出 PNG 失败'));
                    return;
                }

                resolve(blob);
            }, 'image/png', 1);
        });
    }

    private buildDefaultFileName(): string {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const title = sanitizeFileStem(this.options.title);
        return `GridNote_${title}_${timestamp}.png`;
    }

    private async withCaptureNotice(
        run: () => Promise<void>
    ): Promise<void> {
        if (this.isCapturing) {
            return;
        }

        this.isCapturing = true;
        const notice = new Notice('正在生成图片...', 0);

        try {
            await new Promise((resolve) => window.setTimeout(resolve, 120));
            await run();
        } catch (error) {
            console.error('GridNote: 生成分享图片失败', error);
            const message = error instanceof Error ? error.message : '未知错误';
            new Notice(`生成图片失败：${message}`);
        } finally {
            notice.hide();
            this.isCapturing = false;
        }
    }

    private async copyImageToClipboard(): Promise<void> {
        await this.withCaptureNotice(async () => {
            const blob = await this.captureToBlob();

            if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]);
                new Notice('图片已复制到剪贴板');
                return;
            }

            this.downloadBlob(blob, this.buildDefaultFileName());
            new Notice('当前环境不支持图片剪贴板，已下载 PNG 文件');
        });
    }

    private async saveImageToVault(): Promise<void> {
        await this.withCaptureNotice(async () => {
            const blob = await this.captureToBlob();
            const fileName = this.buildDefaultFileName();
            const customPath = this.options.screenshotFolder?.trim() ?? '';
            const folderPath = customPath.length > 0
                ? customPath
                : DEFAULT_SCREENSHOT_FOLDER;
            const folder = this.app.vault.getAbstractFileByPath(folderPath);

            if (!folder) {
                await this.app.vault.createFolder(folderPath);
            } else if (!(folder instanceof TFolder)) {
                throw new Error(`${folderPath} 已存在且不是文件夹`);
            }

            const filePath = `${folderPath}/${fileName}`;
            const buffer = await blob.arrayBuffer();
            const createdFile = await this.app.vault.createBinary(filePath, buffer);
            new Notice(`图片已保存: ${fileName}`);

            const leaf = this.app.workspace.getLeaf('tab');
            if (leaf) {
                await leaf.openFile(createdFile);
            }

            this.close();
        });
    }

    private downloadBlob(blob: Blob, fileName: string): void {
        const linkEl = createEl('a');
        const blobUrl = URL.createObjectURL(blob);
        linkEl.href = blobUrl;
        linkEl.download = fileName;
        linkEl.click();

        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }
}

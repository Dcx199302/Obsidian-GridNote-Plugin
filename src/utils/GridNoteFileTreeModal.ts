import { type App, Modal, TFile, TFolder, type TAbstractFile, type EventRef } from 'obsidian';
import type GridNotePlugin from '../main';
import FileExplorerTree from '../components/fileTree/FileExplorerTree.svelte';
import { VaultTreeStore } from '../components/fileTree/vaultTreeStore';
import { parentPathOf, removeChild, renameChild, moveChild, moveFolderTree } from './fileTreeSortStorage';
import { useCustomModalHeader } from './modalHeader';

/**
 * 全局文件树浏览器弹框
 * 使用 CardTree 组件渲染 Vault 文件结构
 */
export class GridNoteFileTreeModal extends Modal {
	private component: FileExplorerTree | null = null;
	private eventRefs: EventRef[] = [];

	private readonly plugin: GridNotePlugin;

	constructor(app: App, plugin: GridNotePlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		this.modalEl.addClass('gridnote-file-tree-modal');
		useCustomModalHeader(this);
		this.contentEl.empty();

		// 直接设置 Modal 尺寸（不依赖 styles.css 选择器）
		this.modalEl.style.width = '85vw';
		// this.modalEl.style.maxWidth = '1400px';
		this.modalEl.style.minWidth = '600px';
		this.modalEl.style.height = '85vh';
		this.modalEl.style.maxHeight = '1000px';
		this.modalEl.style.display = 'flex';
		this.modalEl.style.flexDirection = 'column';
		this.contentEl.style.flex = '1';
		this.contentEl.style.overflow = 'hidden';
		this.contentEl.style.display = 'flex';
		this.contentEl.style.flexDirection = 'column';
		// 去除 modal 默认 padding，由 header/container 自行控制内边距（header 更紧凑贴边）
		this.modalEl.style.padding = '0';

		const vaultName = this.app.vault.getName();
		const store = new VaultTreeStore();
		const { initialNodes } = store.loadFromVault(this.app, this.app.vault.getRoot());
		const activeFilePath = this.app.workspace.getActiveFile()?.path ?? null;

		this.component = new FileExplorerTree({
			target: this.contentEl,
			props: {
				store,
				initialNodes,
				app: this.app,
				vaultName,
				activeFilePath,
				maxVisibleLayers: this.plugin.settings.fileTreeMaxVisibleLayers,
				onOpenFile: (path: string) => this.handleOpenFile(path),
				onClose: () => this.close(),
			},
		});

		this.registerVaultEvents();
	}

	onClose(): void {
		this.unregisterVaultEvents();
		this.component?.markClosing();
		this.component?.$destroy();
		this.component = null;
		this.contentEl.empty();
	}

	private registerVaultEvents(): void {
		this.eventRefs.push(
			// 新建：不动 order（新文件/文件夹按默认规则排到末尾，符合预期）
			this.app.vault.on('create', (file: TAbstractFile) => {
				if (!this.component) return;
				const isFolder = file instanceof TFolder;
				this.component.handleVaultCreate(file.path, isFolder);
			}),
			// 删除：从父 order 移除该 name（folder/file 两套都清，避免残留幽灵）
			this.app.vault.on('delete', (file: TAbstractFile) => {
				const parent = parentPathOf(file.path);
				removeChild(this.app, parent, 'folder', file.name);
				removeChild(this.app, parent, 'file', file.name);
				if (!this.component) return;
				const isFolder = file instanceof TFolder;
				this.component.handleVaultDelete(file.path, isFolder);
			}),
			// 改名/移动：同步 order 里的 name 与（文件夹的）子树 key 前缀
			this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				const oldParent = parentPathOf(oldPath);
				const newParent = parentPathOf(file.path);
				const oldName = oldPath.substring(oldPath.lastIndexOf('/') + 1);
				const newName = file.name;
				const kind = (file instanceof TFolder ? 'folder' : 'file') as 'folder' | 'file';

				if (file instanceof TFolder) {
					// 文件夹移动/改名：迁移子树 key（oldPath → file.path，含所有后代路径）
					moveFolderTree(this.app, oldPath, file.path);
				}
				// 同步父级 order 里的 name
				if (oldParent === newParent) {
					renameChild(this.app, oldParent, kind, oldName, newName);
				} else {
					// 跨目录：先在旧父改名，再从旧父移到新父（覆盖移动+改名两种情况）
					renameChild(this.app, oldParent, kind, oldName, newName);
					moveChild(this.app, oldParent, newParent, kind, newName);
				}
				if (!this.component) return;
				const isFolder = file instanceof TFolder;
				this.component.handleVaultRename(oldPath, file.path, isFolder);
			}),
		);
	}

	private unregisterVaultEvents(): void {
		for (const ref of this.eventRefs) {
			this.app.vault.offref(ref);
		}
		this.eventRefs = [];
	}

	private async handleOpenFile(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.app.workspace.getLeaf(false).openFile(file);
			this.close();
		}
	}
}

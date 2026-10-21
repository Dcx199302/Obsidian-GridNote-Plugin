import { writable, type Readable } from 'svelte/store';
import type { CardTreeNode, CardTreeRef } from '@xuchengdong/cardtree-svelte';
import { TFile, TFolder, type App, type TAbstractFile } from 'obsidian';
import type { StableFolderNode, FolderCardData, VaultFileEntry } from './fileTreeTypes';
import { sortChildren } from './vaultTreeAdapter';
import { readSortOrder, setOrder, type FileTreeSortData } from '../../utils/fileTreeSortStorage';
import { ROOT_FOLDER_ID } from './fileDnd/fileSelectionStore';

export type RootFilesReadable = Readable<VaultFileEntry[]>;

export interface VaultTreeStoreSnapshot {
	rootFiles: VaultFileEntry[];
}

/**
 * 文件树虚拟数据层：stableId 与 vault 路径解耦，
 * rename/move 时只更新 path/name 不销毁节点 → CardTree 折叠/选中状态保留。
 * 所有 vault 事件走增量 CardTree API，绕开 setNodes 的 SiblingMatcher 身份匹配陷阱。
 */
export class VaultTreeStore implements Readable<VaultTreeStoreSnapshot> {
	private stableTree: StableFolderNode[] = [];
	private pathToStableId = new Map<string, string>();
	private rootFilesValue: VaultFileEntry[] = [];
	private idCounter = 0;
	private cardTreeRef: CardTreeRef | null = null;
	/** 跨文件夹拖拽（reparent）期间的抑制标志。由 FileExplorerTree.handleFolderDrop 在
	 *  return true 前置位，moveVaultItem.finally 里重置。
	 *
	 *  必须同时保护三处全量覆盖路径（漏一处都会让 FLIP 动画失效）：
	 *  1) FileExplorerTree 的 $: 块 → setNodesPreserveCollapse
	 *  2) handleVaultRename → syncRefreshNodes
	 *  3) 本类 applyFolderRename 的 moveNode/updateNode
	 *  原因：CardTree 的 ctx.moveNode 已把节点放到正确位置并触发 FLIP，此处再用旧 stableTree
	 *  覆盖会让 first/last 位置相同、delta=0，动画不触发。rename 事件改走增量更新即可。 */
	suppressCardTreeMove = false;
	private readonly rootFilesStore = writable<VaultFileEntry[]>([]);
	private readonly snapshotStore = writable<VaultTreeStoreSnapshot>({ rootFiles: [] });
	/** loadFromVault 注入，供文件排序持久化使用 */
	private app!: App;

	subscribe = this.snapshotStore.subscribe;

	get rootFiles(): RootFilesReadable {
		return this.rootFilesStore;
	}

	bindCardTree(ref: CardTreeRef): void {
		this.cardTreeRef = ref;
	}

	unbindCardTree(): void {
		this.cardTreeRef = null;
	}

	loadFromVault(app: App, root: TFolder): { initialNodes: CardTreeNode<FolderCardData>[] } {
		this.idCounter = 0;
		this.app = app;
		this.stableTree = [];
		this.pathToStableId.clear();
		this.rootFilesValue = [];

		const order = readSortOrder(app);
		const visibleChildren = sortChildren(
			root.children.filter(c => !shouldSkip(c)),
			'',
			order,
		);

		for (const child of visibleChildren) {
			if (child instanceof TFolder) {
				this.stableTree.push(this.buildStableNode(child, order));
			} else if (child instanceof TFile) {
				this.rootFilesValue.push(fileToEntry(child));
			}
		}

		this.pushRootFilesUpdate();
		this.pushSnapshot();

		return {
			initialNodes: this.stableTree.map(n => this.toCardTreeNode(n)),
		};
	}

	getFullCardTreeNodes(): CardTreeNode<FolderCardData>[] {
		return this.stableTree.map(n => this.toCardTreeNode(n));
	}

	applyCreate(path: string, isFolder: boolean): void {
		if (isFolder) {
			this.applyFolderCreate(path);
		} else {
			this.applyFileCreate(path);
		}
	}

	applyDelete(path: string, isFolder: boolean): void {
		if (isFolder) {
			this.applyFolderDelete(path);
		} else {
			this.applyFileDelete(path);
		}
	}

	applyRename(oldPath: string, newPath: string, isFolder: boolean): void {
		if (isFolder) {
			this.applyFolderRename(oldPath, newPath);
		} else {
			this.applyFileRename(oldPath, newPath);
		}
	}

	/**
	 * 只更新 stableTree + 持久化，不调 cardTreeRef.moveNode。
	 * 调用方应从 onDrop 返回 true，让 CardTree 自己执行 moveNode + FLIP 动画。
	 */
	applyReorder(
		parentStableId: string | null,
		dragStableId: string,
		refStableId: string | null,
		position: 'before' | 'after' | 'first-child' | 'last-child',
	): boolean {
		const siblings = parentStableId === null
			? this.stableTree
			: this.findStableNode(parentStableId)?.children ?? null;

		if (!siblings) {
			return false;
		}

		const dragIndex = siblings.findIndex(n => n.stableId === dragStableId);
		if (dragIndex < 0) {
			return false;
		}

		const spliced = siblings.splice(dragIndex, 1);
		const moved = spliced[0];
		if (!moved) return false;

		let insertAt: number;
		if (position === 'last-child' || refStableId === null) {
			insertAt = siblings.length;
		} else if (position === 'first-child') {
			insertAt = 0;
		} else {
			const refIdx = siblings.findIndex(n => n.stableId === refStableId);
			insertAt = refIdx < 0
				? siblings.length
				: position === 'before' ? refIdx : refIdx + 1;
		}
		siblings.splice(insertAt, 0, moved);

		return true;
	}
	/**
	 * 文件重排：更新 files 顺序并触发重渲染（调用方做 FLIP）。
	 * ROOT_FOLDER_ID 操作根散文件，其余按 stableId 查文件夹。
 */
	applyFileReorder(
		folderId: string,
		dragPaths: string[],
		refPath: string | null,
		position: 'before' | 'after',
	): boolean {
		if (dragPaths.length === 0) return false;
		const dragSet = new Set(dragPaths);

		if (folderId === ROOT_FOLDER_ID) {
			const remaining = this.rootFilesValue.filter((f) => !dragSet.has(f.path));
			const moved = this.rootFilesValue.filter((f) => dragSet.has(f.path));
			let insertAt: number;
			if (refPath === null || position === 'after') {
				const refIdx = refPath === null ? -1 : remaining.findIndex((f) => f.path === refPath);
				insertAt = refIdx < 0 ? remaining.length : refIdx + 1;
			} else {
				const refIdx = remaining.findIndex((f) => f.path === refPath);
				insertAt = refIdx < 0 ? remaining.length : refIdx;
			}
			remaining.splice(insertAt, 0, ...moved);
			this.rootFilesValue = remaining;
			// 持久化新顺序（全量覆盖，自动同步删除/新增）
			setOrder(this.app, '', 'file', remaining.map((f) => f.name));
			this.pushRootFilesUpdate();
			return true;
		}

		const node = this.findStableNode(folderId);
		if (!node) return false;
		const remaining = node.files.filter((f) => !dragSet.has(f.path));
		const moved = node.files.filter((f) => dragSet.has(f.path));
		let insertAt: number;
		if (refPath === null || position === 'after') {
			const refIdx = refPath === null ? -1 : remaining.findIndex((f) => f.path === refPath);
			insertAt = refIdx < 0 ? remaining.length : refIdx + 1;
		} else {
			const refIdx = remaining.findIndex((f) => f.path === refPath);
			insertAt = refIdx < 0 ? remaining.length : refIdx;
		}
		remaining.splice(insertAt, 0, ...moved);
		node.files = remaining;
		setOrder(this.app, node.path, 'file', remaining.map((f) => f.name));
		if (this.cardTreeRef) {
			this.cardTreeRef.updateNode(folderId, {
				data: this.folderDataOf(node),
			});
		}
		return true;
	}

	findParentStableId(nodeStableId: string): string | null {
		const result = this.findParentStableIdInList(this.stableTree, nodeStableId, null);
		return result === undefined ? null : result;
	}

	setSearchNodes(nodes: CardTreeNode<FolderCardData>[]): void {
		if (!this.cardTreeRef) {
			return;
		}
		this.cardTreeRef.setNodes(nodes);
		if (nodes.length > 0) {
			this.cardTreeRef.expandAll();
		}
	}

	/** 仅替换数据，不触发 expandAll（保留当前折叠状态）。用于非搜索态刷新数据源 */
	setNodesPreserveCollapse(nodes: CardTreeNode<FolderCardData>[]): void {
		this.cardTreeRef?.setNodes(nodes);
	}

	findStableNode(stableId: string): StableFolderNode | null {
		return this.findStableNodeInList(this.stableTree, stableId);
	}

	findStableNodeByPath(path: string): StableFolderNode | null {
		const stableId = this.pathToStableId.get(path);
		if (!stableId) {
			return null;
		}
		return this.findStableNode(stableId);
	}

	/** 顶层 stable 节点（vault 根目录的文件夹）。reparent 到根时用于计算兄弟顺序 */
	getTopLevelStableNodes(): StableFolderNode[] {
		return this.stableTree;
	}

	getRootFiles(): VaultFileEntry[] {
		return [...this.rootFilesValue];
	}

	private buildStableNode(folder: TFolder, order: FileTreeSortData): StableFolderNode {
		const stableId = this.nextStableId();
		const visibleChildren = sortChildren(
			folder.children.filter(c => !shouldSkip(c)),
			folder.path,
			order,
		);

		const files: VaultFileEntry[] = [];
		const children: StableFolderNode[] = [];

		for (const child of visibleChildren) {
			if (child instanceof TFolder) {
				children.push(this.buildStableNode(child, order));
			} else if (child instanceof TFile) {
				files.push(fileToEntry(child));
			}
		}

		this.pathToStableId.set(folder.path, stableId);

		return {
			stableId,
			path: folder.path,
			name: folder.name,
			files,
			children,
		};
	}

	private toCardTreeNode(node: StableFolderNode): CardTreeNode<FolderCardData> {
		return {
			id: node.stableId,
			label: node.name,
			content: node.files.length > 0 ? `${node.files.length}` : '',
			data: {
				path: node.path,
				folderName: node.name,
				files: [...node.files],
			},
			children: node.children.map(c => this.toCardTreeNode(c)),
		};
	}

	private nextStableId(): string {
		this.idCounter += 1;
		return `gn-${this.idCounter}`;
	}

	private applyFolderCreate(path: string): void {
		if (this.pathToStableId.has(path)) {
			return;
		}

		const parentPath = parentPathOf(path);
		const folderName = basenameOf(path);

		if (parentPath === '') {
			const stableId = this.nextStableId();
			const newNode: StableFolderNode = {
				stableId, path, name: folderName, files: [], children: [],
			};
			this.stableTree.push(newNode);
			this.pathToStableId.set(path, stableId);

			if (this.cardTreeRef) {
				this.cardTreeRef.addNode(null, this.toCardTreeNode(newNode), 'last-child');
			}
			return;
		}

		const parent = this.findStableNodeByPath(parentPath);
		if (!parent) {
			return;
		}

		const stableId = this.nextStableId();
		const newNode: StableFolderNode = {
			stableId, path, name: folderName, files: [], children: [],
		};
		parent.children.push(newNode);
		this.pathToStableId.set(path, stableId);

		if (this.cardTreeRef) {
			this.cardTreeRef.addNode(parent.stableId, this.toCardTreeNode(newNode), 'last-child');
		}
	}

	private applyFileCreate(path: string): void {
		const parentPath = parentPathOf(path);
		const entry: VaultFileEntry = entryFromPath(path);

		if (parentPath === '') {
			if (this.rootFilesValue.some(f => f.path === path)) {
				return;
			}
			this.rootFilesValue.push(entry);
			this.pushRootFilesUpdate();
			return;
		}

		const parent = this.findStableNodeByPath(parentPath);
		if (!parent || parent.files.some(f => f.path === path)) {
			return;
		}
		parent.files.push(entry);

		if (this.cardTreeRef) {
			this.cardTreeRef.updateNode(parent.stableId, {
				data: this.folderDataOf(parent),
				content: parent.files.length > 0 ? `${parent.files.length}` : '',
			});
		}
	}

	private applyFolderDelete(path: string): void {
		const stableId = this.pathToStableId.get(path);
		if (!stableId) {
			return;
		}

		const node = this.findStableNode(stableId);
		if (node) {
			this.removeAllPathMappings(node);
		}

		const parentPath = parentPathOf(path);

		if (parentPath === '') {
			const idx = this.stableTree.findIndex(n => n.stableId === stableId);
			if (idx >= 0) {
				this.stableTree.splice(idx, 1);
			}
		} else {
			const parent = this.findStableNodeByPath(parentPath);
			if (parent) {
				const idx = parent.children.findIndex(n => n.stableId === stableId);
				if (idx >= 0) {
					parent.children.splice(idx, 1);
				}
			}
		}

		if (this.cardTreeRef) {
			this.cardTreeRef.removeNode(stableId);
		}
	}

	private applyFileDelete(path: string): void {
		const parentPath = parentPathOf(path);

		if (parentPath === '') {
			const idx = this.rootFilesValue.findIndex(f => f.path === path);
			if (idx >= 0) {
				this.rootFilesValue.splice(idx, 1);
				this.pushRootFilesUpdate();
			}
			return;
		}

		const parent = this.findStableNodeByPath(parentPath);
		if (!parent) {
			return;
		}
		const idx = parent.files.findIndex(f => f.path === path);
		if (idx < 0) {
			return;
		}
		parent.files.splice(idx, 1);

		if (this.cardTreeRef) {
			this.cardTreeRef.updateNode(parent.stableId, {
				data: this.folderDataOf(parent),
				content: parent.files.length > 0 ? `${parent.files.length}` : '',
			});
		}
	}

	private applyFolderRename(oldPath: string, newPath: string): void {
		const stableId = this.pathToStableId.get(oldPath);
		if (!stableId) {
			return;
		}

		const node = this.findStableNode(stableId);
		if (!node) {
			return;
		}

		const oldParentPath = parentPathOf(oldPath);
		const newParentPath = parentPathOf(newPath);
		const newName = basenameOf(newPath);
		const isSameParent = oldParentPath === newParentPath;

		this.pathToStableId.delete(oldPath);
		this.updateDescendantPaths(node, oldPath, newPath);
		node.path = newPath;
		node.name = newName;
		this.pathToStableId.set(newPath, stableId);

		if (isSameParent) {
			if (this.cardTreeRef) {
				this.cardTreeRef.updateNode(stableId, {
					label: newName,
					data: this.folderDataOf(node),
				});
			}
		} else {
			const newParent = newParentPath === ''
				? null
				: this.findStableNodeByPath(newParentPath);

			if (oldParentPath === '') {
				const idx = this.stableTree.findIndex(n => n.stableId === stableId);
				if (idx >= 0) {
					this.stableTree.splice(idx, 1);
				}
			} else {
				const oldParent = this.findStableNodeByPath(oldParentPath);
				if (oldParent) {
					const idx = oldParent.children.findIndex(n => n.stableId === stableId);
					if (idx >= 0) {
						oldParent.children.splice(idx, 1);
					}
				}
			}

			if (newParentPath === '') {
				this.stableTree.push(node);
			} else if (newParent) {
				newParent.children.push(node);
			} else {
				this.stableTree.push(node);
			}

			if (this.cardTreeRef) {
				const targetParentId = newParentPath === ''
					? null
					: newParent?.stableId ?? null;
				if (!this.suppressCardTreeMove) {
					this.cardTreeRef.moveNode(stableId, targetParentId, 'last-child');
					this.cardTreeRef.updateNode(stableId, {
						label: newName,
						data: this.folderDataOf(node),
					});
				}
			}
		}
	}

	private applyFileRename(oldPath: string, newPath: string): void {
		const oldParentPath = parentPathOf(oldPath);
		const newParentPath = parentPathOf(newPath);

		if (oldParentPath === '' && newParentPath === '') {
			const idx = this.rootFilesValue.findIndex(f => f.path === oldPath);
			if (idx >= 0) {
				this.rootFilesValue[idx] = entryFromPath(newPath);
				this.pushRootFilesUpdate();
			}
			return;
		}

		if (oldParentPath === '' && newParentPath !== '') {
			const idx = this.rootFilesValue.findIndex(f => f.path === oldPath);
			if (idx >= 0) {
				this.rootFilesValue.splice(idx, 1);
				this.pushRootFilesUpdate();
			}
			const newParent = this.findStableNodeByPath(newParentPath);
			if (newParent && !newParent.files.some(f => f.path === newPath)) {
				newParent.files.push(entryFromPath(newPath));
				if (this.cardTreeRef) {
					this.cardTreeRef.updateNode(newParent.stableId, {
						data: this.folderDataOf(newParent),
						content: newParent.files.length > 0 ? `${newParent.files.length}` : '',
					});
				}
			}
			return;
		}

		if (oldParentPath !== '' && newParentPath === '') {
			const oldParent = this.findStableNodeByPath(oldParentPath);
			if (oldParent) {
				const idx = oldParent.files.findIndex(f => f.path === oldPath);
				if (idx >= 0) {
					oldParent.files.splice(idx, 1);
					if (this.cardTreeRef) {
						this.cardTreeRef.updateNode(oldParent.stableId, {
							data: this.folderDataOf(oldParent),
							content: oldParent.files.length > 0 ? `${oldParent.files.length}` : '',
						});
					}
				}
			}
			if (!this.rootFilesValue.some(f => f.path === newPath)) {
				this.rootFilesValue.push(entryFromPath(newPath));
				this.pushRootFilesUpdate();
			}
			return;
		}

		if (oldParentPath === newParentPath) {
			const parent = this.findStableNodeByPath(oldParentPath);
			if (!parent) {
				return;
			}
			const idx = parent.files.findIndex(f => f.path === oldPath);
			if (idx >= 0) {
				parent.files[idx] = entryFromPath(newPath);
				if (this.cardTreeRef) {
					this.cardTreeRef.updateNode(parent.stableId, {
						data: this.folderDataOf(parent),
					});
				}
			}
			return;
		}

		const oldParent = this.findStableNodeByPath(oldParentPath);
		if (oldParent) {
			const idx = oldParent.files.findIndex(f => f.path === oldPath);
			if (idx >= 0) {
				oldParent.files.splice(idx, 1);
				if (this.cardTreeRef) {
					this.cardTreeRef.updateNode(oldParent.stableId, {
						data: this.folderDataOf(oldParent),
						content: oldParent.files.length > 0 ? `${oldParent.files.length}` : '',
					});
				}
			}
		}
		const newParent = this.findStableNodeByPath(newParentPath);
		if (newParent && !newParent.files.some(f => f.path === newPath)) {
			newParent.files.push(entryFromPath(newPath));
			if (this.cardTreeRef) {
				this.cardTreeRef.updateNode(newParent.stableId, {
					data: this.folderDataOf(newParent),
					content: newParent.files.length > 0 ? `${newParent.files.length}` : '',
				});
			}
		}
	}

	private updateDescendantPaths(node: StableFolderNode, oldPrefix: string, newPrefix: string): void {
		// 直属文件路径同步迁移（files 不进 pathToStableId，只改 path 字段）。
		// 否则文件夹移动后 Obsidian 会为每个内部文件补发 rename 事件，
		// applyFileRename 跨父分支的去重检查 f.path===newPath 会因旧路径残留而误判为「不存在」→ 推送重复条目。
		for (const f of node.files) {
			f.path = newPrefix + f.path.slice(oldPrefix.length);
		}
		for (const child of node.children) {
			const oldChildPath = child.path;
			child.path = newPrefix + oldChildPath.slice(oldPrefix.length);
			this.pathToStableId.delete(oldChildPath);
			this.pathToStableId.set(child.path, child.stableId);
			if (this.cardTreeRef) {
				this.cardTreeRef.updateNode(child.stableId, {
					data: this.folderDataOf(child),
				});
			}
			this.updateDescendantPaths(child, oldPrefix, newPrefix);
		}
	}

	private removeAllPathMappings(node: StableFolderNode): void {
		this.pathToStableId.delete(node.path);
		for (const child of node.children) {
			this.removeAllPathMappings(child);
		}
	}

	private findStableNodeInList(nodes: StableFolderNode[], stableId: string): StableFolderNode | null {
		for (const node of nodes) {
			if (node.stableId === stableId) {
				return node;
			}
			const found = this.findStableNodeInList(node.children, stableId);
			if (found) {
				return found;
			}
		}
		return null;
	}

	private findParentStableIdInList(
		nodes: StableFolderNode[],
		targetId: string,
		parentId: string | null,
	): string | null | undefined {
		for (const node of nodes) {
			if (node.stableId === targetId) {
				return parentId;
			}
			const found = this.findParentStableIdInList(node.children, targetId, node.stableId);
			if (found !== undefined) {
				return found;
			}
		}
		return undefined;
	}

	private pushRootFilesUpdate(): void {
		this.rootFilesStore.set([...this.rootFilesValue]);
	}

	private pushSnapshot(): void {
		this.snapshotStore.set({ rootFiles: [...this.rootFilesValue] });
	}

	private folderDataOf(node: StableFolderNode): FolderCardData {
		return {
			path: node.path,
			folderName: node.name,
			files: [...node.files],
		};
	}
}

function shouldSkip(file: TAbstractFile): boolean {
	return file.name.startsWith('.') || file.name === '.obsidian';
}

function fileToEntry(file: TFile): VaultFileEntry {
	return {
		path: file.path,
		name: file.name,
		basename: file.basename,
		extension: file.extension,
	};
}

function entryFromPath(path: string): VaultFileEntry {
	const name = basenameOf(path);
	const dotIdx = name.lastIndexOf('.');
	const hasExt = dotIdx > 0 && dotIdx < name.length - 1;
	return {
		path,
		name,
		basename: hasExt ? name.slice(0, dotIdx) : name,
		extension: hasExt ? name.slice(dotIdx + 1) : '',
	};
}

function basenameOf(path: string): string {
	const idx = path.lastIndexOf('/');
	return idx < 0 ? path : path.slice(idx + 1);
}

function parentPathOf(path: string): string {
	const idx = path.lastIndexOf('/');
	return idx < 0 ? '' : path.slice(0, idx);
}

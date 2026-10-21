import { TFile, TFolder, type App, type TAbstractFile } from 'obsidian';
import type { CardTreeNode } from '@xuchengdong/cardtree-svelte';
import type { FolderCardData, VaultFileEntry } from './fileTreeTypes';
import { readSortOrder, type FileTreeSortData } from '../../utils/fileTreeSortStorage';

/** 判断是否应跳过该文件/文件夹（隐藏文件、配置目录等） */
function shouldSkip(file: TAbstractFile, configDir: string): boolean {
	return file.name.startsWith('.') || file.name === configDir;
}

/**
 * 比较两个同类子项的顺序：在自定义 order 内的按 index 排，且 order 内的优先于 order 外的；
 * order 缺失或两者都不在 order 内时，降级为名称忽略大小写字母序。
 */
function compareByOrder(aName: string, bName: string, order: string[] | undefined): number {
	if (Array.isArray(order) && order.length > 0) {
		const aIdx = order.indexOf(aName);
		const bIdx = order.indexOf(bName);
		if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
		if (aIdx >= 0) return -1;
		if (bIdx >= 0) return 1;
	}
	return aName.localeCompare(bName, undefined, { sensitivity: 'base' });
}

/**
 * 排序：文件夹优先；同类内按 parentPath 的自定义 order（folder/file 各一套）排，
 * order 缺失/超出的降级为字母序。
 */
export function sortChildren(
	children: TAbstractFile[],
	parentPath: string,
	order: FileTreeSortData,
): TAbstractFile[] {
	const folderOrder = order.folder[parentPath];
	const fileOrder = order.file[parentPath];
	return [...children].sort((a, b) => {
		const aIsFolder = a instanceof TFolder;
		const bIsFolder = b instanceof TFolder;
		if (aIsFolder !== bIsFolder) {
			return aIsFolder ? -1 : 1;
		}
		return aIsFolder
			? compareByOrder(a.name, b.name, folderOrder)
			: compareByOrder(a.name, b.name, fileOrder);
	});
}

/** TFile → VaultFileEntry */
function fileToEntry(file: TFile): VaultFileEntry {
	return {
		path: file.path,
		name: file.name,
		basename: file.basename,
		extension: file.extension,
	};
}

/**
 * 将单个文件夹转换为卡片节点
 * - label = 文件夹名（卡片标题）
 * - content = 文件数量标记（让 hasContent=true，使折叠按钮显示）
 * - data.files = 文件夹直属文件（卡片内容）
 * - children = 子文件夹（嵌套卡片）
 */
function folderToCardNode(folder: TFolder, order: FileTreeSortData, configDir: string): CardTreeNode<FolderCardData> {
	const visibleChildren = sortChildren(folder.children.filter(c => !shouldSkip(c, configDir)), folder.path, order);
	const files: VaultFileEntry[] = [];
	const subfolders: TFolder[] = [];

	for (const child of visibleChildren) {
		if (child instanceof TFolder) {
			subfolders.push(child);
		} else if (child instanceof TFile) {
			files.push(fileToEntry(child));
		}
	}

	return {
		id: folder.path,
		label: folder.name,
		// 有文件时设置非空 content，使 cardtree 判定 hasContent=true → 显示折叠按钮
		// （实际内容由 node-content 插槽渲染，此字符串不显示）
		content: files.length > 0 ? `${files.length}` : '',
		data: {
			path: folder.path,
			folderName: folder.name,
			files,
		},
		children: subfolders.map(sub => folderToCardNode(sub, order, configDir)),
	};
}

/**
 * vault 卡片树数据：cardtree 数据（folderNodes，仅真实文件夹）与根目录散文件（rootFiles）分离。
 * 根目录散文件不进 cardtree，由上层渲染为独立卡片（见 FileExplorerTree.svelte）。
 */
export interface VaultCardTreeData {
	/** 真实文件夹卡片树（喂给 CardTree） */
	folderNodes: CardTreeNode<FolderCardData>[];
	/** vault 根目录下散落的文件（喂给独立"根目录"卡片，不进 cardtree） */
	rootFiles: VaultFileEntry[];
}

/**
 * 将整个 Vault 转换为卡片树数据：
 * - 顶层文件夹 → folderNodes（真实卡片树，cardtree 渲染）
 * - 根目录散落文件 → rootFiles（独立卡片渲染，不参与 cardtree）
 */
export function vaultToCardTree(app: App, root: TFolder, _vaultName: string): VaultCardTreeData {
	const order = readSortOrder(app);
	const visibleChildren = sortChildren(root.children.filter(c => !shouldSkip(c, app.vault.configDir)), '', order);
	const folderNodes: CardTreeNode<FolderCardData>[] = [];
	const rootFiles: VaultFileEntry[] = [];

	for (const child of visibleChildren) {
		if (child instanceof TFolder) {
			folderNodes.push(folderToCardNode(child, order, app.vault.configDir));
		} else if (child instanceof TFile) {
			rootFiles.push(fileToEntry(child));
		}
	}

	return { folderNodes, rootFiles };
}

/**
 * 按查询过滤卡片树（搜索即过滤，保持匹配路径的嵌套结构）：
 * - 匹配字段：文件夹仅 folderName，文件仅 basename（不含扩展名，避免"搜 md 命中全部 md"）
 * - 文件夹名匹配 query → 节点保留，直属文件全保留；但子文件夹仍递归剪枝
 * - 文件夹名不匹配 → 仅保留 basename 命中的直属文件，并递归过滤子文件夹；
 *   祖先文件夹若子树有匹配则保留为骨架以维持嵌套；完全无匹配的分支被丢弃。
 */
export function filterCardTree(nodes: CardTreeNode<FolderCardData>[], query: string): CardTreeNode<FolderCardData>[] {
	const q = query.trim().toLowerCase();
	if (!q) return nodes;
	return nodes
		.map(node => filterNode(node, q))
		.filter((n): n is CardTreeNode<FolderCardData> => n !== null);
}

/**
 * 文件夹直属文件的搜索过滤规则（filterNode 与渲染层 getFolderData 共用，保证一致）：
 * - query 为空 → 原样返回
 * - 文件夹名命中 query → 直属文件全保留
 * - 文件夹名未命中 → 仅保留 basename 命中的文件
 */
export function filterDirectFiles(folderName: string, files: VaultFileEntry[], query: string): VaultFileEntry[] {
	const q = query.trim().toLowerCase();
	if (!q) return files;
	if (folderName.toLowerCase().includes(q)) return [...files];
	return files.filter(f => f.basename.toLowerCase().includes(q));
}

function filterNode(node: CardTreeNode<FolderCardData>, q: string): CardTreeNode<FolderCardData> | null {
	const data = node.data;
	if (!data) return null;

	// 文件夹名匹配 → 节点保留（不丢），直属文件全保留；子文件夹仍递归剪枝
	if (data.folderName.toLowerCase().includes(q)) {
		const filteredChildren = node.children
			.map(c => filterNode(c, q))
			.filter((c): c is CardTreeNode<FolderCardData> => c !== null);
		return {
			...node,
			data: { ...data, files: filterDirectFiles(data.folderName, data.files, q) },
			children: filteredChildren,
		};
	}

	// 文件夹名不匹配 → 仅保留 basename 命中的直属文件，并递归过滤子文件夹
	const matchedFiles = filterDirectFiles(data.folderName, data.files, q);
	const filteredChildren = node.children
		.map(c => filterNode(c, q))
		.filter((c): c is CardTreeNode<FolderCardData> => c !== null);

	// 无匹配文件且无匹配子树 → 丢弃
	if (matchedFiles.length === 0 && filteredChildren.length === 0) return null;

	return {
		...node,
		data: { ...data, files: matchedFiles },
		content: matchedFiles.length > 0 ? `${matchedFiles.length}` : '',
		children: filteredChildren,
	};
}

/**
 * 过滤根目录散文件：仅按 basename 匹配 query（与 filterNode 内文件匹配规则一致，不含扩展名）。
 * 根目录散文件不进 cardtree，搜索时由上层独立卡片据此渲染匹配项。
 */
export function filterRootFiles(rootFiles: VaultFileEntry[], query: string): VaultFileEntry[] {
	const q = query.trim().toLowerCase();
	if (!q) return rootFiles;
	return rootFiles.filter(f =>
		f.basename.toLowerCase().includes(q),
	);
}

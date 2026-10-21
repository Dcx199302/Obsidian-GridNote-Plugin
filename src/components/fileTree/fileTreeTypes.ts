/**
 * 卡片内单个文件的条目
 */
export interface VaultFileEntry {
	/** 完整 vault 路径 */
	path: string;
	/** 显示名称（含扩展名） */
	name: string;
	/** 不含扩展名 */
	basename: string;
	/** 文件扩展名，如 "md"、"canvas" */
	extension: string;
}

/**
 * 文件夹卡片的附加数据
 * 卡片标题(node.label)=文件夹名，卡片内容(data.files)=文件夹直属文件，子卡片(children)=子文件夹
 */
export interface FolderCardData {
	/** 完整 vault 路径 */
	path: string;
	/** 文件夹名 */
	folderName: string;
	/** 该文件夹直属的文件（不含子文件夹内的文件） */
files: VaultFileEntry[];
}

/** stableId 与 vault 路径解耦，rename/move 不销毁节点 */
export interface StableFolderNode {
	stableId: string;
	path: string;
	name: string;
	files: VaultFileEntry[];
	children: StableFolderNode[];
}

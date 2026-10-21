import { type App, Notice, TFile, normalizePath } from 'obsidian';

/**
 * 捕获第三方插件通过 file-menu 事件注册的菜单项（如 Excalidraw 的"新建绘图文件"）。
 * 核心原理：Obsidian 核心的打开/重命名/删除等原生菜单项不走事件系统，
 * 只有第三方插件（含 Canvas 等内置插件）通过 workspace.on('file-menu') 注册的项才会响应。
 * 用代理 Menu/MenuItem 拦截 addItem 调用，提取 title/icon/onClick。
 */
export interface CapturedMenuItem {
	title: string;
	icon: string | null;
	onClick: (evt: MouseEvent | KeyboardEvent) => void;
}

export function captureFileMenuItems(app: App, folderPath: string): CapturedMenuItem[] {
	const folder = folderPath
		? app.vault.getAbstractFileByPath(folderPath)
		: app.vault.getRoot();
	if (!folder) return [];

	const items: CapturedMenuItem[] = [];

	// MenuItem 代理：记录插件设置的 title/icon/onClick，
	// 用 Proxy catch-all 兼容 setSectionSubmenu 等任意未知方法
	const createItemProxy = () => {
		const captured: CapturedMenuItem = {
			title: '',
			icon: null,
			onClick: () => {},
		};
		const handlers = {
			setTitle(title: unknown) {
				if (typeof title === 'string') {
					captured.title = title;
				} else if (title instanceof DocumentFragment) {
					captured.title = title.textContent ?? '';
				}
				return itemProxy;
			},
			setIcon(icon: string | null) { captured.icon = icon; return itemProxy; },
			onClick(cb: (evt: MouseEvent | KeyboardEvent) => void) {
				captured.onClick = cb;
				return itemProxy;
			},
		};
		// 未知属性返回 no-op 函数，防止插件调用未实现方法时抛 TypeError
		const itemProxy = new Proxy(handlers, {
			get(target, prop) {
				if (prop in target) return (target as any)[prop];
				return () => itemProxy;
			},
		});
		return { itemProxy, captured };
	};

	// Menu 代理：拦截 addItem，收集捕获的菜单项，
	// 同样用 Proxy catch-all 兼容任意未知方法
	const menuProxy: any = new Proxy({
		addItem(cb: (item: any) => any) {
			const { itemProxy, captured } = createItemProxy();
			try { cb(itemProxy); } catch { /* 插件回调异常时跳过该菜单项 */ }
			if (captured.title) items.push(captured);
			return menuProxy;
		},
		addSeparator() { return menuProxy; },
		setNoIcon() { return menuProxy; },
		setUseNativeMenu() { return menuProxy; },
		addClass() { return menuProxy; },
	}, {
		get(target, prop) {
			if (prop in target) return (target as any)[prop];
			return () => menuProxy;
		},
	});

	try {
		(app.workspace as any).trigger('file-menu', menuProxy, folder, 'file-explorer-context-menu');
	} catch { /* 触发事件时出错则忽略 */ }

	return items;
}

/**
 * 在指定父目录下创建新的 Markdown 文件，自动生成不重名的文件名
 */
export async function createFile(app: App, parentPath: string): Promise<TFile | null> {
	const prefix = parentPath === '/' ? '' : parentPath;
	const baseName = 'Untitled';
	const ext = '.md';
	const path = generateAvailablePath(app, prefix, baseName, ext);
	try {
		const file = await app.vault.create(path, '');
		new Notice(`已创建: ${path}`);
		return file;
	} catch (error) {
		new Notice(`创建文件失败: ${(error as Error).message}`);
		return null;
	}
}

/**
 * 创建新文件夹
 */
export async function createFolder(app: App, parentPath: string): Promise<boolean> {
	const prefix = parentPath === '/' ? '' : parentPath;
	const baseName = 'New folder';
	const path = generateAvailablePath(app, prefix, baseName, '');
	try {
		await app.vault.createFolder(path);
		new Notice(`已创建文件夹: ${path}`);
		return true;
	} catch (error) {
		new Notice(`创建文件夹失败: ${(error as Error).message}`);
		return false;
	}
}

/**
 * 重命名文件或文件夹，使用 fileManager.renameFile 自动更新所有链接
 */
export async function renameVaultItem(
	app: App,
	oldPath: string,
	newName: string,
	_isFolder: boolean,
): Promise<boolean> {
	const file = app.vault.getAbstractFileByPath(oldPath);
	if (!file) {
		new Notice('文件不存在');
		return false;
	}

	const lastSlash = oldPath.lastIndexOf('/');
	const parentDir = lastSlash >= 0 ? oldPath.substring(0, lastSlash) : '';
	const newPath = normalizePath(
		parentDir ? `${parentDir}/${newName}` : newName,
	);

	if (newPath === oldPath) {
		return false;
	}

	// 检查目标路径是否已存在
	const existing = app.vault.getAbstractFileByPath(newPath);
	if (existing) {
		new Notice(`"${newName}" 已存在`);
		return false;
	}

	try {
		await app.fileManager.renameFile(file, newPath);
		return true;
	} catch (error) {
		new Notice(`重命名失败: ${(error as Error).message}`);
		return false;
	}
}

/**
 * 删除文件或文件夹，默认使用回收站
 */
export async function deleteVaultItem(
	app: App,
	path: string,
	useTrash: boolean = true,
): Promise<boolean> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!file) {
		new Notice('文件不存在');
		return false;
	}

	try {
		if (useTrash) {
			await app.vault.trash(file, true);
		} else {
			await app.vault.delete(file);
		}
		return true;
	} catch (error) {
		new Notice(`删除失败: ${(error as Error).message}`);
		return false;
	}
}

/**
 * 批量删除文件（默认使用回收站），单个失败不阻断其余
 */
export async function deleteVaultItems(
	app: App,
	paths: string[],
	useTrash: boolean = true,
): Promise<number> {
	let deleted = 0;
	for (const path of paths) {
		const file = app.vault.getAbstractFileByPath(path);
		if (!file) continue;
		try {
			if (useTrash) {
				await app.vault.trash(file, true);
			} else {
				await app.vault.delete(file);
			}
			deleted++;
		} catch {
			// 单个失败不阻断其余
		}
	}
	if (deleted > 0 && deleted < paths.length) {
		new Notice(`已删除 ${deleted}/${paths.length} 项`);
	}
	return deleted;
}

/**
 * 移动文件或文件夹到目标父目录
*/
export async function moveVaultItem(
	app: App,
	sourcePath: string,
	targetParentPath: string,
): Promise<boolean> {
	const file = app.vault.getAbstractFileByPath(sourcePath);
	if (!file) {
		new Notice('文件不存在');
		return false;
	}

	const name = file.name;
	const newPath = normalizePath(
		targetParentPath ? `${targetParentPath}/${name}` : name,
	);

	if (newPath === sourcePath) {
		return false;
	}

	const existing = app.vault.getAbstractFileByPath(newPath);
	if (existing) {
		new Notice(`目标位置已存在 "${name}"`);
		return false;
	}

	try {
		await app.fileManager.renameFile(file, newPath);
		return true;
	} catch (error) {
		new Notice(`移动失败: ${(error as Error).message}`);
		return false;
	}
}

/**
 * 生成不重名的路径（自动追加数字后缀）
 */
function generateAvailablePath(
	app: App,
	parentDir: string,
	baseName: string,
	ext: string,
): string {
	const prefix = parentDir ? `${parentDir}/` : '';
	let path = `${prefix}${baseName}${ext}`;
	let attempt = 1;
	while (app.vault.getAbstractFileByPath(path)) {
		path = `${prefix}${baseName} ${attempt}${ext}`;
		attempt++;
	}
	return path;
}

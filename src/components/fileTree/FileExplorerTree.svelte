<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { CardTree } from '@xuchengdong/cardtree-svelte';
	import type { CardTreeRef, MenuConfig, DropTarget, DropPosition } from '@xuchengdong/cardtree-svelte';
	import type { CardTreeNode } from '@xuchengdong/cardtree-svelte';
	import { Menu, TFile, setIcon, type App } from 'obsidian';
	import FolderCardFiles from './FolderCardFiles.svelte';
	import type { FolderCardData, VaultFileEntry } from './fileTreeTypes';
	import type { VaultTreeStore } from './vaultTreeStore';
	import { filterCardTree, filterRootFiles, filterDirectFiles } from './vaultTreeAdapter';
	import {
		createFile,
		createFolder,
		renameVaultItem,
		deleteVaultItem,
		deleteVaultItems,
		moveVaultItem,
		captureFileMenuItems,
	} from './fileOperations';
	import { reorderTo } from '../../utils/fileTreeSortStorage';
	import { readCollapsedPaths, writeCollapsedPaths } from '../../utils/fileTreeCollapseStorage';
	import { readLastDrillPath, writeLastDrillPath } from '../../utils/fileTreeDrillStorage';
	import { PromptModal, ConfirmModal } from '../../utils/dialogs';
import { createFileSelectionStore } from './fileDnd/fileSelectionStore';
	import { createFileClipboardStore } from './fileDnd/fileClipboardStore';
	import { createFileDndController, moveVaultFiles } from './fileDnd/fileDndController';
	import { createFileDragStore } from './fileDnd/fileDragStore';
	import type { FileDragStore } from './fileDnd/fileDragStore';
	import FileDragOverlay from './components/FileDragOverlay.svelte';

	export let store: VaultTreeStore;
	export let initialNodes: CardTreeNode<FolderCardData>[] = [];
	export let app: App;
	export let vaultName = '';
	export let activeFilePath: string | null = null;
	export let onOpenFile: (path: string) => void;
	export let onClose: () => void;
	/** 可见层级上限（用户可调，默认 5）。实际 visibleLayers 按容器宽度动态收缩，不超过此值。 */
	export let maxVisibleLayers = 5;

	let cardTreeRef: CardTreeRef;
	let containerWidth = 0;
	let query = '';
	let debouncedQuery = '';
	let debounceTimer: ReturnType<typeof setTimeout>;
	let closeBtnEl: HTMLElement;
	let vaultIconEl: HTMLElement;
	let searchInputEl: HTMLInputElement;
	/** 文件选中态：单文件夹内多选（单击/Ctrl/Shift），跨文件夹不联动 */
	const selectionStore = createFileSelectionStore();
	/** 文件剪贴板：剪切/粘贴，弹框关闭后清空 */
	const clipboardStore = createFileClipboardStore();
	/** 文件拖拽编排器，onMount 创建 */
	let dndController: ReturnType<typeof createFileDndController> | null = null;
	const dndDragStore: FileDragStore = createFileDragStore();
	/** 进入搜索态前的折叠节点 id 快照（用 stableId/cardtree id）。搜索期间手动折叠不计入持久化 */
	let preSearchCollapsedIds: Set<string> | null = null;
	/** 当前过滤后的 cardtree 节点数（用于空状态判定） */
	let filteredNodeCount = 0;
	/** 上一次用于过滤的 query（trim 后）。关键字变化时主动回到根目录，避免钻取态残留 */
	let lastFilteredQuery = '';
	/** 折叠状态是否已从持久化恢复（仅首次进入非搜索态执行一次） */
	let initialCollapseRestored = false;
	/** 组件是否正在销毁：销毁期间 cardtree 可能触发 onExpandCollapse(ids=[])，需跳过持久化 */
	let isDestroyed = false;
	/** 内存缓存：当前折叠的 vault 路径列表。handleExpandCollapse 只更新此变量，
	 *  真正的持久化在 markClosing（关闭前同步调用）执行一次，避免 destroy 期间的空回调覆盖存储。 */
	let currentCollapsedPaths: string[] = [];
	/** 跨文件夹拖拽时暂存的落点信息。reparent 返回 true 触发 FLIP 后，
	 *  vault rename 事件的 applyFolderRename 会把节点移到末尾（last-child），
	 *  用此对象在 handleVaultRename 中修正回用户拖放时指定的 before/after 位置。 */
	let pendingReparent: {
		newPath: string;
		targetParentId: string | null;
		position: 'before' | 'after';
		referenceName: string | null;
	} | null = null;

		const rootFilesReadable = store.rootFiles;

		$: {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debouncedQuery = query;
		}, 300);
	}

	$: isSearching = !!debouncedQuery.trim();
	$: rootFilesList = $rootFilesReadable;

	/**
	 * 按容器宽度动态计算可见层级，避免窄容器下深层卡片文件名溢出。
	 * 每层至少预留 perLayerPx（卡片最小宽度 + 缩进/间距），算出层数后再夹到 [2, maxVisibleLayers]。
	 * 宽度未知（首次渲染前）时取 maxVisibleLayers，渲染后 ResizeObserver/bind 会触发重算。
	 */
	const VISIBLE_LAYER_PER_PX = 240; // 单层最小预算：卡片最小内容宽 + 缩进 + gap
	$: visibleLayers = containerWidth > 0
		? Math.max(2, Math.min(maxVisibleLayers, Math.floor(containerWidth / VISIBLE_LAYER_PER_PX)))
		: maxVisibleLayers;
	$: cardTreeConfig = { visibleLayers, maxVisibleLayers };

	$: {
		if (cardTreeRef) {
			if (debouncedQuery.trim()) {
				// 进入搜索态（首次非空）→ 记忆当前折叠快照
				if (preSearchCollapsedIds === null) {
					preSearchCollapsedIds = new Set(cardTreeRef.getCollapsedIds());
				}
				// 关键字变化（含首次进入）→ 主动回到根目录，避免钻取态残留在不相关的过滤结果上
				if (lastFilteredQuery !== debouncedQuery.trim()) {
					cardTreeRef.drillToRoot();
					lastFilteredQuery = debouncedQuery.trim();
				}
				const filtered = filterCardTree(store.getFullCardTreeNodes(), debouncedQuery);
				filteredNodeCount = filtered.length;
				store.setSearchNodes(filtered);
			} else if (preSearchCollapsedIds !== null) {
				// 退出搜索态 → 先恢复完整数据，再按进入前快照还原折叠状态
				filteredNodeCount = store.getFullCardTreeNodes().length;
				store.setSearchNodes(store.getFullCardTreeNodes());
				const snapshot = preSearchCollapsedIds;
				preSearchCollapsedIds = null;
				void restoreCollapseSnapshot(snapshot);
				lastFilteredQuery = '';
			} else if (!store.suppressCardTreeMove) {
				// 非搜索态：仅替换数据源，保留折叠状态（不用 setSearchNodes 的 expandAll，它会清空折叠）
				// suppressCardTreeMove=true 时跳过：reparent 期间不能用旧 stableTree 覆盖 moveNode 结果
				const fullNodes = store.getFullCardTreeNodes();
				filteredNodeCount = fullNodes.length;
				store.setNodesPreserveCollapse(fullNodes);
				// 首次进入非搜索态：恢复持久化的折叠状态（打开时计算一次）
				if (!initialCollapseRestored) {
					const collapsedPaths = readCollapsedPaths(app);
					for (const path of collapsedPaths) {
						const node = store.findStableNodeByPath(path);
						if (node) cardTreeRef.collapseNode(node.stableId);
					}
					// 延迟一帧再恢复 transition：确保 is-collapsed 已渲染到 DOM，
					// 避免 gridnote-ft-initializing 移除与 is-collapsed 添加同帧导致动画闪烁
					requestAnimationFrame(() => {
						initialCollapseRestored = true;
					});
				}
			}
		}
	}

	$: displayedRootFiles = isSearching
		? filterRootFiles(rootFilesList, debouncedQuery)
		: rootFilesList;

	// 统一空状态：根散文件过滤后为空，且 cardtree 过滤结果也为空
	$: hasNoMatch = isSearching
		&& displayedRootFiles.length === 0
		&& filteredNodeCount === 0;

	$: showRootCard = isSearching
		? (displayedRootFiles.length > 0 && !hasNoMatch)
		: !hasNoMatch;

	// 非搜索时始终显示根散文件区段（即使为空），保留放置目标以便从文件夹拖回根目录
	$: if (closeBtnEl) { setIcon(closeBtnEl, 'x'); }
	$: if (vaultIconEl) { setIcon(vaultIconEl, 'vault'); }

	$: dragDropConfig = {
		enabled: true,
		showDragHandle: true,
		autoScroll: true,
		onDragOver: (dragId: string, overId: string, _dropPosition: DropPosition) => {
			if (dragId === overId) return false;
			if (overId.startsWith(dragId + '/')) return false;
			return true;
		},
		onDrop: (dragId: string, dropTarget: DropTarget) => {
			return handleFolderDrop(dragId, dropTarget);
		},
		onDragEnd: (_nodeId: string) => {},
	};

	const menuConfig: MenuConfig = {
		native: true,
		triggers: { contextMenu: true, handleClick: true },
	};


	function getFolderData(nodeId: string): FolderCardData | undefined {
		const node = store.findStableNode(nodeId);
		if (!node) return undefined;
		return {
			path: node.path,
			folderName: node.name,
			// 搜索态：cardtree 的 ViewModelNode 不携带 data，渲染层需自行过滤直属文件。
			// 规则与 filterNode 一致（filterDirectFiles 共用），保证树结构剪枝与文件级过滤结果一致。
			files: filterDirectFiles(node.name, node.files, debouncedQuery),
		};
	}

	function handleNodeUpdate(nodeId: string, updates: { label?: string }) {
		if (!updates.label) return;
		const data = getFolderData(nodeId);
		if (!data) return;
		if (updates.label === data.folderName) return;
		void renameVaultItem(app, data.path, updates.label, true);
	}

	export function handleVaultCreate(path: string, isFolder: boolean): void {
		store.applyCreate(path, isFolder);
		syncRefreshNodes();
	}

	export function handleVaultDelete(path: string, isFolder: boolean): void {
		store.applyDelete(path, isFolder);
		syncRefreshNodes();
	}

	export function handleVaultRename(oldPath: string, newPath: string, isFolder: boolean): void {
		store.applyRename(oldPath, newPath, isFolder);

		// 跨文件夹 before/after：修正数据层（排序存储 + stableTree）。
		// cardtree 视图由 onDrop 返回 true 触发的 FLIP 已处理，不再调 cardTreeRef.moveNode。
		if (isFolder && pendingReparent && pendingReparent.newPath === newPath) {
			const { targetParentId, position, referenceName } = pendingReparent;
			// 统一取目标父的子节点列表：reparent 到根（targetParentId===null）时取 stableTree 顶层，
			// 否则按 targetParentId 查。之前 null 分支取不到兄弟，refStableId 恒为 null → 节点永远落到末尾。
			const siblings = targetParentId === null
				? store.getTopLevelStableNodes()
				: (store.findStableNode(targetParentId)?.children ?? []);
			const dragName = newPath.substring(newPath.lastIndexOf('/') + 1);
			const siblingNames = siblings.map(c => c.name);
			reorderTo(app, parentPathOf(newPath), 'folder', dragName, siblingNames, referenceName, position);
			const dragStableId = store.findStableNodeByPath(newPath)?.stableId;
			if (dragStableId) {
				const refStableId = referenceName
					? siblings.find(c => c.name === referenceName)?.stableId ?? null
					: null;
				store.applyReorder(targetParentId, dragStableId, refStableId, position);
			}
			pendingReparent = null;
		}

		// reparent 期间（suppressCardTreeMove=true）跳过全量重刷：stableTree 已由上方增量更新，
		// 再调 setSearchNodes 会用旧全量数据覆盖 FLIP 的 ctx.moveNode 结果。syncRefreshNodes 自身
		// 仅在搜索态运行（拖拽在搜索态禁用），此处补 suppress 守卫以统一三处覆盖路径的不变量。
		if (!store.suppressCardTreeMove) {
			syncRefreshNodes();
		}
	}

	function handleOpenFile(path: string) {
		onOpenFile(path);
	}

	/** 后台新 tab 打开：不关闭弹框，便于连续打开多个文件（Cmd/Ctrl + 点击触发） */
	function handleOpenFileBackground(path: string) {
		const file = app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			void app.workspace.getLeaf('tab').openFile(file);
		}
	}

	/** stableId 集合 → vault 路径数组（找不到节点的 id 静默丢弃） */
	function collapsedIdsToPaths(ids: Iterable<string>): string[] {
		const paths: string[] = [];
		for (const id of ids) {
			const node = store.findStableNode(id);
			if (node) paths.push(node.path);
		}
		return paths;
	}

	/** 折叠/展开状态变化 → 只更新内存缓存（stableId 转成 vault 路径）。
	 *  真正的持久化在 markClosing 执行一次，避免 Svelte $destroy 期间的空回调覆盖存储。
	 *  搜索态/销毁态跳过：前者 setSearchNodes 内部 expandAll 会清空 collapsedIds 并触发本回调，
	 *  后者 cardtree 销毁清理时也会触发空回调。 */
	function handleExpandCollapse(collapsedIds: ReadonlySet<string>): void {
		if (isSearching || isDestroyed) return;
		currentCollapsedPaths = collapsedIdsToPaths(collapsedIds);
	}

	function handleSlashKey(event: KeyboardEvent) {
		if (event.key !== '/') return;
		const target = event.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
		event.preventDefault();
		searchInputEl?.focus();
	}

	function handleFileContextMenu(event: { event: MouseEvent; file: VaultFileEntry }) {
		buildFileMenu(event.file).showAtMouseEvent(event.event);
	}

	/** 双击卡片：未下钻时进入该文件夹，已下钻时返回根目录。
	 *  文件条目有自己的双击行为（打开文件），通过 closest 过滤避免冲突。 */
	function cardDblClickAction(node: HTMLElement): { destroy: () => void } {
		node.addEventListener('dblclick', handleCardDblClick);
		return { destroy() { node.removeEventListener('dblclick', handleCardDblClick); } };
	}
	/** 标题右键守卫：标题左侧已有菜单按钮，标题区域不再弹文件夹菜单。
	 *  库的 handleContextMenu 挂在 section 的冒泡阶段，此处用捕获阶段提前 stopPropagation 阻断；
	 *  不调用 preventDefault，重命名时仍可使用浏览器原生的剪切/复制/粘贴右键。 */
	function contextMenuGuardAction(node: HTMLElement): { destroy: () => void } {
		const handler = (event: MouseEvent) => {
			if ((event.target as HTMLElement).closest('.gridnote-ft-node-title, [contenteditable="true"]')) {
				event.stopPropagation();
			}
		};
		node.addEventListener('contextmenu', handler, true);
		return { destroy() { node.removeEventListener('contextmenu', handler, true); } };
	}
	/** 纸张纹理：按 data-source-id 哈希为每张卡片确定性分配纸张变体（0-5）。
	 *  MutationObserver 监听新增节点，cardtree 动态渲染/FLIP 时自动补齐。 */
	const FT_PAPER_COUNT = 6;
	function ftHashStr(s: string): number {
		let h = 0;
		for (let i = 0; i < s.length; i++) {
			h = ((h << 5) - h + s.charCodeAt(i)) | 0;
		}
		return Math.abs(h);
	}
	function paperTextureAction(node: HTMLElement): { destroy: () => void } {
		function assignPaper(card: Element): void {
			if (card.hasAttribute('data-paper')) return;
			const sid = card.closest('[data-source-id]')?.getAttribute('data-source-id');
			if (!sid) return;
			card.setAttribute('data-paper', String(ftHashStr(sid) % FT_PAPER_COUNT));
		}
		function scanNode(root: Node): void {
			if (root.nodeType !== Node.ELEMENT_NODE) return;
			const el = root as Element;
			if (el.classList?.contains('gridnote-ft-node-card')) assignPaper(el);
			el.querySelectorAll?.('.gridnote-ft-node-card:not([data-paper])').forEach(assignPaper);
		}
		node.querySelectorAll('.gridnote-ft-node-card:not([data-paper])').forEach(assignPaper);
		const observer = new MutationObserver((mutations) => {
			for (const m of mutations) m.addedNodes.forEach(scanNode);
		});
		observer.observe(node, { childList: true, subtree: true });
		return { destroy() { observer.disconnect(); } };
	}
	/** 单击卡片空白区域取消选中。文件条目 handleSelect 已 stopPropagation，
	 *  所以到达容器级的 click 一定来自非文件条目区域（卡片 padding、标题行等）。 */
	function containerClickAction(node: HTMLElement): { destroy: () => void } {
		node.addEventListener('click', handleContainerClick);
		return { destroy() { node.removeEventListener('click', handleContainerClick); } };
	}

	function handleContainerClick(event: MouseEvent): void {
		const target = event.target as HTMLElement;
		// 文件条目、按钮、输入框等交互元素自行处理，不取消选中
		if (target.closest('.gridnote-ft-file-entry, button, [role="button"], input, a')) return;
		if (selectionStore.getSelected().length > 0) {
			selectionStore.clear();
		}
	}

	function handleCardDblClick(event: MouseEvent): void {
		if (!cardTreeRef) return;
		// 文件条目的双击交给其自身处理
		if ((event.target as HTMLElement).closest('.gridnote-ft-file-entry')) return;
		// toggle/drag-handle 等交互元素的双击也忽略
		if ((event.target as HTMLElement).closest('button, [role="button"]')) return;
		// 标题/可编辑区域：editableTitle 在首次 click 即进入重命名，但仅 stopPropagation 了
		// click 事件，dblclick 仍会冒泡，此处需排除以免重命名被下钻打断。
		if ((event.target as HTMLElement).closest('.gridnote-ft-node-title, [contenteditable="true"]')) return;
		// 下钻徽章已有单击下钻逻辑，双击时不应重复触发容器级下钻。
		if ((event.target as HTMLElement).closest('.gridnote-ft-node-drill-badge')) return;

		// 找到双击的卡片节点
		const section = (event.target as HTMLElement).closest('[data-source-id]');
		if (!section) return;
		const sourceId = section.getAttribute('data-source-id');
		if (!sourceId) return;

		const clickedNode = store.findStableNode(sourceId);
		if (!clickedNode) return;

		// 比较双击的文件夹路径与当前视图根路径
		const currentRootId = cardTreeRef.getViewRoot();
		const currentPath = currentRootId ? (store.findStableNode(currentRootId)?.path ?? '') : '';

		if (clickedNode.path === currentPath) {
			// 路径一致：返回根目录
			cardTreeRef.drillToRoot();
		} else {
			// 路径不一致：下钻到该文件夹
			cardTreeRef.drillDown(sourceId);
		}
	}

	/**
	 * 拖拽文件夹：
	 * - 同父级 reorder → store.applyReorder + reorderTo（持久化）+ return true（CardTree 走 FLIP）
	 * - 跨文件夹 reparent → moveVaultItem + return true（CardTree 走 FLIP），并设 suppressCardTreeMove。
	 *
	 * FLIP 时序约束（改动此处前必读）：
	 * return true 会让 CardTree 在 onDragEnd 内先 flip.snapshot → ctx.moveNode（节点到位），
	 * 再在 tick().then() 里 flip.play。moveNode 会同步触发 Svelte 的 $: 重评估，若此时用旧
	 * stableTree 调 setNodesPreserveCollapse，会把节点覆盖回旧位置，FLIP 的 first/last 相同、
	 * delta=0，动画消失。故 reparent 期间设 suppressCardTreeMove，让本组件 $: 块、
	 * handleVaultRename、vaultTreeStore.applyFolderRename 三处都跳过全量覆盖，等 vault rename
	 * 事件走增量更新（applyFolderRename 改 stableTree + pendingReparent 修正落点）。
	 */
	function handleFolderDrop(dragId: string, dropTarget: DropTarget): boolean {
		const dragNode = store.findStableNode(dragId);
		if (!dragNode) return false;

		const sourceParentId = store.findParentStableId(dragId);
		// 拖到当前父的 inside（dropType=reparent, position=last-child）：节点本就在该父内，
		// 无跨文件夹移动意图，应 no-op。否则会走 reparent 分支触发 ctx.moveNode 重排到末尾，
		// 导致后续兄弟节点被判定为"新增"而播放入场动画。
		if (dropTarget.position === 'last-child' && (dropTarget.targetParentId ?? null) === (sourceParentId ?? null)) {
			return false;
		}
		const isSameParentReorder =
			dropTarget.dropType === 'reorder' &&
			(dropTarget.targetParentId ?? null) === (sourceParentId ?? null);

		if (isSameParentReorder) {
			// 取 reorder 前的兄弟顺序（stableTree 当前状态）
			const siblingNames: string[] = sourceParentId === null
				? store.getFullCardTreeNodes().map(c => c.label)
				: (store.findStableNode(sourceParentId)?.children ?? []).map(c => c.name);

			const refNode = dropTarget.referenceId
				? store.findStableNode(dropTarget.referenceId ?? "")
				: null;

			reorderTo(
				app,
				parentPathOf(dragNode.path),
				'folder',
				dragNode.name,
				siblingNames,
				refNode?.name ?? null,
				dropTarget.position,
			);

			store.applyReorder(
				sourceParentId,
				dragId,
				dropTarget.referenceId ?? null,
				dropTarget.position,
			);

			return true;
		}

		const targetParentNode = dropTarget.targetParentId
			? store.findStableNode(dropTarget.targetParentId)
			: null;
		const targetParentPath = targetParentNode?.path ?? '';
		if (targetParentPath === dragNode.path || targetParentPath.startsWith(dragNode.path + '/')) {
			return false;
		}
		// reparent：返回 true 让 CardTree 做 FLIP + ctx.moveNode（正确位置）。
		// 设 suppressCardTreeMove 阻止 applyFolderRename 的 moveNode 覆盖 FLIP 结果。
		store.suppressCardTreeMove = true;
		// before/after：暂存落点，rename 事件中修正数据层（排序存储 + stableTree）。
		// last-child（inside）：applyFolderRename 追加到末尾即为正确位置，无需暂存。
		if (dropTarget.position !== 'last-child') {
			const refNode = dropTarget.referenceId
				? store.findStableNode(dropTarget.referenceId)
				: null;
			pendingReparent = {
				newPath: targetParentPath ? `${targetParentPath}/${dragNode.name}` : dragNode.name,
				targetParentId: dropTarget.targetParentId ?? null,
				position: dropTarget.position as 'before' | 'after',
				referenceName: refNode?.name ?? null,
			};
		}
		void moveVaultItem(app, dragNode.path, targetParentPath).finally(() => {
			store.suppressCardTreeMove = false;
			pendingReparent = null;
		});
		return true;
	}

	function buildFolderMenu(data: FolderCardData, folderSourceId: string | null): Menu {
		const menu = new Menu();
		menu.addItem((item) =>
			item.setTitle('新建文件').setIcon('file-plus')
				.onClick(() => void createFile(app, data.path)),
		);
		menu.addItem((item) =>
			item.setTitle('新建文件夹').setIcon('folder-plus')
				.onClick(() => void createFolder(app, data.path)),
		);
		// 第三方插件注册的自定义文件类型（如 Excalidraw、Canvas）
		const extraItems = captureFileMenuItems(app, data.path);
		if (extraItems.length > 0) {
			menu.addSeparator();
			for (const extra of extraItems) {
				menu.addItem((item) =>
					item.setTitle(extra.title).setIcon(extra.icon ?? null)
						.onClick(extra.onClick),
				);
			}
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle(`粘贴${clipboardStore.getPaths().length > 0 ? ` ${clipboardStore.getPaths().length} 项` : ''}`)
				.setIcon('clipboard-paste')
				.setDisabled(clipboardStore.getPaths().length === 0)
				.onClick(() => void pasteInto(data.path)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle('钻入此文件夹').setIcon('chevrons-right')
				.onClick(() => {
					if (folderSourceId) cardTreeRef?.drillDown(folderSourceId);
				}),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle('删除').setIcon('trash-2')
				.onClick(() => {
					new ConfirmModal(app, `确定要删除文件夹 "${data.folderName}" 吗？`, () => {
						void deleteVaultItem(app, data.path);
					}, '删除').open();
				}),
		);
		return menu;
	}

	function buildRootMenu(): Menu {
		const menu = new Menu();
		menu.addItem((item) =>
			item.setTitle('新建文件').setIcon('file-plus')
				.onClick(() => void createFile(app, '')),
		);
		menu.addItem((item) =>
			item.setTitle('新建文件夹').setIcon('folder-plus')
				.onClick(() => void createFolder(app, '')),
		);
		// 第三方插件注册的自定义文件类型（如 Excalidraw、Canvas）
		const extraItems = captureFileMenuItems(app, '');
		if (extraItems.length > 0) {
			menu.addSeparator();
			for (const extra of extraItems) {
				menu.addItem((item) =>
					item.setTitle(extra.title).setIcon(extra.icon ?? null)
						.onClick(extra.onClick),
				);
			}
		}
		menu.addItem((item) =>
			item.setTitle(`粘贴${clipboardStore.getPaths().length > 0 ? ` ${clipboardStore.getPaths().length} 项` : ''}`)
				.setIcon('clipboard-paste')
				.setDisabled(clipboardStore.getPaths().length === 0)
				.onClick(() => void pasteInto('')),
		);
		return menu;
	}

	function handleRootContextMenu(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		buildRootMenu().showAtMouseEvent(event);
	}
	/** 粘贴：剪切文件移动到目标文件夹，至少移动一项才清空剪贴板 */
	async function pasteInto(targetFolderPath: string): Promise<void> {
		const paths = clipboardStore.getPaths();
		if (paths.length === 0) return;
		const moved = await moveVaultFiles(app, paths, targetFolderPath);
		if (moved > 0) {
			clipboardStore.clear();
		}
	}

	/** 从 cardtree menu slot 的 ViewModelNode 提取文件夹数据 + sourceId（钻入用） */
	function extractFolderData(node: unknown): { data: FolderCardData; sourceId: string | null } | null {
		if (node && typeof node === 'object' && 'data' in node) {
			const data = (node as { data: unknown }).data;
			// menu slot 经 store.getNode() 取出的是原始 CardTreeNode，主键字段为 id（非 ViewModelNode 的 sourceId）
			const id = (node as { id?: unknown }).id;
			if (data && typeof data === 'object') {
				return { data: data as FolderCardData, sourceId: typeof id === 'string' ? id : null };
			}
		}
		return null;
	}

	function showFolderMenu(
		_el: HTMLElement,
		params: { node: unknown; x: number; y: number; onClose: () => void },
	): { destroy: () => void } {
		const extracted = extractFolderData(params.node);
		if (!extracted) return { destroy() {} };
		const menu = buildFolderMenu(extracted.data, extracted.sourceId);
		let closed = false;
		menu.onHide(() => {
			if (!closed) { closed = true; params.onClose(); }
		});
		menu.showAtPosition({ x: params.x, y: params.y });
		return {
			destroy() {
				if (!closed) { closed = true; menu.close(); }
			},
		};
	}

	function buildFileMenu(file: VaultFileEntry): Menu {
		const menu = new Menu();
		// 多选上下文：右键的文件在选中集合内且选中数 > 1 时，操作整个集合
		const selected = selectionStore.getSelected();
		const isInSelection = selected.includes(file.path);
		const isMulti = isInSelection && selected.length > 1;

		// 打开相关项仅单选时显示
		if (!isMulti) {
		menu.addItem((item) =>
			item.setTitle('打开').setIcon('file-text')
				.onClick(() => {
					const f = app.vault.getAbstractFileByPath(file.path);
					if (f instanceof TFile) {
						void app.workspace.getLeaf(false).openFile(f);
						onClose();
					}
				}),
		);
		menu.addItem((item) =>
			item.setTitle('在新标签页打开').setIcon('file-plus')
				.onClick(() => {
					const f = app.vault.getAbstractFileByPath(file.path);
					if (f instanceof TFile) {
						void app.workspace.getLeaf('tab').openFile(f);
						onClose();
					}
				}),
		);
		menu.addItem((item) =>
			item.setTitle('在右侧打开').setIcon('split')
				.onClick(() => {
					const f = app.vault.getAbstractFileByPath(file.path);
					if (f instanceof TFile) {
						void app.workspace.getLeaf('split', 'vertical').openFile(f);
						onClose();
					}
				}),
		);
		menu.addSeparator();
		}
		// 剪切：多选时操作整个选中集合
		const cutPaths = isInSelection ? selected : [file.path];
		menu.addItem((item) =>
			item.setTitle('剪切').setIcon('scissors')
				.onClick(() => {
					clipboardStore.cut(cutPaths, selectionStore.getActiveFolderId() ?? '__root__');
				}),
		);
		// 重命名仅单选时显示
		if (!isMulti) {
			menu.addItem((item) =>
				item.setTitle('重命名').setIcon('pencil')
					.onClick(() => {
						const dotExt = file.extension ? '.' + file.extension : '';
						const baseName = dotExt
							? file.name.slice(0, file.name.length - dotExt.length)
							: file.name;
						new PromptModal(app, '重命名', baseName, (newBase) => {
							// 用户已带后缀则不再追加，避免 .md.md
							const finalName = dotExt && newBase.toLowerCase().endsWith(dotExt)
								? newBase
								: newBase + dotExt;
							if (finalName !== file.name) {
								void renameVaultItem(app, file.path, finalName, false);
							}
						}).open();
					}),
			);
		}
		// 删除：多选批量删除，单选保持原逻辑
		menu.addItem((item) =>
			item.setTitle(isMulti ? `删除 ${selected.length} 项` : '删除').setIcon('trash-2')
				.onClick(() => {
					const deletePaths = isMulti ? selected : [file.path];
					const confirmMsg = isMulti
						? `确定要删除选中的 ${selected.length} 个文件吗？`
						: `确定要删除 "${file.name}" 吗？`;
					new ConfirmModal(app, confirmMsg, () => {
						void deleteVaultItems(app, deletePaths);
					}, '删除').open();
				}),
		);
		return menu;
	}

	function parentPathOf(path: string): string {
		const idx = path.lastIndexOf('/');
		return idx < 0 ? '' : path.slice(0, idx);
	}

	/**
	 * 退出搜索态后还原进入前的折叠状态：
	 * setSearchNodes(fullNodes) 内部会 expandAll，这里再把快照里的节点逐个折叠回来。
	 * 等 DOM 同步后再操作，避免 setNodes 与 collapseNode 时序竞争。
	 */
	async function restoreCollapseSnapshot(snapshot: Set<string>): Promise<void> {
		if (!cardTreeRef || snapshot.size === 0) return;
		await tick();
		for (const id of snapshot) {
			cardTreeRef.collapseNode(id);
		}
	}

	/**
	 * vault 事件（增删改）后刷新当前视图的数据。
	 * 搜索态 → 重新过滤（过滤结果会随数据变化）。
	 * 非搜索态 → 不做全量刷新：applyCreate/Delete/Rename 已通过增量 CardTree API
	 *   （addNode/removeNode/updateNode/moveNode）更新视图并保留折叠/选中状态，
	 *   这里再 setNodes + expandAll 会把用户手动折叠的状态清空（回归）。
	 */
	function syncRefreshNodes(): void {
		if (!cardTreeRef) return;
		if (!debouncedQuery.trim()) return;
		const filtered = filterCardTree(store.getFullCardTreeNodes(), debouncedQuery);
		filteredNodeCount = filtered.length;
		store.setSearchNodes(filtered);
	}

	onMount(() => {
		store.bindCardTree(cardTreeRef);
		// 恢复上次下钻位置：路径反查 stableId，再 drillTo
		const lastDrillPath = readLastDrillPath(app);
		if (lastDrillPath) {
			const targetNode = store.findStableNodeByPath(lastDrillPath);
			// 注意：必须用 drillDown 而非 drillTo。
			// drillTo 要求 _viewRootId 已有值（面包屑内跳转），根目录态调用是空操作。
			if (targetNode) cardTreeRef.drillDown(targetNode.stableId);
		}
		// 文件拖拽：sensor 挂在 body（单 modal），落点检测覆盖根散文件 + 各卡片文件网格
		dndController = createFileDndController({
			container: document.body,
			app,
			selectionStore,
			dragStore: dndDragStore,
			resolveFolderPath: (folderId) => folderId === '__root__' ? '' : (store.findStableNode(folderId)?.path ?? null),
			getFolderFiles: (folderId) => {
				if (folderId === '__root__') return store.getRootFiles().map((f) => ({ path: f.path, name: f.name }));
				const node = store.findStableNode(folderId);
				return node ? node.files.map((f) => ({ path: f.path, name: f.name })) : [];
			},
			applyFileReorder: (folderId, dragPaths, refPath, position) => {
				store.applyFileReorder(folderId, dragPaths, refPath, position);
			},
			moveFiles: (dragPaths, targetFolderPath) => moveVaultFiles(app, dragPaths, targetFolderPath),
		});
	});

	onDestroy(() => {
		clearTimeout(debounceTimer);
		store.unbindCardTree();
		selectionStore.clear();
		clipboardStore.clear();
		dndController?.destroy();
		dndController = null;
	});

	/** 弹框关闭前同步调用：从 cardtree 读取当前折叠状态（ground truth）并持久化，
	 *  然后标记销毁态。即便 $destroy 后续触发空回调也不会影响已写入的存储。 */
	export function markClosing(): void {
		const paths = cardTreeRef ? collapsedIdsToPaths(cardTreeRef.getCollapsedIds()) : currentCollapsedPaths;
		writeCollapsedPaths(app, paths);
		// 持久化下钻路径：根目录存空串
		if (cardTreeRef) {
			const viewRootId = cardTreeRef.getViewRoot();
			const drillPath = viewRootId ? (store.findStableNode(viewRootId)?.path ?? '') : '';
			writeLastDrillPath(app, drillPath);
		}
		selectionStore.clear();
		clipboardStore.clear();
		isDestroyed = true;
	}
</script>


<svelte:window on:keydown={handleSlashKey} />

<header class="gridnote-ft-header">
	<div class="gridnote-ft-header-left" title={vaultName}>
		<span class="gridnote-ft-header-vault-icon" bind:this={vaultIconEl}></span>
		<span class="gridnote-ft-header-vault-name">{vaultName}</span>
	</div>
	<div class="gridnote-ft-header-center">
		<div class="gridnote-ft-search-wrap">
			<input
				class="gridnote-ft-search"
				type="search"
				placeholder="搜索文件…"
				bind:value={query}
				bind:this={searchInputEl}
				spellcheck="false"
			/>
			<kbd class="gridnote-ft-search-kbd" aria-hidden="true">/</kbd>
		</div>
	</div>
	<div class="gridnote-ft-header-right">
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div
			class="gridnote-ft-header-btn"
			role="button"
			tabindex="0"
			title="关闭"
			aria-label="关闭"
			on:click={onClose}
			on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClose(); } }}
		>
			<span bind:this={closeBtnEl}></span>
		</div>
	</div>
</header>

{#if showRootCard}
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<!-- 根目录散文件列表：独立全宽容器，置于滚动区之上，不受 container padding 影响。
	     右键区段可新建文件/文件夹（落到 vault 根，path=''）。根标识由顶部面包屑承担。 -->
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<section class="gridnote-ft-root-files" aria-label="根目录文件" on:contextmenu={handleRootContextMenu}>
		<FolderCardFiles
			files={displayedRootFiles}
			{activeFilePath}
			query={debouncedQuery}
			folderId="__root__"
			selection={selectionStore}
			clipboard={clipboardStore}
			drag={dndDragStore}
			on:openfile={(e) => handleOpenFile(e.detail)}
			on:openfileBackground={(e) => handleOpenFileBackground(e.detail)}
			on:contextmenu={(e) => handleFileContextMenu(e.detail)}
		/>
	</section>
{/if}

<div
	class="gridnote-file-tree-container"
	class:gridnote-ft-initializing={!initialCollapseRestored}
		use:containerClickAction
		use:cardDblClickAction
		use:contextMenuGuardAction
		use:paperTextureAction
		bind:clientWidth={containerWidth}
>
	<CardTree
		bind:this={cardTreeRef}
		nodes={initialNodes}
		config={cardTreeConfig}
		virtualization={false}
		keyboardNavigation={true}
		selectable={false}
		breadcrumb={'always'}
		drillBadge={true}
		rootLabel="根目录"
		dragDrop={isSearching ? false : dragDropConfig}
		menu={menuConfig}
		onNodeUpdate={handleNodeUpdate}
		onExpandCollapse={handleExpandCollapse}
		classPrefix="gridnote-ft"
		className="gridnote-file-tree"
		style="font-family: inherit;"
	>
		<svelte:fragment
			slot="node-content"
			let:node
		>
			{@const folderData = getFolderData(node.sourceId)}
			{#if folderData}
				<FolderCardFiles
				files={folderData.files}
				{activeFilePath}
				query={debouncedQuery}
				folderId={node.sourceId}
				selection={selectionStore}
				clipboard={clipboardStore}
				drag={dndDragStore}
				on:openfile={(e) => handleOpenFile(e.detail)}
				on:openfileBackground={(e) => handleOpenFileBackground(e.detail)}
				on:contextmenu={(e) => handleFileContextMenu(e.detail)}
			/>
			{/if}
		</svelte:fragment>

		<svelte:fragment
			slot="menu"
			let:node
			let:x
			let:y
			let:close
		>
			<!-- 空元素仅作 action 载体：mount 时弹出 Obsidian 原生菜单（native 模式库不包定位容器） -->
			<div
				style="display:none"
				use:showFolderMenu={{ node, x, y, onClose: close }}
			></div>
		</svelte:fragment>
	</CardTree>
	{#if hasNoMatch}
		<div class="gridnote-ft-empty-state" role="status">
			<span>未找到匹配项</span>
		</div>
	{/if}
</div>
{#if dndDragStore}
	<FileDragOverlay dragStore={dndDragStore} />
{/if}

<!--
  忠实移植 cardtree-svelte 的 cascade.css
  前缀 cascade → gridnote-ft（避免与主视图 CascadeNode 的 cascade-* 类冲突）
  CSS 变量改用 Obsidian 主题色，保留库的玻璃拟态卡片设计
-->
<style>
	/* === 容器 + 主题变量（cardtree 默认设计，原始值） === */
	:global(.gridnote-file-tree-container) {
		width: 100%;
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
		/* 始终为滚动条预留 gutter，使有无滚动条时内容区宽度一致、左右边距对称 */
		scrollbar-gutter: stable;
		/* 字体族沿用 Obsidian 外观设置（与 gridnote view 一致） */
		font-family: var(--font-text), var(--font-interface), sans-serif;
		padding: 20px 20px 20px 20px;
		box-sizing: border-box;

		/* Card — 全部映射到 Obsidian 主题变量，自动跟随明/暗模式 */
		--ct-card-padding: 8px 10px;
		--ct-card-border-radius: 14px;
		--ct-card-border-color: var(--background-modifier-border);
		--ct-card-bg: var(--background-primary);
		--ct-card-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
		--ct-card-inner-highlight: inset 0 1px 0 var(--background-modifier-border);
		--ct-card-border-color-hover: var(--interactive-accent);
		--ct-card-bg-hover: var(--background-modifier-hover);

		/* Glass（已禁用 backdrop-filter，仅保留变量定义） */
		--ct-glass-blur: 0px;
		--ct-glass-saturate: 1;

		/* Accent — 跟随 Obsidian 交互强调色 */
		--ct-accent: var(--interactive-accent);
		--ct-accent-light: var(--background-modifier-hover);
		--ct-selected-ring: var(--interactive-accent);

		/* Text — 跟随 Obsidian 文字层级 */
		--ct-text-primary: var(--text-normal);
		--ct-text-secondary: var(--text-muted);
		--ct-text-muted: var(--text-faint);
		--ct-text-toggle: var(--text-muted);
		--ct-text-drag: var(--text-faint);

		/* Heading — 跟随 Obsidian 字号设置（参考 gridnote view 标题做法） */
		--ct-heading-size: calc(var(--font-text-size) * 1.1);
		--ct-dash-color: var(--background-modifier-border);
		--ct-badge-size: var(--font-smallest);

		/* Body — 跟随 Obsidian UI 字号 */
		--ct-body-size: var(--font-ui-small);
		--ct-body-line-height: 1.6;

		/* Spacing */
		--ct-heading-padding: 4px 0;
		--ct-children-gap: 12px;
		--ct-children-margin: 18px;
		--ct-body-margin: 8px;
		--ct-toggle-size: 24px;
		--ct-connector-width: 18px;

		/* Animation */
		--ct-transition-duration: 220ms;
		--ct-enter-duration: 200ms;
		--ct-exit-duration: 150ms;

		/* Drop indicators — 跟随 Obsidian 强调色 */
		--ct-drop-color: var(--interactive-accent);
		--ct-drop-line-height: 3px;
		--ct-drop-line-glow: 0 0 8px color-mix(in srgb, var(--interactive-accent) 35%, transparent);
		--ct-drop-inside-glow: 0 0 0 2px color-mix(in srgb, var(--interactive-accent) 25%, transparent), 0 0 12px color-mix(in srgb, var(--interactive-accent) 10%, transparent);

		--ct-drag-opacity: 0.4;
	}

	/* === 自定义 Header：左(仓库名) / 中(搜索框居中) / 右(按钮组) === */
	/* 兜底处理 Obsidian 在 onOpen 后才补齐的原生 header。 */
	:global(.gridnote-custom-header-modal .modal-header),
	:global(.gridnote-custom-header-modal .modal-header-button),
	:global(.gridnote-custom-header-modal .modal-close-button) {
		display: none;
	}

	:global(.gridnote-ft-header) {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 12px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--background-modifier-border);
		flex-shrink: 0;
	}

	:global(.gridnote-ft-header-left) {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		justify-self: start;
		font-size: var(--font-ui-medium);
		font-weight: 600;
		color: var(--text-normal);
	}

	:global(.gridnote-ft-header-vault-icon) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.1em;
		height: 1.1em;
		flex-shrink: 0;
		color: var(--text-muted);
	}

	:global(.gridnote-ft-header-vault-icon svg) {
		width: 100%;
		height: 100%;
		display: block;
	}

	:global(.gridnote-ft-header-vault-name) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.gridnote-ft-header-center) {
		justify-self: center;
	}

	:global(.gridnote-ft-search-wrap) {
		position: relative;
		width: clamp(220px, 32vw, 420px);
	}

	:global(.gridnote-ft-search) {
		width: 100%;
		padding: 4px 30px 4px 10px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 7px;
		background: var(--background-primary-alt);
		color: var(--text-normal);
		font-size: var(--font-ui-small);
		font-family: inherit;
		outline: none;
		box-sizing: border-box;
		transition: border-color 0.15s ease, box-shadow 0.15s ease;
	}

	:global(.gridnote-ft-search:focus) {
		border-color: var(--interactive-accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--interactive-accent) 18%, transparent);
	}

	:global(.gridnote-ft-search-kbd) {
		position: absolute;
		right: 6px;
		top: 50%;
		transform: translateY(-50%);
		padding: 1px 6px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-modifier-hover);
		color: var(--text-muted);
		font-size: var(--font-smallest);
		font-family: var(--font-interface);
		line-height: 1.4;
		pointer-events: none;
		transition: opacity 0.12s ease;
	}

	/* 聚焦搜索框时隐藏 `/` 提示（已在输入） */
	:global(.gridnote-ft-search-wrap:focus-within .gridnote-ft-search-kbd) {
		opacity: 0;
	}

	:global(.gridnote-ft-header-right) {
		display: flex;
		align-items: center;
		gap: 4px;
		justify-self: end;
	}

	:global(.gridnote-ft-header-btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		color: var(--text-muted);
		cursor: pointer;
		transition: background 0.12s ease, color 0.12s ease;
	}

	:global(.gridnote-ft-header-btn:hover) {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	:global(.gridnote-ft-header-btn svg) {
		width: 18px;
		height: 18px;
		display: block;
	}

	/* 统一空状态：根散文件与 cardtree 过滤结果都为空时居中提示 */
	:global(.gridnote-ft-empty-state) {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 48px 16px;
		color: var(--text-muted);
		font-size: var(--font-ui-medium);
		font-style: italic;
		opacity: 0.8;
	}

	/* === 节点（忠实移植 cascade.css） === */
	/* 重置 Obsidian 的 .modal button 边框/背景（特异性 0,2,0 胜过 0,1,1） */
	:global(.gridnote-file-tree-container button) {
		border: none;
		background: none;
		box-shadow: none;
		font: inherit;
	}

	/* CardTree 根容器：让多个顶层节点垂直排列并带间距 */
	:global(.gridnote-file-tree) {
		display: flex;
		flex-direction: column;
		gap: var(--ct-children-gap);
		width: 100%;
	}

	/* === 根目录散文件：icon（主题色线上）+ 文件列表（线下、cardtree 上） ===
	   不进 cardtree。icon 徽章单独成行、底部主题色分隔线；文件列表复用 FolderCardFiles
	   的默认网格行样式（与文件夹卡片内部一致），仅无外层卡片背景/边框。
	   配色用 Obsidian --interactive-accent，自动跟随用户主题色与明/暗模式。 */

	/* 根目录散文件区段：独立全宽容器，置于滚动区之上（不受 container padding 影响）。
	   背景用系统底层色，限高 3 行内部滚动，底部边界线与下方卡片分层。 */
	:global(.gridnote-ft-root-files) {
		/* 左右贴边全宽；顶部紧贴 header，下方 container 自带 padding-top 留白 */
		margin: 0;
		padding: 8px 20px;
		/* 限高 3 行，超出内部滚动；不被 flex 压缩 */
		flex-shrink: 0;
		overflow-y: auto;
		/* 单行高度 = 字号*1.2(行高) + 6px*2(entry padding)；3 行 + 2 个行间 gap(2px) */
		max-height: calc((var(--font-text-size) * 1.2 + 12px) * 3 + 4px);
		/* 系统底层背景色：跟随主题（明/暗），由骨架纸张规则叠加噪点 */
		background-color: var(--background-underlying, var(--background-primary));
		border-bottom: 1px solid var(--background-modifier-border);
	}

	:global(.gridnote-ft-node) {
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
	}

	:global(.gridnote-ft-node-heading-row) {
		position: relative;
		display: flex;
		align-items: center;
		/* padding: var(--ct-heading-padding); */
		width: 100%;
		min-width: 0;
	}

	:global(.gridnote-ft-node-heading-left) {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: flex-start;
		min-width: var(--ct-toggle-size);
		color: var(--ct-text-muted);
	}

	:global(.gridnote-ft-node-heading-center) {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		min-width: 0;
	}

	:global(.gridnote-ft-node-title) {
		flex: 0 1 auto;
		min-width: 0;
		font-weight: 700;
		font-size: var(--ct-heading-size);
		line-height: 1.2;
		color: var(--ct-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		padding-right: 8px;
		transition: color 0.15s ease, background 0.15s ease;
		cursor: pointer;
		border-radius: 4px;
		outline: none;
		font-family: inherit;
	}

	:global(.gridnote-ft-node-title.is-editing) {
		color: var(--ct-accent);
		cursor: text;
		white-space: nowrap;
		overflow: visible;
		text-overflow: clip;
		outline: none;
	}

	:global(.gridnote-ft-heading-dash) {
		flex: 1 1 0%;
		align-self: center;
		height: 0;
		border-top: 1px dashed var(--ct-dash-color);
		opacity: 0;
		transition: opacity 0.15s ease, border-color 0.15s ease;
		pointer-events: none;
	}

	:global(.gridnote-ft-node-heading-row:hover .gridnote-ft-heading-dash) {
		opacity: 1;
		border-color: var(--ct-accent);
	}

	:global(.gridnote-ft-node-heading-row:hover .gridnote-ft-node-title) {
		color: var(--ct-accent);
	}

	:global(.gridnote-ft-node-heading-badge) {
		font-size: var(--ct-badge-size);
		color: var(--ct-text-muted);
		flex-shrink: 0;
		padding-left: 8px;
	}

	/* === Drill badge（库 0.3.0：层级上限处显示数字徽章，点击下钻） ===
	   移植自 cascade.css，前缀 cascade → gridnote-ft，配色跟随 Obsidian 主题色 */
	:global(.gridnote-ft-node-drill-badge) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 20px;
		height: 18px;
		padding: 0 6px;
		margin-left: 8px;
		border: 1px solid var(--background-modifier-border, var(--ct-dash-color));
		border-radius: 9px;
		background: var(--background-primary-alt, var(--ct-card-bg));
		color: var(--text-secondary, var(--ct-text-secondary));
		font-size: var(--font-smallest);
		font-weight: 600;
		line-height: 1;
		cursor: pointer;
		user-select: none;
		transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
		flex-shrink: 0;
	}
	:global(.gridnote-ft-node-drill-badge:hover) {
		background: var(--interactive-accent);
		border-color: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	/* === Breadcrumb（库 0.3.0：钻取态顶部路径条，点击任意段回退） ===
	   移植自 cascade.css，配色跟随 Obsidian 主题色 */
	:global(.gridnote-ft-breadcrumb) {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 2px;
		padding: 6px 10px;
		margin-bottom: 10px;
		line-height: 1.4;
		border: 1px solid var(--background-modifier-border, var(--ct-dash-color));
		border-radius: 10px;
		background-image: var(--ft-noise-soft), none;
		background-blend-mode: var(--ft-noise-blend);
		background-color: var(--background-primary-alt, var(--ct-card-bg));
		font-size: var(--font-ui-small);
		color: var(--text-secondary, var(--ct-text-secondary));
		flex-shrink: 0;
		/* 粘性吸顶：滚动文件树时面包屑吸顶可见，便于随时回退/切换层级 */
		position: sticky;
		top: 0;
		z-index: 4;
		transform: scale(1.01);
	}
	:global(.gridnote-ft-breadcrumb-item) {
		display: inline-flex;
		align-items: center;
	}
	:global(.gridnote-ft-breadcrumb-root) {
		cursor: pointer;
		color: var(--text-muted, var(--ct-text-muted));
		padding: 2px 4px;
		border-radius: 4px;
		transition: color 0.15s ease, background 0.15s ease;
	}
	:global(.gridnote-ft-breadcrumb-root:hover) {
		color: var(--interactive-accent, var(--ct-accent));
		background: var(--background-modifier-hover, var(--ct-accent-light));
	}
	:global(.gridnote-ft-breadcrumb-link) {
		padding: 2px 6px;
		border-radius: 4px;
		color: var(--text-secondary, var(--ct-text-secondary));
		cursor: pointer;
		max-width: 160px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: color 0.15s ease, background 0.15s ease;
	}
	:global(.gridnote-ft-breadcrumb-link:hover) {
		color: var(--interactive-accent, var(--ct-accent));
		background: var(--background-modifier-hover, var(--ct-accent-light));
	}
	:global(.gridnote-ft-breadcrumb-current) {
		font-weight: 600;
		color: var(--text-normal, var(--ct-text-primary));
		padding: 2px 6px;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	:global(.gridnote-ft-breadcrumb-sep) {
		color: var(--text-faint, var(--ct-text-muted));
		opacity: 0.6;
		padding: 0 1px;
	}
	/* hover 兄弟面板（同级文件夹快速切换） */
	:global(.gridnote-ft-breadcrumb-level) {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	:global(.gridnote-ft-breadcrumb-siblings) {
		position: absolute;
		top: calc(100% + 8px);
		left: 0;
		z-index: 100;
		display: flex;
		flex-direction: column;
		min-width: 140px;
		max-width: 260px;
		max-height: 280px;
		overflow-y: auto;
		padding: 4px;
		border: 1px solid var(--background-modifier-border, var(--ct-dash-color));
		border-radius: 8px;
		background: var(--background-primary, var(--ct-card-bg));
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1);
	}
	:global(.gridnote-ft-breadcrumb-sibling) {
		display: block;
		width: 100%;
		text-align: left;
		padding: 4px 8px;
		border-radius: 5px;
		color: var(--text-secondary, var(--ct-text-secondary));
		font-size: var(--font-ui-small);
		line-height: 1.4;
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: background 0.12s ease, color 0.12s ease;
	}
	:global(.gridnote-ft-breadcrumb-sibling:hover) {
		background: var(--background-modifier-hover, var(--ct-accent-light));
		color: var(--interactive-accent, var(--ct-accent));
	}
	:global(.gridnote-ft-breadcrumb-sibling-current) {
		font-weight: 600;
		color: var(--text-normal, var(--ct-text-primary));
		background: var(--background-modifier-hover, var(--ct-accent-light));
	}

	/* 折叠按钮 */
	:global(.gridnote-ft-toggle-btn) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--ct-toggle-size);
		height: var(--ct-toggle-size);
		padding: 0;
		border: 1px solid transparent;
		border-radius: 6px;
		background: none;
		cursor: pointer;
		color: var(--ct-text-toggle);
		transition: all 0.15s ease;
		flex-shrink: 0;
	}

	:global(.gridnote-ft-toggle-btn .gridnote-ft-toggle-icon) {
		transition: transform 0.2s ease;
		transform: rotate(90deg);
	}

	:global(.gridnote-ft-node.is-collapsed > .gridnote-ft-node-heading-row .gridnote-ft-toggle-btn .gridnote-ft-toggle-icon) {
		transform: rotate(0deg);
	}

	:global(.gridnote-ft-toggle-btn:hover) {
		color: var(--ct-accent);
		border-color: var(--ct-dash-color);
		background: var(--background-modifier-hover);
	}

	/* Body row（split 列由组件 inline bodyRowStyle 控制，这里只管折叠行动画） */
	:global(.gridnote-ft-node-body-row) {
		width: 100%;
		min-width: 0;
		display: grid;
		grid-template-rows: 1fr;
		transition: grid-template-rows var(--ct-transition-duration) ease-out;
	}
 
	/* 初始化禁用折叠动画（先渲染展开态再逐个恢复折叠），避免 1fr→0fr 闪烁 */
	:global(.gridnote-ft-initializing .gridnote-ft-node-body-row) {
		transition: none !important;
	}

	:global(.gridnote-ft-node-body-row > *) {
		min-height: 0;
	}

	/* :global(.gridnote-ft-node:not(.has-split) > .gridnote-ft-node-body-row) {
		margin-top: var(--ct-body-margin);
	} */

	:global(.gridnote-ft-node.is-collapsed > .gridnote-ft-node-body-row) {
		grid-template-rows: 0fr;
		overflow: hidden;
		margin-top: 0;
	}

	:global(.gridnote-ft-node.is-collapsed.drop-inside > .gridnote-ft-node-body-row) {
		grid-template-rows: 1fr;
		overflow: visible;
		/* margin-top: var(--ct-body-margin); */
	}

	:global(.gridnote-ft-node.is-collapsed.drop-inside > .gridnote-ft-node-body-row > .gridnote-ft-node-card-wrapper) {
		grid-template-rows: 1fr;
		overflow: visible;
	}

	/* 卡片 */
	:global(.gridnote-ft-node-card) {
		position: relative;
		display: flex;
		flex-direction: column;
		min-width: 0;
		max-width: 100%;
		box-sizing: border-box;
		border: 1px solid var(--ct-card-border-color);
		border-radius: var(--ct-card-border-radius);
		padding: var(--ct-card-padding);
		background: var(--ct-card-bg);
		transition: box-shadow 0.25s ease;
		cursor: pointer;
		outline: none;
	}

	:global(.gridnote-ft-node.not-selectable .gridnote-ft-node-card) {
		cursor: default;
	}

	:global(.gridnote-ft-node-body) {
		min-width: 0;
		max-width: 100%;
		overflow-x: auto;
		font-size: var(--ct-body-size);
		color: var(--ct-text-secondary);
		line-height: var(--ct-body-line-height);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	:global(.gridnote-ft-node-body-empty) {
		min-height: 1.5rem;
	}

	/* 折叠状态 */
	:global(.gridnote-ft-node.is-collapsed > .gridnote-ft-node-heading-row .gridnote-ft-node-title) {
		color: var(--ct-text-muted);
		opacity: 0.68;
	}

	:global(.gridnote-ft-node.is-collapsed > .gridnote-ft-node-heading-row .gridnote-ft-node-heading-left) {
		opacity: 0.72;
	}

	:global(.gridnote-ft-node-card-wrapper) {
		display: grid;
		grid-template-rows: 1fr;
	}

	:global(.gridnote-ft-node-card-wrapper > .gridnote-ft-node-card) {
		min-height: 0;
	}

	:global(.gridnote-ft-node-children-wrapper) {
		display: grid;
		grid-template-rows: 1fr;
	}

	:global(.gridnote-ft-node-children-wrapper > .gridnote-ft-node-children-container) {
		min-height: 0;
	}

	/* 选中状态 */
	:global(.gridnote-ft-node.is-selected > .gridnote-ft-node-body-row > .gridnote-ft-node-card-wrapper > .gridnote-ft-node-card) {
		border-color: var(--ct-selected-ring);
		box-shadow: var(--ct-card-shadow), 0 0 0 2px color-mix(in srgb, var(--ct-accent) 30%, transparent), var(--ct-card-inner-highlight);
	}

	:global(.gridnote-ft-node.is-selected > .gridnote-ft-node-heading-row > .gridnote-ft-node-heading-left) {
		color: var(--ct-text-toggle);
	}

	/* 动画 */
	@keyframes gridnote-ft-drop-line-appear {
		from { opacity: 0; transform: scaleX(0); }
		to { opacity: 1; transform: scaleX(1); }
	}

	@keyframes gridnote-ft-drop-inside-pulse {
		0%, 100% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--ct-drop-color) 25%, transparent), 0 0 12px color-mix(in srgb, var(--ct-drop-color) 10%, transparent); }
		50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--ct-drop-color) 35%, transparent), 0 0 20px color-mix(in srgb, var(--ct-drop-color) 15%, transparent); }
	}

	@keyframes gridnote-ft-node-enter {
		from { opacity: 0; transform: translateY(-8px); }
		to { opacity: 1; transform: translateY(0); }
	}

	@keyframes gridnote-ft-node-exit {
		from { opacity: 1; transform: translateY(0); }
		to { opacity: 0; transform: translateY(-8px); }
	}

	:global(.gridnote-ft-node.is-entering) {
		animation: gridnote-ft-node-enter var(--ct-enter-duration) ease-out both;
	}

	:global(.gridnote-ft-node.is-exiting) {
		animation: gridnote-ft-node-exit var(--ct-exit-duration) ease-in both;
	}

	:global(.gridnote-ft-node.is-reordering) {
		transition: transform 250ms cubic-bezier(0.2, 0, 0, 1);
	}

	/* 子节点容器 */
	:global(.gridnote-ft-node-children-container) {
		display: flex;
		flex-direction: column;
		width: 100%;
		min-width: 0;
	}

	:global(.gridnote-ft-node.has-split > .gridnote-ft-node-body-row > .gridnote-ft-node-children-container) {
		grid-column: 2;
		align-self: stretch;
	}

	:global(.gridnote-ft-node:not(.has-split) > .gridnote-ft-node-body-row > .gridnote-ft-node-children-container) {
		margin-top: var(--ct-children-margin);
	}

	:global(.gridnote-ft-node-children-stack) {
		display: flex;
		flex-direction: column;
		gap: var(--ct-children-gap);
		width: 100%;
		min-width: 0;
	}

	/* 非根节点连接线 */
	:global(.gridnote-ft-node:not(.is-root) > .gridnote-ft-node-heading-row::before) {
		content: '';
		flex: 0 0 auto;
		width: var(--ct-connector-width);
		height: 1px;
		background: var(--ct-dash-color);
		margin-left: calc(var(--ct-connector-width) * -1);
	}

	/* 拖拽手柄 */
	:global(.gridnote-ft-drag-handle) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 24px;
		padding: 0;
		border: none;
		border-radius: 4px;
		background: none;
		cursor: grab;
		color: var(--ct-text-drag);
		transition: color 0.15s ease, background 0.15s ease;
		flex-shrink: 0;
	}

	:global(.gridnote-ft-drag-handle:hover) {
		color: var(--ct-accent);
		background: var(--ct-accent-light);
	}

	:global(.gridnote-ft-drag-handle:active) {
		cursor: grabbing;
	}

	:global(.gridnote-ft-node.is-dragging) {
		opacity: var(--ct-drag-opacity);
	}

	/* 拖拽指示器 */
	:global(.gridnote-ft-node.drop-before::before),
	:global(.gridnote-ft-node.drop-after::after) {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		height: var(--ct-drop-line-height);
		background: var(--ct-drop-color);
		border-radius: 3px;
		z-index: 10;
		animation: gridnote-ft-drop-line-appear 150ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
		box-shadow: var(--ct-drop-line-glow);
	}

	:global(.gridnote-ft-node.drop-before::before) {
		top: -2px;
	}

	:global(.gridnote-ft-node.drop-after::after) {
		bottom: -2px;
	}

	:global(.gridnote-ft-node.drop-inside > .gridnote-ft-node-body-row > .gridnote-ft-node-card-wrapper > .gridnote-ft-node-card) {
		border-color: var(--ct-drop-color);
		box-shadow: var(--ct-drop-inside-glow);
		animation: gridnote-ft-drop-inside-pulse 1.2s ease-in-out infinite;
	}

	/* 文件拖拽落到卡片时的高亮 */
	:global(.gridnote-ft-node-card.is-ft-file-drop-inside) {
		border-color: var(--ct-drop-color);
		box-shadow: var(--ct-drop-inside-glow);
		animation: gridnote-ft-drop-inside-pulse 1.2s ease-in-out infinite;
	}

	/* 根散文件区放置目标高亮 */
	:global(.gridnote-ft-root-files.is-ft-file-drop-inside) {
		border-bottom-color: var(--ct-drop-color);
		box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--ct-drop-color) 20%, transparent);
	}

	/* === 纸张纹理背景（zine 风格纯 CSS 纸张） ===
	   共享 feTurbulence 噪点 data URI + 6 种纸张底色（data-paper="0"~"5"）。
	   亮色模式 multiply 让噪点压暗纸面形成颗粒感，暗色模式 screen 让噪点提亮可见。
	   颜色取自 zine/孔版印/牛皮纸美学：低饱和暖灰，配一枚高彩度锚点由 accent 变量提供。 */
	/* 噪点变量定义在弹窗骨架上，header / 根散文件区 / 容器三者共享继承 */
	:global(.gridnote-file-tree-modal) {
		--ft-noise: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E");
		/* 骨架区用更轻的噪点（opacity 0.18），叠加在 Obsidian 原生背景色上几乎不可见、仅有纸面颗粒感 */
		--ft-noise-soft: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='ns'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23ns)' opacity='0.18'/%3E%3C/svg%3E");
		--ft-noise-blend: multiply;
	}
	:global(body.theme-dark .gridnote-file-tree-modal) {
		--ft-noise-blend: screen;
	}

	:global(.gridnote-ft-node-card[data-paper]) {
		background-image: var(--ft-noise);
		background-blend-mode: var(--ft-noise-blend);
	}

	/* 0 象牙白 · 1 雾蓝(孔版半调) · 2 牛皮(斜向纤维) · 3 青瓷 · 4 紫丁香 · 5 青灰 */
	:global(.gridnote-ft-node-card[data-paper="0"]) { background-color: #f7f4ed; }
	:global(.gridnote-ft-node-card[data-paper="1"]) {
		background-color: #eef1f2;
		background-image: radial-gradient(circle, rgba(80,120,140,0.07) 0.5px, transparent 0.5px), var(--ft-noise);
		background-size: 6px 6px, auto;
		background-blend-mode: normal, var(--ft-noise-blend);
	}
	:global(.gridnote-ft-node-card[data-paper="2"]) {
		background-color: #efe8d8;
		background-image: repeating-linear-gradient(135deg, transparent 0, transparent 3px, rgba(180,150,100,0.05) 3px, rgba(180,150,100,0.05) 4px), var(--ft-noise);
		background-blend-mode: normal, var(--ft-noise-blend);
	}
	:global(.gridnote-ft-node-card[data-paper="3"]) { background-color: #edf1ea; }
	:global(.gridnote-ft-node-card[data-paper="4"]) { background-color: #f0edf2; }
	:global(.gridnote-ft-node-card[data-paper="5"]) { background-color: #eceae8; }

	/* 暗色模式纸张底色（低饱和深色，噪点用 screen 叠加） */
	:global(body.theme-dark .gridnote-ft-node-card[data-paper="0"]) { background-color: #211e1a; }
	:global(body.theme-dark .gridnote-ft-node-card[data-paper="1"]) { background-color: #1a1d22; }
	:global(body.theme-dark .gridnote-ft-node-card[data-paper="2"]) { background-color: #221e17; }
	:global(body.theme-dark .gridnote-ft-node-card[data-paper="3"]) { background-color: #1a201b; }
	:global(body.theme-dark .gridnote-ft-node-card[data-paper="4"]) { background-color: #1e1a22; }
	:global(body.theme-dark .gridnote-ft-node-card[data-paper="5"]) { background-color: #1c1c1e; }

	/* === 弹窗骨架纸张背景：统一一种（比卡片略深的暖灰），整张弹窗如同一整张纸 === */
	/* 用 Obsidian 原生背景色 + 极轻噪点，不引入额外色相 */
	:global(.gridnote-ft-header),
	:global(.gridnote-file-tree-container) {
		background-image: var(--ft-noise-soft);
		background-blend-mode: var(--ft-noise-blend);
		background-color: var(--background-primary);
	}

	/* 根散文件区：用卡片同款噪点（opacity 0.5），颗粒感与卡片一致 */
	:global(.gridnote-ft-root-files) {
		background-image: var(--ft-noise);
		background-blend-mode: var(--ft-noise-blend);
	}
</style>

<script lang="ts">
	import { setIcon, setTooltip } from 'obsidian';
	import { createEventDispatcher } from 'svelte';
	import type { VaultFileEntry } from './fileTreeTypes';
	import { highlightSegments } from './highlightSegments';
	import { ROOT_FOLDER_ID, type FileSelectionStore, type SelectModifier } from './fileDnd/fileSelectionStore';
	import type { FileDragStore } from './fileDnd/fileDragStore';
	import type { FileClipboardStore } from './fileDnd/fileClipboardStore';

	export let files: VaultFileEntry[];
	export let activeFilePath: string | null = null;
	export let query: string = '';
	export let folderId: string = ROOT_FOLDER_ID;
	export let selection: FileSelectionStore;
	export let drag: FileDragStore;
	export let clipboard: FileClipboardStore;

	/** 被拖拽文件路径集合（源文件夹过滤渲染，保持布局稳定） */
	$: dragPaths =
		($drag.status === 'dragging' || $drag.status === 'hovering') && $drag.sourceFolderId === folderId
			? new Set($drag.paths)
			: new Set<string>();

	/**
	 * placeholderIndex：hovering 时取 dropTarget；dragging 时取源文件位置（零抖动）。
 */
	$: placeholderIndex =
		$drag.status === 'hovering' && $drag.dropTarget.folderId === folderId && $drag.dropTarget.position !== 'inside'
			? $drag.dropTarget.placeholderIndex
		: ($drag.status === 'dragging' || ($drag.status === 'hovering' && $drag.sourceFolderId === folderId && $drag.dropTarget.folderId !== folderId))
			&& dragPaths.size > 0
			? files.findIndex((f) => dragPaths.has(f.path))
			: null;

	/** 拖拽中过滤掉源文件 */
	$: renderedFiles = dragPaths.size > 0
		? files.filter((f) => !dragPaths.has(f.path))
		: files;

	const dispatch = createEventDispatcher<{
		openfile: string;
		openfileBackground: string;
		contextmenu: { event: MouseEvent; file: VaultFileEntry };
	}>();

	let iconEls: HTMLElement[] = [];
	let entryEls: HTMLElement[] = [];

	$: {
		for (let i = 0; i < entryEls.length; i++) {
			const el = entryEls[i];
			const iconEl = iconEls[i];
			const file = files[i];
			if (el && file) {
				setTooltip(el, file.name, { placement: 'top' });
			}
			if (iconEl && file) {
				setIcon(iconEl, resolveIconName(file));
			}
		}
	}

	function resolveIconName(file: VaultFileEntry): string {
		if (file.extension === 'md') return 'file-text';
		if (file.extension === 'canvas') return 'layout-dashboard';
		if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(file.extension)) return 'image';
		if (file.extension === 'pdf') return 'file-text';
		return 'file';
	}

	function handleSelect(event: MouseEvent, file: VaultFileEntry) {
		event.stopPropagation();
		const modifier: SelectModifier = event.shiftKey
			? 'range'
			: (event.metaKey || event.ctrlKey) ? 'toggle' : 'none';
		selection.select(folderId, file.path, modifier, files);
	}

	function handleDoubleClick(_event: MouseEvent, file: VaultFileEntry) {
		dispatch('openfile', file.path);
	}

	function handleContextMenu(event: MouseEvent, file: VaultFileEntry) {
		event.preventDefault();
		event.stopPropagation();
		dispatch('contextmenu', { event, file });
	}

	function handleKeydown(event: KeyboardEvent, file: VaultFileEntry) {
		if (event.key === 'Enter') {
			event.preventDefault();
			dispatch('openfile', file.path);
		} else if (event.key === ' ') {
			event.preventDefault();
			selection.select(folderId, file.path, 'toggle', files);
		}
	}
</script>

{#if files.length > 0}
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<div
		class="gridnote-ft-file-list"
		data-folder-id={folderId}
		on:click={(e) => { if (e.target === e.currentTarget) selection.clear(); }}
	>
		{#each renderedFiles as file, i (file.path)}
			{#if placeholderIndex !== null && i === placeholderIndex}
				<div class="gridnote-ft-file-placeholder" aria-hidden="true"></div>
			{/if}
			<!-- svelte-ignore a11y-no-static-element-interactions -->
			<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
			<div
				class="gridnote-ft-file-entry"
				class:is-active={file.path === activeFilePath}
				class:is-selected={$selection.selectedPaths.has(file.path)}
				class:is-cut={$clipboard.cutPaths.includes(file.path)}
				data-file-path={file.path}
				role="treeitem"
				aria-selected={file.path === activeFilePath}
				tabindex="0"
				bind:this={entryEls[i]}
				on:click={(e) => handleSelect(e, file)}
				on:dblclick={(e) => handleDoubleClick(e, file)}
				on:contextmenu={(e) => handleContextMenu(e, file)}
				on:keydown={(e) => handleKeydown(e, file)}
			>
				<div class="gridnote-ft-file-icon" bind:this={iconEls[i]}></div>
				<div class="gridnote-ft-file-name">
					{#each highlightSegments(file.basename, query) as seg}
						{#if seg.hit}<mark class="gridnote-ft-match">{seg.text}</mark>{/if}
						{#if !seg.hit}{seg.text}{/if}
					{/each}
				</div>
			</div>
		{/each}
		{#if placeholderIndex !== null && placeholderIndex >= renderedFiles.length}
			<div class="gridnote-ft-file-placeholder" aria-hidden="true"></div>
		{/if}
	</div>
{:else}
	<div class="gridnote-ft-file-list-empty">无文件</div>
{/if}

<style>
	:global(.gridnote-ft-file-list) {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 4px;
		width: 100%;
	}

	:global(.gridnote-ft-file-entry) {
		display: flex;
		align-items: flex-end;
		gap: 4px;
		width: 100%;
		padding: 6px;
		border-radius: 6px;
		font-size: var(--font-text-size);
		line-height: 1.2;
		color: var(--text-normal, var(--ct-text-primary));
		cursor: pointer;
		user-select: none;
		white-space: nowrap;
		font-family: inherit;
		overflow: hidden;
		transition: background 0.12s ease;
	}

	:global(.gridnote-ft-file-entry:hover) {
		background: var(--background-modifier-hover);
	}

	:global(.gridnote-ft-file-entry.is-active) {
		color: var(--interactive-accent, var(--ct-accent));
		font-weight: 600;
	}

	:global(.gridnote-ft-file-entry.is-active .gridnote-ft-file-icon) {
		color: var(--interactive-accent, var(--ct-accent));
	}

	:global(.gridnote-ft-file-entry.is-selected) {
		background: color-mix(in srgb, var(--interactive-accent, var(--ct-accent)) 14%, transparent);
		outline: 1px solid color-mix(in srgb, var(--interactive-accent, var(--ct-accent)) 35%, transparent);
	}

	:global(.gridnote-ft-file-entry.is-selected.is-active) {
		color: var(--interactive-accent, var(--ct-accent));
	}

	:global(.gridnote-ft-file-placeholder) {
		display: flex;
		align-items: center;
		padding: 6px;
		border-radius: 6px;
		background: color-mix(in srgb, var(--interactive-accent, var(--ct-accent)) 10%, transparent);
		border: 1.5px solid color-mix(in srgb, var(--interactive-accent, var(--ct-accent)) 35%, transparent);
		/* 与 file-entry 等高（border-box 下含 padding+border） */
		min-height: calc(var(--font-text-size) * 1.2 + 12px);
		animation: gridnote-ft-placeholder-pulse 1.2s ease-in-out infinite;
	}
 
	@keyframes gridnote-ft-placeholder-pulse {
		0%, 100% { opacity: 0.65; }
		50% { opacity: 1; }
	}

	:global(.gridnote-ft-file-entry.is-cut) {
		opacity: 0.5;
	}

	:global(.gridnote-ft-file-entry.is-cut .gridnote-ft-file-name) {
		text-decoration: underline dashed;
		text-decoration-color: var(--text-faint, var(--ct-text-muted));
		text-underline-offset: 3px;
	}

	:global(.gridnote-ft-file-entry.is-ft-file-reordering) {
		transition: transform 250ms cubic-bezier(0.2, 0, 0, 1);
	}

	:global(.gridnote-ft-file-icon) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1em;
		height: 1em;
		flex-shrink: 0;
		color: var(--text-faint, var(--ct-text-muted));
		transform: translateY(-1px);
	}

	:global(.gridnote-ft-file-icon svg) {
		width: 100% !important;
		height: 100% !important;
		display: block;
	}

	:global(.gridnote-ft-file-name) {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	:global(.gridnote-ft-file-name mark.gridnote-ft-match) {
		background: color-mix(in srgb, var(--interactive-accent) 22%, transparent);
		color: inherit;
		border-radius: 2px;
		padding: 0 1px;
		font-weight: 600;
	}

	:global(.gridnote-ft-file-list-empty) {
		padding: 8px;
		font-size: var(--font-text-size);
		color: var(--text-faint, var(--ct-text-muted));
		opacity: 0.7;
		font-style: italic;
	}
</style>

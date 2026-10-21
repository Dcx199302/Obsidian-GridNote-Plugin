<script lang="ts">
	import type { FileDragStore } from '../fileDnd/fileDragStore';

	export let dragStore: FileDragStore;
	const drag = dragStore;

	$: dragState = $drag;
	$: isActive = dragState.status === 'dragging' || dragState.status === 'hovering';
	$: paths = (dragState.status === 'dragging' || dragState.status === 'hovering') ? dragState.paths : [];
	$: count = paths.length;
	$: label = paths[0] ? paths[0].substring(paths[0].lastIndexOf('/') + 1) : '';
</script>

<!-- 永久渲染容器：controller 直接写入 style.transform 定位（绕过 Svelte reactivity），
     visibility 由 CSS class 控制（仅状态变化时触发 Svelte 更新） -->
<div class="gridnote-ft-file-drag-overlay" class:is-visible={isActive && count > 0}>
	{#if isActive && count > 0}
		<div class="gridnote-ft-file-drag-overlay-card">
			<span class="gridnote-ft-file-drag-overlay-name">{label}</span>
			{#if count > 1}
				<span class="gridnote-ft-file-drag-overlay-badge">×{count}</span>
			{/if}
		</div>
	{/if}
</div>

<style>
	:global(.gridnote-ft-file-drag-overlay) {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 10000;
		pointer-events: none;
		opacity: 0;
		will-change: transform;
		transition: opacity 0.12s ease;
	}
	:global(.gridnote-ft-file-drag-overlay.is-visible) {
		opacity: 1;
	}
	:global(.gridnote-ft-file-drag-overlay-card) {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		max-width: 280px;
		padding: 6px 12px;
		border: 1.5px solid var(--ct-accent, #3b82f6);
		border-radius: 8px;
		background: color-mix(in srgb, var(--background-primary, #fff) 92%, transparent);
		box-shadow: 0 12px 32px rgba(59, 130, 246, 0.28), 0 4px 12px rgba(0, 0, 0, 0.08);
		font-size: var(--font-ui-small, 13px);
		font-weight: 600;
		color: var(--text-normal, #1e293b);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: grabbing;
	}
	:global(.gridnote-ft-file-drag-overlay-name) {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	:global(.gridnote-ft-file-drag-overlay-badge) {
		flex-shrink: 0;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 9px;
		background: var(--ct-accent, #3b82f6);
		color: #fff;
		font-size: 11px;
		line-height: 18px;
		text-align: center;
	}
</style>

import { describe, it, expect } from 'vitest';
import { get } from 'svelte/store';
import { createFileSelectionStore, ROOT_FOLDER_ID } from '../../../../src/components/fileTree/fileDnd/fileSelectionStore';
import type { VaultFileEntry } from '../../../../src/components/fileTree/fileTreeTypes';

function entry(path: string): VaultFileEntry {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return {
		path,
		name,
		basename: dot > 0 ? name.slice(0, dot) : name,
		extension: dot > 0 ? name.slice(dot + 1) : '',
	};
}

const files = ['a.md', 'b.md', 'c.md', 'd.md'].map(entry);

describe('fileSelectionStore', () => {
	it('单选清空其余', () => {
		const s = createFileSelectionStore();
		s.select(ROOT_FOLDER_ID, 'a.md', 'none', files);
		s.select(ROOT_FOLDER_ID, 'b.md', 'toggle', files);
		s.select(ROOT_FOLDER_ID, 'c.md', 'none', files);
		expect(get(s).selectedPaths).toEqual(new Set(['c.md']));
		expect(get(s).activeFolderId).toBe(ROOT_FOLDER_ID);
		expect(get(s).anchorPath).toBe('c.md');
	});

	it('Ctrl/Cmd toggle 切换', () => {
		const s = createFileSelectionStore();
		s.select(ROOT_FOLDER_ID, 'a.md', 'none', files);
		s.select(ROOT_FOLDER_ID, 'c.md', 'toggle', files);
		expect(get(s).selectedPaths).toEqual(new Set(['a.md', 'c.md']));
		// 再 toggle 取消
		s.select(ROOT_FOLDER_ID, 'a.md', 'toggle', files);
		expect(get(s).selectedPaths).toEqual(new Set(['c.md']));
	});

	it('Shift 范围选中（含两端）', () => {
		const s = createFileSelectionStore();
		s.select(ROOT_FOLDER_ID, 'a.md', 'none', files);
		s.select(ROOT_FOLDER_ID, 'c.md', 'range', files);
		expect(get(s).selectedPaths).toEqual(new Set(['a.md', 'b.md', 'c.md']));
	});

	it('切换文件夹清空旧选中（跨文件夹不联动）', () => {
		const s = createFileSelectionStore();
		s.select(ROOT_FOLDER_ID, 'a.md', 'none', files);
		s.select(ROOT_FOLDER_ID, 'b.md', 'toggle', files);
		s.select('folder-1', 'x.md', 'none', files);
		expect(get(s).selectedPaths).toEqual(new Set(['x.md']));
		expect(get(s).activeFolderId).toBe('folder-1');
	});

	it('clear 清空所有', () => {
		const s = createFileSelectionStore();
		s.select(ROOT_FOLDER_ID, 'a.md', 'none', files);
		s.clear();
		expect(get(s).selectedPaths.size).toBe(0);
		expect(get(s).activeFolderId).toBeNull();
	});

	it('isSelected 同步反映当前态', () => {
		const s = createFileSelectionStore();
		s.select(ROOT_FOLDER_ID, 'a.md', 'none', files);
		expect(s.isSelected('a.md')).toBe(true);
		expect(s.isSelected('b.md')).toBe(false);
	});
});

import { describe, expect, it } from 'vitest';
import type { CardTreeNode } from '@xuchengdong/cardtree-svelte';
import type { FolderCardData, VaultFileEntry } from '../../../../src/components/fileTree/fileTreeTypes';
import { filterCardTree, filterRootFiles } from '../../../../src/components/fileTree/vaultTreeAdapter';
import { filterDirectFiles } from '../../../../src/components/fileTree/vaultTreeAdapter';
import { highlightSegments } from '../../../../src/components/fileTree/highlightSegments';

/** 构造一个 VaultFileEntry（basename = name 去扩展名） */
function file(path: string, name: string, basename?: string): VaultFileEntry {
	const dot = name.lastIndexOf('.');
	const base = basename ?? (dot > 0 ? name.slice(0, dot) : name);
	const ext = dot > 0 ? name.slice(dot + 1) : '';
	return { path, name, basename: base, extension: ext };
}

/** 构造一个文件夹节点；children 类型标注便于 filterNode 内部 as 断言一致 */
function folder(
	id: string,
	folderName: string,
	files: VaultFileEntry[] = [],
	children: CardTreeNode<FolderCardData>[] = [],
): CardTreeNode<FolderCardData> {
	return {
		id,
		label: folderName,
		content: files.length > 0 ? `${files.length}` : '',
		data: { path: id, folderName, files },
		children,
	};
}

describe('filterCardTree / filterNode', () => {
	it('空 query 直接原样返回', () => {
		const nodes = [folder('dev', '开发', [file('a.md', 'a.md')])];
		expect(filterCardTree(nodes, '')).toBe(nodes);
	});

	it('仅 basename 匹配，扩展名不再参与（搜 md 不命中所有 md 文件）', () => {
		const nodes = [folder('root', 'root', [
			file('a.md', 'a.md'),       // basename "a"，不匹配 "md"
			file('md.md', 'md.md'),     // basename "md"，命中
			file('b.md', 'b.md'),       // basename "b"，不匹配
		])];
		const out = filterCardTree(nodes, 'md');
		expect(out).toHaveLength(1);
		expect(out[0]!.data.files.map(f => f.name)).toEqual(['md.md']);
	});

	it('文件夹名命中 → 直属文件全保留，子文件夹仍递归剪枝', () => {
		const subHit = folder('sub1', '子1', [file('x.md', 'x.md')]);
		const subMiss = folder('sub2', '子2', [file('y.md', 'y.md')]);
		const parent = folder('dev', '开发', [
			file('readme.md', 'readme.md'),
			file('todo.md', 'todo.md'),
		], [subHit, subMiss]);
		const out = filterCardTree([parent], '开发');
		expect(out).toHaveLength(1);
		const dev = out[0]!;
		// 直属文件全保留
		expect(dev.data.files.map(f => f.name)).toEqual(['readme.md', 'todo.md']);
		// 子文件夹仍递归剪枝：子1 的文件 basename "x" 不命中 "开发" → 子1 被整体丢弃
		expect(dev.children).toHaveLength(0);
	});

	it('文件夹名未命中 + 子树有命中 → 骨架保留，直属文件只留命中', () => {
		const sub = folder('docs', 'docs', [file('api.md', 'api.md')]);
		const parent = folder('root', 'root', [
			file('a.md', 'a.md'),
			file('api.md', 'api.md'),
		], [sub]);
		const out = filterCardTree([parent], 'api');
		expect(out).toHaveLength(1);
		const r = out[0]!;
		// 直属文件仅 basename 命中的 "api.md"
		expect(r.data.files.map(f => f.name)).toEqual(['api.md']);
		// 子文件夹保留为骨架，其内部也命中
		expect(r.children).toHaveLength(1);
		expect(r.children[0]!.data.files.map(f => f.name)).toEqual(['api.md']);
	});

	it('文件夹名未命中 + 无任何命中 → 整体丢弃（返回 null）', () => {
		const nodes = [folder('ghost', 'ghost', [file('zzz.md', 'zzz.md')])];
		expect(filterCardTree(nodes, 'api')).toEqual([]);
	});

	it('大小写不敏感', () => {
		const nodes = [folder('root', 'root', [file('Daily.md', 'Daily.md')])];
		const out = filterCardTree(nodes, 'DAILY');
		expect(out).toHaveLength(1);
		expect(out[0]!.data.files).toHaveLength(1);
	});

	it('whitespace query 视为空（原样返回）', () => {
		const nodes = [folder('root', 'root', [file('a.md', 'a.md')])];
		expect(filterCardTree(nodes, '   ')).toBe(nodes);
	});
});

describe('filterRootFiles', () => {
	it('仅 basename 匹配，扩展名不再参与', () => {
		const files = [
			file('a.md', 'a.md'),
			file('md.md', 'md.md'),
			file('canvas.canvas', 'canvas.canvas'),
		];
		// 搜 "md"：只命中 basename==="md" 的 md.md
		expect(filterRootFiles(files, 'md').map(f => f.name)).toEqual(['md.md']);
		// 搜 "canvas"：命中 canvas.canvas 的 basename
		expect(filterRootFiles(files, 'canvas').map(f => f.name)).toEqual(['canvas.canvas']);
	});

	it('空 query 原样返回', () => {
		const files = [file('a.md', 'a.md')];
		expect(filterRootFiles(files, '')).toBe(files);
	});

	it('大小写不敏感', () => {
		const files = [file('Daily.md', 'Daily.md')];
		expect(filterRootFiles(files, 'daily')).toHaveLength(1);
	});
});

describe('highlightSegments', () => {
	it('空 query → 整段返回单段非命中', () => {
		expect(highlightSegments('日记', '')).toEqual([{ text: '日记', hit: false }]);
		expect(highlightSegments('日记', '   ')).toEqual([{ text: '日记', hit: false }]);
	});

	it('单次命中切分正确（前后各一段非命中）', () => {
		expect(highlightSegments('2024日记', '日记')).toEqual([
			{ text: '2024', hit: false },
			{ text: '日记', hit: true },
		]);
	});

	it('多次命中全部切分', () => {
		expect(highlightSegments('aXaXa', 'x')).toEqual([
			{ text: 'a', hit: false },
			{ text: 'X', hit: true },
			{ text: 'a', hit: false },
			{ text: 'X', hit: true },
			{ text: 'a', hit: false },
		]);
	});

	it('大小写不敏感', () => {
		const segs = highlightSegments('Daily', 'DAILY');
		expect(segs).toEqual([{ text: 'Daily', hit: true }]);
	});

	it('未命中 → 整段非命中', () => {
		expect(highlightSegments('hello', 'zzz')).toEqual([{ text: 'hello', hit: false }]);
	});

	it('空 text → 单段空非命中', () => {
		expect(highlightSegments('', 'q')).toEqual([{ text: '', hit: false }]);
	});

	it('命中片段长度等于 query 长度（保留原大小写）', () => {
		const segs = highlightSegments('FooBar', 'ob');
		const hit = segs.find(s => s.hit);
		expect(hit?.text).toBe('oB');
	});
});

describe('filterDirectFiles（渲染层与 filterNode 共用的文件过滤规则）', () => {
	it('空 query → 原样返回全量', () => {
		const files = [file('a.md', 'a.md'), file('b.md', 'b.md')];
		expect(filterDirectFiles('root', files, '')).toBe(files);
	});

	it('文件夹名命中 query → 直属文件全保留（即使 basename 不匹配）', () => {
		const files = [file('a.md', 'a.md'), file('b.md', 'b.md'), file('c.md', 'c.md')];
		// 搜 "root"，文件夹名命中 → 所有文件保留
		expect(filterDirectFiles('root', files, 'root')).toHaveLength(3);
	});

	it('文件夹名未命中 → 仅 basename 命中的文件保留', () => {
		const files = [file('react.md', 'react.md'), file('vue.md', 'vue.md'), file('angular.md', 'angular.md')];
		// 搜 "react"，文件夹名 "框架" 不命中 → 仅 react.md 保留
		expect(filterDirectFiles('框架', files, 'react').map(f => f.name)).toEqual(['react.md']);
	});

	it('文件夹名未命中且无 basename 命中 → 返回空数组（骨架文件夹显示空）', () => {
		const files = [file('a.md', 'a.md'), file('b.md', 'b.md')];
		expect(filterDirectFiles('前端', files, 'react')).toEqual([]);
	});

	it('大小写不敏感', () => {
		const files = [file('React.md', 'React.md')];
		expect(filterDirectFiles('框架', files, 'REACT')).toHaveLength(1);
	});
});

describe('空状态判定 hasNoMatch（组合断言）', () => {
	it('根散文件为空且 cardtree 过滤结果为空 → 无匹配', () => {
		const nodes = [folder('ghost', 'ghost', [file('zzz.md', 'zzz.md')])];
		const filteredNodes = filterCardTree(nodes, 'nomatch');
		const filteredRoot = filterRootFiles([], 'nomatch');
		const hasNoMatch = filteredRoot.length === 0 && filteredNodes.length === 0;
		expect(hasNoMatch).toBe(true);
	});

	it('cardtree 有命中但根散文件为空 → 非空状态', () => {
		const nodes = [folder('dev', '开发', [file('a.md', 'a.md')])];
		const filteredNodes = filterCardTree(nodes, '开发');
		const filteredRoot = filterRootFiles([], '开发');
		const hasNoMatch = filteredRoot.length === 0 && filteredNodes.length === 0;
		expect(hasNoMatch).toBe(false);
	});

	it('根散文件有命中但 cardtree 为空 → 非空状态', () => {
		const filteredNodes = filterCardTree([], 'md');
		const filteredRoot = filterRootFiles([file('md.md', 'md.md')], 'md');
		const hasNoMatch = filteredRoot.length === 0 && filteredNodes.length === 0;
		expect(hasNoMatch).toBe(false);
	});
});

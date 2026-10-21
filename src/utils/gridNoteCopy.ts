import { App, Component, MarkdownRenderer } from 'obsidian';
import type { DocumentStructure, TreeNode } from '../types';
import { readMarkdownLineRange } from './markdownEdit';
import { resolveCurrentTreeNodeRange } from './treeNodeRange';

export enum GridNoteCopyAction {
    COPY_FULL_TEXT = 'copy-full-text',
    COPY_CURRENT_NODE = 'copy-current-node',
    COPY_WITH_CHILDREN = 'copy-with-children',
    COPY_RENDERED_CURRENT_NODE = 'copy-rendered-current-node',
    COPY_RENDERED_WITH_CHILDREN = 'copy-rendered-with-children',
    COPY_AS_IMAGE = 'copy-as-image'
}

export interface GridNoteCopyMenuItem {
    action: GridNoteCopyAction;
    title: string;
    icon: string;
    separatorBefore?: boolean;
}

export const GRID_NOTE_COPY_MENU_ITEMS: GridNoteCopyMenuItem[] = [
    {
        action: GridNoteCopyAction.COPY_FULL_TEXT,
        title: '复制整个文档',
        icon: 'copy-plus'
    },
    {
        action: GridNoteCopyAction.COPY_CURRENT_NODE,
        title: '复制此节点（纯文本）',
        icon: 'copy-minus',
        separatorBefore: true
    },
    {
        action: GridNoteCopyAction.COPY_WITH_CHILDREN,
        title: '复制节点及子节点（纯文本）',
        icon: 'copy'
    },
    {
        action: GridNoteCopyAction.COPY_RENDERED_CURRENT_NODE,
        title: '复制此节点（富文本）',
        icon: 'file-text',
        separatorBefore: true
    },
    {
        action: GridNoteCopyAction.COPY_RENDERED_WITH_CHILDREN,
        title: '复制节点及子节点（富文本）',
        icon: 'files'
    },
    {
        action: GridNoteCopyAction.COPY_AS_IMAGE,
        title: '分享为图片',
        icon: 'image',
        separatorBefore: true
    }
];

function stripRenderedClipboardArtifacts(containerEl: HTMLElement): void {
    containerEl.querySelectorAll(
        '.copy-code-button, .markdown-embed-link, .inline-title'
    ).forEach((element) => element.remove());
}

export function readTreeNodeMarkdown(
    bodyMarkdown: string,
    structure: DocumentStructure | null,
    node: TreeNode
): string | null {
    const currentRange = resolveCurrentTreeNodeRange(structure, node);
    if (!currentRange) {
        return null;
    }

    return readMarkdownLineRange(
        bodyMarkdown,
        currentRange.startLine,
        currentRange.endLine
    );
}

export async function copyMarkdownAsRichText(
    app: App,
    markdown: string,
    sourcePath: string
): Promise<void> {
    const tempEl = document.createElement('div');
    const tempComponent = new Component();

    try {
        await MarkdownRenderer.render(
            app,
            markdown,
            tempEl,
            sourcePath,
            tempComponent
        );

        stripRenderedClipboardArtifacts(tempEl);

        const html = tempEl.innerHTML;
        const plainText = tempEl.innerText;

        try {
            const htmlBlob = new Blob([html], { type: 'text/html' });
            const textBlob = new Blob([plainText], { type: 'text/plain' });

            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': htmlBlob,
                    'text/plain': textBlob
                })
            ]);
        } catch (_error) {
            await navigator.clipboard.writeText(plainText);
        }
    } finally {
        tempComponent.unload();
    }
}

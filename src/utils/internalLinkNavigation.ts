import { Notice, TFile, parseLinktext } from 'obsidian';
import type { App, WorkspaceLeaf } from 'obsidian';

interface ViewWithFileLike {
    file?: {
        path?: unknown;
    };
    getFile?: () => unknown;
}

interface ViewStateWithFileLike {
    state?: {
        file?: unknown;
    };
}

function toNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function resolveSourceFile(app: App, sourcePath: string): TFile | null {
    const abstractFile = app.vault.getAbstractFileByPath(sourcePath);
    return abstractFile instanceof TFile ? abstractFile : null;
}

function resolveTargetFile(app: App, sourcePath: string, linktext: string): TFile | null {
    const { path: rawPath } = parseLinktext(linktext);
    const linkPath = rawPath.trim();

    if (!linkPath) {
        return resolveSourceFile(app, sourcePath);
    }

    return app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
}

function resolveLeafFilePath(leaf: WorkspaceLeaf): string | null {
    const view = leaf.view as ViewWithFileLike;

    const directFilePath = toNonEmptyString(view.file?.path);
    if (directFilePath) {
        return directFilePath;
    }

    if (typeof view.getFile === 'function') {
        const fileLike = view.getFile() as { path?: unknown } | null;
        const viewFilePath = toNonEmptyString(fileLike?.path);
        if (viewFilePath) {
            return viewFilePath;
        }
    }

    const viewState = leaf.getViewState() as ViewStateWithFileLike;
    return toNonEmptyString(viewState.state?.file);
}

function isLeafInMainWorkspace(app: App, leaf: WorkspaceLeaf): boolean {
    return leaf.getRoot() === app.workspace.rootSplit;
}

function findOpenedLeafByFilePath(app: App, filePath: string): WorkspaceLeaf | null {
    const candidates: WorkspaceLeaf[] = [];
    app.workspace.iterateAllLeaves((leaf) => {
        if (isLeafInMainWorkspace(app, leaf)) {
            candidates.push(leaf);
        }
    });

    for (const leaf of candidates) {
        const leafFilePath = resolveLeafFilePath(leaf);
        if (leafFilePath === filePath) {
            return leaf;
        }
    }

    return null;
}

export async function openInternalLinkWithLeafReuse(
    app: App,
    sourcePath: string,
    linktext: string
): Promise<boolean> {
    const normalizedLinktext = linktext.trim();
    if (!sourcePath || !normalizedLinktext) {
        return false;
    }

    const targetFile = resolveTargetFile(app, sourcePath, normalizedLinktext);
    if (!targetFile) {
        new Notice(`未找到链接目标：${normalizedLinktext}`);
        return false;
    }

    const openedLeaf = findOpenedLeafByFilePath(app, targetFile.path);
    if (openedLeaf) {
        app.workspace.setActiveLeaf(openedLeaf, { focus: true });
        await app.workspace.openLinkText(normalizedLinktext, sourcePath, false, {
            active: true
        });
        return true;
    }

    await app.workspace.openLinkText(normalizedLinktext, sourcePath, 'tab', {
        active: true
    });
    return true;
}

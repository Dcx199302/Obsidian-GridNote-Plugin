import type { App } from 'obsidian';

interface AppSettingManager {
	open: () => void;
	openTabById: (pluginId: string) => void;
}

interface AppWithSettingManager {
	setting?: unknown;
}

function isSettingManager(value: unknown): value is AppSettingManager {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Partial<AppSettingManager>;
	return typeof candidate.open === 'function' && typeof candidate.openTabById === 'function';
}

export function getSettingManager(app: App): AppSettingManager | null {
	const candidate = app as App & AppWithSettingManager;
	return isSettingManager(candidate.setting) ? candidate.setting : null;
}

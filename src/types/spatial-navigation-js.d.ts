declare module 'spatial-navigation-js' {
    interface SpatialNavigationSectionConfig {
        selector?: string | Element | Element[] | NodeListOf<Element>;
        straightOnly?: boolean;
        straightOverlapThreshold?: number;
        rememberSource?: boolean;
        disabled?: boolean;
        defaultElement?: string;
        enterTo?: '' | 'last-focused' | 'default-element';
        leaveFor?: Record<'left' | 'right' | 'up' | 'down', string> | null;
        restrict?: 'self-first' | 'self-only' | 'none';
        tabIndexIgnoreList?: string;
        navigableFilter?: ((element: Element, sectionId: string) => boolean) | null;
    }

    interface SpatialNavigationApi {
        init(): void;
        uninit(): void;
        clear(): void;
        add(sectionId: string, config: SpatialNavigationSectionConfig): string;
        remove(sectionId: string): boolean;
        set(sectionId: string, config: SpatialNavigationSectionConfig): void;
        disable(sectionId: string): boolean;
        enable(sectionId: string): boolean;
        pause(): void;
        resume(): void;
        focus(target?: string | Element, silent?: boolean): boolean;
        move(direction: 'left' | 'right' | 'up' | 'down', selector?: string): boolean;
        makeFocusable(sectionId?: string): void;
        setDefaultSection(sectionId?: string): void;
    }

    const SpatialNavigation: SpatialNavigationApi;
    export default SpatialNavigation;
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { StageScroller } from '../../../../src/components/gridNoteContent/StageScroller';

interface FakeRect {
    top: number;
    bottom: number;
    height: number;
}

function createStage() {
    const stage = {
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 400,
        getBoundingClientRect(): FakeRect {
            return { top: 0, bottom: 400, height: 400 };
        }
    };
    return stage as unknown as HTMLElement;
}

function createTarget(documentTop: number, stage: HTMLElement) {
    return {
        getBoundingClientRect(): FakeRect {
            const top = documentTop - stage.scrollTop;
            return { top, bottom: top + 20, height: 20 };
        }
    } as unknown as HTMLElement;
}

describe('StageScroller', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

it('scrolls a history change point into the deterministic safe zone', () => {
        const frames = new Map<number, FrameRequestCallback>();
        let nextFrameId = 1;
        let now = 0;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            const id = nextFrameId++;
            frames.set(id, callback);
            return id;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => {
            frames.delete(id);
        });
        vi.stubGlobal('performance', { now: () => now });
        vi.stubGlobal('window', {
            requestAnimationFrame: (callback: FrameRequestCallback) => {
                const id = nextFrameId++;
                frames.set(id, callback);
                return id;
            },
            cancelAnimationFrame: (id: number) => {
                frames.delete(id);
            }
        });

        const scroller = new StageScroller();
        const stage = createStage();
        stage.scrollTop = 100;
        scroller.stage = stage;

        const target = createTarget(700, stage);
        scroller.scrollPointIntoChangeZone(target);

        while (frames.size > 0) {
            const [frameId, callback] = [...frames.entries()][0]!;
            frames.delete(frameId);
            now += 16;
            callback(now);
        }

        expect(stage.scrollTop).toBe(372);
    });

    it('jumps immediately to a distant search reveal target', () => {
        vi.stubGlobal('requestAnimationFrame', vi.fn());
        vi.stubGlobal('window', {
            requestAnimationFrame: vi.fn(),
            cancelAnimationFrame: vi.fn()
        });

        const scroller = new StageScroller();
        const stage = createStage();
        stage.scrollTop = 0;
        scroller.stage = stage;

        const target = createTarget(520, stage);
        scroller.scrollToRevealAnchor(target, true);

        expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
        expect(stage.scrollTop).toBe(464);
    });

    it('cancels a superseded animation instead of letting an old target continue scrolling', () => {
        const frames = new Map<number, FrameRequestCallback>();
        let nextFrameId = 1;
        let now = 0;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            const id = nextFrameId++;
            frames.set(id, callback);
            return id;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => {
            frames.delete(id);
        });
        vi.stubGlobal('performance', { now: () => now });
        vi.stubGlobal('window', {
            requestAnimationFrame: (callback: FrameRequestCallback) => {
                const id = nextFrameId++;
                frames.set(id, callback);
                return id;
            },
            cancelAnimationFrame: (id: number) => {
                frames.delete(id);
            }
        });

        const scroller = new StageScroller();
        const stage = createStage();
        scroller.stage = stage;

        const distantTarget = createTarget(500, stage);
        scroller.scrollCardIntoComfortZone(distantTarget);

        const runFrame = (frameId: number) => {
            const callback = frames.get(frameId);
            frames.delete(frameId);
            now += 16;
            callback!(now);
        };

        runFrame([...frames.keys()].at(-1)!);
        expect(stage.scrollTop).toBeGreaterThan(0);

        const activeFrameId = [...frames.keys()].at(-1)!;

        const scrollTopBeforeSupersede = stage.scrollTop;
        const visibleTarget = createTarget(300, stage);
        scroller.scrollCardIntoComfortZone(visibleTarget);

        for (const [frameId, callback] of [...frames.entries()]) {
            if (frameId !== activeFrameId) {
                now += 16;
                callback(now);
            }
        }

        expect(stage.scrollTop).toBe(scrollTopBeforeSupersede);
        expect(scroller.isProgrammaticScrollActive()).toBe(false);
    });
});

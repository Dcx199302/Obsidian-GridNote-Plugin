export class StageScroller {
    stage: HTMLElement | null = null;
    private animationFrame = 0;
    private animationToken = 0;
    private isProgrammaticScroll = false;
    private hasUserScrollIntent = false;

    cancelAnimation(): void {
        this.animationToken += 1;

        if (this.animationFrame !== 0) {
            window.cancelAnimationFrame(this.animationFrame);
            this.animationFrame = 0;
        }

        this.isProgrammaticScroll = false;
    }

    isProgrammaticScrollActive(): boolean {
        return this.isProgrammaticScroll;
    }

    markUserScrollIntent(): void {
        this.hasUserScrollIntent = true;
    }

    hasUserScrolledPastProgrammaticTarget(): boolean {
        return Boolean(this.stage) && this.hasUserScrollIntent && !this.isProgrammaticScroll;
    }

    restoreViewportOffset(currentOffset: number, targetOffset: number): void {
        if (!this.stage) {
            return;
        }

        this.cancelAnimation();
        const nextScrollTop = this.clampScrollTop(
            this.stage.scrollTop + currentOffset - targetOffset
        );
        if (Math.abs(nextScrollTop - this.stage.scrollTop) < 1) {
            return;
        }

        this.setImmediateScrollTop(nextScrollTop);
    }

    scrollCardIntoComfortZone(targetEl: HTMLElement): void {
        if (!this.stage) {
            return;
        }

        // 每次新的定位请求都取代旧动画，避免两个目标交错滚动。
        this.cancelAnimation();
        this.hasUserScrollIntent = false;

        const scrollEl = this.stage;
        const stageRect = scrollEl.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const comfortPadding = Math.min(120, Math.max(56, stageRect.height * 0.18));
        const topBoundary = stageRect.top + comfortPadding;
        const bottomBoundary = stageRect.bottom - comfortPadding;

        let targetScrollTop = scrollEl.scrollTop;
        if (targetRect.top < topBoundary) {
            targetScrollTop += targetRect.top - topBoundary;
        } else if (targetRect.bottom > bottomBoundary) {
            targetScrollTop += targetRect.bottom - bottomBoundary;
        } else {
            return;
        }

        this.animateScrollTo(targetScrollTop);
    }

    scrollPointIntoChangeZone(
        targetEl: HTMLElement,
        pointOffset: number = 0
    ): void {
        if (!this.stage) {
            return;
        }

        this.cancelAnimation();
        this.hasUserScrollIntent = false;

        const stageRect = this.stage.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const safePadding = Math.min(
            120,
            Math.max(64, stageRect.height * 0.18)
        );
        const targetTop = targetRect.top + Math.max(
            0,
            Math.min(pointOffset, targetRect.height)
        );
        const topBoundary = stageRect.top + safePadding;
        const bottomBoundary = stageRect.bottom - safePadding;

        let targetScrollTop = this.stage.scrollTop;
        if (targetTop < topBoundary) {
            targetScrollTop += targetTop - topBoundary;
        } else if (targetTop > bottomBoundary) {
            targetScrollTop += targetTop - bottomBoundary;
        } else {
            return;
        }

        this.animateScrollTo(targetScrollTop);
    }

    scrollToRevealAnchor(targetEl: HTMLElement, immediate = false): void {
        if (!this.stage) {
            return;
        }

        this.cancelAnimation();
        this.hasUserScrollIntent = false;

        const stageRect = this.stage.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const revealPadding = Math.min(
            96,
            Math.max(48, stageRect.height * 0.14)
        );
        const targetScrollTop = this.stage.scrollTop
            + (targetRect.top - stageRect.top)
            - revealPadding;

        if (immediate) {
            this.setImmediateScrollTop(targetScrollTop);
            return;
        }

        this.animateScrollTo(targetScrollTop);
    }

    private clampScrollTop(target: number): number {
        if (!this.stage) {
            return target;
        }

        const maxScrollTop = Math.max(
            0,
            this.stage.scrollHeight - this.stage.clientHeight
        );
        return Math.min(Math.max(target, 0), maxScrollTop);
    }

    private animateScrollTo(targetScrollTop: number): void {
        if (!this.stage) {
            return;
        }

        const animationToken = this.animationToken;
        const scrollEl = this.stage;
        const startScrollTop = scrollEl.scrollTop;
        const nextScrollTop = this.clampScrollTop(targetScrollTop);
        const distance = nextScrollTop - startScrollTop;
        if (Math.abs(distance) < 1) {
            this.setImmediateScrollTop(nextScrollTop);
            return;
        }

        this.isProgrammaticScroll = true;
        const duration = Math.min(180, Math.max(90, Math.abs(distance) * 0.2));
        const startTime = performance.now();
        const easeOutCubic = (progress: number) => 1 - ((1 - progress) ** 3);

        const step = (timestamp: number) => {
            if (animationToken !== this.animationToken) {
                return;
            }

            const elapsed = timestamp - startTime;
            const progress = Math.min(elapsed / duration, 1);
            scrollEl.scrollTop = startScrollTop + (distance * easeOutCubic(progress));

            if (progress < 1) {
                this.animationFrame = window.requestAnimationFrame(step);
                return;
            }

            scrollEl.scrollTop = nextScrollTop;
            this.animationFrame = 0;
            this.isProgrammaticScroll = false;
        };

        this.animationFrame = window.requestAnimationFrame(step);
    }

    private setImmediateScrollTop(nextScrollTop: number): void {
        if (!this.stage) {
            return;
        }

        const animationToken = this.animationToken;
        this.stage.scrollTop = nextScrollTop;
        this.isProgrammaticScroll = true;
        window.requestAnimationFrame(() => {
            if (animationToken === this.animationToken) {
                this.isProgrammaticScroll = false;
            }
        });
    }
}

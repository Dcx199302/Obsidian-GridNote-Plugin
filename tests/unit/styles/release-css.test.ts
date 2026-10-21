import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('release CSS', () => {
    const css = readFileSync(resolve(__dirname, '../../../styles.css'), 'utf8');

    it('avoids high-priority declarations rejected by plugin review', () => {
        expect(css).not.toContain('!important');
    });

    it('avoids broad :has selectors rejected by plugin review', () => {
        expect(css).not.toContain(':has(');
    });

    it('uses plugin-owned classes for review-safe overrides', () => {
        expect(css).toContain('.gridnote-view-header::before');
        expect(css).toContain('.gridnote-prompt-modal .setting-item');
    });
});

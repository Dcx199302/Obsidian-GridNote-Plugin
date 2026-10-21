import { describe, expect, it } from 'vitest';
import { cyrb53, generateContentHash } from '../../../src/utils/hash';

describe('hash utilities', () => {
	it('returns deterministic hashes for the same input', () => {
		expect(cyrb53('grid-note')).toBe(cyrb53('grid-note'));
		expect(cyrb53('grid-note')).not.toBe(cyrb53('grid-note', 1));
	});

	it('only uses the first 100 characters when generating content hashes', () => {
		const sharedPrefix = 'a'.repeat(100);
		const first = generateContentHash('Title', `${sharedPrefix}first`);
		const second = generateContentHash('Title', `${sharedPrefix}second`);

		expect(first).toBe(second);
	});
});

import { describe, expect, it } from 'vitest';
import { handleShare, safeSharedName, type ShareStore } from '../../src/shareTarget.ts';

function memStore() {
  const saved: { name: string; size: number }[] = [];
  const store: ShareStore = {
    async save(name, file) {
      saved.push({ name, size: file.size });
    },
  };
  return { saved, store };
}

describe('share target', () => {
  it('stores every shared file field and ignores text fields', async () => {
    const fd = new FormData();
    fd.append('books', new File([new Uint8Array(5)], 'one.cbz'));
    fd.append('books', new File([new Uint8Array(7)], 'two.cbz'));
    fd.append('books', 'not a file');
    fd.append('other', new File([new Uint8Array(1)], 'ignored.cbz'));
    const { saved, store } = memStore();
    const n = await handleShare(new Request('http://x/share', { method: 'POST', body: fd }), store);
    expect(n).toBe(2);
    expect(saved.map((s) => s.size)).toEqual([5, 7]);
    expect(saved[0]!.name).toMatch(/one\.cbz$/);
  });

  it('caps the number of files at 50', async () => {
    const fd = new FormData();
    for (let i = 0; i < 60; i++) fd.append('books', new File([new Uint8Array(1)], `f${i}.cbz`));
    const { store } = memStore();
    expect(
      await handleShare(new Request('http://x/share', { method: 'POST', body: fd }), store),
    ).toBe(50);
  });

  it('sanitises file names against traversal and control characters', () => {
    const name = safeSharedName('..\..\evil/../a:b?.cbz', 3);
    expect(name).not.toMatch(/[\/:?]/);
    expect(name.endsWith('-3-a_b_.cbz')).toBe(true);
    expect(safeSharedName('...', 0)).toMatch(/shared\.bin$/);
  });
});

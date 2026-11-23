import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

test('GitHub Pages root opens the integrated 3D office', async () => {
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(index, /http-equiv=["']refresh["'][^>]*url=\.\/office3d\.html/i);
  assert.match(index, /window\.location\.replace\(["']\.\/office3d\.html["']\)/);
  await access(new URL('../office3d.html', import.meta.url));
  await access(new URL('../office-map.html', import.meta.url));
});

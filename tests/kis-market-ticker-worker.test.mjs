import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const worker = await readFile(new URL('../worker/SW_AI_OFFICE_Worker_v51_22_completion_audit.js', import.meta.url), 'utf8');

test('market quote action is explicitly allowlisted and read-only', () => {
  assert.match(worker, /"get_market_quote"/);
  assert.match(worker, /FHKST01010100/);
  assert.match(worker, /inquire-price/);
  assert.match(worker, /KIS_APP_KEY/);
  assert.match(worker, /KIS_APP_SECRET/);
  assert.match(worker, /KIS_TOKEN_CACHE/);
  assert.doesNotMatch(worker, /uapi\/domestic-stock\/v1\/trading\/order-cash/);
});

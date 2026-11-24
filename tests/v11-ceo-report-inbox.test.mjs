import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

const html = await readFile(new URL('../office-v11-preview.html', import.meta.url), 'utf8');

test('v11 CEO room renders locally saved final reports as a visible inbox', () => {
  assert.match(html, /id="ceoReportInbox"/);
  assert.match(html, /id="ceoReportInboxHeading"/);
  assert.match(html, /id="ceoReportInboxList"/);
  assert.match(html, /function renderCeoReportInbox\(\)/);
  assert.match(html, /Array\.isArray\(st\.hist\.ceo1\)\?st\.hist\.ceo1:\[\]/);
  assert.match(html, /message\.show\|\|message\.content/);
  assert.match(html, /if\(e\.id==="ceo1"\)renderCeoReportInbox\(\)/);
});

test('CEO report cards preserve the existing server approval and rejection actions', () => {
  assert.match(html, /reject\.onclick=\(\)=>srvDecide\(act,"REJECT"\)/);
  assert.match(html, /approve\.onclick=\(\)=>srvDecide\(act,"APPROVE"\)/);
  assert.match(html, /act\.releaseAllowed/);
  assert.match(html, /승인 보류 사유:/);
});

test('v11 preview inline scripts remain syntactically valid', () => {
  const inlineScripts = html.split('<script>').slice(1).map(part => part.split('</script>')[0]);
  inlineScripts.forEach(script => new Script(script));
});

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

test('server report inbox restores reports from D1 using representative-only read authentication', () => {
  assert.match(html, /id="ceoReportRefresh"/);
  assert.match(html, /id="ceoReportInboxSource"/);
  assert.match(html, /async function srvRestoreCeoReportInbox\(\)/);
  assert.match(html, /action:"get_recent_tasks",limit:30\},srvReadAuth\(\)/);
  assert.ok(html.includes('action:"get_task_history",taskId:String(task.taskId||"")},srvReadAuth()'));
  assert.match(html, /function srvReadAuth\(\)\{return \{"X-Representative-Authorization":"Bearer "\+srvCfg\.rep\}\}/);
  assert.match(html, /서버 저장 · 업무번호/);
  assert.match(html, /대표 전용 토큰 \(보고 조회·승인·반려에 사용\)/);
});

test('v11 preview inline scripts remain syntactically valid', () => {
  const inlineScripts = html.split('<script>').slice(1).map(part => part.split('</script>')[0]);
  inlineScripts.forEach(script => new Script(script));
});

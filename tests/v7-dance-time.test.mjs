import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const file = new URL("../sw-ai-office-v7(claude).html", import.meta.url);
const html = fs.readFileSync(file, "utf8");
const workerFile = new URL("../worker/SW_AI_OFFICE_Worker_v51_22_completion_audit.js", import.meta.url);
const worker = fs.readFileSync(workerFile, "utf8");

test("v7 inline JavaScript parses without syntax errors", () => {
  const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((script) => script.trim());
  assert.ok(scripts.length > 0, "Expected at least one inline application script");
  scripts.forEach((script) => {
    assert.doesNotThrow(() => new vm.Script(script, { filename: "v7-inline.js" }));
  });
});

test("Alex routes dance-time commands before normal AI task execution", () => {
  const start = html.indexOf("async function send()");
  const end = html.indexOf('$("#send").onclick=send', start);
  assert.ok(start >= 0 && end > start, "send() handler must exist");
  const send = html.slice(start, end);
  assert.match(send, /if\(e\.id==="alex"\)/);
  assert.match(send, /댄스타임/);
  assert.ok(send.indexOf("startDanceTime") < send.indexOf("runDirective"));
});

test("all AI employees except the representative gather in one hallway row", () => {
  assert.match(html, /chars\.filter\(c=>c\.e\.id!=="ceo1"\)/);
  assert.match(html, /const spacing=dancers\.length>1\?90\/\(dancers\.length-1\):0/);
  assert.match(html, /x=4\+i\*spacing,z=22\.5/);
  assert.match(html, /c\.mode="dance"/);
});

test("dance animation and return-to-desk command are present", () => {
  assert.match(html, /c\.mode==="dance"/);
  assert.match(html, /async function stopDanceTime\(command\)/);
  assert.match(html, /await goDesk\(c,tok\)/);
});

test("automatic wandering and research pause during dance-time", () => {
  assert.match(html, /st\.wfRun\|\|danceActive/);
  assert.match(html, /danceActive\|\|researchRunning/);
});

test("representative and team lead names match the approved SW AI OFFICE organization", () => {
  assert.match(html, /\["ceo1","피터","대표이사"/);
  assert.match(html, /\["peter","렉스","법무팀장"/);
  assert.match(html, /\["jenny","데니스","경영관리팀장"/);
  assert.doesNotMatch(html, /단테|제니/);
  assert.match(html, /사용자는 앱코\(ABKO\)의 대표이사 '피터'/);
});

test("server live progress uses the chronological audit event API contract", () => {
  const historyStart = worker.indexOf('const events = (rows.results || []).map');
  const historyEnd = worker.indexOf('const truncated = events.length > 300', historyStart);
  const historyBlock = worker.slice(historyStart, historyEnd);
  assert.match(worker, /ORDER BY created_at DESC, rowid DESC LIMIT 301/);
  assert.match(historyBlock, /\}\)\.reverse\(\);/);
  assert.match(html, /Date\\.parse\\(evs\\[evs\\.length-1\\]\\.createdAt\\)/);
  assert.match(html, /const ev=\\[\\.\\.\\.evs\\]\\.reverse\\(\\)\\.find\\(x=>x\\.eventType==="WORKFLOW_STAGE_STARTED"\\)/);
  assert.doesNotMatch(html, /evs\\[0\\]\\?\\.createdAt/);
});

test("the original 3D office scene and pathfinding remain in the file", () => {
  assert.match(html, /function init3d\(\)/);
  assert.match(html, /function buildGridNav\(\)/);
  assert.match(html, /EMP\.forEach\(addChar\)/);
});

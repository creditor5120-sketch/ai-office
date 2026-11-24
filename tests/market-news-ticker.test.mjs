import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../office-v11-preview.html', import.meta.url), 'utf8');

test('v11 includes an accessible fixed market and news ticker', () => {
  assert.match(html, /id="marketTicker"[^>]*role="region"/);
  assert.match(html, /aria-label="시세 및 뉴스"/);
  assert.match(html, /id="tickerTrack"/);
  assert.match(html, /id="tickerPause"/);
});

test('ticker does not fabricate live prices or headlines before a provider is connected', () => {
  assert.match(html, /데이터 공급원 미연결/);
  assert.match(html, /시세 데이터 연결 대기 중/);
  assert.match(html, /뉴스 공급원 연결 대기 중/);
  assert.doesNotMatch(html, /16,240|3,917\.76|874\.32/);
});

test('ticker supports safe provider-fed items and pause/resume controls', () => {
  assert.match(html, /window\.SWMarketTicker=\{setItems\}/);
  assert.match(html, /aria-pressed/);
  assert.match(html, /noopener noreferrer/);
  assert.match(html, /prefers-reduced-motion:reduce/);
});

test('v11 ticker polls the authenticated read-only Worker quote endpoint', () => {
  assert.match(html, /SWMarketTickerAuth=\{getQuote:async/);
  assert.match(html, /action:"get_market_quote"/);
  assert.match(html, /setInterval\(refreshAppkoQuote,30000\)/);
  assert.match(html, /한국투자증권 조회/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { fetchSiteData, SiteDataError } from '../lib/site-data.ts';
import { loadPoetryManifest } from '../lib/poetry-db.ts';

test('HTTP 200登录HTML不能作为JSON或二进制地形传给解析器', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const mock = t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        '<html><a href="/signin-with-chatgpt?return_to=%2F">使用 ChatGPT 继续</a></html>',
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      ),
  );
  for (const url of [
    '/data/china.geojson',
    '/data/terrain/relief.bin',
    '/data/poetry/manifest.json.gz',
  ]) {
    await assert.rejects(
      fetchSiteData(url),
      (e) => e instanceof SiteDataError && e.kind === 'login',
    );
  }
  assert.equal(mock.mock.calls[0].arguments[1].credentials, 'same-origin');
});

test('401、403、普通HTML与503分别提示身份或数据问题，不暴露响应内容', async (t) => {
  t.mock.method(console, 'warn', () => {});
  for (const [status, type, kind] of [
    [401, 'application/json', 'login'],
    [403, 'application/json', 'forbidden'],
    [503, 'text/plain', 'response'],
    [200, 'text/html', 'response'],
  ]) {
    const mock = t.mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response('<html>not-a-login secret-marker</html>', {
          status,
          headers: { 'content-type': type },
        }),
    );
    await assert.rejects(
      fetchSiteData('/data/china.geojson'),
      (e) => e.kind === kind && !e.message.includes('secret-marker'),
    );
    mock.mock.restore();
  }
});

test('登录失败不留在诗词缓存，重新验证后可读gzip，已被HTTP解压的JSON同样可读', async (t) => {
  t.mock.method(console, 'warn', () => {});
  let calls = 0;
  const meta = { candidatePoems: 124385, linkedAttractions: 2388 };
  t.mock.method(globalThis, 'fetch', async () => {
    if (++calls === 1)
      return new Response('<a href="/signin-with-chatgpt">登录</a>', {
        headers: { 'content-type': 'text/html' },
      });
    return new Response(gzipSync(JSON.stringify(meta)), {
      headers: { 'content-type': 'application/gzip' },
    });
  });
  await assert.rejects(loadPoetryManifest(), (e) => e.kind === 'login');
  assert.deepEqual(await loadPoetryManifest(), meta);
  assert.deepEqual(await loadPoetryManifest(), meta);
  assert.equal(calls, 2);
});

test('正常二进制响应不被提前消费，取消请求也不误报登录失效', async (t) => {
  const bytes = Uint8Array.from([0, 13, 255, 9]);
  const controller = new AbortController();
  const mock = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(bytes),
  );
  const r = await fetchSiteData('/data/terrain/relief.bin', {
    signal: controller.signal,
  });
  assert.equal(r.bodyUsed, false);
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), bytes);
  assert.equal(mock.mock.calls[0].arguments[1].signal, controller.signal);
  mock.mock.restore();
  t.mock.method(globalThis, 'fetch', async () => {
    throw new DOMException('aborted', 'AbortError');
  });
  await assert.rejects(fetchSiteData('/data/terrain/relief.bin'), {
    name: 'AbortError',
  });
});

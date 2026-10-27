import { describe, expect, test } from 'bun:test'
import { assertWebUrl } from './web-network'

const moduleUrl = new URL('./web-network.ts', import.meta.url).href

/** Bun 的 fetch 在当前版本不遵守 undici dispatcher；路由测试必须运行在 Electron 同类 Node 环境。 */
async function runNodeScenario(scenario: string): Promise<Record<string, unknown>> {
  const source = `
    import { createServer } from 'node:http';
    import { connect } from 'node:net';
    import { createManagedWebFetch } from ${JSON.stringify(moduleUrl)};
    const servers = []; const sockets = new Set();
    const networks = [];
    async function listen(handler) {
      const server = createServer(handler);
      server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
      servers.push(server);
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      return { server, port: server.address().port, url: 'http://127.0.0.1:' + server.address().port };
    }
    function network(proxy, options) { const value = createManagedWebFetch(proxy, options); networks.push(value); return value; }
    let result;
    try { ${scenario} }
    finally {
      await Promise.all(networks.map(value => value.close()));
      for (const socket of sockets) socket.destroy();
      await Promise.all(servers.map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
    }
    console.log(JSON.stringify(result));
  `
  const child = Bun.spawn(['node', '--input-type=module', '-e', source], { stdout: 'pipe', stderr: 'pipe' })
  const [output, errors, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (exitCode !== 0) throw new Error(`Node 网络验证失败：${errors}`)
  return JSON.parse(output) as Record<string, unknown>
}

describe('公开网页请求路由', () => {
  test('Given a reachable domestic page and a rejecting proxy When fetching Then succeeds directly without contacting the proxy', async () => {
    const result = await runNodeScenario(`
      const target = await listen((_, response) => response.end('国内页面'));
      let connects = 0; const proxy = await listen((_, response) => { connects++; response.writeHead(502); response.end(); });
      proxy.server.on('connect', (_, socket) => { connects++; socket.end('HTTP/1.1 502 Bad Gateway\\r\\nContent-Length: 0\\r\\n\\r\\n'); });
      process.env.HTTP_PROXY = proxy.url; process.env.HTTPS_PROXY = proxy.url;
      let route;
      const client = network(proxy.url, { onRoute: (_, value) => route = value });
      const response = await client.fetch(target.url);
      result = { status: response.status, text: await response.text(), connects, route };
    `)
    expect(result).toEqual({ status: 200, text: '国内页面', connects: 0, route: 'direct' })
  })

  test('Given direct connection resets When a configured proxy can reach the page Then falls back and reports proxy routing', async () => {
    const result = await runNodeScenario(`
      const target = await listen((request) => request.socket.destroy());
      const reachable = await listen((_, response) => response.end('代理页面'));
      // undici 7 为 HTTP 建隧道，undici 8 默认转发 HTTP；覆盖两种受支持实现。
      let connects = 0; const proxy = await listen((_, response) => { connects++; response.end('代理页面'); });
      proxy.server.on('connect', (_, socket, head) => {
        connects++;
        const upstream = connect(reachable.port, '127.0.0.1', () => {
          socket.write('HTTP/1.1 200 Connection Established\\r\\n\\r\\n');
          if (head.length) upstream.write(head);
          socket.pipe(upstream); upstream.pipe(socket);
        });
        socket.on('close', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
      });
      let route; const client = network(proxy.url, { onRoute: (_, value) => route = value });
      const response = await client.fetch(target.url);
      result = { text: await response.text(), connects, route };
    `)
    expect(result).toEqual({ text: '代理页面', connects: 1, route: 'proxy' })
  })

  test('Given caller cancellation When the direct request is pending Then does not contact the proxy', async () => {
    const result = await runNodeScenario(`
      const target = await listen(() => {}); let connects = 0;
      const proxy = await listen((_, response) => { connects++; response.end(); });
      proxy.server.on('connect', (_, socket) => { connects++; socket.destroy(); });
      const controller = new AbortController(); const client = network(proxy.url);
      setTimeout(() => controller.abort(), 40);
      let error; try { await client.fetch(target.url, { signal: controller.signal }); } catch (value) { error = value.name; }
      result = { error, connects };
    `)
    expect(result).toEqual({ error: 'AbortError', connects: 0 })
  })

  test('Given rate limiting When a response is 429 Then returns it without retrying another exit', async () => {
    const result = await runNodeScenario(`
      const target = await listen((_, response) => { response.writeHead(429); response.end('quota'); });
      let connects = 0; const proxy = await listen((_, response) => { connects++; response.end(); });
      proxy.server.on('connect', (_, socket) => { connects++; socket.destroy(); });
      const response = await network(proxy.url).fetch(target.url); await response.text();
      result = { status: response.status, connects };
    `)
    expect(result).toEqual({ status: 429, connects: 0 })
  })

  test('Given unsafe protocols or embedded credentials When validating a URL Then refuses before requesting', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:secret@example.com']) {
      expect(() => assertWebUrl(url)).toThrow()
    }
    expect(assertWebUrl('https://yz.chsi.com.cn/').hostname).toBe('yz.chsi.com.cn')
  })

  test('Given an unsupported SOCKS proxy and failed direct access When fetching Then reports the required proxy format without exposing credentials', async () => {
    const result = await runNodeScenario(`
      const target = await listen(request => request.socket.destroy());
      let error; try { await network('socks5://user:secret@127.0.0.1:12345').fetch(target.url); } catch (value) { error = value.message; }
      result = { error };
    `)
    expect(result.error).toContain('HTTP(S)')
    expect(result.error).not.toContain('secret')
  })
})

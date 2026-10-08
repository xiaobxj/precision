import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { applyCommand, emptyState, localDay } from './lib/domain.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const assets = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/bold.js', ['public/bold.js', 'text/javascript; charset=utf-8']],
  ['/status.js', ['public/status.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ['/notes.css', ['public/notes.css', 'text/css; charset=utf-8']],
  ['/notes.js', ['public/notes.js', 'text/javascript; charset=utf-8']],
  ['/images.js', ['public/images.js', 'text/javascript; charset=utf-8']],
  ['/images.css', ['public/images.css', 'text/css; charset=utf-8']],
  ['/domain.mjs', ['lib/domain.mjs', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['public/favicon.svg', 'image/svg+xml']],
]);

export function createApp({ dataDir = process.env.PROCISION_DATA_DIR || join(root, 'data') } = {}) {
  dataDir = resolve(dataDir);
  mkdirSync(join(dataDir, 'backups'), { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'procision.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL)');
  db.prepare('INSERT OR IGNORE INTO workspace (id, document) VALUES (1, ?)').run(JSON.stringify(emptyState()));
  db.exec('CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, mime TEXT NOT NULL, content BLOB NOT NULL, created_at TEXT NOT NULL)');
  const getState = () => JSON.parse(db.prepare('SELECT document FROM workspace WHERE id = 1').get().document);
  const exportState = () => {
    const state = getState();
    const images = db.prepare('SELECT id, mime, content, created_at FROM images').all();
    if (images.length) state.imageAssets = images.map(image => ({ id: image.id, mime: image.mime, createdAt: image.created_at, base64: Buffer.from(image.content).toString('base64') }));
    return state;
  };
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json(res, 403, { error: '只允许本机访问' });
      const url = new URL(req.url, `http://${host}`);
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { app: 'procision', workspace: root });
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, getState());
      if (req.method === 'GET' && /^\/api\/images\/[a-f0-9]{64}$/.test(url.pathname)) {
        const image = db.prepare('SELECT mime, content FROM images WHERE id = ?').get(url.pathname.split('/').at(-1));
        if (!image) return json(res, 404, { error: '未找到这张图片' });
        res.writeHead(200, { 'Content-Type': image.mime, 'Content-Length': image.content.byteLength, 'Cache-Control': 'private, max-age=31536000, immutable' });
        return res.end(Buffer.from(image.content));
      }
      if (req.method === 'POST' && url.pathname === '/api/images') {
        if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res, 403, { error: '请求来源无效' });
        const mime = req.headers['content-type'];
        if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime)) return json(res, 400, { error: '支持 PNG、JPG、GIF 和 WebP 图片' });
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 10 * 1024 * 1024) return json(res, 413, { error: '单张图片不能超过 10 MB' });
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        const detected = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
          : ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)) ? 'image/gif'
          : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
        if (detected !== mime) return json(res, 400, { error: '图片格式无效，请重新复制或选择图片' });
        const id = createHash('sha256').update(bytes).digest('hex');
        db.prepare('INSERT OR IGNORE INTO images (id, mime, content, created_at) VALUES (?, ?, ?, ?)').run(id, mime, bytes, new Date().toISOString());
        return json(res, 201, { id });
      }
      if (req.method === 'GET' && url.pathname === '/api/export') {
        res.setHeader('Content-Disposition', `attachment; filename="procision-${localDay()}.json"`);
        return json(res, 200, exportState());
      }
      if (req.method === 'POST' && url.pathname === '/api/commands') {
        if ((req.headers.origin && req.headers.origin !== `http://${host}`) || !req.headers['content-type']?.startsWith('application/json')) return json(res, 403, { error: '请求来源无效' });
        const buffers = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 1024 * 1024) return json(res, 413, { error: '内容过大，请拆分进度记录' });
          buffers.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(buffers).toString()); } catch { return json(res, 400, { error: '无效的请求内容' }); }
        if (!body || typeof body !== 'object' || !Number.isSafeInteger(body.revision)) return json(res, 400, { error: '无效的请求版本' });
        db.exec('BEGIN IMMEDIATE');
        try {
          const previous = getState();
          if (body.revision !== previous.revision) {
            db.exec('ROLLBACK');
            return json(res, 409, { error: '其他窗口更新了内容。已刷新数据，请检查后重试。', state: previous });
          }
          const next = applyCommand(previous, body.command);
          if (body.command.images) for (const image of body.command.images) {
            if (!db.prepare('SELECT id FROM images WHERE id = ?').get(image.id)) throw new Error('图片尚未保存，请等待上传成功后重试');
          }
          const backup = join(dataDir, 'backups', `${localDay()}.json`);
          if (!existsSync(backup)) writeFileSync(backup, JSON.stringify(exportState(), null, 2), { flag: 'wx' });
          db.prepare('UPDATE workspace SET document = ? WHERE id = 1').run(JSON.stringify(next));
          db.exec('COMMIT');
          return json(res, 200, next);
        } catch (error) {
          if (db.isTransaction) db.exec('ROLLBACK');
          if (error.code) throw error;
          return json(res, 400, { error: error.message });
        }
      }
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        return res.end(readFileSync(join(root, file)));
      }
      json(res, 404, { error: '页面不存在' });
    } catch (error) {
      console.error(error);
      json(res, 500, { error: '保存失败，请检查本地服务和磁盘空间。输入内容仍保留在窗口中。' });
    }
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4311);
  const app = createApp();
  app.listen(port, '127.0.0.1', () => console.log(`Procision is ready at http://127.0.0.1:${port}`));
  app.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : error); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close());
}

// lib/server.js
// 世界书编辑器 Web 服务（纯 Node http，零依赖）
// REST API + 静态页面。启动后浏览器访问 http://127.0.0.1:PORT/

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const core = require('./core.js');
const { validate } = require('./validate.js');
const io = require('./io.js');
const schema = require('./schema.js');

let ROOT = process.cwd(); // 默认工作目录

// ---------- 小工具 ----------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 50 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('请求体 JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function ok(res, data) { sendJson(res, 200, { ok: true, ...data }); }
function err(res, code, message) { sendJson(res, code || 400, { ok: false, error: message }); }

function resolveFile(p) {
  if (!p || typeof p !== 'string') throw new Error('缺少文件路径');
  // 允许绝对路径或相对 ROOT 的路径
  return path.isAbsolute(p) ? p : path.resolve(ROOT, p);
}

// 目标已存在时自动追加（1）（2）…，避免覆盖已有文件
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p);
  const dir = path.dirname(p);
  const stem = path.basename(p, ext);
  for (let n = 1; ; n++) {
    const cand = path.join(dir, `${stem}（${n}）${ext}`);
    if (!fs.existsSync(cand)) return cand;
  }
}

// ---------- API 处理 ----------

async function handleApi(req, res, pathname, query) {
  const route = pathname.replace(/^\/api\//, '');
  const body = req.method === 'POST' ? await readBody(req) : {};

  try {
    switch (route) {
      case 'ping': {
        ok(res, { message: 'pong', cwd: ROOT });
        return;
      }

      case 'dir': {
        // 文件浏览：列出目录内容（只读）。body.path 缺省用 ROOT。
        let p = (body.path || '').trim();
        if (!p) p = ROOT;
        if (!path.isAbsolute(p)) p = path.resolve(ROOT, p);
        const stat = fs.statSync(p);
        if (!stat.isDirectory()) throw new Error('不是目录: ' + p);
        const entries = fs.readdirSync(p, { withFileTypes: true }).sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name, 'zh-CN');
        });
        const dirs = [];
        const files = [];
        for (const ent of entries) {
          if (ent.isDirectory()) dirs.push(ent.name);
          else if (ent.isFile()) {
            let size;
            try { size = fs.statSync(path.join(p, ent.name)).size; } catch (e) { continue; } // 无权限访问的文件跳过
            const ext = path.extname(ent.name).toLowerCase();
            files.push({ name: ent.name, ext, size });
          }
        }
        const parent = path.dirname(p);
        ok(res, { path: p, parent: parent === p ? null : parent, root: ROOT, dirs, files });
        return;
      }

      case 'list': {
        const file = resolveFile(body.file || query.file);
        const wb = core.load(file);
        const list = Object.values(wb.entries).sort((a, b) => (a.order || 0) - (b.order || 0) || (a.uid || 0) - (b.uid || 0));
        ok(res, { file, name: wb.name, description: wb.description ?? '', count: list.length, entries: list });
        return;
      }

      case 'meta': {
        // 读取 / 更新世界书名称与描述。传 name/description 则更新并保存，否则只返回当前值。
        const file = resolveFile(body.file || query.file);
        const wb = core.load(file);
        const fields = {};
        if (body.name !== undefined) fields.name = body.name;
        if (body.description !== undefined) fields.description = body.description;
        if (Object.keys(fields).length > 0) {
          core.updateMeta(wb, fields);
          core.save(file, wb);
        }
        ok(res, { file, name: wb.name, description: wb.description ?? '' });
        return;
      }

      case 'get': {
        const file = resolveFile(body.file || query.file);
        const wb = core.load(file);
        const e = wb.entries[String(body.uid)];
        if (!e) throw new Error('条目 #' + body.uid + ' 不存在');
        ok(res, { entry: e });
        return;
      }

      case 'create': {
        const file = resolveFile(body.file);
        const r = core.create(file, body.name || '新世界书');
        ok(res, r);
        return;
      }

      case 'add': {
        const file = resolveFile(body.file);
        const wb = core.load(file);
        const e = core.addEntry(wb, body.fields || {});
        core.save(file, wb);
        ok(res, { uid: e.uid, entry: e });
        return;
      }

      case 'update': {
        const file = resolveFile(body.file);
        const wb = core.load(file);
        const e = core.updateEntry(wb, body.uid, body.fields || {});
        core.save(file, wb);
        ok(res, { uid: e.uid, entry: e });
        return;
      }

      case 'remove': {
        const file = resolveFile(body.file);
        const wb = core.load(file);
        core.removeEntry(wb, body.uid);
        core.save(file, wb);
        ok(res, { removed: body.uid });
        return;
      }

      case 'batch': {
        const file = resolveFile(body.file);
        const wb = core.load(file);
        const r = core.batch(wb, body.ids || [], body.action, body.value);
        core.save(file, wb);
        ok(res, r);
        return;
      }

      case 'search': {
        const file = resolveFile(body.file || query.file);
        const wb = core.load(file);
        const list = core.search(wb, body.query || '', { exact: !!body.exact });
        ok(res, { count: list.length, entries: list });
        return;
      }

      case 'validate': {
        const file = resolveFile(body.file || query.file);
        const wb = core.load(file);
        const r = validate(wb);
        sendJson(res, r.ok ? 200 : 200, { ok: r.ok, errors: r.errors, warnings: r.warnings });
        return;
      }

      case 'import': {
        const src = resolveFile(body.src);
        const r = io.importWorldbook(src);
        if (body.out) {
          const out = uniquePath(resolveFile(body.out));
          // 自动创建目标目录（如「导入」子文件夹），避免写入失败
          fs.mkdirSync(path.dirname(out), { recursive: true });
          core.save(out, r.wb);
          ok(res, { ...r, saved: out, count: Object.keys(r.wb.entries).length });
        } else {
          ok(res, r);
        }
        return;
      }

      case 'export': {
        const file = resolveFile(body.file);
        const wb = core.load(file);
        const text = io.exportWorldbook(wb, body.type || 'classic');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="worldbook.json"' });
        res.end(text);
        return;
      }

      default:
        throw new Error('未知 API: ' + route);
    }
  } catch (e) {
    err(res, 400, e.message);
  }
}

// ---------- 静态文件 ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(res, pathname) {
  let p = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.resolve(__dirname, '../web', p);
  if (!filePath.startsWith(path.resolve(__dirname, '../web'))) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(filePath, (e, data) => {
    if (e) { res.writeHead(404); res.end('404 Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- 启动 ----------

function start(port, openBrowser, projectRoot) {
  if (projectRoot) ROOT = projectRoot;
  const server = http.createServer(async (req, res) => {
    const u = url.parse(req.url);
    const pathname = decodeURIComponent(u.pathname || '/');
    if (pathname.startsWith('/api/')) {
      try {
        await handleApi(req, res, pathname, url.parse(req.url, true).query);
      } catch (e) {
        err(res, 500, e.message);
      }
      return;
    }
    serveStatic(res, pathname);
  });

  server.listen(port, '127.0.0.1', () => {
    const addr = 'http://127.0.0.1:' + port + '/';
    console.log('世界书编辑器 Web 界面已启动: ' + addr);
    console.log('工作目录: ' + ROOT);
    if (openBrowser) {
      try { require('child_process').exec('start "" ' + addr); } catch (e) { /* 忽略 */ }
    }
  });
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') console.error('端口 ' + port + ' 被占用，换端口: --port 8081');
    else console.error('启动失败: ' + e.message);
    process.exit(1);
  });
}

module.exports = { start };

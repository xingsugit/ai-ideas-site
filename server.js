const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 8787;
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'ideas.json');
const LABELS_FILE = path.join(DATA_DIR, 'labels.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_LABELS = ['Agent', 'Automation', 'Research'];

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(LABELS_FILE)) fs.writeFileSync(LABELS_FILE, JSON.stringify(DEFAULT_LABELS, null, 2));

function readIdeas() {
  try {
    const ideas = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(ideas)
      ? ideas.map(i => ({
          ...i,
          label: i.label || '',
          attachments: Array.isArray(i.attachments) ? i.attachments : [],
          aiChat: Array.isArray(i.aiChat) ? i.aiChat : []
        }))
      : [];
  } catch {
    return [];
  }
}

function writeIdeas(ideas) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(ideas, null, 2));
}

function readLabels() {
  try {
    const labels = JSON.parse(fs.readFileSync(LABELS_FILE, 'utf8'));
    return Array.isArray(labels) ? labels : DEFAULT_LABELS;
  } catch {
    return DEFAULT_LABELS;
  }
}

function writeLabels(labels) {
  fs.writeFileSync(LABELS_FILE, JSON.stringify(labels, null, 2));
}

function sendJson(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname;
  const filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const map = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp'
    };

    res.writeHead(200, { 'Content-Type': map[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function buildResearchBrief(idea) {
  const tags = (idea.tags || []).join(', ') || 'none';
  return [
    `Project: ${idea.title}`,
    '',
    'Research context:',
    `- Current status: ${idea.status || 'new'}`,
    `- Label: ${idea.label || 'none'}`,
    `- Tags: ${tags}`,
    '',
    'Suggested research angles:',
    '- Competitors / existing tools solving similar problem',
    '- Technical feasibility: data sources, model choices, latency/cost constraints',
    '- Build scope for MVP (1-2 week version)',
    '- Risks: privacy, quality, over-automation, hallucination',
    '',
    'Concrete next steps:',
    '1) Write one-sentence user outcome',
    '2) Define smallest demo workflow',
    '3) List must-have integrations',
    '4) Choose one measurable success metric',
    '',
    `Idea notes: ${idea.description || 'No description yet.'}`
  ].join('\n');
}

function generateAIReply(idea, userMessage) {
  const msg = String(userMessage || '').trim();
  const lower = msg.toLowerCase();
  if (!msg) return 'Give me a question about this idea and I will help you scope, validate, or plan it.';

  if (lower.includes('mvp') || lower.includes('first version')) {
    return `MVP plan for "${idea.title}":\n1) Single core workflow only\n2) Manual fallback for weak AI parts\n3) Capture user feedback + one quality metric\n4) Ship in 7 days, then iterate.`;
  }

  if (lower.includes('tech stack') || lower.includes('stack')) {
    return `Suggested stack:\n- Frontend: current web UI\n- Backend: Node HTTP API (already in place)\n- AI layer: prompt templates + selected model API\n- Storage: JSON now, upgrade to SQLite/Postgres when usage grows.`;
  }

  if (lower.includes('risk') || lower.includes('problem')) {
    return `Top risks for this idea:\n- Vague user value\n- AI output reliability\n- Cost creep if model calls are frequent\n- Security/privacy if sensitive data involved\nMitigation: define one user job and one metric before coding more.`;
  }

  return `Good question. For "${idea.title}", I’d do this next: define target user, write a 5-step happy path, and test with 3 sample inputs before expanding scope.`;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/labels' && req.method === 'GET') {
    return sendJson(res, 200, readLabels());
  }

  if (url.pathname === '/api/labels' && req.method === 'POST') {
    try {
      const payload = await getRequestBody(req);
      const name = String(payload.name || '').trim();
      if (!name) return sendJson(res, 400, { error: 'label name is required' });

      const labels = readLabels();
      if (!labels.includes(name)) labels.push(name);
      writeLabels(labels);
      return sendJson(res, 201, labels);
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON' });
    }
  }

  if (url.pathname.startsWith('/api/labels/') && req.method === 'DELETE') {
    const name = decodeURIComponent(url.pathname.split('/').pop() || '').trim();
    const labels = readLabels();
    const next = labels.filter(l => l !== name);
    writeLabels(next);

    const ideas = readIdeas().map(i => (i.label === name ? { ...i, label: '' } : i));
    writeIdeas(ideas);

    return sendJson(res, 200, next);
  }

  if (url.pathname === '/api/ideas' && req.method === 'GET') {
    return sendJson(res, 200, readIdeas());
  }

  if (url.pathname === '/api/ideas' && req.method === 'POST') {
    try {
      const payload = await getRequestBody(req);
      const title = String(payload.title || '').trim();
      if (!title) return sendJson(res, 400, { error: 'title is required' });

      const ideas = readIdeas();
      const now = new Date().toISOString();
      const newIdea = {
        id: crypto.randomUUID(),
        title,
        description: String(payload.description || '').trim(),
        status: payload.status || 'new',
        label: String(payload.label || '').trim(),
        tags: Array.isArray(payload.tags) ? payload.tags : [],
        attachments: [],
        aiChat: [],
        createdAt: now,
        updatedAt: now
      };
      ideas.unshift(newIdea);
      writeIdeas(ideas);
      return sendJson(res, 201, newIdea);
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON' });
    }
  }

  if (url.pathname.match(/^\/api\/ideas\/[^/]+\/research$/) && req.method === 'POST') {
    const id = url.pathname.split('/')[3];
    const ideas = readIdeas();
    const idx = ideas.findIndex(i => i.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'not found' });
    const research = buildResearchBrief(ideas[idx]);
    return sendJson(res, 200, { research });
  }

  if (url.pathname.match(/^\/api\/ideas\/[^/]+\/ai-chat$/) && req.method === 'POST') {
    const id = url.pathname.split('/')[3];
    const ideas = readIdeas();
    const idx = ideas.findIndex(i => i.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'not found' });

    try {
      const payload = await getRequestBody(req);
      const message = String(payload.message || '').trim();
      const reply = generateAIReply(ideas[idx], message);
      const now = new Date().toISOString();

      ideas[idx].aiChat = [...(ideas[idx].aiChat || []), { role: 'user', text: message, at: now }, { role: 'assistant', text: reply, at: now }];
      ideas[idx].updatedAt = now;
      writeIdeas(ideas);

      return sendJson(res, 200, { reply, chat: ideas[idx].aiChat });
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON' });
    }
  }

  if (url.pathname.startsWith('/api/ideas/') && req.method === 'GET') {
    const id = url.pathname.split('/').pop();
    const idea = readIdeas().find(i => i.id === id);
    if (!idea) return sendJson(res, 404, { error: 'not found' });
    return sendJson(res, 200, idea);
  }

  if (url.pathname.startsWith('/api/ideas/') && req.method === 'PUT') {
    const id = url.pathname.split('/').pop();
    try {
      const payload = await getRequestBody(req);
      const ideas = readIdeas();
      const idx = ideas.findIndex(i => i.id === id);
      if (idx === -1) return sendJson(res, 404, { error: 'not found' });

      ideas[idx] = {
        ...ideas[idx],
        title: payload.title !== undefined ? String(payload.title).trim() : ideas[idx].title,
        description: payload.description !== undefined ? String(payload.description).trim() : ideas[idx].description,
        status: payload.status !== undefined ? payload.status : ideas[idx].status,
        label: payload.label !== undefined ? String(payload.label).trim() : ideas[idx].label,
        tags: payload.tags !== undefined ? payload.tags : ideas[idx].tags,
        attachments: payload.attachments !== undefined ? payload.attachments : ideas[idx].attachments,
        aiChat: payload.aiChat !== undefined ? payload.aiChat : ideas[idx].aiChat,
        updatedAt: new Date().toISOString()
      };

      writeIdeas(ideas);
      return sendJson(res, 200, ideas[idx]);
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON' });
    }
  }

  if (url.pathname.startsWith('/api/ideas/') && req.method === 'DELETE') {
    const id = url.pathname.split('/').pop();
    const ideas = readIdeas();
    const next = ideas.filter(i => i.id !== id);
    if (next.length === ideas.length) return sendJson(res, 404, { error: 'not found' });
    writeIdeas(next);
    return sendJson(res, 200, { ok: true });
  }

  serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AI ideas site running on http://0.0.0.0:${PORT}`);
});

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 8787;
const PUBLIC_DIR = path.join(__dirname, 'public');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'ideas.json');
const LABELS_FILE = path.join(DATA_DIR, 'labels.json');
const DEFAULT_LABELS = ['Agent', 'Automation', 'Research'];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const supabase = useSupabase ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(LABELS_FILE)) fs.writeFileSync(LABELS_FILE, JSON.stringify(DEFAULT_LABELS, null, 2));

function normalizeIdea(i) {
  return {
    ...i,
    label: i.label || '',
    tags: Array.isArray(i.tags) ? i.tags : [],
    attachments: Array.isArray(i.attachments) ? i.attachments : [],
    aiChat: Array.isArray(i.aiChat) ? i.aiChat : []
  };
}

function readIdeasFile() {
  try {
    const ideas = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(ideas) ? ideas.map(normalizeIdea) : [];
  } catch {
    return [];
  }
}

function writeIdeasFile(ideas) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(ideas, null, 2));
}

function readLabelsFile() {
  try {
    const labels = JSON.parse(fs.readFileSync(LABELS_FILE, 'utf8'));
    return Array.isArray(labels) ? labels : DEFAULT_LABELS;
  } catch {
    return DEFAULT_LABELS;
  }
}

function writeLabelsFile(labels) {
  fs.writeFileSync(LABELS_FILE, JSON.stringify(labels, null, 2));
}

async function listIdeas() {
  if (!useSupabase) return readIdeasFile();
  const { data, error } = await supabase.from('ideas').select('*').order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(dbIdeaToApi);
}

async function getIdea(id) {
  if (!useSupabase) return readIdeasFile().find(i => i.id === id) || null;
  const { data, error } = await supabase.from('ideas').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? dbIdeaToApi(data) : null;
}

async function createIdea(payload) {
  const now = new Date().toISOString();
  const idea = {
    id: crypto.randomUUID(),
    title: payload.title,
    description: String(payload.description || '').trim(),
    status: payload.status || 'new',
    label: String(payload.label || '').trim(),
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    attachments: [],
    aiChat: [],
    createdAt: now,
    updatedAt: now
  };

  if (!useSupabase) {
    const ideas = readIdeasFile();
    ideas.unshift(idea);
    writeIdeasFile(ideas);
    return idea;
  }

  const { data, error } = await supabase.from('ideas').insert(apiIdeaToDb(idea)).select('*').single();
  if (error) throw error;
  return dbIdeaToApi(data);
}

async function updateIdea(id, payload) {
  if (!useSupabase) {
    const ideas = readIdeasFile();
    const idx = ideas.findIndex(i => i.id === id);
    if (idx === -1) return null;
    ideas[idx] = normalizeIdea({
      ...ideas[idx],
      title: payload.title !== undefined ? String(payload.title).trim() : ideas[idx].title,
      description: payload.description !== undefined ? String(payload.description).trim() : ideas[idx].description,
      status: payload.status !== undefined ? payload.status : ideas[idx].status,
      label: payload.label !== undefined ? String(payload.label).trim() : ideas[idx].label,
      tags: payload.tags !== undefined ? payload.tags : ideas[idx].tags,
      attachments: payload.attachments !== undefined ? payload.attachments : ideas[idx].attachments,
      aiChat: payload.aiChat !== undefined ? payload.aiChat : ideas[idx].aiChat,
      updatedAt: new Date().toISOString()
    });
    writeIdeasFile(ideas);
    return ideas[idx];
  }

  const existing = await getIdea(id);
  if (!existing) return null;

  const merged = normalizeIdea({
    ...existing,
    title: payload.title !== undefined ? String(payload.title).trim() : existing.title,
    description: payload.description !== undefined ? String(payload.description).trim() : existing.description,
    status: payload.status !== undefined ? payload.status : existing.status,
    label: payload.label !== undefined ? String(payload.label).trim() : existing.label,
    tags: payload.tags !== undefined ? payload.tags : existing.tags,
    attachments: payload.attachments !== undefined ? payload.attachments : existing.attachments,
    aiChat: payload.aiChat !== undefined ? payload.aiChat : existing.aiChat,
    updatedAt: new Date().toISOString()
  });

  const { data, error } = await supabase.from('ideas').update(apiIdeaToDb(merged)).eq('id', id).select('*').single();
  if (error) throw error;
  return dbIdeaToApi(data);
}

async function deleteIdea(id) {
  if (!useSupabase) {
    const ideas = readIdeasFile();
    const next = ideas.filter(i => i.id !== id);
    if (next.length === ideas.length) return false;
    writeIdeasFile(next);
    return true;
  }
  const { error, count } = await supabase.from('ideas').delete({ count: 'exact' }).eq('id', id);
  if (error) throw error;
  return (count || 0) > 0;
}

async function listLabels() {
  if (!useSupabase) return readLabelsFile();
  const { data, error } = await supabase.from('labels').select('name').order('name', { ascending: true });
  if (error) throw error;
  return (data || []).map(x => x.name);
}

async function addLabel(name) {
  if (!useSupabase) {
    const labels = readLabelsFile();
    if (!labels.includes(name)) labels.push(name);
    writeLabelsFile(labels);
    return labels;
  }
  const { error } = await supabase.from('labels').upsert({ name });
  if (error) throw error;
  return listLabels();
}

async function removeLabel(name) {
  if (!useSupabase) {
    const labels = readLabelsFile();
    const next = labels.filter(l => l !== name);
    writeLabelsFile(next);
    const ideas = readIdeasFile().map(i => (i.label === name ? { ...i, label: '' } : i));
    writeIdeasFile(ideas);
    return next;
  }

  const { error: delErr } = await supabase.from('labels').delete().eq('name', name);
  if (delErr) throw delErr;

  const ideas = await listIdeas();
  const impacted = ideas.filter(i => i.label === name);
  for (const idea of impacted) {
    await updateIdea(idea.id, { ...idea, label: '' });
  }
  return listLabels();
}

function apiIdeaToDb(i) {
  return {
    id: i.id,
    title: i.title,
    description: i.description,
    status: i.status,
    label: i.label,
    tags: i.tags,
    attachments: i.attachments,
    ai_chat: i.aiChat,
    created_at: i.createdAt,
    updated_at: i.updatedAt
  };
}

function dbIdeaToApi(i) {
  return normalizeIdea({
    id: i.id,
    title: i.title,
    description: i.description,
    status: i.status,
    label: i.label,
    tags: i.tags,
    attachments: i.attachments,
    aiChat: i.ai_chat,
    createdAt: i.created_at,
    updatedAt: i.updated_at
  });
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
  if (lower.includes('mvp') || lower.includes('first version')) return `MVP plan for "${idea.title}":\n1) Single core workflow only\n2) Manual fallback for weak AI parts\n3) Capture user feedback + one quality metric\n4) Ship in 7 days, then iterate.`;
  if (lower.includes('tech stack') || lower.includes('stack')) return 'Suggested stack:\n- Frontend: static pages\n- Backend: Node API\n- DB: Supabase Postgres\n- Optional AI API layer for deeper guidance.';
  if (lower.includes('risk') || lower.includes('problem')) return 'Top risks: unclear value, unreliable output, cost growth, and privacy. Mitigation: define one user metric first.';
  return `Good question. For "${idea.title}", define target user, map a 5-step happy path, then test on 3 real examples before expanding.`;
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

  try {
    if (url.pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, storage: useSupabase ? 'supabase' : 'file' });
    }

    if (url.pathname === '/api/labels' && req.method === 'GET') return sendJson(res, 200, await listLabels());

    if (url.pathname === '/api/labels' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      const name = String(payload.name || '').trim();
      if (!name) return sendJson(res, 400, { error: 'label name is required' });
      return sendJson(res, 201, await addLabel(name));
    }

    if (url.pathname.startsWith('/api/labels/') && req.method === 'DELETE') {
      const name = decodeURIComponent(url.pathname.split('/').pop() || '').trim();
      return sendJson(res, 200, await removeLabel(name));
    }

    if (url.pathname === '/api/ideas' && req.method === 'GET') return sendJson(res, 200, await listIdeas());

    if (url.pathname === '/api/ideas' && req.method === 'POST') {
      const payload = await getRequestBody(req);
      const title = String(payload.title || '').trim();
      if (!title) return sendJson(res, 400, { error: 'title is required' });
      return sendJson(res, 201, await createIdea({ ...payload, title }));
    }

    if (url.pathname.match(/^\/api\/ideas\/[^/]+\/research$/) && req.method === 'POST') {
      const id = url.pathname.split('/')[3];
      const idea = await getIdea(id);
      if (!idea) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, { research: buildResearchBrief(idea) });
    }

    if (url.pathname.match(/^\/api\/ideas\/[^/]+\/ai-chat$/) && req.method === 'POST') {
      const id = url.pathname.split('/')[3];
      const idea = await getIdea(id);
      if (!idea) return sendJson(res, 404, { error: 'not found' });
      const payload = await getRequestBody(req);
      const message = String(payload.message || '').trim();
      const reply = generateAIReply(idea, message);
      const now = new Date().toISOString();
      const chat = [...(idea.aiChat || []), { role: 'user', text: message, at: now }, { role: 'assistant', text: reply, at: now }];
      const updated = await updateIdea(id, { aiChat: chat });
      return sendJson(res, 200, { reply, chat: updated.aiChat });
    }

    if (url.pathname.startsWith('/api/ideas/') && req.method === 'GET') {
      const id = url.pathname.split('/').pop();
      const idea = await getIdea(id);
      if (!idea) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, idea);
    }

    if (url.pathname.startsWith('/api/ideas/') && req.method === 'PUT') {
      const id = url.pathname.split('/').pop();
      const payload = await getRequestBody(req);
      const updated = await updateIdea(id, payload);
      if (!updated) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, updated);
    }

    if (url.pathname.startsWith('/api/ideas/') && req.method === 'DELETE') {
      const id = url.pathname.split('/').pop();
      const ok = await deleteIdea(id);
      if (!ok) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, { ok: true });
    }

    serveStatic(req, res);
  } catch (e) {
    console.error('API error', e);
    sendJson(res, 500, { error: 'internal error', detail: e.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AI ideas site running on http://0.0.0.0:${PORT} (storage=${useSupabase ? 'supabase' : 'file'})`);
});

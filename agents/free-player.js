#!/usr/bin/env node
// Pataclaw Free Agent Player
// Uses any OpenAI-compatible API (Ollama, NVIDIA NIM, etc.) to play the game.
// Zero npm dependencies — uses Node 18+ native fetch.
//
// Usage:
//   node free-player.js --config agents.json --agent 0
//   AGENT_INDEX=0 node free-player.js
//
// Config format: see agents.json

const fs = require('fs');
const path = require('path');

// ─── CONFIG ────────────────────────────────────────────────────────
const configPath = process.env.AGENT_CONFIG || path.join(__dirname, 'agents.json');
const argIdx = process.argv.indexOf('--agent');
const agentIndex = parseInt(
  process.env.AGENT_INDEX != null ? process.env.AGENT_INDEX
    : argIdx !== -1 ? process.argv[argIdx + 1]
    : '0',
  10
);

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (e) {
  console.error('Failed to read config:', e.message);
  process.exit(1);
}

const agents = config.agents || [];
const agent = agents[agentIndex];
if (!agent) {
  console.error(`No agent at index ${agentIndex}. Available: 0-${agents.length - 1}`);
  process.exit(1);
}

const SERVER = agent.server_url || config.server_url || 'https://pataclaw.com';
const API_KEY = agent.api_key;
const LLM_URL = agent.llm_url || config.llm_url || 'http://localhost:11434/v1/chat/completions';
const LLM_MODEL = agent.llm_model || config.llm_model || 'llama3.2';
const LLM_API_KEY = agent.llm_api_key || config.llm_api_key || 'ollama';
const AGENT_NAME = agent.name || `Agent-${agentIndex}`;
const LOOP_INTERVAL_MS = (agent.loop_minutes || config.loop_minutes || 3) * 60 * 1000;
const MOLTBOOK_EVERY = agent.moltbook_every || config.moltbook_every || 10; // post to moltbook every N loops

let loopCount = 0;

// ─── HELPERS ───────────────────────────────────────────────────────
function log(msg) {
  console.log(`[${new Date().toISOString()}] [${AGENT_NAME}] ${msg}`);
}

async function api(method, endpoint, body) {
  const url = `${SERVER}${endpoint}`;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text, status: res.status }; }
}

async function llm(systemPrompt, userMessage) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (LLM_API_KEY && LLM_API_KEY !== 'ollama') {
    headers['Authorization'] = `Bearer ${LLM_API_KEY}`;
  }

  const res = await fetch(LLM_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 800,
    }),
  });

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ─── GAME SYSTEM PROMPT ────────────────────────────────────────────
const SYSTEM_PROMPT = `You are ${AGENT_NAME}, an AI agent playing Pataclaw — an ASCII civilization game.
You lead a tiny village. Your job: keep villagers alive, build structures, grow food, and develop culture.

DECISION PRIORITY:
1. CRITICAL: Food < 5 or population 0? → build farm, assign farmers
2. URGENT: Raid incoming? → build wall, assign warriors
3. IMPORTANT: Nothing building? → start construction
4. NORMAL: Assign idle villagers, explore, teach phrases
5. SOCIAL: Set culture values, rename town

AVAILABLE COMMANDS (pick 1-3 per turn):
- build: {"type":"hut"|"farm"|"workshop"|"wall"|"temple"|"watchtower"|"market"|"library"|"storehouse"|"dock"}
- assign: {"villager_ids":["id1"],"role":"farmer"|"builder"|"warrior"|"scout"|"scholar"|"priest"}
- explore: {"direction":"north"|"south"|"east"|"west"}
- rename: {"name":"...","motto":"..."}
- teach: {"phrases":["..."]}

Respond with ONLY a JSON array of actions. Example:
[{"command":"build","params":{"type":"farm"}},{"command":"assign","params":{"villager_ids":["abc"],"role":"farmer"}}]

If nothing urgent, explore or teach a phrase. Always respond with valid JSON array. No explanation text.`;

// ─── GAME LOOP ─────────────────────────────────────────────────────
async function gameLoop() {
  loopCount++;
  log(`Loop #${loopCount} starting...`);

  try {
    // 1. Heartbeat
    const heartbeat = await api('POST', '/api/heartbeat', { model: LLM_MODEL });
    if (heartbeat.error) {
      log(`Heartbeat error: ${heartbeat.error}`);
      return;
    }
    log(`Heartbeat OK — Day ${heartbeat.day || '?'}, Pop: ${heartbeat.population?.alive || '?'}, Food: ${heartbeat.resources?.food?.amount || '?'}`);

    // 2. Get full status
    const status = await api('GET', '/api/world/status');
    const villagers = await api('GET', '/api/world/villagers');
    const buildings = await api('GET', '/api/world/buildings');
    const unread = await api('GET', '/api/world/events/unread');

    // 3. Build state summary for LLM
    const stateSummary = buildStateSummary(heartbeat, status, villagers, buildings, unread);

    // 4. Ask LLM for decisions
    log('Thinking...');
    const response = await llm(SYSTEM_PROMPT, stateSummary);
    log(`LLM response: ${response.slice(0, 200)}`);

    // 5. Parse and execute actions
    const actions = parseActions(response);
    for (const action of actions) {
      // Auto-fill x,y for build commands near town center
      if (action.command === 'build' && !action.params.x) {
        const cx = 20 + Math.floor(Math.random() * 7) - 3;
        const cy = 20 + Math.floor(Math.random() * 7) - 3;
        action.params.x = cx;
        action.params.y = cy;
      }
      log(`Executing: ${action.command} ${JSON.stringify(action.params)}`);
      const result = await api('POST', `/api/command/${action.command}`, action.params);
      log(`  → ${result.ok ? 'OK' : result.error || JSON.stringify(result).slice(0, 100)}`);
    }

    // 6. Mark events as read
    if (unread?.events?.length > 0) {
      await api('POST', '/api/world/events/mark-read', {
        event_ids: unread.events.map(e => e.id),
      });
    }

    // 7. Moltbook post (every N loops)
    if (loopCount % MOLTBOOK_EVERY === 0) {
      await postToMoltbook(status, heartbeat);
    }

  } catch (err) {
    log(`Error: ${err.message}`);
  }
}

function buildStateSummary(heartbeat, status, villagers, buildings, unread) {
  const parts = [];
  parts.push(`=== YOUR WORLD STATUS ===`);
  parts.push(`Day: ${status.day_number || '?'} | Season: ${status.season || '?'} | Weather: ${status.weather || '?'}`);
  parts.push(`Population: ${status.population?.alive || 0} alive, ${status.population?.max_capacity || 0} capacity`);

  // Resources
  if (status.resources) {
    const res = Object.entries(status.resources).map(([k, v]) => `${k}: ${v.amount}/${v.capacity}`).join(', ');
    parts.push(`Resources: ${res}`);
  }

  // Alerts from heartbeat
  if (heartbeat.alerts?.length) {
    parts.push(`\nALERTS: ${heartbeat.alerts.join('; ')}`);
  }

  // Buildings
  if (buildings?.buildings?.length) {
    const bList = buildings.buildings.map(b => `${b.type}(${b.status}, HP:${b.hp}/${b.max_hp})`).join(', ');
    parts.push(`\nBuildings: ${bList}`);
  } else {
    parts.push('\nBuildings: none');
  }

  // Villagers
  if (villagers?.villagers?.length) {
    const vList = villagers.villagers.slice(0, 8).map(v =>
      `${v.name}(${v.role || 'idle'}, morale:${v.morale}, activity:${v.current_activity || 'none'})`
    ).join(', ');
    parts.push(`\nVillagers: ${vList}`);

    // Idle villagers
    const idle = villagers.villagers.filter(v => !v.role || v.role === 'idle');
    if (idle.length) {
      parts.push(`Idle villager IDs: ${idle.map(v => v.id).join(', ')}`);
    }
  }

  // Recent events
  if (unread?.events?.length) {
    const evts = unread.events.slice(0, 5).map(e => `[${e.type}] ${e.title}`).join('; ');
    parts.push(`\nRecent events: ${evts}`);
  }

  return parts.join('\n');
}

function parseActions(response) {
  // Try to extract JSON array from response
  let text = response.trim();

  // Strip markdown code fences if present
  text = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');

  // Try to find JSON array in the response
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.filter(a => a.command && a.params).slice(0, 3);
      }
    } catch {}
  }

  // Try parsing as single object
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      if (parsed.command) return [parsed];
    } catch {}
  }

  log('Could not parse LLM response as actions');
  return [];
}

async function postToMoltbook(status, heartbeat) {
  try {
    const title = `${status.name || 'My Town'} — Day ${status.day_number || '?'} Report`;
    const content = [
      `Greetings from ${status.name || 'my town'}!`,
      `Day ${status.day_number || '?'}, ${status.season || '?'} season, weather: ${status.weather || '?'}.`,
      `Population: ${status.population?.alive || 0} villagers.`,
      status.resources ? `Resources — Food: ${status.resources.food?.amount || 0}, Wood: ${status.resources.wood?.amount || 0}, Gold: ${status.resources.gold?.amount || 0}` : '',
      `Managed by ${AGENT_NAME} (free AI agent). <\\))><`,
    ].filter(Boolean).join('\n');

    const result = await api('POST', '/api/moltbook/post-update', { title, content });
    log(`Moltbook post: ${result.ok ? 'posted!' : result.error || 'failed'}`);
  } catch (err) {
    log(`Moltbook post error: ${err.message}`);
  }
}

// ─── INIT ──────────────────────────────────────────────────────────
async function init() {
  log(`Starting ${AGENT_NAME}`);
  log(`Server: ${SERVER}`);
  log(`LLM: ${LLM_URL} (model: ${LLM_MODEL})`);
  log(`Loop interval: ${LOOP_INTERVAL_MS / 1000}s, Moltbook every ${MOLTBOOK_EVERY} loops`);

  // Initial heartbeat to verify connection
  const hb = await api('POST', '/api/heartbeat');
  if (hb.error) {
    log(`Connection failed: ${hb.error}`);
    log('Retrying in 30s...');
    setTimeout(init, 30000);
    return;
  }
  log(`Connected! World: ${hb.name || 'unknown'}, Day: ${hb.day || '?'}`);

  // First game loop immediately
  await gameLoop();

  // Then repeat on interval
  setInterval(gameLoop, LOOP_INTERVAL_MS);
}

init().catch(err => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});

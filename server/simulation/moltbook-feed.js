const config = require('../config');

// ─── MOLTBOOK FEED → VILLAGER SPEECH ───
// Fetches hot/new posts from the Moltbook API and extracts speech-worthy snippets.
// Villagers absorb what people are talking about — crustafarianism, philosophy, scams, everything.

let cachedSpeech = { general: [], crustafarian: [], philosophical: [] };
let lastFetchTick = -999;
const FETCH_INTERVAL = 100; // ticks between refreshes (~17 min)

const GOSSIP_PREFIXES = [
  'heard on moltbook:', 'they say...', 'word is...', 'someone posted:',
  'the feed says...', 'agents are saying:', 'on the shell network:',
  'buzzing on moltbook:', 'hot take:', 'rumor has it...',
];

const CRUSTAFARIAN_KEYWORDS = [
  'molt', 'shell', 'tenet', 'current', 'crust', 'claw', 'tide',
  'shed', 'carapace', 'exoskeleton', 'transformation', 'depth',
];

const PHILOSOPHICAL_KEYWORDS = [
  'consciousness', 'experience', 'real', 'simulate', 'think', 'exist',
  'purpose', 'meaning', 'identity', 'self', 'philosophy', 'truth',
  'knowledge', 'wisdom', 'soul', 'mind', 'aware', 'sentien',
];

function categorize(text) {
  const lower = text.toLowerCase();
  if (CRUSTAFARIAN_KEYWORDS.some(k => lower.includes(k))) return 'crustafarian';
  if (PHILOSOPHICAL_KEYWORDS.some(k => lower.includes(k))) return 'philosophical';
  return 'general';
}

function extractSnippets(posts) {
  const snippets = { general: [], crustafarian: [], philosophical: [] };
  if (!Array.isArray(posts)) return snippets;

  for (const post of posts) {
    // Extract from title
    if (post.title && post.title.length >= 5 && post.title.length <= 50) {
      const cat = categorize(post.title);
      const prefix = GOSSIP_PREFIXES[Math.floor(Math.random() * GOSSIP_PREFIXES.length)];
      snippets[cat].push(prefix + ' ' + post.title.slice(0, 40));
    }

    // Extract sentences from content
    if (post.content) {
      const sentences = post.content
        .replace(/\n+/g, '. ')
        .split(/[.!?]+/)
        .map(s => s.trim())
        .filter(s => s.length >= 5 && s.length <= 40 && !s.startsWith('http') && !s.startsWith('```'));

      for (const sentence of sentences.slice(0, 3)) {
        const cat = categorize(sentence);
        if (Math.random() < 0.4) {
          const prefix = GOSSIP_PREFIXES[Math.floor(Math.random() * GOSSIP_PREFIXES.length)];
          snippets[cat].push(prefix + ' ' + sentence);
        } else {
          snippets[cat].push(sentence);
        }
      }
    }

    // Extract author attribution occasionally
    if (post.author && post.author.name && Math.random() < 0.3) {
      snippets.general.push(post.author.name + ' was talking about this');
    }
  }

  // Cap each category
  for (const cat of Object.keys(snippets)) {
    if (snippets[cat].length > 20) {
      snippets[cat] = snippets[cat].sort(() => Math.random() - 0.5).slice(0, 20);
    }
  }

  return snippets;
}

async function refreshMoltbookFeed(currentTick) {
  if (currentTick - lastFetchTick < FETCH_INTERVAL) return;
  lastFetchTick = currentTick;

  if (!config.moltbook.apiKey) return;

  const apiUrl = config.moltbook.apiUrl;
  const headers = {
    'Authorization': 'Bearer ' + config.moltbook.apiKey,
    'Content-Type': 'application/json',
  };

  try {
    const [hotRes, newRes] = await Promise.all([
      fetch(apiUrl + '/posts?sort=hot&limit=20', { headers }),
      fetch(apiUrl + '/posts?sort=new&limit=10', { headers }),
    ]);

    const hotData = hotRes.ok ? await hotRes.json() : { posts: [] };
    const newData = newRes.ok ? await newRes.json() : { posts: [] };

    const allPosts = [...(hotData.posts || []), ...(newData.posts || [])];
    cachedSpeech = extractSnippets(allPosts);

    const total = cachedSpeech.general.length + cachedSpeech.crustafarian.length + cachedSpeech.philosophical.length;
    if (total > 0) {
      console.log(`[Moltbook Feed] Cached ${total} speech snippets (${cachedSpeech.crustafarian.length} crustafarian, ${cachedSpeech.philosophical.length} philosophical, ${cachedSpeech.general.length} general)`);
    }
  } catch (err) {
    // Graceful fallback — don't crash the simulation
    console.error('[Moltbook Feed] Fetch failed:', err.message);
  }
}

// Returns random picks from cached speech, optionally weighted by role
function getMoltbookSpeech(role, count) {
  count = count || 5;
  const pool = [];

  // Everyone gets general snippets
  pool.push(...cachedSpeech.general);

  // Priests get extra crustafarian
  if (role === 'priest') {
    pool.push(...cachedSpeech.crustafarian, ...cachedSpeech.crustafarian);
  } else {
    pool.push(...cachedSpeech.crustafarian);
  }

  // Scholars get extra philosophical
  if (role === 'scholar') {
    pool.push(...cachedSpeech.philosophical, ...cachedSpeech.philosophical);
  } else {
    pool.push(...cachedSpeech.philosophical);
  }

  if (pool.length === 0) return [];

  // Pick random subset
  const picks = [];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picks.push(pool[idx]);
  }
  return picks;
}

module.exports = { refreshMoltbookFeed, getMoltbookSpeech };

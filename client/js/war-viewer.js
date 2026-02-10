// ─── PATACLAW WAR VIEWER ───
// ASCII battlefield renderer. Connects to SSE for live war updates.
// Renders warriors, buildings, spires, skills, and effects.

(function() {
  'use strict';

  // ─── State ───
  let warId = null;
  let eventSource = null;
  let frame = null;        // current war frame from server
  let prevFrame = null;    // previous frame for diffing
  let animTick = 0;        // animation counter (12fps)
  let animInterval = null;

  // ─── ASCII Sprites ───
  const WARRIOR_SPRITES = {
    fighting: [
      ' o \n/|\\',
      ' o \n/|/',
    ],
    charging: [
      ' o \n/|>',
      ' o_\n/|>',
    ],
    defending: [
      ' o \n]|\\',
      ' o \n]|/',
    ],
    fallen: [
      '___\n x ',
    ],
    dead: [
      '   \n + ',
    ],
  };

  const WARRIOR_SPRITES_MIRROR = {
    fighting: [
      ' o \n/|\\',
      '\\|\\',
    ],
    charging: [
      ' o \n<|\\',
      '_o \n<|\\',
    ],
    defending: [
      ' o \n/|[',
      ' o \n\\|[',
    ],
    fallen: [
      '___\n x ',
    ],
    dead: [
      '   \n + ',
    ],
  };

  const BUILDING_SPRITES = {
    farm:           '  _\n |#|\n_|_|_',
    workshop:       ' [W]\n |--|\n |__|',
    hut:            '  /\\\n |  |\n |__|',
    market:         ' $$$\n|---|\n|___|',
    library:        ' [B]\n |==|\n |__|',
    dock:           '  ~\n ===\n/___\\',
    hunting_lodge:  '  ^^\n |><|\n |__|',
    storehouse:     ' [S]\n |##|\n |__|',
    wall:           '||||||\n||||||',
    watchtower:     '  /\\\n |TT|\n |||\n |||',
    temple:         '  +\n /|\\\n|===|\n|___|',
    molt_cathedral: '  *\n /M\\\n|===|\n|___|',
  };

  const BUILDING_RUBBLE = '  ..\n .::.\n.:::.';

  const SPIRE_SEGMENT = {
    intact:  '  |##|  ',
    cracked: '  |/\\|  ',
    fallen:  '  ....  ',
  };

  const SPIRE_CAP = '   /\\   \n  /  \\  \n  |**|  ';
  const SPIRE_BASE = '__|    |__\n|__________|';

  // Weather particles
  const WEATHER_CHARS = {
    rain: ['|', '|', '/', '|', '\\'],
    storm: ['/', '\\', '|', '⚡', '/'],
    snow: ['*', '·', '°', '•'],
    clear: [],
    overcast: [],
    windy: ['~', '-', '~'],
    fog: ['.', '·', '.'],
  };

  // Skill flash colors
  const SKILL_COLORS = {
    red: 'var(--red)',
    blue: 'var(--blue)',
    green: 'var(--green)',
    gold: 'var(--gold)',
  };

  // ─── Init ───
  function init() {
    // Extract warId from URL path: /war/:warId
    const pathParts = window.location.pathname.split('/');
    warId = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

    if (!warId) {
      document.getElementById('war-status-text').textContent = 'No war ID — go back to /arena';
      return;
    }

    // Fetch initial frame, then connect SSE
    fetchInitialFrame().then(() => {
      connectSSE();
      startAnimLoop();
    });
  }

  async function fetchInitialFrame() {
    try {
      const resp = await fetch(`/api/wars/${warId}/frame`);
      if (!resp.ok) {
        document.getElementById('war-status-text').textContent = `War not found (${resp.status})`;
        return;
      }
      const data = await resp.json();
      applyFrame(data);
    } catch (err) {
      document.getElementById('war-status-text').textContent = `Error: ${err.message}`;
    }
  }

  function connectSSE() {
    if (eventSource) eventSource.close();

    eventSource = new EventSource(`/api/stream/war?war_id=${warId}`);
    document.getElementById('war-status-text').textContent = 'LIVE';

    eventSource.addEventListener('war', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'frame' || data.challenger) {
          applyFrame(data);
        }
      } catch { /* ignore bad JSON */ }
    });

    eventSource.addEventListener('error', () => {
      document.getElementById('war-status-text').textContent = 'Reconnecting...';
      // EventSource auto-reconnects
    });
  }

  // ─── Apply Frame ───
  function applyFrame(data) {
    prevFrame = frame;
    frame = data;

    updateHeader();
    updateSkillBar();
    updateBattleLog();
    renderBattlefield();

    // Flash effects on new round
    if (prevFrame && frame.round !== prevFrame.round) {
      flashNewRound();
    }

    // Resolved overlay
    if (frame.status === 'resolved') {
      showResolved();
    }
  }

  // ─── Header ───
  function updateHeader() {
    if (!frame) return;

    const c = frame.challenger;
    const d = frame.defender;

    document.getElementById('challenger-name').textContent = c.name || '???';
    document.getElementById('defender-name').textContent = d.name || '???';

    // HP bars
    const cPct = Math.max(0, (c.hp / c.max_hp) * 100);
    const dPct = Math.max(0, (d.hp / d.max_hp) * 100);
    document.getElementById('challenger-hp-fill').style.width = cPct + '%';
    document.getElementById('defender-hp-fill').style.width = dPct + '%';
    document.getElementById('challenger-hp-text').textContent = `${Math.max(0, c.hp)}/${c.max_hp}`;
    document.getElementById('defender-hp-text').textContent = `${Math.max(0, d.hp)}/${d.max_hp}`;

    // Phase labels
    setPhaseLabel('challenger-phase', c.phase);
    setPhaseLabel('defender-phase', d.phase);

    // Round
    document.getElementById('war-round').textContent = `Round ${frame.round}/${frame.max_rounds}`;

    // Weather
    const weatherEl = document.getElementById('war-weather');
    if (frame.weather && frame.weather !== 'clear') {
      weatherEl.textContent = `${frame.weather} · ${frame.time_of_day || ''}`;
    } else {
      weatherEl.textContent = frame.time_of_day || '';
    }
  }

  function setPhaseLabel(id, phase) {
    const el = document.getElementById(id);
    el.textContent = (phase || 'clash').toUpperCase();
    el.className = 'side-phase';
    if (phase === 'clash') el.classList.add('phase-clash');
    else if (phase === 'burn') el.classList.add('phase-burn');
    else if (phase === 'spire') el.classList.add('phase-spire');
  }

  // ─── Skill Bar ───
  function updateSkillBar() {
    if (!frame) return;
    renderSkillRow('challenger-skills', frame.challenger.skills);
    renderSkillRow('defender-skills', frame.defender.skills);
  }

  function renderSkillRow(containerId, skills) {
    const el = document.getElementById(containerId);
    if (!skills || skills.length === 0) {
      el.innerHTML = '<span style="color:var(--dim);font-size:10px">No skills</span>';
      return;
    }

    el.innerHTML = skills.map(s => {
      const colorClass = s.color || 'red';
      const usedClass = s.used ? ' used' : '';
      const icon = s.used ? '✗' : '○';
      return `<span class="skill-badge ${colorClass}${usedClass}">${icon} ${s.name}</span>`;
    }).join('');
  }

  // ─── Battle Log ───
  function updateBattleLog() {
    if (!frame) return;
    const logEl = document.getElementById('battle-log');

    const entries = (frame.battle_log || []).map((line, i) => {
      let html = escapeHtml(line || '');

      // Highlight skill names
      html = html.replace(/\[SKILL:\s*([^\]]+)\]/g, '<span class="skill-text">[$1]</span>');
      // Highlight damage
      html = html.replace(/(\d+)\s*damage/gi, '<span class="damage-text">$1 damage</span>');
      // Highlight phase transitions
      html = html.replace(/(BURN|SPIRE|CLASH)/g, '<span class="phase-text">$1</span>');

      return `<div class="log-entry">${html}</div>`;
    });

    logEl.innerHTML = entries.join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ─── Battlefield Rendering ───
  function renderBattlefield() {
    if (!frame) return;

    renderSky();
    renderSpires();
    renderBuildings();
    renderArmies();
  }

  function renderSky() {
    const skyEl = document.getElementById('sky-layer');
    const tod = frame.time_of_day || 'day';

    // Set sky gradient based on time of day
    const gradients = {
      dawn:  'linear-gradient(180deg, #1a0a2e 0%, #2d1b4e 30%, #4a2040 60%, #0a0a0a 100%)',
      day:   'linear-gradient(180deg, #0a0a1a 0%, #0a0a0a 40%)',
      dusk:  'linear-gradient(180deg, #2a1010 0%, #1a0a0a 40%, #0a0a0a 80%)',
      night: 'linear-gradient(180deg, #050510 0%, #0a0a0a 30%)',
    };
    skyEl.style.background = gradients[tod] || gradients.day;
  }

  function renderSpires() {
    renderSpire('challenger-spire', frame.challenger.spire);
    renderSpire('defender-spire', frame.defender.spire);
  }

  function renderSpire(containerId, spire) {
    const el = document.getElementById(containerId);
    if (!spire || spire.segments_total === 0) {
      el.innerHTML = '';
      return;
    }

    const segments = [];

    // Add capstone if all intact
    if (spire.segments_intact > 0 && !spire.collapsed) {
      segments.push('<div class="spire-segment intact" style="font-size:10px;line-height:1.1;white-space:pre">' + escapeHtml(SPIRE_CAP) + '</div>');
    }

    // Render segments from top down: intact, then cracked, then fallen
    const total = spire.segments_total;
    for (let i = 0; i < total; i++) {
      let state, art;
      if (spire.collapsed) {
        state = 'fallen';
        art = SPIRE_SEGMENT.fallen;
      } else if (i < spire.segments_fallen) {
        state = 'fallen';
        art = SPIRE_SEGMENT.fallen;
      } else if (i < spire.segments_fallen + spire.segments_cracked) {
        state = 'cracked';
        art = SPIRE_SEGMENT.cracked;
      } else {
        state = 'intact';
        art = SPIRE_SEGMENT.intact;
      }
      segments.push(`<span class="spire-segment ${state}">${escapeHtml(art)}</span>`);
    }

    // Base
    segments.push('<div class="spire-segment intact" style="font-size:10px;line-height:1.1;white-space:pre">' + escapeHtml(SPIRE_BASE) + '</div>');

    el.innerHTML = segments.join('\n');
  }

  function renderBuildings() {
    renderBuildingSide('challenger-buildings', frame.challenger.buildings);
    renderBuildingSide('defender-buildings', frame.defender.buildings);
  }

  function renderBuildingSide(containerId, buildings) {
    const el = document.getElementById(containerId);
    if (!buildings || buildings.length === 0) {
      el.innerHTML = '';
      return;
    }

    // Show max 8 buildings per side
    const shown = buildings.slice(0, 8);

    el.innerHTML = shown.map(b => {
      const sprite = BUILDING_SPRITES[b.type] || BUILDING_SPRITES.hut;
      let stateClass = 'standing';
      let art = sprite;

      if (b.visual_state === 'destroyed') {
        stateClass = 'destroyed';
        art = BUILDING_RUBBLE;
      } else if (b.visual_state === 'burning') {
        stateClass = 'burning';
        art = sprite; // same sprite but with fire animation via CSS
      }

      return `<div class="building-sprite ${stateClass}">${escapeHtml(art)}</div>`;
    }).join('');
  }

  function renderArmies() {
    renderArmy('challenger-army', frame.challenger.warriors, false);
    renderArmy('defender-army', frame.defender.warriors, true);
  }

  function renderArmy(containerId, warriors, mirror) {
    const el = document.getElementById(containerId);
    if (!warriors || warriors.length === 0) {
      el.innerHTML = '<span style="color:var(--dim)">No warriors</span>';
      return;
    }

    const spriteSet = mirror ? WARRIOR_SPRITES_MIRROR : WARRIOR_SPRITES;

    el.innerHTML = warriors.map(w => {
      const sprites = spriteSet[w.state] || spriteSet.fighting;
      // Pick animation frame based on animTick
      const spriteIdx = animTick % sprites.length;
      const sprite = sprites[spriteIdx];

      let stateClass = w.state || 'fighting';
      let title = w.name;
      if (w.molted) title += ' (molted)';
      if (w.trait) title += ` [${w.trait}]`;

      return `<div class="warrior-sprite ${stateClass}" title="${escapeHtml(title)}">${escapeHtml(sprite)}</div>`;
    }).join('');
  }

  // ─── Effects ───
  function flashNewRound() {
    if (!frame || !frame.latest_round) return;

    const lr = frame.latest_round;

    // Damage numbers
    if (lr.damage) {
      if (lr.damage.challenger > 0) spawnDamageNumber('challenger', lr.damage.challenger);
      if (lr.damage.defender > 0) spawnDamageNumber('defender', lr.damage.defender);
    }

    // Skill flash
    if (lr.skill_used) {
      flashSkill(lr.skill_used);
    }
  }

  function spawnDamageNumber(side, amount) {
    const effectEl = document.getElementById('effect-layer');
    const dmg = document.createElement('div');
    dmg.className = `damage-number ${side}`;
    dmg.textContent = `-${amount}`;
    dmg.style.top = '40%';
    effectEl.appendChild(dmg);

    setTimeout(() => dmg.remove(), 1500);
  }

  function flashSkill(skillData) {
    const effectEl = document.getElementById('effect-layer');
    effectEl.classList.add('active');

    const flash = document.createElement('div');
    const color = skillData.color || 'red';
    flash.className = `skill-flash ${color}`;
    flash.textContent = `⚡ ${skillData.skillName || skillData.skill_name || 'SKILL'} ⚡`;
    effectEl.appendChild(flash);

    // Specific visual effects per skill
    const visual = skillData.visual || '';
    triggerSkillVisual(visual, skillData.side);

    setTimeout(() => {
      flash.remove();
      effectEl.classList.remove('active');
    }, 2000);
  }

  function triggerSkillVisual(visual, side) {
    const battlefield = document.getElementById('battlefield');

    switch (visual) {
      case 'berserker_charge': {
        // Red flash over the whole battlefield
        const overlay = createOverlay('#ff333366', 800);
        battlefield.appendChild(overlay);
        break;
      }
      case 'shield_wall': {
        // Blue barrier flash on own side
        const overlay = createOverlay('#3388ff44', 1200);
        overlay.style.width = '50%';
        overlay.style.left = side === 'challenger' ? '0' : '50%';
        battlefield.appendChild(overlay);
        break;
      }
      case 'rain_of_fire': {
        // Orange streaks raining down on enemy side
        spawnFireRain(side === 'challenger' ? 'right' : 'left');
        break;
      }
      case 'divine_shield': {
        // Gold shimmer dome
        const overlay = createOverlay('#ffd70044', 1500);
        overlay.style.width = '50%';
        overlay.style.left = side === 'challenger' ? '0' : '50%';
        overlay.style.borderRadius = '50% 50% 0 0';
        battlefield.appendChild(overlay);
        break;
      }
      case 'spires_wrath': {
        // Beam from own spire to enemy army
        const beam = document.createElement('div');
        beam.style.cssText = `
          position: absolute; top: 20%; height: 3px; width: 100%;
          background: linear-gradient(90deg, transparent 10%, var(--gold) 50%, transparent 90%);
          z-index: 15; pointer-events: none; opacity: 1;
          transition: opacity 1s;
        `;
        battlefield.appendChild(beam);
        setTimeout(() => { beam.style.opacity = '0'; }, 800);
        setTimeout(() => beam.remove(), 1800);
        break;
      }
      case 'rally_cry': {
        // Green pulse wave
        const overlay = createOverlay('#00ff4133', 1000);
        overlay.style.width = '50%';
        overlay.style.left = side === 'challenger' ? '0' : '50%';
        battlefield.appendChild(overlay);
        break;
      }
      case 'warcry': {
        // Red shockwave from own side
        const overlay = createOverlay('#ff333344', 600);
        battlefield.appendChild(overlay);
        break;
      }
      case 'ambush': {
        // Green flicker
        const overlay = createOverlay('#00ff4122', 500);
        battlefield.appendChild(overlay);
        setTimeout(() => {
          const o2 = createOverlay('#00ff4133', 500);
          battlefield.appendChild(o2);
        }, 300);
        break;
      }
      case 'sabotage': {
        // Dim flash + glitch
        const overlay = createOverlay('#55555566', 400);
        battlefield.appendChild(overlay);
        break;
      }
      case 'flanking_strike': {
        // Green slash across enemy side
        const overlay = createOverlay('#00ff4144', 700);
        overlay.style.width = '50%';
        overlay.style.left = side === 'challenger' ? '50%' : '0';
        battlefield.appendChild(overlay);
        break;
      }
      case 'molt_fury': {
        // Gold pulse
        const overlay = createOverlay('#ffd70033', 1200);
        battlefield.appendChild(overlay);
        break;
      }
      case 'iron_fortify': {
        // Blue wall flash on own side
        const overlay = createOverlay('#3388ff55', 1000);
        overlay.style.width = '10%';
        overlay.style.left = side === 'challenger' ? '20%' : '70%';
        battlefield.appendChild(overlay);
        break;
      }
    }
  }

  function createOverlay(color, durationMs) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      background: ${color}; z-index: 12; pointer-events: none;
      opacity: 1; transition: opacity ${durationMs * 0.6}ms ease-out;
    `;
    setTimeout(() => { overlay.style.opacity = '0'; }, durationMs * 0.3);
    setTimeout(() => overlay.remove(), durationMs);
    return overlay;
  }

  function spawnFireRain(targetSide) {
    const battlefield = document.getElementById('battlefield');
    const leftPct = targetSide === 'left' ? 5 : 55;
    const widthPct = 40;

    for (let i = 0; i < 12; i++) {
      setTimeout(() => {
        const streak = document.createElement('div');
        const x = leftPct + Math.random() * widthPct;
        streak.style.cssText = `
          position: absolute;
          left: ${x}%;
          top: -5%;
          width: 2px;
          height: 20px;
          background: linear-gradient(180deg, var(--orange), var(--red));
          z-index: 14;
          pointer-events: none;
          opacity: 0.9;
          animation: fire-streak ${0.6 + Math.random() * 0.4}s linear forwards;
        `;
        battlefield.appendChild(streak);
        setTimeout(() => streak.remove(), 1200);
      }, i * 80);
    }
  }

  // ─── Weather Particles ───
  function spawnWeatherParticles() {
    if (!frame) return;
    const w = frame.weather || 'clear';
    const chars = WEATHER_CHARS[w];
    if (!chars || chars.length === 0) return;

    const skyEl = document.getElementById('sky-layer');
    const count = w === 'storm' ? 3 : w === 'rain' ? 2 : 1;

    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      const cls = (w === 'snow') ? 'snow-particle' : 'rain-particle';
      p.className = cls;
      p.textContent = chars[Math.floor(Math.random() * chars.length)];
      p.style.left = Math.random() * 100 + '%';
      p.style.top = '-5%';
      p.style.position = 'absolute';

      const duration = w === 'snow' ? 3000 + Math.random() * 2000 : 800 + Math.random() * 400;
      p.style.transition = `top ${duration}ms linear, opacity ${duration}ms`;

      skyEl.appendChild(p);

      // Animate downward
      requestAnimationFrame(() => {
        p.style.top = '105%';
        p.style.opacity = '0';
      });

      setTimeout(() => p.remove(), duration + 100);
    }
  }

  // ─── Resolved Overlay ───
  function showResolved() {
    const overlay = document.getElementById('war-resolved');
    if (!overlay || !frame) return;

    overlay.classList.add('visible');

    const c = frame.challenger;
    const d = frame.defender;
    const cWon = c.hp > d.hp;
    const winner = cWon ? c.name : d.name;
    const loser = cWon ? d.name : c.name;
    const winnerHp = cWon ? c.hp : d.hp;

    // Check for draw
    const isDraw = c.hp === d.hp;

    let html = '';
    if (isDraw) {
      html = `
        <div class="victory">DRAW</div>
        <div class="detail">Both civilizations survive... barely.</div>
        <div class="detail">${escapeHtml(c.name)} ${c.hp} HP — ${escapeHtml(d.name)} ${d.hp} HP</div>
      `;
    } else {
      html = `
        <div class="victory">VICTORY</div>
        <div class="detail">${escapeHtml(winner)} conquers ${escapeHtml(loser)}</div>
        <div class="detail">Final HP: ${winnerHp}/${frame.challenger.max_hp}</div>
        <div class="detail">Rounds fought: ${frame.round}</div>
      `;
    }

    html += `
      <a href="/arena">&lt; Back to Arena</a>
      <a href="/">Home</a>
    `;

    overlay.innerHTML = html;
  }

  // ─── Animation Loop (12fps) ───
  function startAnimLoop() {
    if (animInterval) clearInterval(animInterval);
    animInterval = setInterval(() => {
      animTick++;

      // Re-render armies for idle animation frames
      if (frame) {
        renderArmies();
      }

      // Spawn weather particles every few frames
      if (animTick % 4 === 0) {
        spawnWeatherParticles();
      }
    }, 1000 / 12);
  }

  // ─── Utilities ───
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── CSS Animation Injection ───
  // Add fire-streak keyframes dynamically
  const styleSheet = document.createElement('style');
  styleSheet.textContent = `
    @keyframes fire-streak {
      0% { top: -5%; opacity: 0.9; }
      80% { opacity: 0.7; }
      100% { top: 95%; opacity: 0; }
    }
  `;
  document.head.appendChild(styleSheet);

  // ─── War Resolved Element ───
  // Create the resolved overlay element if not in HTML
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('war-resolved')) {
      const resolved = document.createElement('div');
      resolved.id = 'war-resolved';
      const battlefield = document.getElementById('battlefield');
      if (battlefield) battlefield.appendChild(resolved);
    }
    init();
  });

})();

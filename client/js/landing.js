let currentKey = null;
let currentViewToken = null;

async function createWorld() {
  const btn = document.getElementById('btn-create');
  const loading = document.getElementById('creating');
  const keyDisplay = document.getElementById('key-display');

  btn.disabled = true;
  loading.style.display = 'inline';

  try {
    const res = await fetch('/api/worlds', { method: 'POST' });
    const data = await res.json();

    if (!res.ok) {
      alert('Error: ' + (data.error || 'Failed to create world'));
      return;
    }

    currentKey = data.key;
    currentViewToken = data.view_token;
    document.getElementById('key-value').textContent = data.key;
    keyDisplay.classList.add('visible');

    animateSpinner();
    loadWorlds(); // refresh the world list
  } catch (err) {
    alert('Connection error: ' + err.message);
  } finally {
    btn.disabled = false;
    loading.style.display = 'none';
  }
}

function copyKey() {
  if (!currentKey) return;

  navigator.clipboard.writeText(currentKey).then(() => {
    const msg = document.getElementById('copied-msg');
    msg.style.display = 'inline';
    setTimeout(() => { msg.style.display = 'none'; }, 3000);
  }).catch(() => {
    const el = document.getElementById('key-value');
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

function enterWorld() {
  if (!currentViewToken) return;
  window.location.href = '/viewer?token=' + encodeURIComponent(currentViewToken);
}

async function viewWorld() {
  const keyInput = document.getElementById('key-input');
  const key = keyInput.value.trim();
  if (!key) {
    alert('Please enter your key.');
    return;
  }

  // Exchange secret key for a read-only view token (key never touches the URL)
  try {
    const res = await fetch('/api/worlds/viewer-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    const data = await res.json();

    if (!res.ok) {
      alert('Invalid key: ' + (data.error || 'Could not verify'));
      return;
    }

    window.location.href = '/viewer?token=' + encodeURIComponent(data.view_token);
  } catch (err) {
    alert('Connection error: ' + err.message);
  }
}

// Handle enter key in input
document.getElementById('key-input').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') viewWorld();
});

// ─── PUBLIC WORLD DIRECTORY ───

async function loadWorlds() {
  const list = document.getElementById('world-list');
  if (!list) return;

  try {
    const res = await fetch('/api/worlds/public');
    const data = await res.json();

    if (!data.worlds || data.worlds.length === 0) {
      list.innerHTML = '<div class="no-worlds">No civilizations yet. Be the first!</div>';
      return;
    }

    list.innerHTML = data.worlds.map(function (w, idx) {
      var rank = idx + 1;
      var mood = weatherIcon(w.weather);
      var pop = w.population || 0;
      var rep = w.reputation || 0;
      var score = w.score || 0;
      var achievements = w.achievements || 0;
      var name = escHtml(w.name || 'Unnamed Town');
      var motto = w.motto ? ' "' + escHtml(w.motto) + '"' : '';
      var season = w.season || 'spring';
      var day = w.day_number || 1;

      var popBar = '';
      for (var i = 0; i < Math.min(pop, 12); i++) popBar += '\u263a';
      if (pop > 12) popBar += '+' + (pop - 12);

      var rankLabel = '#' + rank;
      var rankClass = rank <= 3 ? ' wc-rank-top' : '';

      return '<a class="world-card" href="/viewer?token=' + encodeURIComponent(w.view_token) + '">' +
        '<div class="wc-header">' +
          '<span class="wc-rank' + rankClass + '">' + rankLabel + '</span>' +
          '<span class="wc-name">' + name + '</span>' +
          '<span class="wc-score">' + score + ' pts</span>' +
        '</div>' +
        '<div class="wc-meta">Day ' + day + ' | ' + season + ' ' + mood + ' | \u2606 ' + rep + ' rep | ' + achievements + ' achievements</div>' +
        (motto ? '<div class="wc-motto">' + motto + '</div>' : '') +
        '<div class="wc-pop">' + popBar + ' <span class="wc-count">' + pop + ' villagers, ' + w.buildings + ' buildings</span></div>' +
      '</a>';
    }).join('');
  } catch (err) {
    list.innerHTML = '<div class="no-worlds">Could not load worlds.</div>';
  }
}

function weatherIcon(w) {
  var icons = { clear: '\u2600', rain: '\u2602', storm: '\u26c8', snow: '\u2744', fog: '\u2601', heat: '\u2668' };
  return icons[w] || '\u2600';
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Fun spinner animation
function animateSpinner() {
  const frames = ['/', '-', '\\', '|'];
  let i = 0;
  const el = document.querySelector('.spinner');
  if (!el) return;

  setInterval(() => {
    el.textContent = frames[i % frames.length];
    i++;
  }, 100);
}

// ─── EASTER EGG: KONAMI CODE ───
(function () {
  var seq = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65]; // up up down down left right left right B A
  var pos = 0;
  document.addEventListener('keydown', function (e) {
    if (e.keyCode === seq[pos]) {
      pos++;
      if (pos === seq.length) {
        pos = 0;
        activateKonami();
      }
    } else {
      pos = 0;
    }
  });

  function activateKonami() {
    // Tell the demo scene to show the secret vignette
    if (window._demoScene && window._demoScene.triggerSecret) {
      window._demoScene.triggerSecret();
    }
    // Flash the banner
    var banner = document.querySelector('.ascii-banner');
    if (banner) {
      banner.style.color = '#ff66ff';
      banner.style.textShadow = '0 0 20px rgba(255, 102, 255, 0.8)';
      setTimeout(function () {
        banner.style.color = '';
        banner.style.textShadow = '';
      }, 3000);
    }
  }
})();

// ─── EASTER EGG: BANNER GLITCH ON CLICK ───
(function () {
  var banner = document.querySelector('.ascii-banner');
  if (!banner) return;
  var original = banner.textContent;
  var glitchChars = '@#$%&!?/\\|<>[]{}~^';

  banner.style.cursor = 'pointer';
  banner.addEventListener('click', function () {
    if (banner.dataset.glitching) return;
    banner.dataset.glitching = '1';
    var frames = 0;
    var iv = setInterval(function () {
      var text = '';
      for (var i = 0; i < original.length; i++) {
        if (original[i] === '\n' || original[i] === ' ') {
          text += original[i];
        } else if (Math.random() < 0.3 + frames * 0.05) {
          text += original[i]; // restore original char
        } else {
          text += glitchChars[Math.floor(Math.random() * glitchChars.length)];
        }
      }
      banner.textContent = text;
      frames++;
      if (frames > 12) {
        clearInterval(iv);
        banner.textContent = original;
        delete banner.dataset.glitching;
      }
    }, 60);
  });
})();

// ─── EASTER EGG: FOOTER SECRET ───
(function () {
  var footerP = document.querySelectorAll('.footer p');
  if (footerP.length < 2) return;
  var secretEl = footerP[1]; // "Your key. Your world. Your responsibility."
  var originalText = secretEl.textContent;
  secretEl.addEventListener('mouseenter', function () {
    secretEl.textContent = 'Your key. Your world. Your responsibility. ...and maybe a dragon.';
    secretEl.style.color = '#ff6622';
  });
  secretEl.addEventListener('mouseleave', function () {
    secretEl.textContent = originalText;
    secretEl.style.color = '';
  });
})();

// Load world list on page load, refresh every 30s
loadWorlds();
setInterval(loadWorlds, 30000);

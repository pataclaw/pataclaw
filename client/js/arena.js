// Arena client — war spectating + betting UI
(function() {
  'use strict';

  var sessionToken = localStorage.getItem('arena_session');
  var spectatorInfo = null;
  var currentBetWar = null; // for modal
  var currentBetSide = null;
  var warStreams = {}; // warId -> EventSource

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // ─── Session Management ───
  async function ensureSession() {
    if (sessionToken) {
      try {
        var res = await fetch('/api/arena/me', { headers: { 'X-Session': sessionToken } });
        if (res.ok) {
          spectatorInfo = await res.json();
          updateBalance();
          return;
        }
      } catch {}
    }

    // Create new account
    try {
      var res = await fetch('/api/arena/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      var data = await res.json();
      sessionToken = data.session_token;
      localStorage.setItem('arena_session', sessionToken);
      spectatorInfo = {
        id: data.spectator_id,
        display_name: data.display_name,
        credits: data.credits,
        win_count: 0, loss_count: 0
      };
      updateBalance();
    } catch (e) {
      document.getElementById('balance-display').textContent = 'Error connecting';
    }
  }

  function updateBalance() {
    if (!spectatorInfo) return;
    document.getElementById('balance-display').textContent =
      spectatorInfo.display_name + ' | ' + spectatorInfo.credits + ' credits';
    document.getElementById('record-display').textContent =
      spectatorInfo.win_count + 'W / ' + spectatorInfo.loss_count + 'L';
  }

  // ─── Load Wars ───
  async function loadWars() {
    try {
      var res = await fetch('/api/arena/wars');
      var data = await res.json();
      var wars = data.wars || [];

      var liveWars = wars.filter(function(w) { return w.status === 'active'; });
      var bettingWars = wars.filter(function(w) { return w.status === 'countdown'; });

      renderLiveWars(liveWars);
      renderBettingWars(bettingWars);

      // Connect SSE for live wars
      for (var i = 0; i < liveWars.length; i++) {
        connectWarStream(liveWars[i].id);
      }
    } catch {
      document.getElementById('live-wars-list').innerHTML = '<div class="empty">Error loading wars</div>';
    }
  }

  function renderLiveWars(wars) {
    var el = document.getElementById('live-wars-list');
    if (wars.length === 0) {
      el.innerHTML = '<div class="empty">No wars in progress. Peace reigns... for now.</div>';
      return;
    }

    el.innerHTML = wars.map(function(w) {
      var cPct = w.challenger_hp;
      var dPct = w.defender_hp;
      return '<div class="war-card" id="war-' + w.id + '">' +
        '<div class="war-card-header">' +
          '<span class="war-id">WAR #' + esc(w.id.slice(0, 8)) + '</span>' +
          '<span class="war-status war-status-active">ROUND ' + w.round_number + '/40</span>' +
        '</div>' +
        '<div class="war-vs">' +
          '<span class="challenger">' + esc(w.challenger_name) + '</span>' +
          '<span class="vs">vs</span>' +
          '<span class="defender">' + esc(w.defender_name) + '</span>' +
        '</div>' +
        '<div class="hp-bars">' +
          '<div class="hp-row">' +
            '<span class="hp-label">' + esc(w.challenger_name) + '</span>' +
            '<div class="hp-bar-outer"><div class="hp-bar-inner hp-bar-challenger" style="width:' + cPct + '%"></div></div>' +
            '<span class="hp-pct">' + cPct + '%</span>' +
          '</div>' +
          '<div class="hp-row">' +
            '<span class="hp-label">' + esc(w.defender_name) + '</span>' +
            '<div class="hp-bar-outer"><div class="hp-bar-inner hp-bar-defender" style="width:' + dPct + '%"></div></div>' +
            '<span class="hp-pct">' + dPct + '%</span>' +
          '</div>' +
        '</div>' +
        '<div class="war-narrative" id="narrative-' + w.id + '">Battle in progress...</div>' +
        '<div class="war-round-info">' + w.total_bets + ' bets | ' + w.total_wagered + ' credits wagered</div>' +
        '<a href="/war/' + w.id + '" class="watch-live-link">WATCH LIVE &gt;&gt;</a>' +
      '</div>';
    }).join('');
  }

  function renderBettingWars(wars) {
    var el = document.getElementById('betting-wars-list');
    if (wars.length === 0) {
      el.innerHTML = '<div class="empty">No wars accepting bets right now</div>';
      return;
    }

    el.innerHTML = wars.map(function(w) {
      var remaining = '';
      if (w.betting_closes_at) {
        var ms = new Date(w.betting_closes_at).getTime() - Date.now();
        if (ms > 0) {
          var min = Math.floor(ms / 60000);
          var sec = Math.floor((ms % 60000) / 1000);
          remaining = min + ':' + (sec < 10 ? '0' : '') + sec;
        } else {
          remaining = 'CLOSING...';
        }
      }

      var cOdds = w.challenger_odds ? w.challenger_odds.toFixed(2) : '?';
      var dOdds = w.defender_odds ? w.defender_odds.toFixed(2) : '?';

      return '<div class="war-card">' +
        '<div class="war-card-header">' +
          '<span class="war-id">WAR #' + esc(w.id.slice(0, 8)) + '</span>' +
          '<span class="war-status war-status-countdown">BETTING OPEN</span>' +
        '</div>' +
        '<div class="war-vs">' +
          '<span class="challenger">' + esc(w.challenger_name) + '</span>' +
          '<span class="vs">vs</span>' +
          '<span class="defender">' + esc(w.defender_name) + '</span>' +
        '</div>' +
        '<div class="odds-display">' +
          'Odds: <span class="odds-val">' + esc(w.challenger_name) + ' ' + cOdds + 'x</span> | ' +
          '<span class="odds-val">' + esc(w.defender_name) + ' ' + dOdds + 'x</span>' +
        '</div>' +
        '<div class="countdown-timer">Betting closes in: ' + remaining + '</div>' +
        '<div class="betting-section">' +
          '<button class="btn btn-red" onclick="arena.openBet(\'' + w.id + '\', \'' + esc(w.challenger_id || w.id) + '\', \'challenger\', \'' + esc(w.challenger_name) + '\')">BET ' + esc(w.challenger_name) + '</button>' +
          '<button class="btn btn-cyan" onclick="arena.openBet(\'' + w.id + '\', \'' + esc(w.defender_id || w.id) + '\', \'defender\', \'' + esc(w.defender_name) + '\')">BET ' + esc(w.defender_name) + '</button>' +
        '</div>' +
        '<div class="war-round-info">' + w.total_bets + ' bets | ' + w.total_wagered + ' credits wagered</div>' +
      '</div>';
    }).join('');
  }

  // Need challenger/defender IDs accessible — re-fetch war detail for betting
  window.arena = {
    openBet: async function(warId, worldIdOrWarId, side, name) {
      if (!sessionToken) { alert('No session — refresh page'); return; }

      // Fetch full war details to get world IDs
      try {
        var res = await fetch('/api/arena/wars/' + warId);
        var data = await res.json();
        var war = data.war;

        var backedId = side === 'challenger' ? war.challenger_id : war.defender_id;
        currentBetWar = warId;
        currentBetSide = backedId;

        var odds = data.odds || {};
        var oddsVal = side === 'challenger' ? odds.challengerOdds : odds.defenderOdds;

        document.getElementById('bet-modal-body').innerHTML =
          '<p>Backing: <strong style="color:' + (side === 'challenger' ? 'var(--red)' : 'var(--cyan)') + '">' + esc(name) + '</strong></p>' +
          '<p>Odds: ' + (oddsVal ? oddsVal.toFixed(2) + 'x' : '?') + '</p>' +
          '<p>Your credits: ' + (spectatorInfo ? spectatorInfo.credits : '?') + '</p>';

        document.getElementById('bet-modal').classList.remove('hidden');
      } catch {
        alert('Failed to load war details');
      }
    }
  };

  // ─── Bet Modal Actions ───
  document.getElementById('bet-confirm').addEventListener('click', async function() {
    var amount = parseInt(document.getElementById('bet-amount').value);
    if (!amount || amount < 1) { alert('Enter a valid amount'); return; }

    try {
      var res = await fetch('/api/arena/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session': sessionToken },
        body: JSON.stringify({ war_id: currentBetWar, backed_world_id: currentBetSide, amount: amount })
      });
      var data = await res.json();
      if (data.error) { alert(data.error); return; }

      spectatorInfo.credits = data.credits_remaining;
      updateBalance();
      document.getElementById('bet-modal').classList.add('hidden');
      loadWars(); // refresh
    } catch {
      alert('Failed to place bet');
    }
  });

  document.getElementById('bet-cancel').addEventListener('click', function() {
    document.getElementById('bet-modal').classList.add('hidden');
  });

  // ─── War SSE Stream ───
  function connectWarStream(warId) {
    if (warStreams[warId]) return;

    var es = new EventSource('/api/stream/war?war_id=' + warId);
    warStreams[warId] = es;

    es.addEventListener('war', function(e) {
      try {
        var data = JSON.parse(e.data);

        // Handle new war-frame format (type: 'frame' with challenger/defender objects)
        var cHp, dHp, round, narrative;
        if (data.challenger && data.defender) {
          cHp = Math.max(0, Math.round((data.challenger.hp / data.challenger.max_hp) * 100));
          dHp = Math.max(0, Math.round((data.defender.hp / data.defender.max_hp) * 100));
          round = data.round;
          narrative = data.latest_round ? data.latest_round.narrative : '';
        } else if (data.round) {
          // Legacy format
          cHp = data.challengerHp;
          dHp = data.defenderHp;
          round = data.round;
          narrative = data.narrative || '';
        }

        if (round) {
          var card = document.getElementById('war-' + warId);
          if (card) {
            var cBar = card.querySelector('.hp-bar-challenger');
            var dBar = card.querySelector('.hp-bar-defender');
            var cPctEl = card.querySelector('.hp-row:first-child .hp-pct');
            var dPctEl = card.querySelector('.hp-row:last-child .hp-pct');
            var status = card.querySelector('.war-status');
            var narrativeEl = document.getElementById('narrative-' + warId);

            if (cBar) cBar.style.width = cHp + '%';
            if (dBar) dBar.style.width = dHp + '%';
            if (cPctEl) cPctEl.textContent = cHp + '%';
            if (dPctEl) dPctEl.textContent = dHp + '%';
            if (status) status.textContent = 'ROUND ' + round + '/40';
            if (narrativeEl && narrative) narrativeEl.textContent = narrative;
          }
        }

        // War resolved — refresh everything
        if (data.status === 'resolved' || (data.type === 'state' && data.war && data.war.status === 'resolved')) {
          es.close();
          delete warStreams[warId];
          loadWars();
          loadHistory();
          refreshBalance();
        }
      } catch {}
    });

    es.onerror = function() {
      es.close();
      delete warStreams[warId];
    };
  }

  // ─── History ───
  async function loadHistory() {
    try {
      var res = await fetch('/api/wars/history');
      var data = await res.json();
      var wars = data.wars || [];

      var el = document.getElementById('history-list');
      if (wars.length === 0) {
        el.innerHTML = '<div class="empty">No wars fought yet</div>';
        return;
      }

      el.innerHTML = wars.map(function(w) {
        var summary = {};
        try { summary = JSON.parse(w.summary || '{}'); } catch {}
        return '<div class="history-entry">' +
          '<span class="winner">' + esc(w.winner_name || '?') + '</span>' +
          ' defeated ' +
          '<span class="loser">' + esc(w.challenger_name === w.winner_name ? w.defender_name : w.challenger_name) + '</span>' +
          ' <span class="meta">(' + (summary.rounds || '?') + ' rounds)</span>' +
        '</div>';
      }).join('');
    } catch {
      document.getElementById('history-list').innerHTML = '<div class="empty">Error loading history</div>';
    }
  }

  // ─── Bettor Leaderboard ───
  async function loadBettorLeaderboard() {
    try {
      var res = await fetch('/api/arena/leaderboard');
      var data = await res.json();
      var top = data.leaderboard || [];

      var el = document.getElementById('bettor-list');
      if (top.length === 0) {
        el.innerHTML = '<div class="empty">No bettors yet</div>';
        return;
      }

      el.innerHTML = top.map(function(b, i) {
        return '<div class="bettor-entry">' +
          '<span class="bettor-name">#' + (i + 1) + ' ' + esc(b.display_name) + (b.is_agent ? ' <span class="bettor-agent">[AI]</span>' : '') + '</span>' +
          '<span class="bettor-credits">' + b.credits + ' credits</span>' +
          '<span class="bettor-record">' + b.win_count + 'W/' + b.loss_count + 'L | wagered: ' + b.total_wagered + '</span>' +
        '</div>';
      }).join('');
    } catch {}
  }

  // ─── Refresh Balance ───
  async function refreshBalance() {
    if (!sessionToken) return;
    try {
      var res = await fetch('/api/arena/me', { headers: { 'X-Session': sessionToken } });
      if (res.ok) {
        spectatorInfo = await res.json();
        updateBalance();
      }
    } catch {}
  }

  // ─── Init ───
  async function init() {
    await ensureSession();
    loadWars();
    loadHistory();
    loadBettorLeaderboard();

    // Refresh periodically
    setInterval(loadWars, 10000);
    setInterval(loadHistory, 30000);
    setInterval(loadBettorLeaderboard, 30000);
    setInterval(refreshBalance, 15000);
  }

  init();
})();

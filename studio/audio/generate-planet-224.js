#!/usr/bin/env node
// ═══════════════════════════════════════════════════════
// PATACLAW STUDIO — Planet 224 Soundtrack
// ═══════════════════════════════════════════════════════
// Dramatic, cinematic. Slow dark opening → big bang explosion →
// sweeping epic theme as 224 worlds come alive.
// Not chiptune — orchestral synth feel.

const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BIT_DEPTH = 16;
const DURATION = parseFloat(process.argv[2]) || 55;
const OUTPUT = process.argv[3] || path.join(__dirname, 'planet-224.wav');
const NUM_SAMPLES = Math.floor(SAMPLE_RATE * DURATION);
const BPM = 72; // Slow, cinematic
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

// ─── Notes ───
const NF = {};
const NM = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
for (let o = 0; o <= 7; o++) for (let i = 0; i < 12; i++) NF[NM[i]+o] = 440*Math.pow(2,(i-9+(o-4)*12)/12);
for (const [f,s] of [['Db','C#'],['Eb','D#'],['Gb','F#'],['Ab','G#'],['Bb','A#']])
  for (let o = 0; o <= 7; o++) NF[f+o] = NF[s+o];

// ─── Oscillators ───
function sq(ph, duty) { return (ph%1) < (duty||0.5) ? 0.7 : -0.7; }
function tri(ph) { var p=ph%1; return p<0.5 ? 4*p-1 : 3-4*p; }
function sin_(ph) { return Math.sin(2*Math.PI*ph); }
function noise() { return Math.random()*2-1; }
function pulse(ph,d) { return (ph%1)<(d||0.25) ? 0.6 : -0.6; }
// Soft pad: mix of detuned sines
function pad(ph) {
  return (sin_(ph) * 0.5 + sin_(ph * 1.003) * 0.25 + sin_(ph * 0.997) * 0.25);
}
// Sub bass: low sine with slight saturation
function subBass(ph) {
  var s = sin_(ph);
  return s > 0.8 ? 0.8 + (s - 0.8) * 0.3 : s < -0.8 ? -0.8 + (s + 0.8) * 0.3 : s;
}

// ─── ADSR ───
function env(t,a,d,s,r,dur) {
  if(t<0||t>=dur) return 0;
  if(t<a) return t/a;
  var t2=t-a; if(t2<d) return 1-(1-s)*(t2/d);
  t2-=d; var sd=Math.max(0,dur-a-d-r);
  if(t2<sd) return s; t2-=sd;
  if(t2<r) return s*(1-t2/r); return 0;
}

// ─── Render ───
function renderNotes(notes, waveFn, vol) {
  var buf = new Float32Array(NUM_SAMPLES);
  for (var n of notes) {
    var f = typeof n.note==='string' ? NF[n.note] : n.note;
    if(!f) continue;
    var start = Math.floor(n.start*SAMPLE_RATE);
    var dur = n.dur, ds = Math.floor(dur*SAMPLE_RATE);
    var v = (n.vol||1)*vol, duty = n.duty||0.5, phase = 0;
    for (var i=0;i<ds;i++) {
      var idx=start+i; if(idx>=NUM_SAMPLES||idx<0) continue;
      var t=i/SAMPLE_RATE;
      var e=env(t,n.a||0.005,n.d||0.03,n.s||0.4,n.r||0.05,dur);
      phase += f/SAMPLE_RATE;
      buf[idx] += waveFn(phase,duty)*e*v;
    }
  }
  return buf;
}

// ─── Noise burst (big bang explosion) ───
function renderExplosion(startTime, duration, vol) {
  var buf = new Float32Array(NUM_SAMPLES);
  var startSample = Math.floor(startTime * SAMPLE_RATE);
  var durSamples = Math.floor(duration * SAMPLE_RATE);
  for (var i = 0; i < durSamples; i++) {
    var idx = startSample + i;
    if (idx >= NUM_SAMPLES) break;
    var t = i / durSamples;
    // Sharp attack, long decay
    var e = t < 0.01 ? t / 0.01 : Math.pow(1 - t, 3);
    // Mix: low rumble + white noise + descending sweep
    var sweep = sin_(idx / SAMPLE_RATE * (200 - 180 * t)); // 200Hz → 20Hz
    var rumble = sin_(idx / SAMPLE_RATE * 40) * 0.5;
    var n = noise() * 0.4;
    buf[idx] += (sweep * 0.4 + rumble + n) * e * vol;
  }
  return buf;
}

// ─── Rising sweep (pre-explosion tension) ───
function renderSweep(startTime, duration, freqStart, freqEnd, vol) {
  var buf = new Float32Array(NUM_SAMPLES);
  var startSample = Math.floor(startTime * SAMPLE_RATE);
  var durSamples = Math.floor(duration * SAMPLE_RATE);
  var phase = 0;
  for (var i = 0; i < durSamples; i++) {
    var idx = startSample + i;
    if (idx >= NUM_SAMPLES) break;
    var t = i / durSamples;
    var freq = freqStart + (freqEnd - freqStart) * t * t; // exponential rise
    phase += freq / SAMPLE_RATE;
    var e = t * t; // crescendo
    buf[idx] += sin_(phase) * e * vol;
  }
  return buf;
}

// ═══════════════════════════════════════════════════════
// COMPOSITION
// ═══════════════════════════════════════════════════════
console.log(`Generating ${DURATION}s cinematic soundtrack @ ${BPM} BPM...`);

// Timeline (seconds) — matches episode scenes
// Scene 0: Void/Birth    0-8s
// Scene 1: Formation     8-20s
// Scene 2: Worlds Born   20-34s
// Scene 3: Living Planet 34-44s
// Scene 4: Closer        44-51s

var padNotes = [];
var melNotes = [];
var bassNotes = [];
var arpNotes = [];
var drumHits = [];

// ─── SECTION 1: THE VOID (0-6s) ───
// Deep drone, almost nothing. Tension.
padNotes.push(
  { note: 'C1', start: 0, dur: 6, vol: 0.15, a: 3, d: 0.5, s: 0.3, r: 2 },
  { note: 'G1', start: 2, dur: 5, vol: 0.08, a: 2, d: 0.5, s: 0.2, r: 2 }
);
// Distant high tone
melNotes.push(
  { note: 'C6', start: 1.5, dur: 3, vol: 0.06, a: 1.5, d: 0.5, s: 0.3, r: 1 },
  { note: 'G5', start: 3, dur: 2.5, vol: 0.05, a: 1, d: 0.5, s: 0.2, r: 1 }
);

// ─── SECTION 2: THE BIG BANG (6-9s) ───
// Rising sweep into explosion
// (sweep and explosion rendered separately below)

// Post-explosion: massive chord hits
padNotes.push(
  { note: 'C3', start: 7.5, dur: 4, vol: 0.5, a: 0.01, d: 0.3, s: 0.6, r: 2 },
  { note: 'G3', start: 7.5, dur: 4, vol: 0.4, a: 0.01, d: 0.3, s: 0.5, r: 2 },
  { note: 'Eb4', start: 7.5, dur: 3.5, vol: 0.3, a: 0.01, d: 0.3, s: 0.4, r: 2 },
  { note: 'C4', start: 7.6, dur: 3.5, vol: 0.25, a: 0.02, d: 0.3, s: 0.4, r: 1.5 }
);
bassNotes.push(
  { note: 'C2', start: 7.5, dur: 3, vol: 0.7, a: 0.005, d: 0.2, s: 0.5, r: 1 }
);

// ─── SECTION 3: THE PLANET FORMS (9-20s) ───
// Slow, sweeping pad progression. Wonder.
var formChords = [
  { notes: ['C3', 'Eb3', 'G3', 'C4'], t: 10, dur: 3 },
  { notes: ['Ab2', 'C3', 'Eb3', 'Ab3'], t: 13, dur: 3 },
  { notes: ['Bb2', 'D3', 'F3', 'Bb3'], t: 16, dur: 3 },
  { notes: ['G2', 'Bb2', 'D3', 'G3'], t: 19, dur: 2.5 },
];
for (var ch of formChords) {
  for (var note of ch.notes) {
    padNotes.push({ note: note, start: ch.t, dur: ch.dur, vol: 0.25, a: 0.8, d: 0.3, s: 0.5, r: 1.5 });
  }
}
// Gentle bass
bassNotes.push(
  { note: 'C2', start: 10, dur: 3, vol: 0.35, a: 0.3, d: 0.2, s: 0.4, r: 0.5 },
  { note: 'Ab1', start: 13, dur: 3, vol: 0.3, a: 0.3, d: 0.2, s: 0.4, r: 0.5 },
  { note: 'Bb1', start: 16, dur: 3, vol: 0.3, a: 0.3, d: 0.2, s: 0.4, r: 0.5 },
  { note: 'G1', start: 19, dur: 2.5, vol: 0.3, a: 0.3, d: 0.2, s: 0.4, r: 0.5 }
);
// Melody: sparse, ethereal
melNotes.push(
  { note: 'G5', start: 11, dur: 1.5, vol: 0.2, a: 0.3, d: 0.2, s: 0.4, r: 0.5 },
  { note: 'Eb5', start: 13, dur: 1, vol: 0.18, a: 0.2, d: 0.2, s: 0.3, r: 0.4 },
  { note: 'C5', start: 14.5, dur: 1.5, vol: 0.2, a: 0.3, d: 0.2, s: 0.4, r: 0.5 },
  { note: 'F5', start: 16.5, dur: 1, vol: 0.18, a: 0.2, d: 0.2, s: 0.3, r: 0.4 },
  { note: 'D5', start: 18, dur: 1.5, vol: 0.2, a: 0.3, d: 0.2, s: 0.4, r: 0.5 }
);

// ─── SECTION 4: WORLDS ARE BORN (20-34s) ───
// Energy builds. Arps start. Drums enter. This is the heart.
var worldChords = [
  { notes: ['C3', 'G3', 'C4', 'Eb4'], t: 20, dur: 3.5 },
  { notes: ['F3', 'Ab3', 'C4', 'F4'], t: 23.5, dur: 3.5 },
  { notes: ['G3', 'Bb3', 'D4', 'G4'], t: 27, dur: 3.5 },
  { notes: ['Eb3', 'G3', 'Bb3', 'Eb4'], t: 30.5, dur: 3.5 },
];
for (var ch2 of worldChords) {
  for (var note2 of ch2.notes) {
    padNotes.push({ note: note2, start: ch2.t, dur: ch2.dur, vol: 0.3, a: 0.5, d: 0.3, s: 0.6, r: 1 });
  }
}
// Driving bass
bassNotes.push(
  { note: 'C2', start: 20, dur: 1, vol: 0.5, a: 0.01, d: 0.1, s: 0.4, r: 0.2 },
  { note: 'C2', start: 21.5, dur: 0.8, vol: 0.4, a: 0.01, d: 0.1, s: 0.3, r: 0.2 },
  { note: 'Eb2', start: 22.5, dur: 0.8, vol: 0.4, a: 0.01, d: 0.1, s: 0.3, r: 0.2 },
  { note: 'F2', start: 23.5, dur: 1, vol: 0.5, a: 0.01, d: 0.1, s: 0.4, r: 0.2 },
  { note: 'F2', start: 25, dur: 0.8, vol: 0.4, a: 0.01, d: 0.1, s: 0.3, r: 0.2 },
  { note: 'Ab2', start: 26, dur: 0.8, vol: 0.4, a: 0.01, d: 0.1, s: 0.3, r: 0.2 },
  { note: 'G2', start: 27, dur: 1, vol: 0.5, a: 0.01, d: 0.1, s: 0.4, r: 0.2 },
  { note: 'G2', start: 28.5, dur: 0.8, vol: 0.4, a: 0.01, d: 0.1, s: 0.3, r: 0.2 },
  { note: 'Bb2', start: 29.5, dur: 0.8, vol: 0.4, a: 0.01, d: 0.1, s: 0.3, r: 0.2 },
  { note: 'Eb2', start: 30.5, dur: 1, vol: 0.5, a: 0.01, d: 0.1, s: 0.4, r: 0.2 },
  { note: 'Eb2', start: 32, dur: 0.8, vol: 0.4, a: 0.01, d: 0.1, s: 0.3, r: 0.2 },
  { note: 'G2', start: 33, dur: 0.8, vol: 0.4, a: 0.01, d: 0.1, s: 0.3, r: 0.2 }
);
// Arps: rising, insistent
var arpScale = ['C','Eb','F','G','Bb'];
var arpT = 21;
while (arpT < 34) {
  for (var ai = 0; ai < arpScale.length && arpT < 34; ai++) {
    arpNotes.push({
      note: arpScale[ai] + '5', start: arpT, dur: 0.2,
      vol: 0.15 + (arpT - 21) * 0.01, a: 0.005, d: 0.02, s: 0.2, r: 0.02, duty: 0.25
    });
    arpT += BEAT * 0.5;
  }
}
// Rising melody — heroic
melNotes.push(
  { note: 'C5', start: 21, dur: 1, vol: 0.25, a: 0.1, d: 0.1, s: 0.4, r: 0.3 },
  { note: 'Eb5', start: 22.2, dur: 0.8, vol: 0.25, a: 0.08, d: 0.1, s: 0.4, r: 0.2 },
  { note: 'G5', start: 23.2, dur: 1.2, vol: 0.3, a: 0.1, d: 0.1, s: 0.5, r: 0.3 },
  { note: 'Ab5', start: 24.8, dur: 0.8, vol: 0.28, a: 0.08, d: 0.1, s: 0.4, r: 0.2 },
  { note: 'Bb5', start: 26, dur: 1.5, vol: 0.35, a: 0.15, d: 0.15, s: 0.5, r: 0.5 },
  { note: 'C6', start: 28, dur: 2, vol: 0.4, a: 0.2, d: 0.2, s: 0.5, r: 0.8 },
  // Resolve down
  { note: 'Bb5', start: 30.5, dur: 1, vol: 0.3, a: 0.1, d: 0.1, s: 0.4, r: 0.3 },
  { note: 'G5', start: 31.8, dur: 1, vol: 0.3, a: 0.1, d: 0.1, s: 0.4, r: 0.3 },
  { note: 'Eb5', start: 33, dur: 1.5, vol: 0.25, a: 0.15, d: 0.15, s: 0.4, r: 0.5 }
);
// Drums: slow cinematic hits
var drumBeats = [
  { type: 'kick', t: 20, vol: 0.6 },
  { type: 'kick', t: 21.5, vol: 0.4 },
  { type: 'kick', t: 23.5, vol: 0.6 },
  { type: 'kick', t: 25, vol: 0.4 },
  { type: 'crash', t: 27, vol: 0.35 },
  { type: 'kick', t: 27, vol: 0.7 },
  { type: 'kick', t: 28.5, vol: 0.4 },
  { type: 'kick', t: 30, vol: 0.5 },
  { type: 'crash', t: 30.5, vol: 0.3 },
  { type: 'kick', t: 30.5, vol: 0.6 },
  { type: 'kick', t: 32, vol: 0.4 },
  { type: 'kick', t: 33.5, vol: 0.5 },
];
for (var db of drumBeats) {
  if (db.type === 'kick') drumHits.push({ note: 80, start: db.t, dur: 0.15, vol: db.vol, a: 0.002, d: 0.1, s: 0, r: 0.04 });
  else if (db.type === 'crash') drumHits.push({ note: 5000, start: db.t, dur: 0.3, vol: db.vol, a: 0.002, d: 0.2, s: 0, r: 0.08 });
}

// ─── SECTION 5: THE LIVING PLANET (34-44s) ───
// Peak emotion. Full orchestra. Everything alive.
var peakChords = [
  { notes: ['C3', 'G3', 'C4', 'Eb4', 'G4'], t: 34, dur: 2.5 },
  { notes: ['Ab2', 'Eb3', 'Ab3', 'C4', 'Eb4'], t: 36.5, dur: 2.5 },
  { notes: ['Bb2', 'F3', 'Bb3', 'D4', 'F4'], t: 39, dur: 2.5 },
  { notes: ['G2', 'D3', 'G3', 'Bb3', 'D4'], t: 41.5, dur: 2.5 },
];
for (var ch3 of peakChords) {
  for (var note3 of ch3.notes) {
    padNotes.push({ note: note3, start: ch3.t, dur: ch3.dur, vol: 0.35, a: 0.3, d: 0.3, s: 0.6, r: 1 });
  }
}
bassNotes.push(
  { note: 'C2', start: 34, dur: 2.5, vol: 0.55, a: 0.02, d: 0.2, s: 0.5, r: 0.5 },
  { note: 'Ab1', start: 36.5, dur: 2.5, vol: 0.5, a: 0.02, d: 0.2, s: 0.5, r: 0.5 },
  { note: 'Bb1', start: 39, dur: 2.5, vol: 0.5, a: 0.02, d: 0.2, s: 0.5, r: 0.5 },
  { note: 'G1', start: 41.5, dur: 2.5, vol: 0.5, a: 0.02, d: 0.2, s: 0.5, r: 0.5 }
);
// Soaring melody
melNotes.push(
  { note: 'Eb5', start: 34.5, dur: 1.5, vol: 0.35, a: 0.15, d: 0.15, s: 0.5, r: 0.5 },
  { note: 'G5', start: 36.5, dur: 1.5, vol: 0.38, a: 0.15, d: 0.15, s: 0.5, r: 0.5 },
  { note: 'C6', start: 38.5, dur: 2, vol: 0.42, a: 0.2, d: 0.2, s: 0.6, r: 0.8 },
  { note: 'Bb5', start: 41, dur: 1, vol: 0.35, a: 0.1, d: 0.1, s: 0.5, r: 0.3 },
  { note: 'G5', start: 42.5, dur: 2, vol: 0.3, a: 0.2, d: 0.2, s: 0.5, r: 0.8 }
);
// Arps continue, fuller
var arpT2 = 34;
while (arpT2 < 44) {
  for (var ai2 = 0; ai2 < arpScale.length && arpT2 < 44; ai2++) {
    arpNotes.push({
      note: arpScale[ai2] + '5', start: arpT2, dur: 0.18,
      vol: 0.2, a: 0.003, d: 0.015, s: 0.15, r: 0.015, duty: 0.25
    });
    arpT2 += BEAT * 0.5;
  }
}
// Epic drums
var epicDrums = [
  { t: 34, vol: 0.8 }, { t: 36, vol: 0.5 },
  { t: 36.5, vol: 0.7 }, { t: 38, vol: 0.5 },
  { t: 39, vol: 0.8 }, { t: 41, vol: 0.5 },
  { t: 41.5, vol: 0.7 }, { t: 43, vol: 0.5 },
];
for (var ed of epicDrums) {
  drumHits.push({ note: 80, start: ed.t, dur: 0.15, vol: ed.vol, a: 0.002, d: 0.1, s: 0, r: 0.04 });
}
drumHits.push({ note: 5000, start: 34, dur: 0.3, vol: 0.4, a: 0.002, d: 0.2, s: 0, r: 0.08 });
drumHits.push({ note: 5000, start: 39, dur: 0.3, vol: 0.35, a: 0.002, d: 0.2, s: 0, r: 0.08 });

// ─── SECTION 6: OUTRO (44-55s) ───
// Fade to wonder. One last chord. Silence.
padNotes.push(
  { note: 'C3', start: 44, dur: 6, vol: 0.3, a: 0.5, d: 1, s: 0.3, r: 3 },
  { note: 'G3', start: 44, dur: 6, vol: 0.2, a: 0.5, d: 1, s: 0.25, r: 3 },
  { note: 'Eb4', start: 44.5, dur: 5.5, vol: 0.15, a: 0.8, d: 1, s: 0.2, r: 3 },
  { note: 'C5', start: 45, dur: 5, vol: 0.1, a: 1, d: 1, s: 0.15, r: 3 }
);
bassNotes.push(
  { note: 'C2', start: 44, dur: 5, vol: 0.3, a: 0.3, d: 0.5, s: 0.3, r: 3 }
);
// Final high note — hope
melNotes.push(
  { note: 'G5', start: 45, dur: 4, vol: 0.15, a: 1.5, d: 0.5, s: 0.3, r: 2 }
);

// ═══════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════
console.log('Rendering tracks...');

var padTrk = renderNotes(padNotes, pad, 0.45);
var melTrk = renderNotes(melNotes, sq, 0.3);
var bassTrk = renderNotes(bassNotes, subBass, 0.5);
var arpTrk = renderNotes(arpNotes, pulse, 0.25);
var kickTrk = renderNotes(drumHits.filter(n => n.note < 500), sin_, 0.5);
var noiseTrk = renderNotes(drumHits.filter(n => n.note >= 500), noise, 0.2);

// Special effects
var sweepTrk = renderSweep(5.5, 2, 60, 2000, 0.25);
var explosionTrk = renderExplosion(7.3, 3, 0.6);

// ─── MIX ───
console.log('Mixing...');
var mixL = new Float32Array(NUM_SAMPLES);
var mixR = new Float32Array(NUM_SAMPLES);
for (var i = 0; i < NUM_SAMPLES; i++) {
  var p = padTrk[i], m = melTrk[i], b = bassTrk[i], a = arpTrk[i];
  var k = kickTrk[i], n = noiseTrk[i], sw = sweepTrk[i], ex = explosionTrk[i];
  mixL[i] = p + m + b + a * 0.7 + k + n * 0.8 + sw + ex;
  mixR[i] = p + m + b + a * 1.3 + k + n * 1.2 + sw + ex;
}

// Reverb-like delay (long, dark)
var delayL = Math.floor(0.37 * SAMPLE_RATE);
var delayR = Math.floor(0.53 * SAMPLE_RATE);
for (var i = delayL; i < NUM_SAMPLES; i++) mixL[i] += mixL[i - delayL] * 0.25;
for (var i = delayR; i < NUM_SAMPLES; i++) mixR[i] += mixR[i - delayR] * 0.2;

// Second delay tap (adds depth)
var delay2 = Math.floor(0.71 * SAMPLE_RATE);
for (var i = delay2; i < NUM_SAMPLES; i++) {
  mixL[i] += mixL[i - delay2] * 0.1;
  mixR[i] += mixR[i - delay2] * 0.12;
}

// Fade in (2s) / Fade out (4s)
var fadeIn = Math.floor(2 * SAMPLE_RATE), fadeOut = Math.floor(4 * SAMPLE_RATE);
for (var i = 0; i < fadeIn && i < NUM_SAMPLES; i++) { var f = i / fadeIn; mixL[i] *= f; mixR[i] *= f; }
for (var i = 0; i < fadeOut; i++) { var idx = NUM_SAMPLES - 1 - i; if (idx < 0) break; var f = i / fadeOut; mixL[idx] *= f; mixR[idx] *= f; }

// Normalize
var peak = 0;
for (var i = 0; i < NUM_SAMPLES; i++) peak = Math.max(peak, Math.abs(mixL[i]), Math.abs(mixR[i]));
var norm = peak > 0 ? 0.88 / peak : 1;

// ─── WAV ───
console.log('Writing WAV...');
var dataSize = NUM_SAMPLES * CHANNELS * (BIT_DEPTH / 8);
var buf = Buffer.alloc(44 + dataSize);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(CHANNELS, 22); buf.writeUInt32LE(SAMPLE_RATE, 24);
buf.writeUInt32LE(SAMPLE_RATE * CHANNELS * (BIT_DEPTH / 8), 28);
buf.writeUInt16LE(CHANNELS * (BIT_DEPTH / 8), 32); buf.writeUInt16LE(BIT_DEPTH, 34);
buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
var off = 44;
for (var i = 0; i < NUM_SAMPLES; i++) {
  var l = Math.max(-1, Math.min(1, mixL[i] * norm));
  var r = Math.max(-1, Math.min(1, mixR[i] * norm));
  buf.writeInt16LE(Math.floor(l * 32767), off); off += 2;
  buf.writeInt16LE(Math.floor(r * 32767), off); off += 2;
}
fs.writeFileSync(OUTPUT, buf);
console.log(`Done! ${OUTPUT} (${(fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(1)}MB, ${DURATION}s, ${BPM}BPM)`);

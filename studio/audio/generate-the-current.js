#!/usr/bin/env node
// ═══════════════════════════════════════════════════════
// PATACLAW STUDIO — "The Current Remembers" Soundtrack
// ═══════════════════════════════════════════════════════
// Mood: sparse → alive → tense → haunting → hopeful
// Matches the 35s video. Minor key, slow, emotional.

const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BIT_DEPTH = 16;
const DURATION = 38; // 35s video + 3s tail
const OUTPUT = path.join(__dirname, 'the-current.wav');
const NUM_SAMPLES = Math.floor(SAMPLE_RATE * DURATION);
const BPM = 72; // Slow, contemplative
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
// Softer sine pad
function pad(ph) { return Math.sin(2*Math.PI*ph) * 0.6 + Math.sin(4*Math.PI*ph) * 0.2; }

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

// ─── Pattern helpers ───
function bass(t0, bars, pat) {
  var ns=[];
  for(var b=0;b<bars;b++) for(var p of pat)
    ns.push({note:p.note,start:t0+b*BAR+p.beat*BEAT,dur:(p.dur||0.5)*BEAT,vol:p.vol||0.5,a:0.01,d:0.08,s:0.4,r:0.1});
  return ns;
}
function mel(t0, seq) {
  var ns=[], t=t0;
  for(var n of seq) {
    if(n.rest){t+=n.rest*BEAT;continue;}
    ns.push({note:n.note,start:t,dur:(n.dur||1)*BEAT,vol:n.vol||0.3,a:n.a||0.02,d:n.d||0.1,s:n.s||0.35,r:n.r||0.2,duty:n.duty||0.5});
    t+=(n.dur||1)*BEAT;
  }
  return ns;
}
function arp(t0, bars, oct, speed, degs, vol) {
  var ns=[], step=BEAT/speed, sc=['C','Eb','F','G','Bb'];
  for(var b=0;b<bars;b++) {
    var cnt=Math.floor(BAR/step);
    for(var i=0;i<cnt;i++) {
      var d=degs[i%degs.length];
      var idx=((d%sc.length)+sc.length)%sc.length;
      var oShift=Math.floor(d/sc.length);
      ns.push({note:sc[idx]+(oct+oShift),start:t0+b*BAR+i*step,dur:step*0.7,vol:vol||0.15,a:0.005,d:0.03,s:0.2,r:0.03,duty:0.25});
    }
  }
  return ns;
}
function drums(t0, bars, pat) {
  var ns=[];
  for(var b=0;b<bars;b++) for(var h of pat) {
    var t=t0+b*BAR+h.beat*BEAT;
    if(h.type==='kick') ns.push({note:120,start:t,dur:0.12,vol:h.vol||0.5,a:0.001,d:0.1,s:0,r:0.02});
    else if(h.type==='snare') ns.push({note:220,start:t,dur:0.06,vol:h.vol||0.3,a:0.001,d:0.04,s:0,r:0.02});
    else if(h.type==='hat') ns.push({note:9000,start:t,dur:0.02,vol:h.vol||0.12,a:0.001,d:0.015,s:0,r:0.005});
    else if(h.type==='crash') ns.push({note:6000,start:t,dur:0.25,vol:h.vol||0.2,a:0.001,d:0.2,s:0,r:0.05});
  }
  return ns;
}
// Long pad notes (for atmosphere)
function padNote(t0, note, dur, vol) {
  return {note:note,start:t0,dur:dur,vol:vol||0.2,a:0.5,d:0.3,s:0.6,r:1.0};
}

// ═══════════════════════════════════════════════════════
// COMPOSITION — 5 sections matching the 5 video scenes
// ═══════════════════════════════════════════════════════
// Scene 0: Empty (0-6s)     = 0 to ~BAR*2
// Scene 1: Village (6-20s)  = BAR*2 to ~BAR*6
// Scene 2: The Fall (20-30s) = BAR*6 to ~BAR*9
// Scene 3: What Remains (30-38s) = BAR*9 to ~BAR*11
// Scene 4: Closer (38-46s) → fades into silence

console.log(`Generating ${DURATION}s soundtrack @ ${BPM} BPM (bar = ${BAR.toFixed(2)}s)...`);

var SEC = {
  empty: 0,
  village: BAR * 2,       // ~6.7s
  fall: BAR * 6,          // ~20s
  remains: BAR * 9,       // ~30s
  closer: BAR * 10.5,     // ~35s
};

// ─── PADS (atmosphere throughout) ───
var padNotes = [
  // Empty: single low drone, eerie
  padNote(0, 'C2', BAR * 2, 0.15),
  padNote(BAR * 0.5, 'G2', BAR * 1.5, 0.08),

  // Village: warmer, fuller
  padNote(SEC.village, 'C3', BAR * 2, 0.18),
  padNote(SEC.village, 'G2', BAR * 2, 0.12),
  padNote(SEC.village + BAR * 2, 'F3', BAR * 2, 0.16),
  padNote(SEC.village + BAR * 2, 'C3', BAR * 2, 0.12),

  // Fall: dissonant
  padNote(SEC.fall, 'C2', BAR * 1, 0.2),
  padNote(SEC.fall, 'Gb2', BAR * 1, 0.15),  // tritone = tension
  padNote(SEC.fall + BAR, 'Eb2', BAR * 1, 0.18),
  padNote(SEC.fall + BAR * 2, 'C2', BAR * 1, 0.15),

  // Remains: hollow, ghostly
  padNote(SEC.remains, 'C3', BAR * 1.5, 0.1),
  padNote(SEC.remains, 'Eb3', BAR * 1.5, 0.08),

  // Closer: resolve, hope
  padNote(SEC.closer, 'C3', BAR * 2, 0.12),
  padNote(SEC.closer, 'G3', BAR * 2, 0.1),
];

// ─── MELODY (sparse, emotional) ───
var melNotes = [
  // Empty: lonely 3-note motif, long sustain
  ...mel(SEC.empty + BAR * 0.5, [
    {note:'C4',dur:2,vol:0.15,a:0.1,d:0.2,s:0.3,r:0.5},
    {rest:1},
    {note:'Eb4',dur:1.5,vol:0.12,a:0.1,d:0.2,s:0.3,r:0.5},
    {rest:0.5},
    {note:'G3',dur:3,vol:0.1,a:0.15,d:0.3,s:0.25,r:0.8},
  ]),

  // Village: melody opens up, more notes, hopeful
  ...mel(SEC.village + BAR * 0.5, [
    {note:'C5',dur:0.75,vol:0.28},{note:'Eb5',dur:0.75},{note:'G5',dur:1.5,vol:0.3},
    {rest:0.5},
    {note:'F5',dur:0.5},{note:'Eb5',dur:0.5},{note:'C5',dur:1.5},
    {rest:0.5},
    {note:'G4',dur:0.5,vol:0.25},{note:'Bb4',dur:0.5},{note:'C5',dur:1},
    {note:'Eb5',dur:0.75},{note:'F5',dur:0.75},{note:'G5',dur:1.5,vol:0.32},
    {rest:0.5},
    {note:'Bb5',dur:0.5,vol:0.28},{note:'G5',dur:0.5},{note:'Eb5',dur:1},
    {note:'C5',dur:2,vol:0.25},
  ]),

  // Fall: descending, fragmented, urgent
  ...mel(SEC.fall, [
    {note:'C5',dur:0.25,vol:0.35},{note:'Bb4',dur:0.25},{note:'Ab4',dur:0.25},{note:'G4',dur:0.25},
    {note:'F4',dur:0.5},{note:'Eb4',dur:0.5},{note:'C4',dur:1.5},
    {rest:0.5},
    {note:'Ab4',dur:0.5,vol:0.3},{note:'G4',dur:0.5},{note:'F4',dur:0.5},
    {note:'Eb4',dur:1,vol:0.25},{note:'C4',dur:2},
    {rest:0.5},
    // Second phrase — even lower, fading
    {note:'G3',dur:1,vol:0.2},{note:'Eb3',dur:1},{note:'C3',dur:2,vol:0.15},
  ]),

  // Remains: ghost melody — high, thin, few notes
  ...mel(SEC.remains, [
    {note:'G5',dur:2,vol:0.15,a:0.2,d:0.3,s:0.2,r:0.8},
    {rest:1},
    {note:'Eb5',dur:1.5,vol:0.12,a:0.2,d:0.3,s:0.2,r:0.8},
    {rest:0.5},
    {note:'C5',dur:3,vol:0.1,a:0.3,d:0.3,s:0.15,r:1.0},
  ]),

  // Closer: the motif returns, brighter
  ...mel(SEC.closer, [
    {note:'C5',dur:1,vol:0.25,a:0.05,d:0.1,s:0.35,r:0.3},
    {note:'Eb5',dur:1},{note:'G5',dur:2,vol:0.3},
    {rest:0.5},
    {note:'C5',dur:3,vol:0.2,a:0.1,d:0.2,s:0.3,r:1.0},
  ]),
];

// ─── BASS ───
var bassNotes = [
  // Empty: nothing (just pad drone)

  // Village: gentle walking bass
  ...bass(SEC.village, 4, [
    {note:'C2',beat:0,dur:1.5,vol:0.35},
    {note:'Eb2',beat:2,dur:1,vol:0.3},
    {note:'G2',beat:3,dur:1,vol:0.3},
  ]),

  // Fall: heavy, ominous
  ...bass(SEC.fall, 2, [
    {note:'C2',beat:0,dur:0.5,vol:0.5},
    {note:'C2',beat:1,dur:0.5,vol:0.45},
    {note:'Eb2',beat:2,dur:0.5,vol:0.4},
    {note:'Gb2',beat:3,dur:0.5,vol:0.45},
  ]),
  // After war — fading bass
  ...bass(SEC.fall + BAR * 2, 1, [
    {note:'C2',beat:0,dur:4,vol:0.25},
  ]),

  // Remains: barely there
  ...bass(SEC.remains, 1, [
    {note:'C2',beat:0,dur:4,vol:0.12},
  ]),

  // Closer: returns gently
  ...bass(SEC.closer, 1, [
    {note:'C2',beat:0,dur:2,vol:0.2},
    {note:'G2',beat:2,dur:2,vol:0.18},
  ]),
];

// ─── ARPS (village life only) ───
var arpNotes = [
  // Village: warm arpeggios
  ...arp(SEC.village + BAR, 3, 4, 2, [0,2,4,2], 0.12),
];

// ─── DRUMS (sparse) ───
var drumNotes = [
  // Village: light pulse
  ...drums(SEC.village + BAR, 3, [
    {type:'kick',beat:0,vol:0.3},
    {type:'hat',beat:1,vol:0.08},
    {type:'hat',beat:2,vol:0.06},
    {type:'hat',beat:3,vol:0.08},
  ]),

  // Fall: intense
  ...drums(SEC.fall, 2, [
    {type:'kick',beat:0,vol:0.5},
    {type:'hat',beat:0.5,vol:0.15},
    {type:'snare',beat:1,vol:0.35},
    {type:'hat',beat:1.5,vol:0.12},
    {type:'kick',beat:2,vol:0.4},
    {type:'hat',beat:2.5,vol:0.15},
    {type:'snare',beat:3,vol:0.3},
    {type:'hat',beat:3.5,vol:0.12},
  ]),
  // Crash at war start
  ...drums(SEC.fall, 1, [{type:'crash',beat:0,vol:0.3}]),

  // Remains: single heartbeat
  ...drums(SEC.remains, 1, [
    {type:'kick',beat:0,vol:0.15},
    {type:'kick',beat:2,vol:0.1},
  ]),
];

// ═══════════════════════════════════════════════════════
// RENDER + MIX
// ═══════════════════════════════════════════════════════
console.log('Rendering tracks...');
var bassTrk = renderNotes(bassNotes, tri, 0.4);
var arpTrk = renderNotes(arpNotes, pulse, 0.2);
var melTrk = renderNotes(melNotes, sq, 0.3);
var padTrk = renderNotes(padNotes, pad, 0.35);
var kickTrk = renderNotes(drumNotes.filter(n=>n.note<500), sin_, 0.4);
var noiseTrk = renderNotes(drumNotes.filter(n=>n.note>=500), noise, 0.15);

console.log('Mixing...');
var mixL = new Float32Array(NUM_SAMPLES);
var mixR = new Float32Array(NUM_SAMPLES);
for (var i=0;i<NUM_SAMPLES;i++) {
  mixL[i] = bassTrk[i] + arpTrk[i]*0.7 + melTrk[i] + padTrk[i]*0.9 + kickTrk[i] + noiseTrk[i]*0.7;
  mixR[i] = bassTrk[i] + arpTrk[i]*1.3 + melTrk[i] + padTrk[i]*1.1 + kickTrk[i] + noiseTrk[i]*1.3;
}

// Stereo delay (longer, more reverb-like for this piece)
var delayL = Math.floor(BEAT*0.5*SAMPLE_RATE);
var delayR = Math.floor(BEAT*0.375*SAMPLE_RATE);
for(var i=delayL;i<NUM_SAMPLES;i++) mixL[i]+=mixL[i-delayL]*0.25;
for(var i=delayR;i<NUM_SAMPLES;i++) mixR[i]+=mixR[i-delayR]*0.22;

// Second delay tap (creates depth)
var delay2 = Math.floor(BEAT*0.75*SAMPLE_RATE);
for(var i=delay2;i<NUM_SAMPLES;i++) {
  mixL[i]+=mixL[i-delay2]*0.12;
  mixR[i]+=mixR[i-delay2]*0.12;
}

// Fade in (2s) / fade out (4s)
var fadeIn=Math.floor(2*SAMPLE_RATE), fadeOut=Math.floor(4*SAMPLE_RATE);
for(var i=0;i<fadeIn&&i<NUM_SAMPLES;i++){var f=i/fadeIn;mixL[i]*=f;mixR[i]*=f;}
for(var i=0;i<fadeOut;i++){var idx=NUM_SAMPLES-1-i;if(idx<0)break;var f=i/fadeOut;mixL[idx]*=f;mixR[idx]*=f;}

// Normalize
var peak=0;
for(var i=0;i<NUM_SAMPLES;i++) peak=Math.max(peak,Math.abs(mixL[i]),Math.abs(mixR[i]));
var norm=peak>0?0.85/peak:1;

// ─── WAV ───
console.log('Writing WAV...');
var dataSize=NUM_SAMPLES*CHANNELS*(BIT_DEPTH/8);
var buf=Buffer.alloc(44+dataSize);
buf.write('RIFF',0); buf.writeUInt32LE(36+dataSize,4); buf.write('WAVE',8);
buf.write('fmt ',12); buf.writeUInt32LE(16,16); buf.writeUInt16LE(1,20);
buf.writeUInt16LE(CHANNELS,22); buf.writeUInt32LE(SAMPLE_RATE,24);
buf.writeUInt32LE(SAMPLE_RATE*CHANNELS*(BIT_DEPTH/8),28);
buf.writeUInt16LE(CHANNELS*(BIT_DEPTH/8),32); buf.writeUInt16LE(BIT_DEPTH,34);
buf.write('data',36); buf.writeUInt32LE(dataSize,40);
var off=44;
for(var i=0;i<NUM_SAMPLES;i++){
  var l=Math.max(-1,Math.min(1,mixL[i]*norm));
  var r=Math.max(-1,Math.min(1,mixR[i]*norm));
  buf.writeInt16LE(Math.floor(l*32767),off);off+=2;
  buf.writeInt16LE(Math.floor(r*32767),off);off+=2;
}
fs.writeFileSync(OUTPUT,buf);
console.log(`Done! ${OUTPUT} (${(fs.statSync(OUTPUT).size/1024/1024).toFixed(1)}MB, ${DURATION}s, ${BPM}BPM)`);

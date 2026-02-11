#!/usr/bin/env node
// ═══════════════════════════════════════════════════════
// PATACLAW STUDIO — Feb 11 Update Soundtrack
// ═══════════════════════════════════════════════════════
// Upbeat chiptune — hype energy. Build → groove → intense war drums → fade.
// ~40s, punchy, 150 BPM

const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BIT_DEPTH = 16;
const DURATION = parseFloat(process.argv[2]) || 40;
const OUTPUT = process.argv[3] || path.join(__dirname, 'feb11.wav');
const NUM_SAMPLES = Math.floor(SAMPLE_RATE * DURATION);
const BPM = 150;
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
function saw(ph) { return 2*(ph%1)-1; }

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
    ns.push({note:p.note,start:t0+b*BAR+p.beat*BEAT,dur:(p.dur||0.5)*BEAT,vol:p.vol||0.7,a:0.003,d:0.04,s:0.5,r:0.04});
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
      ns.push({note:sc[idx]+(oct+oShift),start:t0+b*BAR+i*step,dur:step*0.6,vol:vol||0.2,a:0.002,d:0.015,s:0.2,r:0.01,duty:0.25});
    }
  }
  return ns;
}
function mel(t0, seq) {
  var ns=[], t=t0;
  for(var n of seq) {
    if(n.rest){t+=n.rest*BEAT;continue;}
    ns.push({note:n.note,start:t,dur:(n.dur||1)*BEAT,vol:n.vol||0.35,a:0.008,d:0.06,s:0.4,r:0.1,duty:n.duty||0.5});
    t+=(n.dur||1)*BEAT;
  }
  return ns;
}
function drums(t0, bars, pat) {
  var ns=[];
  for(var b=0;b<bars;b++) for(var h of pat) {
    var t=t0+b*BAR+h.beat*BEAT;
    if(h.type==='kick') ns.push({note:120,start:t,dur:0.12,vol:h.vol||0.65,a:0.001,d:0.09,s:0,r:0.03});
    else if(h.type==='snare') ns.push({note:280,start:t,dur:0.07,vol:h.vol||0.4,a:0.001,d:0.05,s:0,r:0.02});
    else if(h.type==='hat') ns.push({note:9000,start:t,dur:0.025,vol:h.vol||0.2,a:0.001,d:0.02,s:0,r:0.005});
    else if(h.type==='crash') ns.push({note:6000,start:t,dur:0.25,vol:h.vol||0.3,a:0.001,d:0.18,s:0,r:0.06});
    else if(h.type==='tom') ns.push({note:h.pitch||180,start:t,dur:0.1,vol:h.vol||0.5,a:0.001,d:0.07,s:0,r:0.03});
  }
  return ns;
}

// ─── COMPOSITION ───
console.log(`Generating ${DURATION}s chiptune @ ${BPM} BPM...`);

// Sections (in seconds, mapped to bars)
var S = {
  title:   0,              // 0-6s: title screen — atmospheric
  tiers:   BAR*4,          // 6-16s: building tiers — upbeat groove
  fog:     BAR*10,         // 16-25s: fog of war — mysterious build
  coast:   BAR*16,         // 25-33s: coastline — triumphant
  war:     BAR*21,         // 33-38s: war tease — HEAVY drums, dark
  closer:  BAR*25,         // 38-40s: fade out
};

// ─── TITLE: atmospheric pulse ───
var titleBeat = [
  {type:'kick',beat:0,vol:0.3},
  {type:'hat',beat:2,vol:0.1},
];

// ─── TIERS: upbeat groove ───
var tiersBeat = [
  {type:'kick',beat:0},{type:'hat',beat:0.5},
  {type:'kick',beat:1},{type:'hat',beat:1.5},
  {type:'snare',beat:2},{type:'hat',beat:2.5},
  {type:'kick',beat:3},{type:'hat',beat:3.5},
];

// ─── FOG: atmospheric, sparse ───
var fogBeat = [
  {type:'kick',beat:0,vol:0.4},{type:'hat',beat:1,vol:0.12},
  {type:'hat',beat:2,vol:0.1},{type:'snare',beat:3,vol:0.2},
];

// ─── COAST: triumphant ───
var coastBeat = [
  {type:'kick',beat:0,vol:0.7},{type:'crash',beat:0},{type:'hat',beat:0.5},
  {type:'hat',beat:1},{type:'hat',beat:1.5},
  {type:'snare',beat:2,vol:0.5},{type:'hat',beat:2.5},
  {type:'kick',beat:3},{type:'hat',beat:3.5},
];

// ─── WAR: heavy double-kick, war drums ───
var warBeat = [
  {type:'kick',beat:0,vol:0.9},{type:'kick',beat:0.25,vol:0.7},
  {type:'tom',beat:0.5,vol:0.6,pitch:150},{type:'hat',beat:0.75,vol:0.15},
  {type:'snare',beat:1,vol:0.6},{type:'kick',beat:1.25,vol:0.5},
  {type:'tom',beat:1.5,vol:0.5,pitch:130},{type:'hat',beat:1.75,vol:0.15},
  {type:'kick',beat:2,vol:0.9},{type:'crash',beat:2,vol:0.35},
  {type:'kick',beat:2.25,vol:0.6},{type:'tom',beat:2.5,vol:0.7,pitch:160},
  {type:'snare',beat:3,vol:0.7},{type:'kick',beat:3.25,vol:0.5},
  {type:'tom',beat:3.5,vol:0.5,pitch:140},{type:'hat',beat:3.75,vol:0.15},
];

// ═══ BASS ═══
var bassNotes = [
  // Title: long droney
  ...bass(S.title, 4, [{note:'C2',beat:0,dur:4,vol:0.4}]),
  // Tiers: bouncy
  ...bass(S.tiers, 6, [
    {note:'C2',beat:0,dur:0.5},{note:'C2',beat:1,dur:0.5},
    {note:'Eb2',beat:2,dur:0.5},{note:'G2',beat:3,dur:0.5}
  ]),
  // Fog: sparse, mysterious
  ...bass(S.fog, 6, [{note:'C2',beat:0,dur:2,vol:0.35},{note:'Bb1',beat:2,dur:2,vol:0.3}]),
  // Coast: triumphant, big
  ...bass(S.coast, 5, [{note:'C2',beat:0,dur:1.5,vol:0.8},{note:'G2',beat:2,dur:1.5,vol:0.7}]),
  // War: pounding low octave
  ...bass(S.war, 4, [
    {note:'C1',beat:0,dur:0.25,vol:0.9},{note:'C1',beat:0.5,dur:0.25,vol:0.7},
    {note:'Eb1',beat:1,dur:0.5,vol:0.8},{note:'C1',beat:2,dur:0.25,vol:0.9},
    {note:'Bb0',beat:2.5,dur:0.5,vol:0.8},{note:'C1',beat:3,dur:0.5,vol:0.7}
  ]),
  // Closer: fade
  ...bass(S.closer, 3, [{note:'C2',beat:0,dur:4,vol:0.3}]),
];

// ═══ ARPS ═══
var arpNotes = [
  // Tiers: fast sparkly
  ...arp(S.tiers, 6, 4, 4, [0,2,4,3,4,2,0,1], 0.25),
  // Fog: slow eerie
  ...arp(S.fog, 6, 5, 2, [0,4,2,3], 0.12),
  // Coast: triumphant fast
  ...arp(S.coast, 5, 4, 4, [0,4,2,3,4,0,2,4], 0.22),
  // War: low aggressive
  ...arp(S.war, 4, 3, 6, [0,0,2,0,3,0,4,0,2,0,0,3], 0.18),
];

// ═══ MELODY ═══
var melNotes = [
  // Title: slow reveal
  ...mel(S.title, [
    {note:'C5',dur:2,vol:0.2},{rest:1},{note:'Eb5',dur:1.5,vol:0.18},
    {rest:0.5},{note:'G4',dur:2,vol:0.15},{rest:1},
    {note:'C5',dur:1,vol:0.2},{note:'Bb4',dur:1,vol:0.18},{note:'G4',dur:2,vol:0.15},
  ]),
  // Tiers: catchy ascending — buildings going up!
  ...mel(S.tiers, [
    {note:'C5',dur:0.5,vol:0.35},{note:'Eb5',dur:0.5},{note:'F5',dur:0.5},{note:'G5',dur:1},
    {rest:0.25},{note:'G5',dur:0.25},{note:'Bb5',dur:0.5},{note:'C6',dur:1.5},
    {rest:0.5},
    {note:'Bb5',dur:0.5},{note:'G5',dur:0.5},{note:'F5',dur:0.5},{note:'Eb5',dur:1},{rest:0.5},
    // Repeat higher
    {note:'G5',dur:0.5,vol:0.4},{note:'Bb5',dur:0.5},{note:'C6',dur:0.5},{note:'Eb6',dur:1.5},
    {note:'C6',dur:0.5},{note:'Bb5',dur:0.5},{note:'G5',dur:1},{rest:0.5},
    {note:'F5',dur:0.5},{note:'G5',dur:0.5},{note:'Bb5',dur:1},{note:'C6',dur:2},{rest:1},
  ]),
  // Fog: mysterious, sparse
  ...mel(S.fog, [
    {note:'Eb5',dur:1.5,vol:0.22},{rest:1},{note:'G5',dur:1,vol:0.2},
    {rest:1.5},{note:'Bb4',dur:2,vol:0.18},{rest:1},
    {note:'C5',dur:1,vol:0.22},{note:'Eb5',dur:2,vol:0.2},{rest:1},
    {note:'F5',dur:1,vol:0.2},{note:'Eb5',dur:1},{note:'C5',dur:2,vol:0.18},{rest:2},
  ]),
  // Coast: triumphant! Big notes
  ...mel(S.coast, [
    {note:'C5',dur:1,vol:0.45},{note:'G5',dur:1},{note:'Bb5',dur:1},{note:'C6',dur:2},
    {rest:0.5},{note:'Eb6',dur:2,vol:0.5},
    {note:'C6',dur:0.5},{note:'Bb5',dur:0.5},{note:'G5',dur:1},{note:'C6',dur:2},{rest:0.5},
    {note:'G5',dur:0.5,vol:0.45},{note:'Bb5',dur:0.5},{note:'C6',dur:1},{note:'Eb6',dur:2.5},
  ]),
  // War: dark, low, staccato
  ...mel(S.war, [
    {note:'C4',dur:0.25,vol:0.5,duty:0.25},{note:'C4',dur:0.25},{note:'Eb4',dur:0.5},{note:'C4',dur:0.25},{rest:0.25},
    {note:'Bb3',dur:0.5,vol:0.45},{note:'C4',dur:0.25},{note:'Eb4',dur:0.25},{note:'F4',dur:0.5},
    {note:'Eb4',dur:0.25},{note:'C4',dur:0.25},{note:'Bb3',dur:0.5},{rest:0.5},
    {note:'G3',dur:0.5,vol:0.5},{note:'Bb3',dur:0.5},{note:'C4',dur:1.5},
    {rest:0.5},
    {note:'C4',dur:0.25,vol:0.55},{note:'Eb4',dur:0.25},{note:'F4',dur:0.25},{note:'G4',dur:0.25},
    {note:'Eb4',dur:0.5},{note:'C4',dur:1},{note:'Bb3',dur:2,vol:0.4},
  ]),
  // Closer
  ...mel(S.closer, [
    {note:'C5',dur:2,vol:0.25},{note:'G4',dur:2,vol:0.2},{note:'C4',dur:4,vol:0.15},
  ]),
];

// ═══ DRUMS ═══
var drumNotes = [
  ...drums(S.title, 4, titleBeat),
  ...drums(S.tiers, 6, tiersBeat),
  ...drums(S.fog, 6, fogBeat),
  ...drums(S.coast, 5, coastBeat),
  ...drums(S.war, 4, warBeat),
];

// ─── RENDER ───
console.log('Rendering tracks...');
var bassTrk = renderNotes(bassNotes, tri, 0.45);
var arpTrk = renderNotes(arpNotes, pulse, 0.3);
var melTrk = renderNotes(melNotes, sq, 0.35);
var kickTrk = renderNotes(drumNotes.filter(n=>n.note<500), sin_, 0.5);
var noiseTrk = renderNotes(drumNotes.filter(n=>n.note>=500), noise, 0.2);

// ─── MIX ───
console.log('Mixing...');
var mixL = new Float32Array(NUM_SAMPLES);
var mixR = new Float32Array(NUM_SAMPLES);
for (var i=0;i<NUM_SAMPLES;i++) {
  mixL[i] = bassTrk[i] + arpTrk[i]*0.6 + melTrk[i] + kickTrk[i] + noiseTrk[i]*0.8;
  mixR[i] = bassTrk[i] + arpTrk[i]*1.4 + melTrk[i] + kickTrk[i] + noiseTrk[i]*1.2;
}

// Stereo delay
var delayL = Math.floor(BEAT*0.375*SAMPLE_RATE);
var delayR = Math.floor(BEAT*0.25*SAMPLE_RATE);
for(var i=delayL;i<NUM_SAMPLES;i++) mixL[i]+=mixL[i-delayL]*0.22*0.4;
for(var i=delayR;i<NUM_SAMPLES;i++) mixR[i]+=mixR[i-delayR]*0.2*0.35;

// Fade in/out
var fadeIn=Math.floor(0.8*SAMPLE_RATE), fadeOut=Math.floor(3*SAMPLE_RATE);
for(var i=0;i<fadeIn&&i<NUM_SAMPLES;i++){var f=i/fadeIn;mixL[i]*=f;mixR[i]*=f;}
for(var i=0;i<fadeOut;i++){var idx=NUM_SAMPLES-1-i;if(idx<0)break;var f=i/fadeOut;mixL[idx]*=f;mixR[idx]*=f;}

// Normalize
var peak=0;
for(var i=0;i<NUM_SAMPLES;i++) peak=Math.max(peak,Math.abs(mixL[i]),Math.abs(mixR[i]));
var norm=peak>0?0.9/peak:1;

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

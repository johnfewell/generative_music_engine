// Tiny Planet duet — a fuller, game-shaped demo in the spirit of
// tiny-planet-r185-duet.html, with every musical decision made by the library:
// the metastable engine carries phrase/section/movement form, the conductor
// schedules with the look-ahead loop that was born in that prototype, the mood
// surface breathes with the day/night cycle and player motion, and a Tone.js
// rig (rig.ts) consumes the event stream — the "bring your own audio" path.
//
// Walk the planet, plant probability, catch stars. The left/right melody
// voices are two draws from the same walk: unison right after a planting,
// drifting apart as the chain mixes.

import * as Tone from "tone";
import { createMetastableEngine, mulberry32, tensionL1 } from "convergence/core";
import { pentatonicMinor } from "convergence/pitch";
import { Conductor } from "convergence/conductor";
import { MoodSurface } from "convergence/mood";
import { buildRig } from "./rig";
import type { TinyPlanetRig } from "./rig";

/* ---------- the music: engine + conductor + mood ---------- */
const CLUSTERS = 4;
const PER_CLUSTER = 4;
const N = CLUSTERS * PER_CLUSTER;

// A-minor pentatonic, A2 up — same ladder the prototype's duet walked. Each
// 4-node cluster lands in its own register band (the clPitch idea).
const PITCH = pentatonicMinor(45, N / 5);

const engine = createMetastableEngine({
  clusters: CLUSTERS,
  perCluster: PER_CLUSTER,
  superGroups: 2,
  alpha: 0.3,
  seed: 7,
});
const conductor = new Conductor(engine, {
  tempoStepsPerSec: 2.2,
  pitchMap: PITCH,
  clock: () => Tone.now(),
  rng: mulberry32(4242),
});
const mood = new MoodSurface(conductor);
mood.preset("explore");

/* ---------- DOM ---------- */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $("world") as HTMLCanvasElement;
const g = canvas.getContext("2d")!;
const scoreEl = $("score");
const phraseEl = $("phraseN");
const sectionEl = $("sectionN");
const movementEl = $("movementN");
const tensionBarEl = $("tensionBar");
const soundEl = $("sound");
const overlayEl = $("overlay");

function resize(): void {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
}
addEventListener("resize", resize);
resize();

/* ---------- world state ---------- */
const TAU = Math.PI * 2;
const CYCLE = 80; // seconds per planet day
const CLUSTER_HUES = ["#8ee6b0", "#ffd88a", "#c9b3ff", "#ff9db0"];

const player = { theta: -Math.PI / 2, dir: 1, walking: false, h: 0, vh: 0 };
const keys = new Set<string>();
let score = 0;
let stars: { node: number; born: number }[] = [];
let nextStarAt = 5;
let rings: { t0: number }[] = []; // movement pulses
let nightF = 0;
let isNightPreset = false;
let urgencyApplied = -1;

let rig: TinyPlanetRig | null = null;
let audioPending = false;
let muted = false;

// fixed starfield, seeded so the sky is the same planet every visit
const skyRng = mulberry32(11);
const skyStars = Array.from({ length: 90 }, () => ({
  x: skyRng(),
  y: skyRng() * 0.55,
  r: 0.5 + skyRng() * 1.1,
  tw: skyRng() * TAU,
}));

const nodeAngle = (i: number) => (i / N) * TAU - Math.PI / 2;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const nearestNode = (theta: number) => {
  const raw = Math.round(((theta + Math.PI / 2) / TAU) * N);
  return ((raw % N) + N) % N;
};

/* ---------- popups (floating text, prototype's .popup) ---------- */
function popup(text: string, x: number, y: number): void {
  const el = document.createElement("div");
  el.className = "popup";
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

/* ---------- audio boot: keep retrying on every gesture (prototype 1663) ---------- */
function ensureAudio(): void {
  if (rig || audioPending) return;
  audioPending = true;
  Tone.start()
    .then(() => {
      rig = buildRig(conductor);
      rig.setBrightness(mood.currentHint().brightness ?? 0.6);
      conductor.start();
      overlayEl.classList.add("hidden");
      soundEl.textContent = "🔊";
    })
    .catch((err) => {
      audioPending = false; // failed — the next gesture tries again
      console.warn("Tone.js could not start (will retry on next input):", err);
    });
}

function toggleMute(): void {
  if (!rig) return;
  muted = !muted;
  Tone.getDestination().mute = muted;
  soundEl.textContent = muted ? "🔇" : "🔊";
}

/* ---------- planting + stars ---------- */
function worldPoint(theta: number, lift: number): { x: number; y: number } {
  const { cx, cy, R } = view();
  return { x: cx + Math.cos(theta) * (R + lift), y: cy + Math.sin(theta) * (R + lift) };
}

function plantAt(node: number): void {
  conductor.inject(node);
  rig?.plant(PITCH.freq(node));
  const p = worldPoint(nodeAngle(node), 40);
  popup("♪", p.x, p.y);
}

function spawnStar(now: number): void {
  if (stars.length >= 3) return;
  const node = Math.floor(skyRng() * N);
  if (stars.some((s) => s.node === node)) return;
  stars.push({ node, born: now });
}

function collectStars(now: number): void {
  const caught = stars.filter((s) => Math.abs(wrap(player.theta - nodeAngle(s.node))) < 0.14);
  if (!caught.length) return;
  stars = stars.filter((s) => !caught.includes(s));
  for (const s of caught) {
    score++;
    scoreEl.textContent = String(score);
    rig?.pickup();
    conductor.inject(s.node); // catching a star IS a stinger
    const p = worldPoint(nodeAngle(s.node), 46);
    popup("+⭐", p.x, p.y);
  }
  void now;
}

/* ---------- input ---------- */
addEventListener("keydown", (e) => {
  ensureAudio();
  if (e.code === "KeyM") toggleMute();
  if (e.code === "Space" && player.h === 0) {
    player.vh = 240;
    e.preventDefault();
  }
  if (e.code === "KeyE") plantAt(nearestNode(player.theta));
  keys.add(e.code);
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("pointerdown", (e) => {
  ensureAudio();
  if (!rig) return;
  const { cx, cy, R } = view();
  const dx = e.clientX - cx;
  const dy = e.clientY - cy;
  if (Math.hypot(dx, dy) < R * 1.6) plantAt(nearestNode(Math.atan2(dy, dx)));
});

/* ---------- form counters ---------- */
let movements = 0;
conductor.on("form", (e) => {
  if (e.kind === "phraseResolved") phraseEl.textContent = String(e.count);
  else if (e.kind === "sectionResolved") sectionEl.textContent = String(e.count);
  else {
    movements = e.count;
    movementEl.textContent = String(movements);
    rings.push({ t0: performance.now() / 1000 });
    const { cx, cy, R } = view();
    popup("◌ movement", cx, cy - R - 60);
  }
});

/* ---------- day/night -> mood ---------- */
function updateMood(now: number): void {
  const phase = ((now / CYCLE) % 1) * TAU + 0.6; // start mid-morning
  const sun = Math.sin(phase);
  const s = clamp01((0.12 - sun) / 0.24);
  nightF = s * s * (3 - 2 * s); // smooth twilight band
  rig?.setNight(nightF);

  const nowNight = nightF > 0.5;
  if (nowNight !== isNightPreset) {
    isNightPreset = nowNight;
    mood.preset(nowNight ? "night" : "explore"); // wander change -> rebuild + crossfade
    rig?.setBrightness(mood.currentHint().brightness ?? 0.6);
    urgencyApplied = -1; // re-apply the motion nudge on the new base
  }

  const base = isNightPreset ? 0.2 : 0.35;
  const target = player.walking ? base + 0.25 : base;
  if (target !== urgencyApplied) {
    urgencyApplied = target;
    mood.set({ urgency: target });
  }
}

/* ---------- rendering ---------- */
function view() {
  const w = canvas.width;
  const h = canvas.height;
  return { w, h, cx: w / 2, cy: h * 0.6, R: Math.min(w, h) * 0.27 };
}

const lerpHex = (a: string, b: string, t: number) => {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => {
    const va = (pa >> sh) & 255;
    const vb = (pb >> sh) & 255;
    return Math.round(va + (vb - va) * t);
  };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
};

function drawSky(now: number): void {
  const { w, h, cx, cy, R } = view();
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, lerpHex("#7ec9ff", "#070b26", nightF));
  grad.addColorStop(1, lerpHex("#dff2ff", "#23305c", nightF));
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  // starfield fades in with night
  if (nightF > 0.02) {
    for (const st of skyStars) {
      const a = nightF * (0.5 + 0.5 * Math.sin(now * 1.7 + st.tw));
      g.fillStyle = `rgba(255,255,255,${(0.75 * a).toFixed(3)})`;
      g.beginPath();
      g.arc(st.x * w, st.y * h, st.r, 0, TAU);
      g.fill();
    }
  }

  // sun and moon orbit the planet
  const phase = ((now / CYCLE) % 1) * TAU + 0.6;
  const orbit = R * 1.85;
  const sx = cx + Math.cos(-phase) * orbit;
  const sy = cy + Math.sin(-phase) * orbit;
  const sunGlow = g.createRadialGradient(sx, sy, 4, sx, sy, 60);
  sunGlow.addColorStop(0, "rgba(255,236,170,0.95)");
  sunGlow.addColorStop(1, "rgba(255,236,170,0)");
  g.fillStyle = sunGlow;
  g.beginPath();
  g.arc(sx, sy, 60, 0, TAU);
  g.fill();
  g.fillStyle = "#fff2c0";
  g.beginPath();
  g.arc(sx, sy, 16, 0, TAU);
  g.fill();
  const mx = cx - Math.cos(-phase) * orbit;
  const my = cy - Math.sin(-phase) * orbit;
  g.fillStyle = "#dfe8ff";
  g.beginPath();
  g.arc(mx, my, 11, 0, TAU);
  g.fill();
  g.fillStyle = lerpHex("#7ec9ff", "#070b26", nightF);
  g.beginPath();
  g.arc(mx - 4, my - 3, 9, 0, TAU);
  g.fill();
}

function drawPlanet(now: number): void {
  const { cx, cy, R } = view();
  const x = engine.x;
  const grouping = engine.grouping;

  // movement pulses: slow rings breathing out from the planet
  rings = rings.filter((r) => now - r.t0 < 2.4);
  for (const r of rings) {
    const t = (now - r.t0) / 2.4;
    g.strokeStyle = `rgba(255,226,122,${(0.5 * (1 - t)).toFixed(3)})`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, R + 24 + t * 130, 0, TAU);
    g.stroke();
  }

  // body
  const body = g.createRadialGradient(cx - R * 0.3, cy - R * 0.4, R * 0.2, cx, cy, R);
  body.addColorStop(0, lerpHex("#9fd98a", "#3c5a52", nightF * 0.8));
  body.addColorStop(1, lerpHex("#5faa6e", "#233c3e", nightF * 0.8));
  g.fillStyle = body;
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.fill();

  // probability terrain: a glowing mound per node, coloured by its cluster
  for (let i = 0; i < N; i++) {
    const a = nodeAngle(i);
    const hgt = Math.sqrt(Math.max(0, x[i])) * R * 0.6;
    const base = worldPoint(a, 0);
    const tip = worldPoint(a, hgt);
    const hue = CLUSTER_HUES[grouping.clusterOf(i) % CLUSTER_HUES.length];
    const glow = g.createLinearGradient(base.x, base.y, tip.x, tip.y);
    glow.addColorStop(0, hue + "cc");
    glow.addColorStop(1, hue + "00");
    g.strokeStyle = glow;
    g.lineWidth = 9;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(base.x, base.y);
    g.lineTo(tip.x, tip.y);
    g.stroke();
    // the node itself: a small pebble on the rim
    g.fillStyle = hue;
    g.beginPath();
    g.arc(base.x, base.y, 3.5, 0, TAU);
    g.fill();
  }

  // collectible stars hover over their node
  for (const s of stars) {
    const bob = Math.sin(now * 2.2 + s.node) * 4;
    const p = worldPoint(nodeAngle(s.node), 26 + bob);
    drawStar(p.x, p.y, 8, now * 0.8);
  }
}

function drawStar(x: number, y: number, r: number, rot: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot % TAU);
  g.fillStyle = "#ffe27a";
  g.strokeStyle = "rgba(255,226,122,0.45)";
  g.lineWidth = 6;
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const rr = k % 2 === 0 ? r : r * 0.45;
    const a = (k / 10) * TAU - Math.PI / 2;
    g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
  g.stroke();
  g.fill();
  g.restore();
}

function drawPlayer(now: number): void {
  const p = worldPoint(player.theta, 10 + player.h);
  const bob = player.walking && player.h === 0 ? Math.abs(Math.sin(now * 9)) * 2.5 : 0;
  const up = player.theta; // radially outward
  g.save();
  g.translate(p.x, p.y);
  g.rotate(up + Math.PI / 2);
  // body
  g.fillStyle = "#fff7ea";
  g.beginPath();
  g.ellipse(0, -bob, 9, 10 + bob * 0.4, 0, 0, TAU);
  g.fill();
  // eye, looking the way we walk
  g.fillStyle = "#22303a";
  g.beginPath();
  g.arc(4 * player.dir, -3 - bob, 1.8, 0, TAU);
  g.fill();
  // feet
  g.fillStyle = "#e8d8bd";
  const step = player.walking ? Math.sin(now * 9) * 3 : 0;
  g.beginPath();
  g.ellipse(-3.5 + step, 8, 3, 2, 0, 0, TAU);
  g.ellipse(3.5 - step, 8, 3, 2, 0, 0, TAU);
  g.fill();
  g.restore();
}

/* ---------- main loop ---------- */
let lastT = performance.now() / 1000;
function frame(): void {
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - lastT);
  lastT = now;

  // movement
  const left = keys.has("ArrowLeft") || keys.has("KeyA");
  const right = keys.has("ArrowRight") || keys.has("KeyD");
  player.walking = left !== right;
  if (player.walking) {
    player.dir = right ? 1 : -1;
    player.theta += player.dir * 1.05 * dt;
  }
  if (player.h > 0 || player.vh > 0) {
    player.h += player.vh * dt * 0.35;
    player.vh -= 560 * dt;
    if (player.h <= 0) {
      player.h = 0;
      player.vh = 0;
    }
  }

  // stars
  if (now > nextStarAt) {
    spawnStar(now);
    nextStarAt = now + 8 + skyRng() * 6;
  }
  collectStars(now);

  updateMood(now);

  // draw
  drawSky(now);
  drawPlanet(now);
  drawPlayer(now);

  // tension HUD (presentation only; the conductor does its own thresholding)
  const T = tensionL1(engine.x, engine.graph.pi);
  tensionBarEl.style.width = `${Math.min(100, T * 55)}%`;

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

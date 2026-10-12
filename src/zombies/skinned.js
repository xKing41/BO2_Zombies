// ─────────────────────────────────────────────────────────────
//  Zombies mit echten Körpern (MakeHuman/MPFB, CC0 – siehe public/chars/
//  QUELLEN.md). Jeder Körpertyp ist EIN Mesh mit Skelett und Textur-Atlas;
//  alle Zombies desselben Typs werden mit einem einzigen Draw-Call
//  gezeichnet („instanziertes Skinning“): Die Knochen aller Exemplare
//  liegen zeilenweise in einer Float-Textur, der Shader liest die Zeile
//  über gl_InstanceID.
//
//  Animiert wird weiter das bewährte prozedurale Zombie-Skelett
//  (zombie.js); seine Drehungen werden je Bild auf das menschliche Skelett
//  übertragen (Ruhelagen angeglichen: A-Pose → hängende Arme).
//  Zerstückelung: Der abgetrennte Teilbaum schrumpft auf sein Gelenk
//  (Stumpf), und das abgetrennte Stück fliegt als eigenes Exemplar
//  desselben Körpers davon – mit Ärmel, Hand, Hosenbein und Schuh.
//  Haut und Kleidung „verwesen“ im Shader (Farbe, Flecken, Blut, Schmutz),
//  je Exemplar anders.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ── Shader: Knochen je Exemplar aus einer eigenen Texturzeile ─
let PATCHED = false;
export function patchInstancedSkinning() {
  if (PATCHED) return;
  PATCHED = true;
  const src = THREE.ShaderChunk.skinning_pars_vertex;
  const re = /int size = textureSize\( boneTexture, 0 \)\.x;\s*int j = int\( i \) \* 4;\s*int x = j % size;\s*int y = j \/ size;/;
  if (!re.test(src)) { console.warn('Skinning-Shader unbekannt – instanziertes Skinning aus'); PATCHED = 'failed'; return; }
  THREE.ShaderChunk.skinning_pars_vertex = src.replace(re, `
		#ifdef USE_INSTANCING
			int x = int( i ) * 4;
			int y = gl_InstanceID;
		#else
			int size = textureSize( boneTexture, 0 ).x;
			int j = int( i ) * 4;
			int x = j % size;
			int y = j / size;
		#endif`);
}

// ── Laden ─────────────────────────────────────────────────────
let INDEX = null, indexPromise = null, LO = false;
const lib = new Map(); // Name → { promise, data }
export function configureChars({ lo = false } = {}) { LO = lo; }

export function loadCharIndex() {
  if (!indexPromise) {
    indexPromise = (async () => {
      try {
        if (typeof fetch !== 'function' || location.protocol === 'file:') return null;
        const r = await fetch('chars/index.json', { cache: 'no-cache' });
        INDEX = r.ok ? await r.json() : null;
      } catch { INDEX = null; }
      return INDEX;
    })();
  }
  return indexPromise;
}

export const charNames = (prefix = '') => Object.keys(INDEX || {}).filter((n) => n.startsWith(prefix)).sort();
// Nur die tatsächlich geladenen (für den Renderer)
export const loadedChars = (prefix = '') => charNames(prefix).filter((n) => lib.get(n)?.data);

let loader = null;
function loadOne(name) {
  const e = INDEX?.[name];
  if (!e) return Promise.resolve(null);
  if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); }
  return loader.loadAsync(`chars/${name}${LO ? '_lo' : ''}.glb${e.v ? `?v=${e.v}` : ''}`)
    .then((g) => prepareChar(name, g.scene, e))
    .catch((err) => { console.warn('Figur nicht geladen:', name, err?.message || err); return null; });
}

export async function preloadChars(names, onEach = () => {}) {
  await loadCharIndex();
  if (!INDEX) return 0;
  let n = 0;
  await Promise.all(names.map(async (name) => {
    let s = lib.get(name);
    if (!s) { s = { promise: loadOne(name), data: null }; lib.set(name, s); }
    s.data = await s.promise;
    if (s.data) n++;
    onEach(name);
  }));
  return n;
}

export const charData = (name) => lib.get(name)?.data || null;

// ── Ruhelage und Übertragungs-Tabelle ─────────────────────────
// Menschlicher Knochen → Gelenk-Drehung D[j] des Antriebs-Skeletts (Zombie: zombie.js,
// Überlebende: avatar.js; jeweils relativ zur Figur-Wurzel) und dessen Ruherichtung
const UP = [0, 1, 0], DN = [0, -1, 0];
const MAP = {
  pelvis: { j: 'pelvis', dir: UP, next: 'spine_01' },
  spine_01: { j: 'spine1', dir: UP, next: 'spine_02' }, spine_02: { j: 'spine2', dir: UP, next: 'spine_03' }, spine_03: { j: 'spine3', dir: UP, next: 'neck_01' },
  neck_01: { j: 'neck1', dir: UP, next: 'head' }, head: { j: 'head' },
  upperarm_l: { j: 'shL', dir: DN, next: 'lowerarm_l' }, lowerarm_l: { j: 'elL', dir: DN, next: 'hand_l' },
  upperarm_r: { j: 'shR', dir: DN, next: 'lowerarm_r' }, lowerarm_r: { j: 'elR', dir: DN, next: 'hand_r' },
  thigh_l: { j: 'hpL', dir: DN, next: 'calf_l' }, calf_l: { j: 'knL', dir: DN, next: 'foot_l' }, foot_l: { j: 'ftL' },
  thigh_r: { j: 'hpR', dir: DN, next: 'calf_r' }, calf_r: { j: 'knR', dir: DN, next: 'foot_r' }, foot_r: { j: 'ftR' },
};
export const D_KEYS = ['pelvis', 'spine1', 'spine2', 'spine3', 'neck1', 'head', 'shL', 'elL', 'shR', 'elR', 'hpL', 'knL', 'ftL', 'hpR', 'knR', 'ftR'];
export const newD = () => Object.fromEntries(D_KEYS.map((k) => [k, new THREE.Quaternion()]));
// Abtrennbare Teile: Stücke 0–3 von zombie.js (rechter/linker Unterarm, rechter/linker Unterschenkel) und Kopf
const PIECE_BONES = ['lowerarm_r', 'lowerarm_l', 'calf_r', 'calf_l'];
// Größe der Wundkappe je Stelle (Grundform: Stumpf mit 4,2 cm Radius)
const CAP_SCALE = { lowerarm_r: 0.95, lowerarm_l: 0.95, calf_r: 1.3, calf_l: 1.3, head: 1.35 };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1), TINY = new THREE.Vector3(1e-4, 1e-4, 1e-4), _W = new THREE.Matrix4(), _F = new THREE.Matrix4();
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI), IDENT = new THREE.Matrix4();

function prepareChar(name, scene, entry) {
  let sm = null;
  scene.traverse((o) => { if (o.isSkinnedMesh && !sm) sm = o; });
  if (!sm) return null;
  scene.updateMatrixWorld(true);
  const bones = sm.skeleton.bones, nb = bones.length;
  const idx = new Map(bones.map((b, i) => [b.name, i]));
  const parent = new Int16Array(nb), P0 = [], Q0 = [], LP = [], LQ = [], pre = [];
  for (let i = 0; i < nb; i++) {
    const b = bones[i];
    const pi = b.parent ? bones.indexOf(b.parent) : -1;
    parent[i] = pi;
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    b.matrixWorld.decompose(p, q, s);
    P0.push(p); Q0.push(q);
    LP.push(b.position.clone()); LQ.push(b.quaternion.clone());
    // K = B · boneInverse · bindMatrix (Netz bleibt im Ursprung, Bindung = Einheitsmatrix)
    pre.push(new THREE.Matrix4().multiplyMatrices(sm.skeleton.boneInverses[i], sm.bindMatrix));
  }
  // Reihenfolge: Eltern vor Kindern
  const order = [], seen = new Uint8Array(nb);
  const visit = (i) => { if (seen[i]) return; if (parent[i] >= 0) visit(parent[i]); seen[i] = 1; order.push(i); };
  for (let i = 0; i < nb; i++) visit(i);
  // Ausrichtung je übertragenem Knochen: menschliche Ruherichtung → die des Antriebs-Skeletts
  const map = new Array(nb).fill(null);
  for (const [bn, m] of Object.entries(MAP)) {
    const i = idx.get(bn);
    if (i === undefined) continue;
    const A = new THREE.Quaternion();
    const nx = m.next ? idx.get(m.next) : undefined;
    if (m.dir && nx !== undefined) A.setFromUnitVectors(_v.copy(P0[nx]).sub(P0[i]).normalize(), _v2.fromArray(m.dir));
    map[i] = { j: m.j, AQ0: A.multiply(Q0[i]) };
  }
  // Teilbäume der abtrennbaren Teile
  const subtree = (r) => { const out = []; for (const i of order) { let k = i; while (k >= 0 && k !== r) k = parent[k]; if (k === r) out.push(i); } return out; };
  const pieces = PIECE_BONES.map((bn) => (idx.has(bn) ? idx.get(bn) : -1));
  const sub = {};
  for (const r of [...pieces, idx.get('head')]) if (r >= 0 && r !== undefined) sub[r] = subtree(r);
  // Positionen im Shader entquantisieren (KHR_mesh_quantization steckt in den inversen Bindematrizen)
  const dequant = new THREE.Matrix4().multiplyMatrices(bones[0].matrixWorld, pre[0]);
  const head = idx.get('head');
  const eyes = entry.eyes ? entry.eyes.map((e) => new THREE.Vector3().fromArray(e)) : null;
  // Kopfmitte (Kopf-Raum) aus der Augenlage: etwas höher und weiter hinten
  const headCenter = eyes ? new THREE.Vector3(0, (eyes[0].y + eyes[1].y) / 2 + 0.025, (eyes[0].z + eyes[1].z) / 2 - 0.07) : new THREE.Vector3(0, 0.07, 0.02);
  const eyeRest = eyes && head !== undefined ? eyes[0].clone().add(eyes[1]).multiplyScalar(0.5).applyMatrix4(bones[head].matrixWorld) : new THREE.Vector3(0, 1.62, 0.09);
  // Größe angleichen: sehr große/kleine Körper Richtung 1,75 m ziehen (Vielfalt bleibt)
  const height = entry.height || 1.75;
  const fit = (1.7 + (height - 1.75) * 0.4) / height;
  const geo = sm.geometry, mat = sm.material;
  geo.userData.shared = true;
  for (const t of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (mat[t]) mat[t].userData.shared = true;
  const ix = (n) => (idx.has(n) ? idx.get(n) : -1);
  // Finger krümmen (Drehung um die eigene x-Achse beugt zur Handfläche): Anteil je Knochen
  const fingers = [];
  for (let i = 0; i < nb; i++) {
    const n = bones[i].name;
    if (/^(index|middle|ring|pinky)_0[123]_[lr]$/.test(n)) fingers.push([i, /_01_/.test(n) ? 0.8 : 1]);
    else if (/^thumb_0[23]_[lr]$/.test(n)) fingers.push([i, 0.45]);
  }
  const curls = new Map();
  const curl = (theta) => {
    let m = curls.get(theta);
    if (!m) {
      m = new Array(nb).fill(null);
      for (const [i, k] of fingers) m[i] = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), theta * k);
      curls.set(theta, m);
    }
    return m;
  };
  const arm = (s) => {
    const up = ix('upperarm_' + s), lo = ix('lowerarm_' + s), hand = ix('hand_' + s);
    if (up < 0 || lo < 0 || hand < 0) return null;
    const du = P0[lo].clone().sub(P0[up]), df = P0[hand].clone().sub(P0[lo]);
    // Beugeachse des Ellbogens in Ruhe: Unterarm klappt nach vorn (+z)
    const h0 = du.clone().normalize().cross(new THREE.Vector3(0, 0, 1)).normalize();
    return { up, lo, hand, L1: du.length(), L2: df.length(), du: du.normalize(), df: df.normalize(), h0 };
  };
  return {
    arms: { r: arm('r'), l: arm('l') }, curl,
    name, geo, mat, nb, parent, order, P0, Q0, LP, LQ, pre, map, idx, sub, pieces, dequant, eyes, headCenter, eyeRest, fit, height,
    pelvis: ix('pelvis'), head: head ?? -1,
    hit: { spine: ix('spine_03'), neck: ix('neck_01'), calfR: ix('calf_r'), calfL: ix('calf_l'), armR: ix('lowerarm_r'), handR: ix('hand_r'), armL: ix('lowerarm_l'), handL: ix('hand_l') },
  };
}

// ── Instanziertes Skinned Mesh ────────────────────────────────
export class InstancedSkinnedMesh extends THREE.SkinnedMesh {
  constructor(geo, material, nb, max) {
    super(geo, material);
    this.isInstancedMesh = true;
    this.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(max * 16), 16);
    this.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instanceColor = null;
    this.morphTexture = null;
    this.count = 0;
    this.max = max;
    this.frustumCulled = false;
    this.bindMode = THREE.DetachedBindMode;
    this.rowFloats = nb * 16;
    const data = new Float32Array(this.rowFloats * max);
    const tex = new THREE.DataTexture(data, nb * 4, max, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    const sk = new THREE.Skeleton([], []);
    sk.bones = new Array(nb).fill(null);
    sk.boneMatrices = data;
    sk.boneTexture = tex;
    sk.update = () => {};
    sk.computeBoneTexture = () => sk;
    this.skeleton = sk;
    this.boneData = data;
    this.bindMatrix.identity();
    this.bindMatrixInverse.identity();
  }
  updateMatrixWorld(force) { THREE.Object3D.prototype.updateMatrixWorld.call(this, force); }
  computeBoundingSphere() { if (!this.boundingSphere) this.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5); }
  computeBoundingBox() { if (!this.boundingBox) this.boundingBox = new THREE.Box3(new THREE.Vector3(-1e5, -1e5, -1e5), new THREE.Vector3(1e5, 1e5, 1e5)); }
  raycast() { /* Treffer laufen über die Trefferkugeln der Zombies */ }
  dispose() { this.skeleton.boneTexture.dispose(); this.dispatchEvent({ type: 'dispose' }); }
}

// ── Verwesungs-Shader (Haut fahl, Flecken, Blut, Schmutz) ─────
const NOISE = /* glsl */`
	float zHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
	float zNoise( vec3 x ) {
		vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
		return mix( mix( mix( zHash( i ), zHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( zHash( i + vec3( 0, 1, 0 ) ), zHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
			mix( mix( zHash( i + vec3( 0, 0, 1 ) ), zHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( zHash( i + vec3( 0, 1, 1 ) ), zHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
	}`;
export function zombifyMaterial(src, c) {
  const m = src.clone();
  m.side = THREE.DoubleSide;
  m.alphaTest = 0.5;
  m.transparent = false;
  m.envMapIntensity = 0.55;
  m.userData.shared = true; // Texturen gehören der Figuren-Bibliothek
  const dq = c.dequant.clone(), eye = c.eyeRest.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDequant = { value: dq };
    sh.uniforms.uEye = { value: eye };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
	attribute float _skin;
	attribute vec4 aZom;
	uniform mat4 uDequant;
	varying float vSkinM;
	varying vec3 vBind;
	varying vec4 vZom;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
	vSkinM = _skin; vBind = ( uDequant * vec4( position, 1.0 ) ).xyz; vZom = aZom;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
	uniform vec3 uEye;
	varying float vSkinM;
	varying vec3 vBind;
	varying vec4 vZom;
	float zBlood = 0.0;
	${NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
	{
		float seed = vZom.x * 37.0;
		float decay = vZom.y, bloodAmt = vZom.z;
		vec3 c = diffuseColor.rgb;
		vec3 p = vBind;
		float n1 = zNoise( p * 9.0 + seed );
		float n2 = zNoise( p * 3.1 + seed * 1.7 );
		float n3 = zNoise( p * 31.0 + seed * 0.7 );
		float skin = smoothstep( 0.75, 0.95, vSkinM );
		float eyeM = 1.0 - smoothstep( 0.08, 0.3, abs( vSkinM - 0.5 ) );
		float cloth = ( 1.0 - skin ) * ( 1.0 - eyeM );
		// Haut: fahl, grau-grünlich, dunkle Flecken, Blutergüsse, Adern, Poren
		float l = dot( c, vec3( 0.3, 0.59, 0.11 ) );
		vec3 dead = mix( vec3( l ) * vec3( 0.8, 0.9, 0.7 ), c * vec3( 0.7, 0.78, 0.6 ), 0.3 ) * 0.86;
		dead *= 1.0 - smoothstep( 0.5, 0.8, n2 ) * 0.4;
		dead = mix( dead, dead * vec3( 0.55, 0.38, 0.5 ), smoothstep( 0.6, 0.8, n1 ) * 0.6 );
		float vein = 1.0 - smoothstep( 0.0, 0.045, abs( zNoise( p * 15.0 + seed ) - 0.5 ) );
		dead = mix( dead, dead * vec3( 0.48, 0.44, 0.62 ), vein * 0.4 );
		dead *= 0.9 + n3 * 0.16;
		c = mix( c, dead, skin * decay );
		// eingefallene, dunkle Augenhöhlen und blutleere Lippen
		vec2 eo = vec2( abs( p.x - uEye.x ) - 0.031, ( p.y - uEye.y + 0.004 ) * 1.25 );
		float ring = skin * smoothstep( 0.042, 0.012, length( eo ) ) * step( uEye.z - 0.06, p.z );
		c *= 1.0 - ring * 0.55 * decay;
		float lips = skin * smoothstep( 0.028, 0.008, length( ( p - vec3( uEye.x, uEye.y - 0.078, uEye.z + 0.004 ) ) * vec3( 0.65, 1.7, 1.0 ) ) );
		c = mix( c, vec3( 0.13, 0.07, 0.07 ), lips * 0.65 * decay );
		// Augen: milchig-gelb
		c = mix( c, vec3( 0.6, 0.55, 0.36 ) * ( 0.55 + 0.45 * l ), eyeM * 0.75 );
		// Kleidung: je Zombie etwas andere Farbe, ausgeblichen, Schmutz nach unten, Flecken
		vec3 hue = 1.0 + 0.08 * ( vec3( fract( seed * 0.731 ), fract( seed * 1.379 + 0.3 ), fract( seed * 2.113 + 0.6 ) ) - 0.5 );
		c = mix( c, c * hue * ( 0.74 + 0.3 * fract( seed * 3.17 ) ), cloth );
		float lc = dot( c, vec3( 0.3, 0.59, 0.11 ) );
		c = mix( c, vec3( lc ) * vec3( 1.0, 0.95, 0.86 ), cloth * 0.3 * decay );
		c *= mix( vec3( 1.0 ), vec3( 0.9, 0.85, 0.76 ), cloth * decay ); // vergilbt, speckig
		c *= 1.0 - cloth * ( 0.1 + smoothstep( 0.9, 0.05, p.y ) * 0.34 + smoothstep( 0.58, 0.85, n2 ) * 0.3 + n3 * 0.1 );
		// Blut: vom Mund übers Kinn, Brust, Hände, Laufspuren, Spritzer – scharf begrenzt
		// verwirbeltes Rauschen für ausgefranste Ränder (Stoff saugt Blut ungleichmäßig auf)
		float nw = zNoise( p * 7.0 + vec3( n3, n2, n3 ) * 1.6 + seed * 1.3 );
		float mouth = smoothstep( 0.1, 0.0, length( ( p - vec3( uEye.x, uEye.y - 0.1, uEye.z - 0.006 ) ) * vec3( 1.4, 0.6, 1.0 ) ) );
		mouth *= smoothstep( 0.2, 0.45, zNoise( p * 18.0 + seed ) );
		float chest = smoothstep( 0.24, 0.0, length( ( p - vec3( uEye.x + ( fract( seed ) - 0.5 ) * 0.16, uEye.y - 0.36, uEye.z + 0.02 ) ) * vec3( 1.3, 0.45, 2.0 ) ) ) * smoothstep( 0.38, 0.66, nw );
		float hands = smoothstep( 0.6, 0.74, abs( p.x ) ) * smoothstep( 0.3, 0.55, n1 );
		float drip = smoothstep( 0.63, 0.7, zNoise( p * vec3( 9.0, 2.2, 9.0 ) + seed * 2.3 ) );
		float spl = smoothstep( 0.71, 0.76, zNoise( p * 11.0 + seed * 3.1 ) );
		float blood = clamp( ( mouth * 1.35 + chest + hands * 0.9 + drip * 0.6 + spl * 0.55 ) * bloodAmt, 0.0, 1.0 );
		blood = smoothstep( 0.3, 0.46, blood );
		vec3 bc = mix( vec3( 0.21, 0.014, 0.011 ), vec3( 0.07, 0.012, 0.009 ), n3 );
		c = mix( c, bc, blood * 0.95 );
		diffuseColor.rgb = c;
		zBlood = blood;
	}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
	roughnessFactor = mix( roughnessFactor, 0.22, zBlood );`);
  };
  m.customProgramCacheKey = () => 'zombify6';
  return m;
}

// ── Pose aus Gelenk-Drehungen ─────────────────────────────────
// D: Drehungen relativ zur Figur-Wurzel (Schlüssel D_KEYS), hip: Beckenversatz im Raum der
// Figur, ik: optional { r/l: { T, pole } } – Hand genau auf Ziel T (Ellbogen Richtung pole)
const _f = new THREE.Vector3(), _n = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3(), _b = new THREE.Vector3(), _M0 = new THREE.Matrix4(), _M1 = new THREE.Matrix4();
function frameQuat(d0, h0, d1, h1, out) {
  // Drehung, die das Paar (d0, h0) auf (d1, h1) abbildet (h jeweils senkrecht zu d)
  _b.crossVectors(d0, h0); _M0.makeBasis(d0, h0, _b);
  _b.crossVectors(d1, h1); _M1.makeBasis(d1, h1, _b);
  return out.setFromRotationMatrix(_M1.multiply(_M0.transpose()));
}
const _arm = { f: new THREE.Vector3(), n: new THREE.Vector3() };
function armIK(c, A, Q, P, goal) {
  const S = P[A.up], T = goal.T;
  _w.subVectors(T, S);
  const dist = Math.min(Math.max(_w.length(), Math.abs(A.L1 - A.L2) + 0.01), A.L1 + A.L2 - 0.003);
  _w.normalize();
  _n.copy(goal.pole).addScaledVector(_w, -goal.pole.dot(_w));
  if (_n.lengthSq() < 1e-8) _n.set(0, -1, 0);
  _n.normalize();
  const cosA = Math.min(1, Math.max(-1, (A.L1 * A.L1 + dist * dist - A.L2 * A.L2) / (2 * A.L1 * dist)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  _u.copy(_w).multiplyScalar(cosA).addScaledVector(_n, sinA); // Oberarm
  _f.copy(S).addScaledVector(_w, dist).sub(_v.copy(S).addScaledVector(_u, A.L1)).normalize(); // Unterarm
  _arm.n.crossVectors(_u, _f);
  if (_arm.n.lengthSq() < 1e-8) _arm.n.crossVectors(_w, _n);
  _arm.n.normalize();
  _arm.f.copy(_f);
  frameQuat(A.du, _v2.copy(A.h0).addScaledVector(A.du, -A.h0.dot(A.du)).normalize(), _u, _arm.n, _q);
  Q[A.up].copy(_q).multiply(c.Q0[A.up]);
}
export function solvePose(c, D, st, hip, ik = null, curl = null) {
  const Q = st.Q, P = st.P;
  for (const i of c.order) {
    const p = c.parent[i], mp = c.map[i];
    if (mp) Q[i].copy(D[mp.j]).multiply(mp.AQ0);
    else if (p >= 0) { Q[i].copy(Q[p]).multiply(c.LQ[i]); if (curl && curl[i]) Q[i].multiply(curl[i]); }
    else Q[i].copy(c.Q0[i]);
    // Lage: Eltern-Gelenk + gedrehter Ruhe-Versatz (menschliche Proportionen bleiben)
    if (i === c.pelvis) P[i].copy(c.P0[i]).add(hip);
    else if (p >= 0) P[i].copy(c.LP[i]).applyQuaternion(Q[p]).add(P[p]);
    else P[i].copy(c.P0[i]);
    if (ik) {
      for (const s of ['r', 'l']) {
        const A = c.arms[s], goal = ik[s];
        if (!A || !goal) continue;
        if (i === A.up) armIK(c, A, Q, P, goal);
        else if (i === A.lo) {
          // Unterarm in derselben Beugeebene
          const n = _arm.n;
          frameQuat(A.df, _v2.copy(A.h0).addScaledVector(A.df, -A.h0.dot(A.df)).normalize(), _arm.f, n, _q);
          Q[i].copy(_q).multiply(c.Q0[i]);
        }
      }
    }
  }
}

// Knochen-Matrizen einer Zeile schreiben; lost: Wurzelknochen abgetrennter Teilbäume (schrumpfen aufs Gelenk)
export function writeBones(c, st, data, base, lost = null) {
  const Q = st.Q, P = st.P, C = st.C;
  for (const i of c.order) {
    const p = c.parent[i];
    C[i] = lost && lost.includes(i) ? i : p >= 0 ? C[p] : -1;
    if (C[i] >= 0) _m.compose(P[C[i]], Q[i], TINY); else _m.compose(P[i], Q[i], ONE);
    _m.multiply(c.pre[i]).toArray(data, base + i * 16);
  }
}

export const newPoseState = (c) => ({
  Q: Array.from({ length: c.nb }, () => new THREE.Quaternion()),
  P: Array.from({ length: c.nb }, () => new THREE.Vector3()),
  C: new Int16Array(c.nb),
});

// Geometrie-Hülle mit denselben GPU-Puffern (eigene Exemplar-Attribute je Spiel)
export function wrapGeometry(src) {
  const geo = new THREE.BufferGeometry();
  for (const k in src.attributes) geo.setAttribute(k, src.attributes[k]);
  geo.setIndex(src.index);
  geo.userData.shared = true;
  return geo;
}

// ── Renderer für alle Zombies eines Spiels ────────────────────
const _I = new THREE.Quaternion(), _hip = new THREE.Vector3(), _sl = new THREE.Quaternion();
const ZD = newD();

// Drehungen des prozeduralen Zombie-Skeletts (relativ zur Wurzel) einsammeln
function zombieD(z) {
  const A = z.arms, L = z.legs;
  ZD.pelvis.copy(z.hips.quaternion);
  ZD.spine3.copy(ZD.pelvis).multiply(z.spine.quaternion);
  ZD.spine1.copy(ZD.pelvis).multiply(_sl.copy(_I).slerp(z.spine.quaternion, 0.4));
  ZD.spine2.copy(ZD.pelvis).multiply(_sl.copy(_I).slerp(z.spine.quaternion, 0.72));
  ZD.head.copy(ZD.spine3).multiply(z.neck.quaternion);
  ZD.neck1.copy(ZD.spine3).slerp(ZD.head, 0.5);
  ZD.shR.copy(ZD.spine3).multiply(A[0].sh.quaternion); ZD.elR.copy(ZD.shR).multiply(A[0].el.quaternion);
  ZD.shL.copy(ZD.spine3).multiply(A[1].sh.quaternion); ZD.elL.copy(ZD.shL).multiply(A[1].el.quaternion);
  ZD.hpR.copy(ZD.pelvis).multiply(L[0].hp.quaternion); ZD.knR.copy(ZD.hpR).multiply(L[0].kn.quaternion); ZD.ftR.copy(ZD.knR).multiply(L[0].ft.quaternion);
  ZD.hpL.copy(ZD.pelvis).multiply(L[1].hp.quaternion); ZD.knL.copy(ZD.hpL).multiply(L[1].kn.quaternion); ZD.ftL.copy(ZD.knL).multiply(L[1].ft.quaternion);
  return ZD;
}

export class SkinnedZombies {
  // names: geladene Körpertypen; max: Zeilen je Typ (Zombies + abgetrennte Stücke); cap: { geo, mat } für Wundstümpfe
  constructor(scene, names, max, cap) {
    patchInstancedSkinning();
    this.ok = PATCHED === true;
    this.variants = [];
    this.max = max;
    if (!this.ok) return;
    for (const n of names) {
      const c = charData(n);
      if (!c) continue;
      // eigene Geometrie-Hülle (gleiche GPU-Puffer), damit Splitscreen-Spiele eigene Exemplar-Daten haben
      const geo = wrapGeometry(c.geo);
      const zattr = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
      zattr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aZom', zattr);
      if (!geo.attributes._skin) geo.setAttribute('_skin', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count), 1));
      const mesh = new InstancedSkinnedMesh(geo, zombifyMaterial(c.mat, c), c.nb, max);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.dynamic = true;
      mesh.name = 'zombie_body_' + n;
      scene.add(mesh); // bleibt bis zum ersten Bild sichtbar (Shader vorkompilieren)
      this.variants.push({ name: n, c, mesh, zattr, st: newPoseState(c), n: 0 });
    }
    // Wundstümpfe (Hals, Ellbogen, Knie – am Körper und am abgetrennten Stück)
    const capGeo = cap?.geo || new THREE.CylinderGeometry(0.042, 0.042, 0.02, 10);
    const capMat = cap?.mat || new THREE.MeshStandardMaterial({ color: 0x4a0606, roughness: 0.35 });
    this.caps = new THREE.InstancedMesh(capGeo, capMat, max * 6);
    this.caps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.caps.frustumCulled = false;
    this.caps.count = 0;
    this.caps.castShadow = false;
    this.caps.userData.dynamic = true;
    this.caps.name = 'zombie_caps';
    scene.add(this.caps);
  }

  get active() { return this.ok && this.variants.length > 0; }

  // Typ für einen Zombie wählen (mit seinem Startwert – im Koop gleich)
  pick(r) { return this.variants.length ? Math.floor(r * this.variants.length) % this.variants.length : -1; }

  update(zombies) {
    if (!this.active) return;
    for (const V of this.variants) V.n = 0;
    let caps = 0;
    const capMax = this.caps.instanceMatrix.count;
    const addCap = (W, P, Q, scale, flip) => {
      if (caps >= capMax) return;
      _q.copy(Q);
      if (flip) _q.multiply(FLIP);
      _m.compose(P, _q, _v2.setScalar(scale)).premultiply(W);
      this.caps.setMatrixAt(caps++, _m);
    };
    for (const z of zombies) {
      if (!z.active || !(z.skinVariant >= 0)) continue;
      const V = this.variants[z.skinVariant];
      if (!V || V.n >= this.max) continue;
      const c = V.c, st = V.st;
      z.root.updateMatrixWorld(true);
      const W = _W.copy(z.root.matrixWorld).multiply(_F.makeScale(c.fit, c.fit, c.fit));
      this.pose(V, z);
      // Körper
      const k = V.n++;
      W.toArray(V.mesh.instanceMatrix.array, k * 16);
      this.setZom(V, k, z);
      const lost = this.lostBones(c, z);
      writeBones(c, st, V.mesh.boneData, k * V.mesh.rowFloats, lost);
      for (const r of lost) addCap(W, st.P[r], st.Q[r], CAP_SCALE[r === c.head ? 'head' : PIECE_BONES[c.pieces.indexOf(r)]] || 1, false);
      this.placeEyes(V, z, W);
      this.hitPoints(V, z);
      // abgetrennte Stücke als eigene Exemplare (nur der Teilbaum ist sichtbar)
      for (let pi = 0; pi < 4; pi++) {
        const pc = z.pieces[pi];
        if (!pc.root.visible) { pc.skinRel = null; continue; }
        const r = c.pieces[pi];
        if (r < 0) continue;
        pc.root.updateMatrixWorld(true);
        if (!pc.skinRel) this.snapPiece(V, pc, r, W);
        if (V.n >= this.max) continue;
        const kp = V.n++;
        _m.identity().toArray(V.mesh.instanceMatrix.array, kp * 16);
        this.setZom(V, kp, z);
        this.writePiece(V, kp, pc, r);
        _m2.multiplyMatrices(pc.root.matrixWorld, pc.skinRel[r]);
        _m2.decompose(_v, _q, _v2);
        addCap(IDENT, _v, _q, (CAP_SCALE[PIECE_BONES[pi]] || 1) * _v2.x, true);
      }
    }
    for (const V of this.variants) {
      const n = V.n, mesh = V.mesh;
      mesh.count = n;
      mesh.visible = n > 0;
      if (!n) continue;
      const im = mesh.instanceMatrix;
      im.clearUpdateRanges(); im.addUpdateRange(0, n * 16); im.needsUpdate = true;
      V.zattr.clearUpdateRanges(); V.zattr.addUpdateRange(0, n * 4); V.zattr.needsUpdate = true;
      const tex = mesh.skeleton.boneTexture;
      tex.clearUpdateRanges();
      for (let r = 0; r < n; r++) tex.addUpdateRange(r * mesh.rowFloats, mesh.rowFloats);
      tex.needsUpdate = true;
    }
    this.caps.count = caps;
    this.caps.visible = caps > 0;
    if (caps) this.caps.instanceMatrix.needsUpdate = true;
  }

  setZom(V, k, z) {
    const a = V.zattr.array;
    a[k * 4] = z.skinSeed || 0; a[k * 4 + 1] = z.decay ?? 0.85; a[k * 4 + 2] = z.bloodAmt ?? 0.6; a[k * 4 + 3] = 0;
  }

  lostBones(c, z) {
    const out = this._lost || (this._lost = []);
    out.length = 0;
    if (z.headless && c.head >= 0) out.push(c.head);
    if (z.arms[0].lost && c.pieces[0] >= 0) out.push(c.pieces[0]);
    if (z.arms[1].lost && c.pieces[1] >= 0) out.push(c.pieces[1]);
    if (z.legs[0].lost && c.pieces[2] >= 0) out.push(c.pieces[2]);
    if (z.legs[1].lost && c.pieces[3] >= 0) out.push(c.pieces[3]);
    return out;
  }

  // Ganze Pose (ohne Zerstückelung) im Raum der Figur: st.Q, st.P
  pose(V, z) {
    const c = V.c;
    // Hüfthöhe des Zombies (0,98 m in Ruhe) auf den Menschen übertragen
    const pelvisY0 = c.pelvis >= 0 ? c.P0[c.pelvis].y : 0.98;
    _hip.set(z.hips.position.x, (z.hips.position.y - 0.98) * (pelvisY0 / 0.98), z.hips.position.z);
    solvePose(c, zombieD(z), V.st, _hip, null, c.curl(0.62)); // Krallenhände
  }

  // Lage des abgetrennten Teilbaums relativ zum fliegenden Stück festhalten
  snapPiece(V, pc, r, W) {
    const c = V.c, rel = new Array(c.nb).fill(null);
    _m2.copy(pc.root.matrixWorld).invert();
    for (const i of c.sub[r]) rel[i] = new THREE.Matrix4().compose(V.st.P[i], V.st.Q[i], ONE).premultiply(W).premultiply(_m2);
    pc.skinRel = rel;
  }

  // Exemplar für ein abgetrenntes Stück: Teilbaum folgt dem Stück, der Rest schrumpft aufs Gelenk
  writePiece(V, k, pc, r) {
    const c = V.c, rel = pc.skinRel, data = V.mesh.boneData, base = k * V.mesh.rowFloats;
    const Wp = pc.root.matrixWorld;
    _v.setFromMatrixPosition(_m2.multiplyMatrices(Wp, rel[r]));
    for (let i = 0; i < c.nb; i++) {
      if (rel[i]) _m.multiplyMatrices(Wp, rel[i]);
      else _m.makeScale(TINY.x, TINY.y, TINY.z).setPosition(_v);
      _m.multiply(c.pre[i]).toArray(data, base + i * 16);
    }
  }

  // Trefferzonen am echten Körper (Wurzel-Raum des Zombies): Kopf, Brust, Becken, Knie, Unterarme
  hitPoints(V, z) {
    const c = V.c, P = V.st.P, Q = V.st.Q, f = c.fit, h = c.hit;
    const H = z.skinHit || (z.skinHit = Array.from({ length: 7 }, () => new THREE.Vector3()));
    if (c.head >= 0) H[0].copy(c.headCenter).applyQuaternion(Q[c.head]).add(P[c.head]);
    if (h.spine >= 0 && h.neck >= 0) H[1].copy(P[h.spine]).lerp(P[h.neck], 0.35);
    if (c.pelvis >= 0) H[2].copy(P[c.pelvis]);
    if (h.calfR >= 0) H[3].copy(P[h.calfR]);
    if (h.calfL >= 0) H[4].copy(P[h.calfL]);
    if (h.armR >= 0 && h.handR >= 0) H[5].copy(P[h.armR]).lerp(P[h.handR], 0.5);
    if (h.armL >= 0 && h.handL >= 0) H[6].copy(P[h.armL]).lerp(P[h.handL], 0.5);
    for (const p of H) p.multiplyScalar(f);
    z.skinHitOk = true;
  }

  // Leuchtaugen an die echten Augen setzen (eyes.js liest matrixWorld der Augen-Platzhalter)
  placeEyes(V, z, W) {
    const c = V.c;
    if (!c.eyes || c.head < 0) return;
    _m.compose(V.st.P[c.head], V.st.Q[c.head], ONE).premultiply(W);
    for (let k = 0; k < 2; k++) {
      // eyes[0] = links (+x) → zombie.eyes[1] (links), eyes[1] = rechts → zombie.eyes[0]
      _v.copy(c.eyes[k === 0 ? 1 : 0]).applyMatrix4(_m);
      const e = z.eyes[k].matrixWorld.elements;
      e[12] = _v.x; e[13] = _v.y; e[14] = _v.z;
    }
  }

  dispose() {
    for (const V of this.variants) { V.mesh.dispose(); V.mesh.material.dispose(); V.mesh.removeFromParent(); }
    this.variants = [];
    this.caps.dispose();
    this.caps.removeFromParent();
  }
}

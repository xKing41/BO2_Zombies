// ─────────────────────────────────────────────────────────────
//  Prozedurale Waffenmodelle für Viewmodel, Mystery-Kiste und Äther-Schmiede.
//  Konvention: Lauf zeigt nach -z, Ursprung am Griff, Visierlinie bei y = sightY.
//  Profile nutzen a = Abstand nach vorn (z = -a).
//  Feste Teile werden je Material verschmolzen; bewegliche Teile (Magazin,
//  Schlitten, Verschluss, Vorderschaft, Kipplauf, Deckel) sind eigene Gruppen.
//  Ankerpunkte (Object3D) geben Handgelenk-Lage der Hände vor:
//  Fingerrichtung = -z, Handrücken = +y, Daumen rechts -x / links +x.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { Parts, side, front, top, rbox, box, cylZ, cylX, cylY, lathe, ringZ, sphere, rail, circle, roundRect, helixZ } from './gunGeo.js';
import { gunMats, TINT as T, bottleLabel } from './gunTextures.js';
import { PERKS } from '../config.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _m4 = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

// Basis aus Fingerrichtung (fwd) und Handrücken (up)
export function setFrame(q, fwd, up) {
  _z.copy(fwd).normalize().negate();
  _x.crossVectors(up, _z).normalize();
  _y.crossVectors(_z, _x);
  _m4.makeBasis(_x, _y, _z);
  return q.setFromRotationMatrix(_m4);
}

function node(parent, name, x = 0, y = 0, z = 0) {
  const o = new THREE.Object3D();
  o.name = name; o.position.set(x, y, z);
  parent.add(o);
  return o;
}
function grp(parent, name, x = 0, y = 0, z = 0) {
  const o = new THREE.Group();
  o.name = name; o.position.set(x, y, z);
  parent.add(o);
  return o;
}
// Handanker: Position, Fingerrichtung, Handrücken
function hand(parent, name, pos, fwd, up) {
  const o = node(parent, name, pos[0], pos[1], pos[2]);
  setFrame(o.quaternion, V(fwd[0], fwd[1], fwd[2]), V(up[0], up[1], up[2]));
  return o;
}
// Pistolengriff-Haltung der rechten Hand (Griffwinkel ang, Handgelenk-Position)
const gripR = (parent, pos, ang = 0.33, roll = 0.12) => hand(parent, 'handR', pos, [0, -Math.sin(ang), -Math.cos(ang)], [Math.cos(roll), Math.sin(roll) * Math.cos(ang), Math.sin(roll) * Math.sin(ang) * -1 + 0.0]);

// ── Wiederkehrende Bauteile ───────────────────────────────────
// Abzug (Seitenprofil) bei a, Oberkante y0
function trigger(P, mat, a, y0, len = 0.022) {
  P.add(mat, T.steel, side([[a - 0.002, y0], [a + 0.004, y0], ['q', a + 0.001, y0 - len * 0.55, a + 0.006, y0 - len], [a + 0.001, y0 - len], ['q', a - 0.004, y0 - len * 0.5, a - 0.002, y0]], 0.006, 0.0008));
}
// Abzugsbügel als Schlaufe
function guard(P, mat, tint, a0, a1, y0, y1, w = 0.01) {
  P.add(mat, tint, side([[a1, y0], [a1, y1 + 0.006], ['q', a1, y1, a1 - 0.008, y1], [a0 + 0.004, y1], ['q', a0, y1, a0, y1 + 0.006], [a0, y0]], w, 0.0012,
    [[[a1 - 0.004, y0 - 0.001], [a1 - 0.004, y1 + 0.007], ['q', a1 - 0.004, y1 + 0.004, a1 - 0.008, y1 + 0.004], [a0 + 0.005, y1 + 0.004], ['q', a0 + 0.004, y1 + 0.004, a0 + 0.004, y1 + 0.007], [a0 + 0.004, y0 - 0.001]]]));
}
// Pistolengriff (Polymer, Fingerrille), oben bei (a0..a1, y0), Winkel ang, Länge len
function pistolGrip(P, mat, tint, a0, a1, y0, len = 0.09, ang = 0.42, w = 0.027) {
  const s = Math.sin(ang), c = Math.cos(ang);
  const d = a1 - a0;
  const bf = [a1 - s * len, y0 - c * len], bb = [a0 - s * len, y0 - c * len];
  P.add(mat, tint, side([
    [a1, y0], ['q', a1 - s * len * 0.25 + 0.004, y0 - c * len * 0.25, a1 - s * len * 0.4, y0 - c * len * 0.4],
    ['q', a1 - s * len * 0.55 - 0.004, y0 - c * len * 0.52, a1 - s * len * 0.62, y0 - c * len * 0.62],
    [bf[0], bf[1]], ['q', bf[0] - 0.002, bf[1] - 0.008, bf[0] - d * 0.3, bf[1] - 0.008], [bb[0] + 0.004, bb[1] - 0.004],
    ['q', bb[0] - 0.004, bb[1], bb[0] - 0.002, bb[1] + 0.012],
    [a0 - 0.006, y0 - 0.012], ['q', a0 - 0.008, y0, a0, y0],
  ], w, 0.0045, null, 5));
}
// Lochkimme (Diopter) mit Schutzohren
function aperture(P, mat, tint, a, y, h = 0.016, r = 0.0024, w = 0.014) {
  P.add(mat, tint, front([[-w / 2, y - h * 0.65], [w / 2, y - h * 0.65], [w / 2, y + h * 0.35], [-w / 2, y + h * 0.35]], 0.003, 0.0006, [circle(0, y, r, 14)]), [0, 0, -a]);
}
// Kornsäule mit Schutzflügeln
function postSight(P, mat, tint, a, yBase, yTop, w = 0.016) {
  P.add(mat, tint, rbox(0.0026, yTop - yBase, 0.0026, 0.0006), [0, (yTop + yBase) / 2, -a]);
  for (const s of [-1, 1]) P.add(mat, tint, rbox(0.0032, yTop - yBase + 0.003, 0.009, 0.0008), [s * (w / 2 - 0.0016), (yTop + yBase) / 2 + 0.0015, -a]);
}
// Mündung: Laufbohrung als dunkle Scheibe
function bore(P, mat, a, y, r, x = 0) { P.add(mat, T.hole, cylZ(r, r, 0.004, 12), [x, y, -a + 0.0015]); }

// Leere Info-Struktur
function makeInfo(id, pap) {
  const g = new THREE.Group();
  g.name = 'gun_' + id;
  return {
    id, pap, group: g, muzzle: node(g, 'muzzle'), ejectPort: node(g, 'ejectPort'),
    mag: null, magHome: null, slide: null, pump: null, pumpHome: null, breakPart: null, handle: null, cover: null, chamber: null,
    sightY: 0.07, adsZ: -0.2, back: 0, hip: V(0.12, -0.13, -0.27),
    gripR: V(), gripL: V(), poseR: 'pistol', poseL: 'handguard', reload: 'mag', eject: 'rifle',
    flash: 1, slideTravel: 0, handleTravel: V(0, 0, 0.05), pumpTravel: 0.085,
  };
}

// ── Waffen ────────────────────────────────────────────────────
const BUILDERS = {
  // P-45: 1911 mit Holzgriffschalen (Fischhaut), Schlitten mit Rillen
  p45(G, I, pap) {
    const g = I.group, met = pap ? G.pap : G.metal, dk = pap ? G.poly : G.metal;
    const F = new Parts(), S = new Parts(), Mg = new Parts();
    // Rahmen mit Abzugsbügel, Griff und Griffsicherung
    F.add(met, T.steel, side([
      [-0.058, 0.012], [0.145, 0.012], [0.147, 0.006], [0.143, 0.0], [0.066, 0.0],
      [0.066, -0.027], ['q', 0.066, -0.037, 0.055, -0.037], [0.018, -0.037], ['q', 0.012, -0.036, 0.011, -0.032],
      [-0.012, -0.099], ['q', -0.013, -0.104, -0.019, -0.104], [-0.055, -0.104], ['q', -0.061, -0.104, -0.06, -0.098],
      [-0.036, -0.03], ['q', -0.034, -0.014, -0.046, -0.006], ['q', -0.064, 0.0, -0.072, 0.005], ['q', -0.074, 0.012, -0.062, 0.012],
    ], 0.0205, 0.0018, [[[0.06, -0.004], [0.06, -0.026], ['q', 0.06, -0.031, 0.054, -0.031], [0.02, -0.031], ['q', 0.016, -0.031, 0.016, -0.027], [0.016, -0.004]]]));
    // Griffschalen mit Fischhaut + Schrauben
    for (const s of [-1, 1]) {
      F.add(G.woodChk, T.wood, side([[0.004, -0.02], [-0.016, -0.093], ['q', -0.018, -0.098, -0.024, -0.098], [-0.05, -0.098], ['q', -0.055, -0.098, -0.054, -0.093],
        [-0.034, -0.024], ['q', -0.032, -0.016, -0.024, -0.015], [-0.004, -0.015], ['q', 0.004, -0.015, 0.004, -0.02]], 0.0042, 0.0014, null, 4), [s * 0.0118, 0, 0], null, null, 40);
      for (const [a, y] of [[-0.011, -0.03], [-0.034, -0.087]]) F.add(met, T.chrome, cylX(0.0027, 0.0016, 10), [s * 0.0142, y, -a]);
    }
    // Hahn (gespannt), Daumensicherung, Fanghebel, Magazinknopf
    F.add(met, T.steel, side([[-0.054, 0.014], [-0.052, 0.034], ['q', -0.054, 0.043, -0.064, 0.044], ['q', -0.073, 0.041, -0.07, 0.033], [-0.06, 0.03], [-0.059, 0.014]], 0.0065, 0.0012));
    F.add(met, T.steel, rbox(0.003, 0.0055, 0.019, 0.001), [-0.0118, 0.0068, 0.03]);
    F.add(met, T.steel, rbox(0.004, 0.006, 0.01, 0.0012), [-0.0128, 0.0105, 0.038]);
    F.add(met, T.steel, rbox(0.003, 0.004, 0.022, 0.0012), [-0.0115, 0.0055, -0.03]);
    F.add(met, T.steel, cylX(0.0032, 0.004), [-0.0128, 0.0075, -0.042]);
    F.add(met, T.steel, cylX(0.0036, 0.003), [-0.0108, -0.012, -0.004]);
    trigger(F, met, 0.031, -0.002, 0.021);
    // Schlitten: Querschnitt-Extrusion, Rillen, Auswurffenster, Visierung
    const slide = grp(g, 'slide');
    S.add(met, T.blued, front([[-0.0118, 0.012], [0.0118, 0.012], [0.0118, 0.039], ['q', 0.0118, 0.0465, 0.0062, 0.0465], [-0.0062, 0.0465], ['q', -0.0118, 0.0465, -0.0118, 0.039]], 0.218, 0.0022), [0, 0, -0.066]);
    for (let i = 0; i < 9; i++) for (const s of [-1, 1]) S.add(dk, T.dark, box(0.0008, 0.024, 0.0011), [s * 0.0119, 0.029, 0.038 - i * 0.0031]);
    S.add(dk, T.hole, box(0.001, 0.0125, 0.034), [0.0115, 0.0335, -0.03]);
    S.add(met, T.brass, cylZ(0.0062, 0.0062, 0.026, 10), [0.006, 0.03, -0.03]); // Lauf-Haube im Fenster
    for (const s of [-1, 1]) S.add(met, T.blued, rbox(0.0042, 0.0075, 0.007, 0.0009), [s * 0.0034, 0.0503, 0.034]);
    S.add(met, T.blued, rbox(0.011, 0.003, 0.007, 0.0006), [0, 0.048, 0.034]);
    S.add(met, T.blued, rbox(0.0032, 0.0075, 0.009, 0.0012), [0, 0.0503, -0.165]);
    for (const s of [-1, 1]) S.add(G.poly, T.white, box(0.0018, 0.0018, 0.0004), [s * 0.0034, 0.0515, 0.0377]);
    S.add(G.poly, T.white, box(0.0016, 0.0016, 0.0004), [0, 0.051, -0.1605]);
    S.add(met, T.steel, cylZ(0.0085, 0.0085, 0.006, 16), [0, 0.03, -0.176]);
    bore(S, dk, 0.179, 0.03, 0.0057);
    S.build(slide, 'slide');
    I.slide = slide; I.slideTravel = 0.036;
    // Magazin (Gruppe am Schacht, entlang des Griffwinkels)
    const mag = grp(g, 'mag', 0, 0, 0.0025); mag.rotation.x = -0.33;
    Mg.add(met, T.blued, rbox(0.019, 0.1, 0.031, 0.0025), [0, -0.05, 0]);
    Mg.add(met, T.steel, rbox(0.0225, 0.0055, 0.037, 0.0018), [0, -0.103, 0.002]);
    const rnd = new THREE.Group(); rnd.position.set(0, 0.0, 0); rnd.rotation.x = 0.33;
    Mg.add(met, T.brass, cylZ(0.0058, 0.0058, 0.017, 10), [0, 0.002, 0.002], [0.33, 0, 0]);
    Mg.add(met, T.copper, lathe([[0.0058, 0], [0.0052, 0.004], [0.0035, 0.008], [0.0, 0.0095]], 10), [0, 0.0048, -0.0045], [0.33, 0, 0]);
    Mg.build(mag, 'mag');
    I.mag = mag;
    hand(mag, 'magGrab', [-0.004, -0.13, 0.075], [0.15, 0.85, -0.5], [-0.95, 0.05, 0.3]);
    F.build(g, 'frame');
    I.muzzle.position.set(0, 0.03, -0.18);
    I.ejectPort.position.set(0.012, 0.035, -0.03);
    I.sightY = 0.054; I.adsZ = -0.19; I.hip = V(0.098, -0.112, -0.26);
    gripR(g, [0.012, -0.012, 0.082], 0.36, 0.25);
    hand(g, 'handL', [-0.03, -0.075, 0.05], [0.42, 0.2, -0.88], [-0.75, -0.55, 0.1]);
    hand(slide, 'slideGrab', [-0.01, 0.075, 0.08], [0.2, -0.75, -0.6], [-0.4, 0.5, -0.75]);
    I.poseR = 'pistol'; I.poseL = 'support'; I.reload = 'pistol'; I.eject = 'pistol'; I.flash = 0.7;
  },

  // K-14: Kampfgewehr mit Holzschaft, Handschutz oben, Mündungsfeuerdämpfer
  k14(G, I, pap) {
    const g = I.group, met = pap ? G.pap : G.metal, dk = pap ? G.poly : G.metal;
    const P = new Parts(), B = new Parts(), Mg = new Parts();
    // Schaft (Holz) vom Kolben bis zur Spitze
    P.add(G.wood, T.wood, side([
      [-0.37, 0.036], [-0.07, 0.024], ['q', -0.035, 0.013, 0.0, 0.013], [0.0, 0.015], [0.245, 0.015], [0.255, 0.022], [0.44, 0.022],
      ['q', 0.456, 0.022, 0.455, 0.01], [0.448, -0.006], [0.26, -0.02], [0.15, -0.024], [0.138, -0.024], [0.138, -0.006], [0.062, -0.006], [0.062, -0.024],
      [0.03, -0.026], [0.0, -0.03], ['q', -0.03, -0.072, -0.07, -0.074], [-0.37, -0.11], ['q', -0.382, -0.04, -0.37, 0.036],
    ], 0.044, 0.007, null, 6));
    P.add(met, T.steel, side([[-0.369, 0.036], [-0.377, 0.035], ['q', -0.388, -0.04, -0.377, -0.112], [-0.369, -0.11], ['q', -0.38, -0.04, -0.369, 0.036]], 0.042, 0.0015)); // Kolbenkappe
    // System (Stahl)
    P.add(met, T.steel, front([[-0.0135, 0.014], [0.0135, 0.014], [0.0135, 0.039], ['q', 0.0135, 0.046, 0.007, 0.046], [-0.007, 0.046], ['q', -0.0135, 0.046, -0.0135, 0.039]], 0.24, 0.002), [0, 0, -0.118]);
    P.add(dk, T.hole, box(0.022, 0.003, 0.07), [0.003, 0.0465, -0.07]); // offene Oberseite
    // Kimme mit Schutzohren
    P.add(met, T.steel, rbox(0.022, 0.012, 0.016, 0.002), [0, 0.051, -0.012]);
    for (const s of [-1, 1]) P.add(met, T.steel, side([[0.0, 0.05], [0.022, 0.05], [0.016, 0.068], [0.005, 0.071]], 0.0035, 0.0008), [s * 0.0085, 0, 0]);
    aperture(P, met, T.steel, 0.012, 0.064, 0.014, 0.0021, 0.011);
    P.add(met, T.steel, cylX(0.0052, 0.03, 12), [0, 0.053, -0.006]);
    // Handschutz oben (Holz) mit Lüftungsschlitzen
    P.add(G.wood, T.woodDark, side([[0.245, 0.024], [0.42, 0.024], [0.42, 0.04], ['q', 0.42, 0.046, 0.41, 0.046], [0.255, 0.046], [0.245, 0.042]], 0.03, 0.005));
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) P.add(dk, T.hole, box(0.001, 0.009, 0.014), [s * 0.0146, 0.036, -(0.28 + i * 0.035)]);
    // Lauf, Gaszylinder, Bänder, Feuerdämpfer, Korn
    P.add(met, T.steel, cylZ(0.0092, 0.0098, 0.43, 14), [0, 0.03, -0.45]);
    P.add(met, T.steel, cylZ(0.0075, 0.0075, 0.15, 12), [0, 0.012, -0.5]);
    P.add(met, T.steel, rbox(0.024, 0.04, 0.022, 0.003), [0, 0.02, -0.575]);
    P.add(met, T.steel, lathe([[0.0098, 0.58], [0.0118, 0.585], [0.0118, 0.69], [0.011, 0.705], [0.0065, 0.706]], 16));
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; P.add(dk, T.hole, box(0.0022, 0.0012, 0.05), [Math.cos(a) * 0.0115, 0.03 + Math.sin(a) * 0.0115, -0.67], [0, 0, a]); }
    bore(P, dk, 0.706, 0.03, 0.0062);
    P.add(met, T.steel, rbox(0.016, 0.014, 0.018, 0.002), [0, 0.046, -0.655]);
    postSight(P, met, T.steel, 0.655, 0.052, 0.064, 0.014);
    // Abzugsbügel, Abzug, Sicherung, Riemenbügel
    guard(P, met, T.steel, -0.005, 0.062, -0.022, -0.05, 0.011);
    trigger(P, met, 0.022, -0.024, 0.02);
    P.add(met, T.steel, rbox(0.006, 0.01, 0.006, 0.0015), [0, -0.024, -0.064]);
    P.add(met, T.steel, ringZ(0.01, 0.0018, 12, 5), [0, -0.018, -0.4], [0, Math.PI / 2, 0]);
    // Verschluss + Ladehebel rechts (beweglich)
    const bolt = grp(g, 'handle');
    B.add(met, T.chrome, rbox(0.016, 0.01, 0.04, 0.003), [0.002, 0.042, -0.06]);
    B.add(met, T.steel, rbox(0.006, 0.006, 0.32, 0.0015), [0.016, 0.02, -0.26]);
    B.add(met, T.steel, rbox(0.015, 0.012, 0.016, 0.003), [0.026, 0.026, -0.12]);
    B.build(bolt, 'handle');
    I.handle = bolt; I.handleTravel = V(0, 0, 0.065);
    hand(bolt, 'handleGrab', [0.075, 0.045, -0.05], [-0.85, -0.2, -0.45], [0.3, 0.9, -0.2]);
    // Magazin (20 Schuss)
    const mag = grp(g, 'mag', 0, -0.004, -0.1);
    Mg.add(met, T.steel, side([[-0.034, 0.004], [0.034, 0.004], [0.036, -0.09], ['q', 0.038, -0.098, 0.033, -0.1], [-0.026, -0.108], ['q', -0.032, -0.106, -0.032, -0.1]], 0.026, 0.0025));
    Mg.add(met, T.steel, side([[-0.033, -0.1], [0.036, -0.092], [0.037, -0.098], [-0.033, -0.108]], 0.028, 0.0012));
    Mg.add(met, T.brass, cylZ(0.0062, 0.0062, 0.05, 10), [0, 0.01, 0.002]);
    Mg.add(met, T.copper, lathe([[0.0062, 0], [0.005, 0.007], [0.0025, 0.016], [0.0, 0.018]], 10), [0, 0.01, -0.023]);
    Mg.build(mag, 'mag');
    I.mag = mag;
    hand(mag, 'magGrab', [-0.02, -0.12, 0.07], [0.25, 0.85, -0.45], [-0.95, 0.15, 0.2]);
    P.build(g, 'body');
    I.muzzle.position.set(0, 0.03, -0.71);
    I.ejectPort.position.set(0.012, 0.045, -0.07);
    I.sightY = 0.064; I.adsZ = -0.105; I.hip = V(0.105, -0.13, -0.2);
    hand(g, 'handR', [0.022, -0.02, 0.085], [0.0, -0.55, -0.83], [0.95, 0.2, 0.2]);
    hand(g, 'handL', [-0.045, -0.06, -0.3], [0.62, 0.45, -0.62], [-0.65, -0.72, -0.15]);
    I.poseR = 'wrist'; I.poseL = 'forend'; I.reload = 'mag'; I.eject = 'rifle'; I.flash = 1.1;
  },

  // Doppellauf: Kipplauf-Flinte, Holzschaft mit Pistolengriff
  dlf(G, I, pap) {
    const g = I.group, met = pap ? G.pap : G.metal, dk = pap ? G.poly : G.metal;
    const P = new Parts(), Br = new Parts(), Ch = new Parts();
    P.add(G.wood, T.wood, side([
      [-0.34, 0.03], [-0.06, 0.02], ['q', -0.03, 0.016, 0.0, 0.016], [0.04, 0.02], [0.04, -0.016], [0.028, -0.02], [0.0, -0.022],
      ['q', -0.012, -0.03, -0.026, -0.07], [-0.03, -0.082], [-0.058, -0.084], ['q', -0.07, -0.075, -0.09, -0.072], [-0.34, -0.1], ['q', -0.352, -0.035, -0.34, 0.03],
    ], 0.042, 0.007, null, 6));
    P.add(G.poly, T.rubber, side([[-0.34, 0.031], [-0.356, 0.03], ['q', -0.366, -0.035, -0.356, -0.101], [-0.34, -0.1], ['q', -0.35, -0.035, -0.34, 0.031]], 0.04, 0.003));
    P.add(met, T.steel, rbox(0.02, 0.012, 0.022, 0.003), [0, -0.08, 0.044]);
    // Basküle
    P.add(met, T.steel, side([[0.035, 0.032], [0.145, 0.032], [0.145, -0.008], ['q', 0.14, -0.024, 0.12, -0.026], [0.05, -0.026], ['q', 0.035, -0.022, 0.035, -0.01]], 0.05, 0.004));
    P.add(met, T.steel, rbox(0.014, 0.005, 0.06, 0.002), [0, 0.033, -0.01]); // Oberer Steg
    P.add(met, T.chrome, rbox(0.007, 0.0045, 0.032, 0.0018), [0.008, 0.0365, -0.05], [0, 0.35, 0]); // Öffnungshebel
    P.add(met, T.steel, cylX(0.0062, 0.054, 14), [0, -0.012, -0.145]);
    guard(P, met, T.steel, 0.0, 0.085, -0.026, -0.052, 0.01);
    trigger(P, met, 0.042, -0.026, 0.02); trigger(P, met, 0.06, -0.026, 0.018);
    for (const s of [-1, 1]) P.add(met, T.chrome, cylX(0.003, 0.002), [s * 0.0255, 0.004, -0.09]);
    // Kipplauf (Drehpunkt am Scharnier)
    const br = grp(g, 'breakPart', 0, -0.012, -0.145);
    const by = 0.026 + 0.012;
    for (const s of [-1, 1]) {
      Br.add(met, T.blued, cylZ(0.0112, 0.0122, 0.52, 18), [s * 0.0118, by, -0.26]);
      Br.add(met, T.blued, lathe([[0.0122, 0.0], [0.0128, 0.002], [0.0128, 0.03], [0.0122, 0.035]], 18), [s * 0.0118, by, 0]);
      bore(Br, dk, 0.52, by, 0.0094, s * 0.0118);
      Br.add(dk, T.hole, cylZ(0.0094, 0.0094, 0.004, 12), [s * 0.0118, by, -0.0005]);
    }
    Br.add(met, T.steel, rbox(0.007, 0.0045, 0.51, 0.0015), [0, by + 0.0105, -0.26]);
    Br.add(met, T.steel, rbox(0.006, 0.006, 0.4, 0.0015), [0, by - 0.012, -0.22]);
    Br.add(met, T.brass, sphere(0.0019, 8, 6), [0, by + 0.0145, -0.505]);
    Br.add(G.wood, T.wood, side([[0.015, 0.024], [0.235, 0.024], ['q', 0.248, 0.02, 0.242, 0.006], [0.22, -0.002], [0.035, -0.006], ['q', 0.015, -0.004, 0.015, 0.012]], 0.052, 0.007, null, 6));
    Br.add(met, T.steel, rbox(0.018, 0.006, 0.03, 0.002), [0, 0.0, -0.05]);
    Br.add(met, T.steel, rbox(0.054, 0.034, 0.012, 0.003), [0, by - 0.004, -0.006]); // Laufhaken
    Br.build(br, 'barrels');
    // Patronen im Lager (sichtbar beim Öffnen)
    const ch = grp(br, 'chamber');
    for (const s of [-1, 1]) {
      Ch.add(met, T.brass, cylZ(0.0115, 0.0115, 0.006, 14), [s * 0.0118, by, 0.0025]);
      Ch.add(met, T.copper, cylZ(0.0026, 0.0026, 0.007, 8), [s * 0.0118, by, 0.003]);
    }
    Ch.build(ch, 'chamber');
    I.breakPart = br; I.chamber = ch;
    I.chamberPos = [V(-0.0118, by, 0.0), V(0.0118, by, 0.0)];
    hand(br, 'handL', [-0.04, -0.035, -0.16], [0.62, 0.42, -0.65], [-0.62, -0.78, -0.1]);
    hand(br, 'shellGrab', [-0.012, by + 0.02, 0.1], [0.05, -0.45, -0.89], [-0.6, 0.7, -0.35]);
    P.build(g, 'body');
    I.muzzle.position.set(0, 0.026, -0.67);
    I.ejectPort.position.set(0, 0.03, -0.14);
    I.sightY = 0.046; I.adsZ = -0.115; I.hip = V(0.11, -0.13, -0.2);
    hand(g, 'handR', [0.02, -0.018, 0.085], [0.0, -0.45, -0.89], [0.95, 0.2, 0.15]);
    I.poseR = 'wrist'; I.poseL = 'forend'; I.reload = 'break'; I.eject = 'shell'; I.flash = 1.35;
  },

  // Vektor MP: kantiges Polymergehäuse, Schräge vorn, langes Magazin, Klappschaft
  vmp(G, I, pap) {
    const g = I.group, met = pap ? G.pap : G.metal, pol = pap ? G.pap : G.poly, dk = G.poly;
    const P = new Parts(), H = new Parts(), Mg = new Parts();
    // Oberteil
    P.add(pol, T.black, side([[-0.075, 0.012], [0.225, 0.012], [0.238, 0.02], [0.238, 0.046], [0.226, 0.052], [-0.06, 0.052], [-0.075, 0.044]], 0.046, 0.003));
    // Unterteil mit der typischen Schräge und Magazinschacht
    P.add(pol, T.black, side([
      [-0.03, 0.014], [0.21, 0.014], [0.2, -0.004], [0.142, -0.07], [0.135, -0.074], [0.084, -0.074], [0.076, -0.05],
      [0.062, -0.044], [0.062, -0.052], ['q', 0.062, -0.058, 0.054, -0.058], [0.006, -0.058], ['q', -0.001, -0.058, -0.002, -0.05], [-0.003, -0.012], [-0.03, -0.006],
    ], 0.04, 0.0035, [[[0.055, -0.044], [0.055, -0.052], [0.008, -0.052], [0.006, -0.03], [0.048, -0.03]]]));
    pistolGrip(P, pol, T.black, -0.037, -0.002, -0.008, 0.088, 0.32, 0.028);
    trigger(P, met, 0.026, -0.03, 0.017);
    // Laufmantel, Lauf, Mündung
    P.add(pol, T.black, rbox(0.032, 0.032, 0.06, 0.004), [0, 0.026, -0.255]);
    P.add(met, T.steel, cylZ(0.0085, 0.0085, 0.07, 14), [0, 0.026, -0.315]);
    P.add(met, T.steel, lathe([[0.0105, 0.35], [0.012, 0.354], [0.012, 0.378], [0.0105, 0.382], [0.0055, 0.382]], 14));
    for (let i = 0; i < 3; i++) P.add(dk, T.hole, box(0.025, 0.003, 0.003), [0, 0.026 + (i - 1) * 0.0058, -0.367]);
    bore(P, dk, 0.382, 0.026, 0.0055);
    // Schiene oben, Klappvisiere
    P.add(met, T.alu, rail(0.28, 0.021, 0.008), [0, 0.052, -0.08]);
    P.add(met, T.alu, rbox(0.02, 0.01, 0.022, 0.002), [0, 0.065, 0.03]);
    aperture(P, met, T.alu, -0.034, 0.08, 0.016, 0.0024, 0.013);
    P.add(met, T.alu, rbox(0.018, 0.012, 0.02, 0.002), [0, 0.066, -0.205]);
    postSight(P, met, T.alu, 0.205, 0.07, 0.08, 0.014);
    // Auswurffenster rechts, Unterschiene + Frontgriff
    P.add(dk, T.hole, box(0.001, 0.016, 0.04), [0.0232, 0.034, -0.07]);
    P.add(met, T.alu, rail(0.05, 0.02, 0.007), [0, 0.012, -0.245], [Math.PI, 0, 0]);
    P.add(pol, T.black, lathe([[0.0, 0.0], [0.0135, 0.0], [0.0145, 0.01], [0.0138, 0.03], [0.014, 0.05], [0.0155, 0.056], [0.0155, 0.064], [0.0, 0.066]], 14), [0, 0.006, -0.245], [Math.PI / 2, 0, 0]);
    // Klappschaft
    P.add(pol, T.black, side([[-0.075, 0.047], [-0.305, 0.047], [-0.318, 0.038], [-0.318, -0.04], [-0.302, -0.05], [-0.27, -0.04], [-0.13, 0.005], [-0.075, 0.012]], 0.02, 0.003,
      [[[-0.13, 0.036], [-0.29, 0.036], [-0.296, -0.026], [-0.272, -0.026], [-0.14, 0.014]]]));
    P.add(G.poly, T.rubber, rbox(0.032, 0.095, 0.012, 0.004), [0, 0.002, 0.323]);
    // Ladehebel links (beweglich)
    const h = grp(g, 'handle');
    H.add(met, T.steel, rbox(0.014, 0.009, 0.014, 0.003), [-0.029, 0.036, -0.17]);
    H.build(h, 'handle');
    I.handle = h; I.handleTravel = V(0, 0, 0.06);
    hand(h, 'handleGrab', [-0.085, 0.045, -0.11], [0.85, -0.25, -0.45], [-0.35, 0.92, -0.1]);
    // Magazin
    const mag = grp(g, 'mag', 0, -0.03, -0.11); mag.rotation.x = 0.06;
    Mg.add(met, T.dark, side([[-0.024, 0.02], [0.024, 0.02], [0.024, -0.15], [-0.024, -0.15]], 0.025, 0.0028));
    Mg.add(G.poly, T.black, rbox(0.03, 0.012, 0.058, 0.003), [0, -0.154, 0]);
    Mg.add(met, T.brass, cylZ(0.0058, 0.0058, 0.016, 10), [0, 0.024, 0.006]);
    Mg.build(mag, 'mag');
    I.mag = mag;
    hand(mag, 'magGrab', [-0.012, -0.175, 0.07], [0.2, 0.85, -0.5], [-0.95, 0.15, 0.25]);
    P.build(g, 'body');
    I.muzzle.position.set(0, 0.026, -0.385);
    I.ejectPort.position.set(0.024, 0.035, -0.07);
    I.sightY = 0.08; I.adsZ = -0.14; I.hip = V(0.11, -0.13, -0.22);
    gripR(g, [0.012, -0.03, 0.088], 0.32, 0.18);
    hand(g, 'handL', [-0.035, -0.075, -0.2], [0.55, -0.1, -0.83], [-0.82, 0.0, -0.55]);
    I.poseR = 'pistol'; I.poseL = 'vgrip'; I.reload = 'mag'; I.eject = 'pistol'; I.flash = 0.8;
  },

  // Pumpgun 870: Holzschaft, gerippter Vorderschaft, Röhrenmagazin
  pump(G, I, pap) {
    const g = I.group, met = pap ? G.pap : G.metal, dk = pap ? G.poly : G.metal;
    const P = new Parts(), Pm = new Parts();
    P.add(met, T.blued, side([[-0.012, 0.044], [0.17, 0.044], [0.17, -0.008], [0.155, -0.018], [0.02, -0.018], [-0.012, -0.004]], 0.036, 0.003));
    P.add(dk, T.hole, box(0.001, 0.02, 0.07), [0.0181, 0.022, -0.085]);
    P.add(dk, T.hole, box(0.02, 0.001, 0.1), [0, -0.0183, -0.09]);
    P.add(G.wood, T.wood, side([
      [-0.37, 0.034], [-0.07, 0.03], ['q', -0.035, 0.03, -0.01, 0.042], [-0.01, -0.006], [-0.02, -0.02],
      ['q', -0.035, -0.06, -0.075, -0.066], [-0.37, -0.105], ['q', -0.382, -0.035, -0.37, 0.034],
    ], 0.04, 0.007, null, 6));
    P.add(G.poly, T.rubber, side([[-0.37, 0.035], [-0.39, 0.034], ['q', -0.4, -0.035, -0.39, -0.106], [-0.37, -0.105], ['q', -0.38, -0.035, -0.37, 0.035]], 0.042, 0.003));
    guard(P, met, T.steel, -0.01, 0.07, -0.018, -0.046, 0.011);
    trigger(P, met, 0.03, -0.018, 0.02);
    P.add(met, T.steel, rbox(0.006, 0.006, 0.014, 0.0015), [0.0, -0.017, -0.075]);
    // Lauf, Korn, Magazinrohr, Kappe, Schelle
    P.add(met, T.blued, cylZ(0.0112, 0.012, 0.535, 18), [0, 0.03, -0.437]);
    P.add(met, T.brass, sphere(0.0022, 8, 6), [0, 0.0435, -0.69]);
    bore(P, dk, 0.705, 0.03, 0.0094);
    P.add(met, T.blued, cylZ(0.0105, 0.0105, 0.43, 14), [0, 0.006, -0.385]);
    P.add(met, T.steel, lathe([[0.0108, 0.6], [0.012, 0.604], [0.012, 0.622], [0.008, 0.628], [0.0, 0.629]], 14));
    P.add(met, T.steel, rbox(0.026, 0.044, 0.014, 0.004), [0, 0.018, -0.58]);
    // Vorderschaft (beweglich) mit Rippen, Aktionsstangen und Verschluss
    const pump = grp(g, 'pump');
    const ribsPts = [[0.0, -0.0001]];
    for (let i = 0; i <= 14; i++) ribsPts.push([i % 2 ? 0.0205 : 0.0228, 0.012 + i * 0.0125]);
    ribsPts.unshift([0.019, 0.0]);
    ribsPts.push([0.019, 0.2]); ribsPts.push([0.0112, 0.201]);
    Pm.add(G.wood, T.wood, lathe([[0.0112, 0.0], ...ribsPts.slice(1)], 18), [0, 0.012, -0.23], null, [1, 1.18, 1]);
    for (const s of [-1, 1]) Pm.add(met, T.steel, box(0.003, 0.004, 0.17), [s * 0.0125, 0.004, -0.15]);
    Pm.add(met, T.chrome, rbox(0.012, 0.016, 0.05, 0.002), [0.011, 0.024, -0.09]);
    Pm.build(pump, 'pump');
    I.pump = pump; I.pumpTravel = 0.085;
    hand(pump, 'handL', [-0.045, -0.04, -0.33], [0.62, 0.45, -0.64], [-0.65, -0.74, -0.14]);
    P.build(g, 'body');
    I.loadPort = node(g, 'loadPort', 0, -0.025, -0.1);
    hand(g, 'shellGrab', [-0.03, -0.11, -0.05], [0.1, 0.8, -0.6], [-0.95, 0.15, 0.25]);
    I.muzzle.position.set(0, 0.03, -0.71);
    I.ejectPort.position.set(0.019, 0.025, -0.085);
    I.sightY = 0.045; I.adsZ = -0.11; I.hip = V(0.11, -0.13, -0.2);
    hand(g, 'handR', [0.022, -0.02, 0.09], [0.0, -0.5, -0.86], [0.95, 0.2, 0.15]);
    I.poseR = 'wrist'; I.poseL = 'forend'; I.reload = 'shells'; I.eject = 'shell'; I.flash = 1.35;
  },

  // AR-77: Sturmgewehr mit Tragegriff, Dreieckskorn, gerippter Handschutz
  ar(G, I, pap) {
    const g = I.group, met = pap ? G.pap : G.metal, pol = pap ? G.pap : G.poly, dk = G.poly;
    const P = new Parts(), H = new Parts(), Mg = new Parts(), Bo = new Parts();
    // Unteres Gehäuse mit Magazinschacht
    P.add(met, T.alu, side([[-0.075, 0.012], [0.142, 0.012], [0.142, -0.004], [0.128, -0.012], [0.128, -0.046], [0.04, -0.046], [0.04, -0.02], [-0.004, -0.02], [-0.04, -0.014], [-0.075, 0.0]], 0.024, 0.0022));
    P.add(met, T.alu, cylX(0.0045, 0.006, 10), [0.0135, -0.004, -0.024]);
    guard(P, met, T.alu, -0.002, 0.04, -0.02, -0.044, 0.012);
    trigger(P, met, 0.016, -0.02, 0.018);
    P.add(met, T.steel, rbox(0.004, 0.008, 0.014, 0.0015), [-0.0135, 0.0, 0.03]);
    pistolGrip(P, pol, T.black, -0.04, -0.004, -0.012, 0.09, 0.42, 0.027);
    // Oberes Gehäuse, Auswurffenster, Schließhilfe, Tragegriff
    P.add(met, T.alu, front([[-0.0125, 0.012], [0.0125, 0.012], [0.0125, 0.042], [0.0085, 0.05], [-0.0085, 0.05], [-0.0125, 0.042]], 0.225, 0.002), [0, 0, -0.035]);
    P.add(dk, T.hole, box(0.001, 0.016, 0.05), [0.0127, 0.029, -0.03]);
    P.add(met, T.alu, rbox(0.006, 0.01, 0.014, 0.002), [0.0138, 0.04, 0.008]);
    P.add(met, T.alu, cylZ(0.0062, 0.0062, 0.03, 12), [0.0155, 0.034, 0.05], [0, 0.35, 0]);
    P.add(met, T.alu, side([[-0.074, 0.05], [0.094, 0.05], [0.094, 0.058], [0.08, 0.071], ['q', 0.074, 0.082, 0.06, 0.082], [-0.06, 0.082], [-0.068, 0.078], [-0.074, 0.068]], 0.018, 0.0025,
      [[[-0.045, 0.055], [0.064, 0.055], ['q', 0.07, 0.055, 0.068, 0.061], [0.06, 0.069], [-0.04, 0.069], ['q', -0.045, 0.069, -0.045, 0.064]]]));
    P.add(met, T.alu, cylX(0.0085, 0.024, 16), [0, 0.072, 0.045]);
    for (const s of [-1, 1]) P.add(met, T.alu, rbox(0.004, 0.024, 0.014, 0.0012), [s * 0.0062, 0.091, 0.06]);
    aperture(P, met, T.alu, -0.06, 0.094, 0.018, 0.0024, 0.0085);
    // Handschutz mit Rippen und Lüftung, Delta-Ring
    P.add(pol, T.black, lathe([[0.0, 0.15], [0.026, 0.15], [0.0292, 0.156], [0.0285, 0.4], [0.026, 0.405], [0.0, 0.405]], 18), [0, 0.028, 0]);
    for (let i = 0; i < 12; i++) P.add(pol, T.black, ringZ(0.0286, 0.0016, 18, 4), [0, 0.028, -(0.168 + i * 0.02)]);
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) P.add(dk, T.hole, rbox(0.002, 0.006, 0.012, 0.001), [s * 0.0262, 0.036, -(0.18 + i * 0.038)], [0, 0, s * 0.35]);
    P.add(met, T.steel, lathe([[0.0, 0.14], [0.03, 0.14], [0.033, 0.146], [0.033, 0.153], [0.028, 0.158], [0.0, 0.158]], 18), [0, 0.028, 0]);
    // Lauf, Kornträger, Riemenbügel, Mündungsfeuerdämpfer
    P.add(met, T.steel, cylZ(0.0075, 0.0085, 0.15, 14), [0, 0.028, -0.478]);
    P.add(met, T.steel, side([[0.415, 0.016], [0.448, 0.016], [0.448, 0.04], [0.436, 0.074], [0.428, 0.074], [0.415, 0.042]], 0.013, 0.0018));
    P.add(met, T.steel, rbox(0.022, 0.024, 0.034, 0.003), [0, 0.026, -0.431]);
    postSight(P, met, T.steel, 0.432, 0.074, 0.094, 0.012);
    P.add(met, T.steel, ringZ(0.009, 0.0017, 12, 5), [0, 0.006, -0.44], [0, Math.PI / 2, 0]);
    P.add(met, T.steel, lathe([[0.0, 0.548], [0.0095, 0.548], [0.0105, 0.552], [0.0105, 0.6], [0.0092, 0.604], [0.0055, 0.604]], 16), [0, 0.028, 0]);
    for (let i = 0; i < 5; i++) { const a = Math.PI * (0.15 + i * 0.175); P.add(dk, T.hole, box(0.0022, 0.0012, 0.03), [Math.cos(a) * 0.0103, 0.028 + Math.sin(a) * 0.0103, -0.582], [0, 0, a]); }
    bore(P, dk, 0.604, 0.028, 0.0052);
    // Schulterstütze
    P.add(pol, T.black, side([[-0.07, 0.046], [-0.41, 0.046], ['q', -0.425, 0.046, -0.425, 0.035], [-0.425, -0.092], ['q', -0.425, -0.1, -0.41, -0.1], [-0.33, -0.088], [-0.19, -0.035], [-0.12, -0.012], [-0.07, -0.004]], 0.036, 0.006, null, 6));
    P.add(G.poly, T.rubber, side([[-0.425, 0.046], [-0.438, 0.046], [-0.438, -0.1], [-0.425, -0.1]], 0.038, 0.003));
    // Spannschieber (beweglich)
    const h = grp(g, 'handle');
    H.add(met, T.alu, rbox(0.008, 0.005, 0.03, 0.0015), [0, 0.052, 0.07]);
    H.add(met, T.alu, top([[-0.019, 0.0], [0.019, 0.0], [0.016, -0.009], [-0.016, -0.009]], 0.0055, 0.0012), [0, 0.052, 0.083]);
    H.build(h, 'handle');
    I.handle = h; I.handleTravel = V(0, 0, 0.06);
    hand(h, 'handleGrab', [-0.035, 0.12, 0.13], [0.35, -0.85, -0.4], [-0.3, 0.3, -0.9]);
    // Verschlussträger im Auswurffenster
    const bolt = grp(g, 'bolt');
    Bo.add(met, T.chrome, rbox(0.006, 0.012, 0.048, 0.002), [0.0098, 0.029, -0.03]);
    Bo.build(bolt, 'bolt');
    I.bolt = bolt;
    // Gebogenes 30-Schuss-Magazin
    const mag = grp(g, 'mag', 0, -0.012, -0.085);
    Mg.add(met, T.alu, side([[-0.031, 0.012], [0.031, 0.012], [0.031, -0.035], ['q', 0.035, -0.12, 0.062, -0.176], [0.003, -0.198], ['q', -0.025, -0.13, -0.031, -0.035]], 0.0215, 0.0022));
    Mg.add(met, T.alu, side([[0.0005, -0.196], [0.064, -0.174], [0.066, -0.18], [0.0015, -0.204]], 0.026, 0.0012));
    for (const s of [-1, 1]) Mg.add(met, T.alu, side([[-0.018, -0.02], [0.018, -0.02], ['q', 0.021, -0.1, 0.04, -0.15], [0.034, -0.153], ['q', 0.016, -0.1, -0.012, -0.02]], 0.002, 0.0006), [s * 0.0108, 0, 0]);
    Mg.add(met, T.brass, cylZ(0.0048, 0.0048, 0.035, 10), [0, 0.016, 0.004]);
    Mg.add(met, T.copper, lathe([[0.0032, 0], [0.0028, 0.006], [0.0012, 0.013], [0.0, 0.0145]], 10), [0, 0.016, -0.0135]);
    Mg.build(mag, 'mag');
    I.mag = mag;
    hand(mag, 'magGrab', [-0.012, -0.19, 0.075], [0.3, 0.85, -0.45], [-0.95, 0.2, 0.25]);
    P.build(g, 'body');
    I.muzzle.position.set(0, 0.028, -0.605);
    I.ejectPort.position.set(0.014, 0.03, -0.03);
    I.sightY = 0.094; I.adsZ = -0.13; I.hip = V(0.11, -0.135, -0.21);
    gripR(g, [0.012, -0.034, 0.088], 0.42, 0.18);
    hand(g, 'handL', [-0.05, -0.04, -0.27], [0.62, 0.45, -0.64], [-0.62, -0.77, -0.14]);
    I.poseR = 'pistol'; I.poseL = 'handguard'; I.reload = 'mag'; I.eject = 'rifle'; I.flash = 1;
  },

  // Hammer LMG: Trommel unter dem Gehäuse, Holzschaft und -griff, Zweibein
  lmg(G, I, pap) {
    const g = I.group, met = pap ? G.pap : G.metal, dk = pap ? G.poly : G.metal;
    const P = new Parts(), Cv = new Parts(), Mg = new Parts(), H = new Parts();
    P.add(met, T.steel, side([[-0.075, 0.05], [0.24, 0.05], [0.24, 0.0], [0.2, -0.016], [0.0, -0.016], [-0.03, -0.01], [-0.075, 0.01]], 0.05, 0.003));
    P.add(met, T.steel, rbox(0.046, 0.022, 0.07, 0.003), [0, 0.04, -0.21]);
    P.add(G.wood, T.wood, side([[-0.07, 0.035], [-0.43, 0.022], ['q', -0.445, -0.03, -0.43, -0.095], [-0.32, -0.08], [-0.15, -0.03], [-0.07, -0.012]], 0.042, 0.007, null, 6));
    P.add(met, T.steel, side([[-0.428, 0.023], [-0.438, 0.022], ['q', -0.452, -0.03, -0.438, -0.097], [-0.428, -0.095], ['q', -0.442, -0.03, -0.428, 0.023]], 0.04, 0.0015));
    pistolGrip(P, G.wood, T.wood, -0.035, 0.0, -0.014, 0.088, 0.33, 0.028);
    guard(P, met, T.steel, 0.0, 0.05, -0.016, -0.042, 0.011);
    trigger(P, met, 0.022, -0.016, 0.018);
    // Handschutz (Holz), Lauf, Gasrohr, Korn mit Tunnel, Mündung, Zweibein
    P.add(G.wood, T.wood, side([[0.24, 0.022], [0.43, 0.022], [0.43, -0.01], ['q', 0.425, -0.02, 0.41, -0.02], [0.26, -0.022], [0.24, -0.012]], 0.05, 0.007, null, 6));
    P.add(met, T.steel, cylZ(0.0108, 0.0118, 0.62, 16), [0, 0.032, -0.55]);
    P.add(met, T.steel, cylZ(0.0075, 0.0075, 0.22, 12), [0, 0.012, -0.53]);
    P.add(met, T.steel, rbox(0.022, 0.036, 0.024, 0.003), [0, 0.022, -0.64]);
    P.add(met, T.steel, lathe([[0.0, 0.79], [0.016, 0.79], [0.016, 0.812], [0.0, 0.812]], 16), [0, 0.032, 0]);
    P.add(met, T.steel, front([[-0.012, 0.0], [-0.012, 0.03], ['q', -0.012, 0.045, 0.0, 0.045], ['q', 0.012, 0.045, 0.012, 0.03], [0.012, 0.0], [0.009, 0.0], [0.009, 0.03], ['q', 0.009, 0.041, 0.0, 0.041], ['q', -0.009, 0.041, -0.009, 0.03], [-0.009, 0.0]], 0.016, 0.001), [0, 0.04, -0.8]);
    P.add(met, T.steel, rbox(0.0025, 0.016, 0.003, 0.0006), [0, 0.07, -0.8]);
    P.add(met, T.steel, lathe([[0.0, 0.84], [0.0118, 0.84], [0.0135, 0.846], [0.0135, 0.878], [0.012, 0.884], [0.006, 0.884]], 16), [0, 0.032, 0]);
    bore(P, dk, 0.884, 0.032, 0.006);
    for (const s of [-1, 1]) {
      P.add(met, T.steel, cylZ(0.0035, 0.0035, 0.27, 8), [s * 0.013, 0.012, -0.64]);
      P.add(met, T.steel, rbox(0.01, 0.004, 0.02, 0.0015), [s * 0.013, 0.012, -0.5]);
    }
    // Kimme (Visierklappe) auf dem Deckelende
    P.add(met, T.steel, rbox(0.03, 0.012, 0.04, 0.003), [0, 0.055, -0.225]);
    P.add(met, T.steel, front([[-0.012, 0.0], [0.012, 0.0], [0.012, 0.016], [0.0022, 0.016], [0.0022, 0.012], [-0.0022, 0.012], [-0.0022, 0.016], [-0.012, 0.016]], 0.004, 0.0006), [0, 0.06, -0.21]);
    // Deckel (beweglich, Scharnier vorn)
    const cover = grp(g, 'cover', 0, 0.05, -0.2);
    Cv.add(met, T.steel, side([[-0.2, 0.0], [0.0, 0.0], [0.0, 0.006], [-0.02, 0.016], [-0.18, 0.016], [-0.2, 0.012]], 0.048, 0.003), [0, 0, -0.2]);
    Cv.add(met, T.steel, cylX(0.004, 0.05, 10), [0, 0.004, 0.0]);
    Cv.add(met, T.steel, rbox(0.012, 0.008, 0.016, 0.002), [0.02, 0.012, 0.19]);
    Cv.build(cover, 'cover');
    I.cover = cover;
    hand(cover, 'coverGrab', [-0.02, 0.07, 0.25], [0.3, -0.7, -0.65], [-0.3, 0.6, -0.75]);
    // Ladehebel rechts
    const h = grp(g, 'handle');
    H.add(met, T.steel, rbox(0.02, 0.012, 0.014, 0.003), [0.033, 0.015, -0.17]);
    H.build(h, 'handle');
    I.handle = h; I.handleTravel = V(0, 0, 0.08);
    hand(h, 'handleGrab', [0.08, 0.035, -0.11], [-0.85, -0.2, -0.45], [0.3, 0.92, -0.2]);
    // Trommel mit Gurt (Magazin)
    const mag = grp(g, 'mag', 0, -0.016, -0.105);
    Mg.add(met, T.od, cylX(0.068, 0.056, 28), [0, -0.068, 0]);
    for (const s of [-1, 1]) Mg.add(met, T.od, ringZ(0.066, 0.0035, 28, 6), [s * 0.028, -0.068, 0], [0, Math.PI / 2, 0]);
    Mg.add(met, T.steel, rbox(0.06, 0.014, 0.03, 0.003), [0, -0.003, 0]);
    Mg.add(met, T.steel, cylX(0.012, 0.06, 12), [0, -0.068, 0]);
    Mg.add(met, T.steel, rbox(0.01, 0.02, 0.012, 0.002), [0.03, -0.11, -0.04]);
    for (let i = 0; i < 4; i++) {
      Mg.add(met, T.brass, cylX(0.0055, 0.04, 10), [-0.012, 0.004 + i * 0.012, 0.012 - i * 0.004], [0, 0, 0.5]);
      Mg.add(met, T.steel, box(0.006, 0.004, 0.012), [-0.03, 0.004 + i * 0.012, 0.012 - i * 0.004]);
    }
    Mg.build(mag, 'mag');
    I.mag = mag;
    hand(mag, 'magGrab', [-0.07, -0.08, 0.06], [0.75, 0.3, -0.6], [-0.6, -0.15, -0.78]);
    P.build(g, 'body');
    I.muzzle.position.set(0, 0.032, -0.885);
    I.ejectPort.position.set(0.0, -0.012, -0.08);
    I.sightY = 0.072; I.adsZ = -0.17; I.hip = V(0.12, -0.14, -0.22);
    gripR(g, [0.012, -0.034, 0.085], 0.33, 0.18);
    hand(g, 'handL', [-0.05, -0.04, -0.3], [0.62, 0.45, -0.64], [-0.62, -0.77, -0.14]);
    I.poseR = 'pistol'; I.poseL = 'handguard'; I.reload = 'lmg'; I.eject = 'rifle'; I.flash = 1.15;
  },

  // Falke .50: schweres Selbstladegewehr mit Pfeil-Mündungsbremse und großem Zielfernrohr
  sniper(G, I, pap) {
    const g = I.group, met = pap ? G.pap : G.metal, dk = pap ? G.poly : G.metal;
    const P = new Parts(), H = new Parts(), Mg = new Parts();
    // Oberes Gehäuse mit Kühlbohrungen
    P.add(met, T.steel, front([[-0.03, 0.0], [0.03, 0.0], [0.03, 0.05], ['q', 0.03, 0.058, 0.022, 0.058], [-0.022, 0.058], ['q', -0.03, 0.058, -0.03, 0.05]], 0.65, 0.003), [0, 0, -0.005]);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) P.add(dk, T.hole, cylX(0.011, 0.002, 16), [s * 0.0302, 0.028, -(0.15 + i * 0.045)]);
    P.add(dk, T.hole, box(0.001, 0.02, 0.06), [0.0302, 0.03, -0.0]);
    // Unteres Gehäuse mit Schaft, Wangenauflage, Schaftkappe
    P.add(met, T.steel, side([[0.12, 0.0], [-0.36, 0.0], [-0.36, -0.09], [-0.33, -0.09], [-0.2, -0.045], [-0.04, -0.04], [0.0, -0.032], [0.04, -0.036], [0.165, -0.036], [0.165, -0.01]], 0.05, 0.003));
    P.add(met, T.steel, side([[-0.12, 0.058], [-0.34, 0.058], [-0.36, 0.05], [-0.36, 0.0], [-0.12, 0.0]], 0.044, 0.004));
    P.add(G.poly, T.rubber, side([[-0.36, 0.06], [-0.39, 0.06], ['q', -0.395, -0.015, -0.39, -0.095], [-0.36, -0.095]], 0.05, 0.004));
    P.add(G.poly, T.black, rbox(0.03, 0.022, 0.14, 0.005), [0, 0.07, 0.25]);
    pistolGrip(P, G.poly, T.black, -0.036, 0.0, -0.034, 0.088, 0.3, 0.028);
    guard(P, met, T.steel, 0.0, 0.05, -0.036, -0.062, 0.012);
    trigger(P, met, 0.022, -0.036, 0.018);
    // Lauf (kanneliert), Zweibein, Mündungsbremse
    P.add(met, T.steel, cylZ(0.0145, 0.016, 0.5, 18), [0, 0.03, -0.575]);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; P.add(dk, T.dark, box(0.003, 0.0012, 0.36), [Math.cos(a) * 0.0145, 0.03 + Math.sin(a) * 0.0145, -0.56], [0, 0, a]); }
    P.add(met, T.steel, top([[-0.03, 0.82], [0.03, 0.82], [0.033, 0.875], [0.012, 0.925], [-0.012, 0.925], [-0.033, 0.875]], 0.042, 0.003), [0, 0.03, 0]);
    for (let i = 0; i < 2; i++) for (const s of [-1, 1]) P.add(dk, T.hole, box(0.002, 0.026, 0.016), [s * (0.031 - i * 0.004), 0.03, -(0.845 + i * 0.038)], [0, s * 0.35, 0]);
    bore(P, dk, 0.925, 0.03, 0.007);
    for (const s of [-1, 1]) P.add(met, T.steel, cylZ(0.006, 0.006, 0.3, 8), [s * 0.034, 0.012, -0.47]);
    P.add(met, T.steel, rbox(0.074, 0.014, 0.03, 0.003), [0, 0.012, -0.33]);
    // Zielfernrohr mit Montage
    P.add(met, T.dark, rail(0.36, 0.022, 0.008), [0, 0.058, -0.02]);
    for (const a of [-0.06, 0.1]) {
      P.add(met, T.dark, rbox(0.026, 0.026, 0.02, 0.003), [0, 0.078, -a]);
      P.add(met, T.dark, ringZ(0.0185, 0.004, 20, 6), [0, 0.105, -a]);
    }
    P.add(met, T.dark, cylZ(0.0165, 0.0165, 0.28, 20), [0, 0.105, -0.03]);
    P.add(met, T.dark, lathe([[0.0165, 0.17], [0.027, 0.205], [0.0275, 0.26], [0.025, 0.264], [0.022, 0.264]], 22), [0, 0.105, 0]);
    P.add(met, T.dark, lathe([[0.016, -0.11], [0.0215, -0.13], [0.0215, -0.175], [0.019, -0.178], [0.017, -0.178]], 22), [0, 0.105, 0]);
    P.add(met, T.dark, cylY(0.0115, 0.0115, 0.018, 16), [0, 0.128, -0.03]);
    P.add(met, T.dark, cylX(0.0105, 0.018, 16), [0.026, 0.105, -0.03]);
    P.add(G.lens, null, cylZ(0.022, 0.022, 0.002, 22), [0, 0.105, -0.262]);
    P.add(G.lens, null, cylZ(0.017, 0.017, 0.002, 20), [0, 0.105, 0.176]);
    // Ladehebel rechts
    const h = grp(g, 'handle');
    H.add(met, T.steel, rbox(0.016, 0.014, 0.024, 0.004), [0.04, 0.034, -0.1]);
    H.add(met, T.steel, rbox(0.012, 0.006, 0.01, 0.002), [0.034, 0.034, -0.1]);
    H.build(h, 'handle');
    I.handle = h; I.handleTravel = V(0, 0, 0.09);
    hand(h, 'handleGrab', [0.085, 0.05, -0.04], [-0.85, -0.2, -0.45], [0.3, 0.92, -0.2]);
    // Magazin (.50, 10 Schuss)
    const mag = grp(g, 'mag', 0, -0.03, -0.1);
    Mg.add(met, T.steel, side([[-0.055, 0.03], [0.055, 0.03], [0.055, -0.07], [0.05, -0.078], [-0.05, -0.078], [-0.055, -0.07]], 0.034, 0.003));
    Mg.add(met, T.steel, side([[-0.057, -0.074], [0.057, -0.074], [0.057, -0.084], [-0.057, -0.084]], 0.038, 0.002));
    Mg.add(met, T.brass, cylZ(0.0105, 0.0105, 0.07, 12), [0, 0.04, 0.012]);
    Mg.build(mag, 'mag');
    I.mag = mag;
    hand(mag, 'magGrab', [-0.02, -0.11, 0.07], [0.3, 0.85, -0.45], [-0.95, 0.2, 0.25]);
    P.build(g, 'body');
    I.muzzle.position.set(0, 0.03, -0.93);
    I.ejectPort.position.set(0.032, 0.03, 0.0);
    I.sightY = 0.105; I.adsZ = -0.2; I.hip = V(0.12, -0.15, -0.24);
    gripR(g, [0.012, -0.056, 0.085], 0.3, 0.18);
    hand(g, 'handL', [-0.052, -0.035, -0.2], [0.62, 0.45, -0.64], [-0.62, -0.77, -0.14]);
    I.poseR = 'pistol'; I.poseL = 'handguard'; I.reload = 'mag'; I.eject = 'big'; I.flash = 1.6;
  },

  // Strahlenkanone: rote Retro-Pistole, Chromlauf mit Leuchtringen, Flossen
  ray(G, I, pap) {
    const g = I.group, paint = pap ? G.pap : G.poly, met = G.metal;
    const glow = pap ? G.glowRed : G.glowGreen;
    const P = new Parts(), Mg = new Parts();
    const y0 = 0.035;
    P.add(paint, T.red, lathe([[0.0, -0.065], [0.018, -0.062], [0.032, -0.05], [0.041, -0.028], [0.044, 0.0], [0.043, 0.03], [0.038, 0.065], [0.028, 0.1], [0.02, 0.122], [0.0, 0.124]], 24), [0, y0, 0]);
    P.add(met, T.chrome, ringZ(0.0436, 0.003, 24, 6), [0, y0, 0.0]);
    P.add(met, T.chrome, ringZ(0.0385, 0.0025, 24, 6), [0, y0, -0.065]);
    P.add(met, T.chrome, lathe([[0.0, -0.075], [0.012, -0.072], [0.016, -0.064], [0.0, -0.06]], 14), [0, y0, 0]);
    // Lauf mit Käfig und Leuchtringen, Emitter
    P.add(met, T.chrome, cylZ(0.011, 0.013, 0.14, 16), [0, y0, -0.18]);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; P.add(met, T.chrome, cylZ(0.0018, 0.0018, 0.11, 6), [Math.cos(a) * 0.024, y0 + Math.sin(a) * 0.024, -0.185]); }
    P.add(met, T.chrome, lathe([[0.012, 0.238], [0.03, 0.262], [0.033, 0.27], [0.03, 0.274], [0.014, 0.27], [0.0, 0.268]], 20), [0, y0, 0]);
    for (let i = 0; i < 3; i++) P.add(glow, null, ringZ(0.0245 - i * 0.002, 0.0042, 22, 8), [0, y0, -(0.15 + i * 0.035)]);
    P.add(glow, null, sphere(0.011, 12, 10), [0, y0, -0.264]);
    // Flossen
    P.add(paint, T.red, side([[-0.045, 0.072], [0.07, 0.07], [0.03, 0.098], [-0.035, 0.106]], 0.0045, 0.0012));
    for (const s of [-1, 1]) P.add(paint, T.red, top([[0.0, -0.045], [0.0, 0.035], [s * 0.032, -0.03], [s * 0.034, -0.06]].map(([x, a]) => [x, a]), 0.004, 0.001), [s * 0.036, y0 + 0.008, 0], [0, 0, s * -0.5]);
    P.add(met, T.chrome, rbox(0.006, 0.01, 0.006, 0.0015), [0, 0.081, 0.035]);
    P.add(met, T.chrome, rbox(0.004, 0.006, 0.004, 0.001), [0, 0.098, -0.03]);
    // Griff, Bügel, Abzug
    P.add(met, T.chrome, side([[0.004, 0.0], [-0.032, 0.0], [-0.047, -0.094], ['q', -0.042, -0.106, -0.026, -0.105], [-0.012, -0.1], ['q', -0.012, -0.08, -0.004, -0.07], ['q', 0.0, -0.06, -0.006, -0.05], ['q', 0.002, -0.04, -0.002, -0.03], [0.004, 0.0]], 0.026, 0.006, null, 5));
    for (const s of [-1, 1]) P.add(paint, T.red, side([[-0.008, -0.012], [-0.028, -0.012], [-0.04, -0.088], [-0.022, -0.09]], 0.004, 0.0012), [s * 0.013, 0, 0]);
    guard(P, met, T.chrome, 0.0, 0.05, -0.0, -0.04, 0.008);
    trigger(P, met, 0.022, -0.002, 0.02);
    // Energiezelle (Magazin) oben links
    P.add(met, T.chrome, rbox(0.012, 0.012, 0.06, 0.003), [-0.034, 0.062, 0.0]);
    const mag = grp(g, 'mag', -0.036, 0.072, 0.0);
    Mg.add(glow, null, cylZ(0.0075, 0.0075, 0.042, 12), [0, 0, 0]);
    Mg.add(met, T.chrome, cylZ(0.0095, 0.0095, 0.008, 12), [0, 0, -0.025]);
    Mg.add(met, T.chrome, cylZ(0.0095, 0.0095, 0.008, 12), [0, 0, 0.025]);
    Mg.build(mag, 'mag');
    I.mag = mag;
    hand(mag, 'magGrab', [-0.07, 0.03, 0.06], [0.75, 0.3, -0.6], [-0.6, 0.7, -0.4]);
    P.build(g, 'body');
    I.muzzle.position.set(0, y0, -0.275);
    I.ejectPort.position.set(0, 0.05, 0.0);
    I.sightY = 0.088; I.adsZ = -0.2; I.hip = V(0.1, -0.12, -0.25);
    gripR(g, [0.012, -0.012, 0.085], 0.28, 0.2);
    hand(g, 'handL', [-0.03, -0.075, 0.05], [0.42, 0.2, -0.88], [-0.75, -0.55, 0.1]);
    I.poseR = 'pistol'; I.poseL = 'support'; I.reload = 'cell'; I.eject = null; I.flash = 0;
    I.glow = glow;
  },

  // Gewitter-Werfer: Holzgriff, Glasröhre mit Kern, Kupferspulen, zwei Elektroden
  tesla(G, I, pap) {
    const g = I.group, met = pap ? G.pap : G.metal, cu = G.metal;
    const core = pap ? G.glowViolet : G.glowBlue;
    const P = new Parts(), Mg = new Parts(), Gl = new Parts(), Cr = new Parts();
    // Griff und kurzer Schaft (Holz)
    P.add(G.wood, T.wood, side([[0.008, 0.0], [-0.03, 0.0], [-0.05, -0.096], ['q', -0.046, -0.108, -0.03, -0.106], [-0.012, -0.1], [0.008, -0.012]], 0.03, 0.006, null, 5));
    P.add(G.wood, T.wood, side([[-0.03, 0.03], [-0.2, 0.025], ['q', -0.215, -0.01, -0.2, -0.05], [-0.06, -0.03], [-0.03, -0.01]], 0.03, 0.006, null, 5));
    // Rahmen mit Messingblenden
    P.add(met, T.steel, side([[-0.06, 0.05], [0.2, 0.05], ['q', 0.215, 0.05, 0.215, 0.03], [0.215, -0.01], [0.2, -0.018], [0.05, -0.018], [-0.06, -0.006]], 0.046, 0.004));
    for (const s of [-1, 1]) P.add(cu, T.brass, side([[-0.04, 0.04], [0.18, 0.04], [0.18, -0.006], [-0.04, -0.002]], 0.002, 0.0006), [s * 0.0235, 0, 0]);
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) P.add(cu, T.copper, sphere(0.0022, 6, 5), [s * 0.025, 0.035, -(-0.03 + i * 0.05)]);
    guard(P, met, T.steel, 0.0, 0.05, -0.018, -0.044, 0.01);
    trigger(P, cu, 0.024, -0.018, 0.018);
    // Glasröhre mit Endkappen und Kern
    Gl.add(G.glass, null, cylZ(0.03, 0.03, 0.24, 20, true), [0, 0.088, -0.07]);
    for (const a of [-0.055, 0.195]) P.add(cu, T.brass, lathe([[0.0, -0.012], [0.033, -0.012], [0.035, -0.006], [0.035, 0.006], [0.033, 0.012], [0.0, 0.012]], 20), [0, 0.088, -a]);
    P.add(core, null, cylZ(0.0045, 0.0045, 0.24, 8), [0, 0.088, -0.07]);
    P.add(core, null, helixZ(0.011, 0.0013, 7, 0.22, 120), [0, 0.088, -0.07]);
    for (let i = 0; i < 4; i++) P.add(cu, T.copper, ringZ(0.031, 0.0035, 22, 6), [0, 0.088, -(0.0 + i * 0.045)]);
    P.add(met, T.steel, rbox(0.018, 0.02, 0.18, 0.003), [0, 0.06, -0.07]);
    // Elektroden mit Spulen, Isolatoren und glühenden Spitzen
    for (const s of [-1, 1]) {
      P.add(cu, T.chrome, cylZ(0.0055, 0.0065, 0.16, 12), [s * 0.022, 0.014, -0.29]);
      P.add(G.poly, T.cream, lathe([[0.0, 0.205], [0.011, 0.205], [0.012, 0.212], [0.009, 0.218], [0.011, 0.224], [0.008, 0.232], [0.0, 0.232]], 12), [s * 0.022, 0.014, 0]);
      P.add(cu, T.copper, helixZ(0.0095, 0.0016, 10, 0.08, 120), [s * 0.022, 0.014, -0.28]);
      P.add(core, null, sphere(0.0085, 12, 10), [s * 0.022, 0.014, -0.372]);
    }
    // Manometer links, Kurbel rechts, Visier
    P.add(cu, T.brass, cylX(0.017, 0.008, 18), [-0.027, 0.03, -0.02]);
    P.add(G.poly, T.cream, cylX(0.014, 0.002, 18), [-0.0315, 0.03, -0.02]);
    P.add(G.poly, T.black, box(0.001, 0.012, 0.0015), [-0.033, 0.034, -0.02], [0.5, 0, 0]);
    P.add(met, T.steel, cylX(0.006, 0.02, 10), [0.033, 0.02, -0.09]);
    P.add(met, T.steel, rbox(0.006, 0.03, 0.006, 0.002), [0.043, 0.008, -0.09]);
    P.add(G.wood, T.wood, cylX(0.005, 0.018, 8), [0.052, -0.004, -0.09]);
    P.add(cu, T.brass, front([[-0.008, 0.0], [0.008, 0.0], [0.008, 0.012], [0.002, 0.012], [0.002, 0.007], [-0.002, 0.007], [-0.002, 0.012], [-0.008, 0.012]], 0.005, 0.0008), [0, 0.118, 0.04]);
    P.add(cu, T.brass, rbox(0.003, 0.012, 0.005, 0.001), [0, 0.124, -0.18]);
    // Energiezelle unten (Magazin)
    const mag = grp(g, 'mag', 0, -0.035, -0.12);
    Mg.add(cu, T.copper, cylZ(0.02, 0.02, 0.07, 18), [0, 0, 0]);
    for (const a of [-0.028, 0.0, 0.028]) Mg.add(core, null, ringZ(0.0205, 0.0022, 18, 5), [0, 0, a]);
    Mg.add(cu, T.brass, cylZ(0.012, 0.012, 0.012, 12), [0, 0, -0.04]);
    Mg.build(mag, 'mag');
    I.mag = mag;
    hand(mag, 'magGrab', [-0.035, -0.06, 0.06], [0.45, 0.6, -0.65], [-0.85, 0.2, -0.45]);
    Gl.build(g, 'glass');
    P.build(g, 'body');
    I.core = core;
    I.muzzle.position.set(0, 0.014, -0.375);
    I.ejectPort.position.set(0, 0.05, 0.0);
    I.sightY = 0.124; I.adsZ = -0.17; I.hip = V(0.11, -0.13, -0.24);
    gripR(g, [0.012, -0.012, 0.085], 0.33, 0.2);
    hand(g, 'handL', [-0.048, -0.06, -0.14], [0.62, 0.45, -0.64], [-0.62, -0.77, -0.14]);
    I.poseR = 'pistol'; I.poseL = 'handguard'; I.reload = 'cell'; I.eject = null; I.flash = 0;
  },
};

// ── Aufbau & Cache ────────────────────────────────────────────
// Ein Prototyp je Waffe (und PaP-Variante); weitere Aufrufe klonen die Gruppe
// und teilen Geometrien/Materialien.
const PROTO = new Map();
const REFS = ['muzzle', 'ejectPort', 'mag', 'slide', 'pump', 'breakPart', 'handle', 'bolt', 'cover', 'chamber', 'loadPort'];
const ANCHORS = ['handR', 'handL', 'magGrab', 'handleGrab', 'slideGrab', 'coverGrab', 'shellGrab'];

function buildProto(id, M, pap) {
  const G = gunMats(M);
  G.pap = M.papGun;
  const I = makeInfo(id, pap);
  (BUILDERS[id] || BUILDERS.p45)(G, I, pap);
  const g = I.group;
  g.updateMatrixWorld(true);
  I.back = new THREE.Box3().setFromObject(g).max.z;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return I;
}

export function buildGun(id, M, pap = false) {
  const key = id + (pap ? '_pap' : '');
  let proto = PROTO.get(key);
  if (!proto) { proto = buildProto(id, M, pap); PROTO.set(key, proto); }
  const group = proto.group.clone(true);
  const info = { ...proto, group };
  for (const k of [...REFS, ...ANCHORS]) info[k] = proto[k] ? group.getObjectByName(k) || null : null;
  for (const k of ANCHORS) if (!info[k]) info[k] = group.getObjectByName(k) || null;
  info.hip = proto.hip.clone();
  if (info.mag) { info.magHome = info.mag.position.clone(); info.magRot = info.mag.rotation.clone(); }
  if (info.pump) info.pumpHome = info.pump.position.clone();
  if (info.slide) info.slideHome = info.slide.position.clone();
  if (info.handle) info.handleHome = info.handle.position.clone();
  if (info.handR) info.gripR = info.handR.position.clone();
  if (info.handL) info.gripL = info.handL.getWorldPosition(new THREE.Vector3());
  return info;
}

// ── Messer ────────────────────────────────────────────────────
// Klinge entlang -z, Schneide unten (-y), Griff hinten (+z)
export function buildKnife(M, big = false) {
  const G = gunMats(M);
  const P = new Parts();
  const g = new THREE.Group();
  if (!big) {
    P.add(G.metal, T.steel, side([[0.0, -0.011], [0.118, -0.011], ['q', 0.158, -0.008, 0.176, 0.005], [0.15, 0.007], ['q', 0.13, 0.009, 0.118, 0.011], [0.0, 0.011]], 0.0042, 0.0012, null, 6));
    P.add(G.metal, T.chrome, side([[0.004, -0.011], [0.118, -0.011], ['q', 0.158, -0.008, 0.176, 0.005], [0.17, 0.0], ['q', 0.15, -0.006, 0.118, -0.0075], [0.004, -0.0075]], 0.0046, 0.0004, null, 6));
    P.add(G.metal, T.dark, rbox(0.012, 0.044, 0.006, 0.002), [0, -0.002, 0.003]);
    const pts = [[0.0, 0.006]];
    for (let i = 0; i <= 10; i++) pts.push([i % 2 ? 0.0118 : 0.0128, 0.008 + i * 0.0095]);
    pts.push([0.0135, 0.11], [0.0135, 0.118], [0.0, 0.12]);
    P.add(G.poly, T.black, lathe(pts.map(([r, a]) => [r, -a]).reverse(), 12), null, null, [1, 1.3, 1]);
    P.add(G.metal, T.steel, lathe([[0.0, -0.13], [0.012, -0.13], [0.0145, -0.124], [0.0145, -0.118], [0.0, -0.118]].map(([r, a]) => [r, a]).reverse(), 12), null, null, [1, 1.25, 1]);
  } else {
    // Jagdmesser (Bowie): lange Klinge mit Rückenschliff, Messing-Parierstange, Lederscheiben-Griff
    P.add(G.metal, T.steel, side([[0.0, -0.016], [0.17, -0.016], ['q', 0.235, -0.012, 0.262, 0.008], [0.205, 0.006], ['q', 0.185, 0.014, 0.16, 0.016], [0.0, 0.016]], 0.005, 0.0014, null, 6));
    P.add(G.metal, T.chrome, side([[0.004, -0.016], [0.17, -0.016], ['q', 0.235, -0.012, 0.262, 0.008], [0.255, 0.0], ['q', 0.22, -0.01, 0.17, -0.011], [0.004, -0.011]], 0.0054, 0.0004, null, 6));
    P.add(G.metal, T.chrome, side([[0.16, 0.0158], [0.205, 0.0058], [0.2, 0.0045], [0.16, 0.0145]], 0.0058, 0.0003));
    P.add(G.metal, T.brass, side([[-0.004, -0.03], [0.006, -0.028], [0.006, 0.026], ['q', 0.012, 0.032, 0.006, 0.036], [-0.004, 0.03]], 0.014, 0.002));
    const pts = [];
    for (let i = 0; i <= 12; i++) pts.push([i % 2 ? 0.0135 : 0.0145, 0.008 + i * 0.0095]);
    pts.unshift([0.0, 0.006]); pts.push([0.015, 0.13], [0.0, 0.132]);
    P.add(G.wood, T.wood, lathe(pts.map(([r, a]) => [r, -a]).reverse(), 12), null, null, [1, 1.35, 1]);
    P.add(G.metal, T.brass, lathe([[0.0, -0.145], [0.012, -0.145], [0.016, -0.136], [0.016, -0.13], [0.0, -0.13]].reverse(), 12), null, null, [1, 1.3, 1]);
  }
  P.build(g, 'knife');
  g.userData.tip = big ? 0.26 : 0.175;
  return g;
}

// ── Granate (M67-artig) ──────────────────────────────────────
export function buildGrenade(M) {
  const G = gunMats(M);
  const P = new Parts(), R = new Parts();
  const g = new THREE.Group();
  P.add(G.poly, T.od, sphere(0.032, 16, 12), [0, 0, 0], null, [1, 1.08, 1]);
  P.add(G.poly, T.od, ringZ(0.0322, 0.0015, 20, 4), [0, 0, 0], [Math.PI / 2, 0, 0]);
  P.add(G.metal, T.steel, cylY(0.011, 0.013, 0.02, 12), [0, 0.04, 0]);
  P.add(G.metal, T.steel, cylY(0.008, 0.008, 0.008, 10), [0, 0.053, 0]);
  P.add(G.metal, T.steel, side([[-0.004, 0.056], [0.008, 0.056], [0.016, 0.05], ['q', 0.034, 0.036, 0.036, 0.0], [0.031, -0.012], [0.03, 0.0], ['q', 0.029, 0.03, 0.012, 0.048], [-0.004, 0.05]].map(([a, y]) => [a, y]), 0.012, 0.0012), [0, 0, 0], [0, -Math.PI / 2, 0]);
  P.build(g, 'nade');
  const pin = new THREE.Group(); pin.name = 'pin';
  R.add(G.metal, T.chrome, ringZ(0.012, 0.0014, 16, 5), [0, 0, 0], [0, Math.PI / 2, 0]);
  R.add(G.metal, T.chrome, cylX(0.0012, 0.022, 6), [0.0, 0.012, 0]);
  R.build(pin, 'pin');
  pin.position.set(-0.012, 0.046, 0.0);
  g.add(pin);
  g.userData.pin = pin;
  return g;
}

// ── Schrotpatrone (Hand) ─────────────────────────────────────
export function buildShell(M) {
  const G = gunMats(M);
  const P = new Parts();
  const g = new THREE.Group();
  P.add(G.poly, T.red, cylZ(0.0104, 0.0104, 0.058, 14), [0, 0, -0.029 - 0.004]);
  P.add(G.metal, T.brass, lathe([[0.0, -0.0015], [0.0118, -0.0015], [0.0118, 0.0005], [0.0108, 0.001], [0.0108, 0.014], [0.0, 0.014]], 16));
  P.add(G.poly, T.red, cylZ(0.0095, 0.0095, 0.001, 12), [0, 0, -0.0625]);
  P.build(g, 'shell');
  return g;
}

// ── Perk-Flasche ─────────────────────────────────────────────
// Getöntes Glas, Etikett, Flüssigkeit (sinkt beim Trinken), Kronkorken
export function buildBottle(color) {
  const g = new THREE.Group();
  const c = new THREE.Color(color);
  const perk = Object.values(PERKS).find((p) => new THREE.Color(p.color).getHex() === c.getHex());
  const prof = [[0.0, 0.0], [0.028, 0.0], [0.031, 0.004], [0.032, 0.012], [0.032, 0.105], [0.03, 0.118], [0.022, 0.135], [0.014, 0.152], [0.0115, 0.17], [0.0125, 0.176], [0.0125, 0.181], [0.011, 0.183]];
  const glassGeo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 22);
  const glass = new THREE.Mesh(glassGeo, new THREE.MeshStandardMaterial({ color: c.clone().lerp(new THREE.Color(0x3a2a18), 0.35), roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.5, envMapIntensity: 2.2, depthWrite: false }));
  glass.renderOrder = 2;
  const liqGeo = new THREE.LatheGeometry([[0.0, 0.0], [0.0285, 0.0], [0.0295, 0.004], [0.0295, 1.0], [0.0, 1.0]].map(([r, y]) => new THREE.Vector2(r, y)), 18);
  const liquid = new THREE.Mesh(liqGeo, new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.5), emissive: c, emissiveIntensity: 0.5, roughness: 0.2 }));
  liquid.position.y = 0.004; liquid.scale.y = 0.11;
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0325, 0.0325, 0.052, 22, 1, true), new THREE.MeshStandardMaterial({ map: bottleLabel(c.getHex(), perk ? perk.glyph : '✦', perk ? perk.name : ''), roughness: 0.75 }));
  label.position.y = 0.06;
  const cap = new THREE.Group();
  const capMat = new THREE.MeshStandardMaterial({ color: 0xb8a060, roughness: 0.35, metalness: 0.85 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.0128, 0.0138, 0.007, 18), capMat);
  cap.add(disc);
  cap.position.y = 0.184;
  g.add(liquid, label, glass, cap);
  g.userData = { cap, liquid, glass };
  return g;
}

// Prozedurale Waffenmodelle für Viewmodel und Mystery-Kiste.
// Konvention: Lauf zeigt nach -z, Ursprung am Griff, Visierlinie bei y = sightY.
import * as THREE from 'three';

export function buildGun(id, M, pap = false) {
  const g = new THREE.Group();
  const metal = pap ? M.papGun : M.gunMetal;
  const poly = M.gunPolymer, wood = M.gunWood, dark = M.dark;
  const glow = new THREE.MeshBasicMaterial({ color: pap ? new THREE.Color(1.8, 0.2, 0.4) : new THREE.Color(0.25, 1.8, 0.4) });
  const B = (w, h, d, mat, x, y, z, rx = 0, parent = g) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.x = rx; parent.add(m); return m;
  };
  const Cy = (r, len, mat, x, y, z, parent = g, seg = 14) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
    m.rotation.x = Math.PI / 2; m.position.set(x, y, z); parent.add(m); return m;
  };
  const info = { group: g, mag: null, pump: null, breakPart: null, sightY: 0.07, gripR: new THREE.Vector3(0, -0.06, 0.06), gripL: new THREE.Vector3(0, -0.03, -0.28), muzzle: new THREE.Object3D(), adsZ: -0.3 };

  switch (id) {
    case 'p45': {
      const slide = B(0.034, 0.034, 0.2, metal, 0, 0.032, -0.07);
      B(0.03, 0.024, 0.17, metal, 0, 0.004, -0.06);
      B(0.032, 0.12, 0.052, pap ? M.paintRed : wood, 0, -0.055, 0.025, -0.25);
      Cy(0.009, 0.02, dark, 0, 0.032, -0.172);
      B(0.006, 0.01, 0.008, metal, 0, 0.054, -0.16);
      B(0.022, 0.01, 0.008, metal, 0, 0.054, 0.02);
      B(0.005, 0.022, 0.006, metal, 0, -0.016, -0.035);
      B(0.012, 0.02, 0.012, metal, 0, 0.045, 0.035);
      info.mag = B(0.024, 0.1, 0.036, metal, 0, -0.06, 0.025, -0.25);
      info.slide = slide;
      info.muzzle.position.set(0, 0.032, -0.19);
      info.sightY = 0.059; info.gripR.set(0, -0.06, 0.035); info.gripL.set(-0.02, -0.075, 0.025); info.adsZ = -0.34;
      break;
    }
    case 'k14': {
      B(0.05, 0.07, 0.75, wood, 0, -0.01, -0.05);
      B(0.045, 0.12, 0.26, wood, 0, -0.045, 0.3, 0.12);
      B(0.046, 0.05, 0.26, metal, 0, 0.03, -0.05);
      Cy(0.012, 0.45, metal, 0, 0.038, -0.55);
      Cy(0.008, 0.3, metal, 0, 0.012, -0.5);
      info.mag = B(0.036, 0.13, 0.065, metal, 0, -0.08, -0.07, 0.15);
      B(0.006, 0.035, 0.006, metal, 0, 0.065, -0.74);
      B(0.022, 0.022, 0.01, metal, 0, 0.068, 0.05);
      info.muzzle.position.set(0, 0.038, -0.78);
      info.sightY = 0.076; info.gripR.set(0, -0.06, 0.12); info.gripL.set(0, -0.03, -0.32);
      break;
    }
    case 'dlf': {
      B(0.06, 0.065, 0.13, metal, 0, 0.02, -0.06);
      B(0.05, 0.09, 0.36, wood, 0, -0.03, 0.18, 0.12);
      const br = new THREE.Group(); br.position.set(0, 0.03, -0.12); g.add(br);
      Cy(0.017, 0.6, metal, -0.018, 0, -0.3, br); Cy(0.017, 0.6, metal, 0.018, 0, -0.3, br);
      B(0.012, 0.008, 0.6, metal, 0, 0.022, -0.3, 0, br);
      B(0.05, 0.04, 0.26, wood, 0, -0.03, -0.18, 0, br);
      B(0.008, 0.008, 0.008, M.chrome, 0, 0.03, -0.58, 0, br);
      info.breakPart = br;
      info.muzzle.position.set(0, 0.03, -0.74);
      info.sightY = 0.064; info.gripR.set(0, -0.06, 0.1); info.gripL.set(0, -0.03, -0.28);
      break;
    }
    case 'vmp': {
      B(0.05, 0.075, 0.3, poly, 0, 0.022, -0.06);
      Cy(0.02, 0.18, metal, 0, 0.03, -0.29);
      info.mag = B(0.03, 0.2, 0.045, metal, 0, -0.11, -0.09, 0.06);
      B(0.036, 0.1, 0.046, poly, 0, -0.06, 0.07, -0.2);
      B(0.02, 0.04, 0.22, metal, 0, 0.0, 0.2);
      B(0.022, 0.012, 0.22, metal, 0, 0.066, -0.06);
      B(0.006, 0.026, 0.006, metal, 0, 0.083, -0.16);
      B(0.022, 0.02, 0.01, metal, 0, 0.081, 0.04);
      info.muzzle.position.set(0, 0.03, -0.39);
      info.sightY = 0.09; info.gripR.set(0, -0.065, 0.07); info.gripL.set(0, -0.15, -0.09); info.adsZ = -0.27;
      break;
    }
    case 'pump': {
      B(0.05, 0.07, 0.22, metal, 0, 0.02, -0.03);
      Cy(0.015, 0.56, metal, 0, 0.042, -0.42);
      Cy(0.014, 0.45, metal, 0, 0.006, -0.37);
      info.pump = B(0.058, 0.052, 0.2, wood, 0, 0.006, -0.3);
      B(0.05, 0.1, 0.34, wood, 0, -0.035, 0.24, 0.12);
      B(0.008, 0.008, 0.008, M.chrome, 0, 0.062, -0.68);
      info.muzzle.position.set(0, 0.042, -0.71);
      info.sightY = 0.066; info.gripR.set(0, -0.05, 0.1); info.gripL.set(0, -0.03, -0.3);
      break;
    }
    case 'ar': {
      B(0.05, 0.08, 0.32, metal, 0, 0.02, -0.05);
      B(0.062, 0.062, 0.28, poly, 0, 0.026, -0.34);
      Cy(0.011, 0.2, metal, 0, 0.032, -0.56);
      B(0.016, 0.045, 0.13, metal, 0, 0.083, 0.01);
      B(0.01, 0.065, 0.012, metal, 0, 0.08, -0.43);
      info.mag = B(0.03, 0.19, 0.062, metal, 0, -0.1, -0.07, 0.28);
      B(0.036, 0.1, 0.046, poly, 0, -0.06, 0.07, -0.25);
      B(0.042, 0.085, 0.26, poly, 0, 0.0, 0.26);
      info.muzzle.position.set(0, 0.032, -0.67);
      info.sightY = 0.106; info.gripR.set(0, -0.065, 0.075); info.gripL.set(0, -0.02, -0.32); info.adsZ = -0.27;
      break;
    }
    case 'lmg': {
      B(0.08, 0.1, 0.36, metal, 0, 0.02, -0.05);
      Cy(0.016, 0.56, metal, 0, 0.032, -0.5);
      Cy(0.03, 0.3, M.rust, 0, 0.032, -0.38);
      info.mag = B(0.11, 0.12, 0.13, M.paintGreen, -0.02, -0.09, -0.05);
      B(0.016, 0.05, 0.13, metal, 0.05, 0.06, -0.26);
      B(0.05, 0.11, 0.3, poly, 0, 0.0, 0.28);
      B(0.036, 0.1, 0.046, poly, 0, -0.07, 0.08, -0.25);
      B(0.03, 0.02, 0.12, metal, 0, 0.08, 0.0);
      B(0.008, 0.04, 0.008, metal, 0, 0.09, -0.7);
      info.muzzle.position.set(0, 0.032, -0.79);
      info.sightY = 0.104; info.gripR.set(0, -0.07, 0.09); info.gripL.set(0, -0.035, -0.26); info.adsZ = -0.26;
      break;
    }
    case 'sniper': {
      B(0.05, 0.07, 0.36, metal, 0, 0.02, -0.05);
      Cy(0.013, 0.6, metal, 0, 0.032, -0.53);
      Cy(0.024, 0.32, dark, 0, 0.1, -0.06);
      Cy(0.03, 0.05, dark, 0, 0.1, -0.21); Cy(0.028, 0.05, dark, 0, 0.1, 0.09);
      B(0.012, 0.04, 0.02, metal, 0, 0.065, -0.12); B(0.012, 0.04, 0.02, metal, 0, 0.065, 0.02);
      const bolt = Cy(0.006, 0.07, M.chrome, 0.045, 0.035, 0.05); bolt.rotation.set(0, 0, Math.PI / 2);
      B(0.05, 0.1, 0.42, wood, 0, -0.015, 0.25, 0.06);
      info.mag = B(0.036, 0.06, 0.08, metal, 0, -0.04, -0.05);
      info.muzzle.position.set(0, 0.032, -0.84);
      info.sightY = 0.1; info.gripR.set(0, -0.05, 0.13); info.gripL.set(0, -0.02, -0.3);
      break;
    }
    case 'ray': {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 14), pap ? M.papGun : M.paintRed);
      body.scale.set(1, 1, 1.7); body.position.set(0, 0.03, -0.06); g.add(body);
      Cy(0.02, 0.26, M.chrome, 0, 0.03, -0.22);
      for (let i = 0; i < 3; i++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.032 - i * 0.004, 0.008, 8, 20), glow);
        t.position.set(0, 0.03, -0.15 - i * 0.07); g.add(t);
      }
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), glow); tip.position.set(0, 0.03, -0.36); g.add(tip);
      B(0.008, 0.06, 0.12, M.chrome, 0, 0.1, -0.05);
      B(0.034, 0.11, 0.045, M.chrome, 0, -0.06, 0.04, -0.25);
      info.mag = B(0.03, 0.04, 0.05, glow, 0, -0.01, 0.06);
      info.muzzle.position.set(0, 0.03, -0.38);
      info.sightY = 0.12; info.gripR.set(0, -0.06, 0.045); info.gripL.set(-0.01, -0.03, -0.15); info.adsZ = -0.33;
      break;
    }
    case 'tesla': {
      // Gewitter-Werfer: Holzgriff, Kupferspulen, Glasröhre, zwei Elektroden
      const copper = M.copper || (M.copper = new THREE.MeshStandardMaterial({ color: 0xb8673a, roughness: 0.35, metalness: 0.9 }));
      const core = new THREE.MeshBasicMaterial({ color: pap ? new THREE.Color(1.5, 0.4, 1.9) : new THREE.Color(0.35, 0.9, 1.9) });
      B(0.05, 0.13, 0.07, wood, 0, -0.06, 0.05, -0.28);
      B(0.07, 0.07, 0.3, pap ? M.papGun : M.gunMetal, 0, 0.02, -0.05);
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.28, 14), new THREE.MeshStandardMaterial({ color: 0x6f98b8, transparent: true, opacity: 0.22, roughness: 0.05, depthWrite: false }));
      tube.rotation.x = Math.PI / 2; tube.position.set(0, 0.075, -0.1); g.add(tube);
      Cy(0.01, 0.27, core, 0, 0.075, -0.1);
      for (let i = 0; i < 5; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.009, 6, 16), copper); t.position.set(0, 0.075, -0.2 + i * 0.05); g.add(t); }
      for (const x of [-0.025, 0.025]) { Cy(0.008, 0.16, M.chrome, x, 0.02, -0.28); const tip = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), core); tip.position.set(x, 0.02, -0.36); g.add(tip); }
      B(0.02, 0.03, 0.08, M.chrome, 0, 0.12, 0.0);
      info.mag = B(0.045, 0.05, 0.06, copper, 0, -0.035, -0.12);
      info.core = core;
      info.muzzle.position.set(0, 0.02, -0.37);
      info.sightY = 0.13; info.gripR.set(0, -0.07, 0.05); info.gripL.set(0, -0.02, -0.2); info.adsZ = -0.3;
      break;
    }
  }
  g.add(info.muzzle);
  g.updateMatrixWorld(true);
  info.back = new THREE.Box3().setFromObject(g).max.z; // wie weit der Schaft Richtung Kamera reicht
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  if (info.mag) info.magHome = info.mag.position.clone();
  if (info.pump) info.pumpHome = info.pump.position.clone();
  return info;
}

// Arme/Handschuhe zum Viewmodel
export function buildArms(info, M) {
  const g = new THREE.Group();
  const limb = (a, b, r, mat) => {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, len, 12), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
    g.add(m);
  };
  const hand = (p, mat, rx = 0) => {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.085, 0.09), mat);
    h.position.copy(p); h.rotation.x = rx; g.add(h);
    const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.05), mat);
    fingers.position.copy(p).add(new THREE.Vector3(0.02, -0.03, -0.04)); g.add(fingers);
  };
  const R = info.gripR, L = info.gripL;
  const rElbow = new THREE.Vector3(R.x + 0.1, R.y - 0.18, R.z + 0.2);
  const rShoulder = new THREE.Vector3(R.x + 0.18, R.y - 0.35, R.z + 0.55);
  limb(R, rElbow, 0.036, M.glove);
  limb(rElbow, rShoulder, 0.05, M.sleeve);
  hand(R, M.glove, -0.2);
  const lElbow = new THREE.Vector3(L.x - 0.14, L.y - 0.16, L.z + 0.18);
  const lShoulder = new THREE.Vector3(L.x - 0.32, L.y - 0.32, L.z + 0.5);
  limb(L, lElbow, 0.036, M.glove);
  limb(lElbow, lShoulder, 0.05, M.sleeve);
  hand(L, M.glove, 0.2);
  return g;
}

export function buildKnife(M, big = false) {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.007, big ? 0.045 : 0.03, big ? 0.3 : 0.2), M.chrome);
  blade.position.z = big ? -0.17 : -0.12; g.add(blade);
  if (big) { const back = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 0.22), M.gunMetal); back.position.set(0, 0.024, -0.14); g.add(back); }
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.03, 0.1), M.dark);
  handle.position.z = 0.02; g.add(handle);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.008), M.metal);
  guard.position.z = -0.025; g.add(guard);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.085, 0.09), M.glove);
  hand.position.set(0, -0.01, 0.03); g.add(hand);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.4, 10), M.sleeve);
  arm.rotation.x = Math.PI / 2; arm.position.set(0.02, -0.02, 0.27); g.add(arm);
  return g;
}

export function buildGrenade(M) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), M.paintGreen);
  body.scale.set(1, 1.25, 1); g.add(body);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.025, 8), M.metal);
  top.position.y = 0.05; g.add(top);
  const spoon = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.06, 0.004), M.metal);
  spoon.position.set(0.022, 0.03, 0); spoon.rotation.z = -0.3; g.add(spoon);
  return g;
}

export function buildBottle(color) {
  const g = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color, roughness: 0.15, metalness: 0.1, emissive: color, emissiveIntensity: 0.08 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.13, 16), glass);
  g.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.033, 0.07, 16), glass);
  neck.position.y = 0.1; g.add(neck);
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0355, 0.0355, 0.06, 16), new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.8 }));
  label.position.y = -0.01; g.add(label);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.09), new THREE.MeshStandardMaterial({ color: 0x23201d, roughness: 0.8 }));
  hand.position.set(0.035, -0.02, 0.02); g.add(hand);
  return g;
}

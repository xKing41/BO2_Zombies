// ─────────────────────────────────────────────────────────────
//  Echte Körper (MakeHuman/MPFB, CC0) für die Überlebenden im Koop und
//  Splitscreen. Die bewährte Figur aus avatar.js bleibt der Antrieb
//  (Gehen, Ducken, Liegen, Hechten, am Boden, Waffe, Aktionen); ihre
//  Gelenkdrehungen werden je Bild auf das menschliche Skelett übertragen,
//  die Hände greifen per IK genau an die Ziele der Figur (Waffengriff,
//  Handschutz, Messer, Flasche …). Die Bauteile der Figur werden dann
//  ausgeblendet – Waffe, Name und Symbol bleiben.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { charData, preloadChars, solvePose, writeBones, newPoseState, newD, wrapGeometry, InstancedSkinnedMesh } from '../zombies/skinned.js';

const _q = new THREE.Quaternion(), _I = new THREE.Quaternion();
const _hip = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();
// Die Figur blickt nach −z, der Mensch nach +z: halbe Drehung um die Hochachse
const RH = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), ZERO = new THREE.Vector3();

export class SurvivorBody {
  // av: SurvivorAvatar, c: geladene Figur, hipY: Hüfthöhe der Figur in Ruhe (Raum des Körpers)
  constructor(av, c, hipY) {
    this.av = av;
    this.c = c;
    this.hipY = hipY;
    const mat = c.mat.clone();
    mat.side = THREE.DoubleSide;
    mat.alphaTest = 0.5;
    mat.transparent = false;
    mat.envMapIntensity = 0.6;
    mat.userData.shared = true; // Texturen gehören der Figuren-Bibliothek
    this.mesh = new InstancedSkinnedMesh(wrapGeometry(c.geo), mat, c.nb, 1);
    this.mesh.count = 1;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'survivor_body_' + c.name;
    // Becken des Menschen auf die Hüfthöhe der Figur bringen (Beine stehen dann richtig)
    const scale = av.body.scale.y;
    this.fit = c.pelvis >= 0 ? (hipY * scale) / c.P0[c.pelvis].y : 1;
    this.place = new THREE.Matrix4().compose(ZERO, RH, new THREE.Vector3(this.fit, this.fit, this.fit));
    this.place.toArray(this.mesh.instanceMatrix.array, 0);
    this.mesh.instanceMatrix.needsUpdate = true;
    av.group.add(this.mesh);
    this.st = newPoseState(c);
    this.D = newD();
    this.ik = { r: { T: new THREE.Vector3(), pole: new THREE.Vector3() }, l: { T: new THREE.Vector3(), pole: new THREE.Vector3() } };
  }

  // Nach avatar.update(): Drehungen der Figur einsammeln, Pose lösen, Knochen schreiben
  update() {
    const av = this.av, D = this.D, c = this.c;
    // Drehungen relativ zur Wurzel (der Körper der Figur ist nur skaliert, nicht gedreht)
    D.pelvis.copy(av.hips.quaternion).multiply(av.lower.quaternion);
    D.spine3.copy(av.hips.quaternion).multiply(av.spine.quaternion);
    D.spine1.copy(av.hips.quaternion).multiply(_q.copy(_I).slerp(av.spine.quaternion, 0.4));
    D.spine2.copy(av.hips.quaternion).multiply(_q.copy(_I).slerp(av.spine.quaternion, 0.72));
    D.head.copy(D.spine3).multiply(av.neck.quaternion);
    D.neck1.copy(D.spine3).slerp(D.head, 0.5);
    const [AL, AR] = av.arms; // Figur blickt nach −z: arms[0] (x < 0) ist links, arms[1] rechts (hält den Griff)
    D.shL.copy(D.spine3).multiply(AL.shoulder.quaternion); D.elL.copy(D.shL).multiply(AL.elbow.quaternion);
    D.shR.copy(D.spine3).multiply(AR.shoulder.quaternion); D.elR.copy(D.shR).multiply(AR.elbow.quaternion);
    const [LL, LR] = av.legs;
    D.hpL.copy(D.pelvis).multiply(LL.hip.quaternion); D.knL.copy(D.hpL).multiply(LL.knee.quaternion); D.ftL.copy(D.knL).multiply(LL.ankle.quaternion);
    D.hpR.copy(D.pelvis).multiply(LR.hip.quaternion); D.knR.copy(D.hpR).multiply(LR.knee.quaternion); D.ftR.copy(D.knR).multiply(LR.ankle.quaternion);
    // in den Raum des Menschen umrechnen (RH ist ihr eigenes Inverses)
    for (const k in D) D[k].premultiply(RH).multiply(RH);
    // Beckenversatz (Ducken, Liegen, Hechten) aus dem Raum der Figur in den des Menschen
    const s = av.body.scale.y;
    _hip.copy(av.hips.position).sub(_a.set(0, this.hipY, 0)).multiplyScalar(s / this.fit).applyQuaternion(RH);
    // Hände: Weltziele der Figur → Raum des Menschen; Ellbogen in Richtung des Figur-Ellbogens
    av.group.updateMatrixWorld(true);
    _inv.copy(av.group.matrixWorld).multiply(this.place).invert();
    for (const [k, A] of [['l', AL], ['r', AR]]) {
      const g = this.ik[k];
      A.hand.getWorldPosition(g.T).applyMatrix4(_inv);
      A.elbow.getWorldPosition(_a).applyMatrix4(_inv);
      A.shoulder.getWorldPosition(_b).applyMatrix4(_inv);
      g.pole.subVectors(_a, _b);
    }
    solvePose(c, D, this.st, _hip, this.ik, c.curl(0.85)); // Hände greifen
    writeBones(c, this.st, this.mesh.boneData, 0);
    this.mesh.skeleton.boneTexture.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.mesh.material.dispose();
  }
}

// Echten Körper nachladen und anhängen, sobald er da ist (bis dahin bleibt die gebaute Figur)
export function attachRealBody(av, hipY) {
  const name = 's_' + av.id;
  const q = av.g?.rs?.quality;
  if (q && q.realBodies === false) return;
  const take = () => {
    const c = charData(name);
    if (!c || av.disposed || av.real) return;
    try { av.setRealBody(new SurvivorBody(av, c, hipY)); } catch (err) { console.warn('[Figur] echter Körper', name, err); }
  };
  if (charData(name)) take();
  else preloadChars([name]).then(take).catch(() => {});
}

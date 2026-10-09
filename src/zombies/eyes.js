// ─────────────────────────────────────────────────────────────
//  Leuchtende Zombie-Augen: zwei Lichtpunkte pro Zombie (additiv,
//  vom Bloom aufgeweitet) und Leuchtspuren hinter schnellen Zombies.
//  Von hinten verdeckt der Kopf die Punkte (Tiefentest).
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';

const VS = /* glsl */`
  attribute float alpha;
  varying float vA;
  uniform float uScale, uSize;
  void main(){
    vA = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    mv.xyz += normalize(-mv.xyz) * 0.045; // etwas vor die Augenhöhle, damit Brauen/Wangen nicht abschneiden
    gl_PointSize = alpha > 0.0 ? uSize * uScale / max(0.05, -mv.z) : 0.0;
    gl_Position = projectionMatrix * mv;
  }`;
const FS = /* glsl */`
  varying float vA;
  uniform vec3 uColor;
  void main(){
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float halo = exp(-d * d * 6.0), core = exp(-d * d * 60.0);
    gl_FragColor = vec4(uColor * halo + vec3(1.0, 0.95, 0.8) * core * 2.0, halo * vA);
  }`;

export class EyeGlow {
  constructor(scene, max) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 2 * 3);
    this.alpha = new Float32Array(max * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.color = new THREE.Color(3.2, 1.5, 0.25);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS,
      uniforms: { uScale: { value: 600 }, uSize: { value: 0.085 }, uColor: { value: this.color } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    this.points.userData.dynamic = true;
    scene.add(this.points);
    this.trailT = 0;
  }

  setScale(s) { this.mat.uniforms.uScale.value = s; }

  // Augenfarbe (z. B. blau, nachdem das Signal gesendet wurde)
  setColor(r, g, b) { this.color.setRGB(r, g, b); }

  update(zombies, dt, game) {
    const P = this.pos, A = this.alpha;
    const cam = game.camera.position;
    this.mat.uniforms.uScale.value = game.effects.add.mat.uniforms.uScale.value;
    this.trailT += dt;
    const trail = this.trailT > 1 / 40;
    if (trail) this.trailT = 0;
    const c = this.color;
    for (const z of zombies) {
      const i = z.index * 2;
      let a = 0;
      if (z.active && !z.headless) {
        if (z.state === 'dying') z.eyeFade = Math.max(0, z.eyeFade - dt * 1.6);
        else if (z.state === 'rise') z.eyeFade = Math.min(1, z.stateT / 1.2);
        else z.eyeFade = 1;
        a = z.eyeFade;
      }
      for (let k = 0; k < 2; k++) {
        const j = (i + k) * 3;
        if (a > 0) {
          const e = z.eyes[k].matrixWorld.elements;
          P[j] = e[12]; P[j + 1] = e[13]; P[j + 2] = e[14];
          // Leuchtspur hinter schnellen Zombies (nur in der Nähe)
          if (trail && z.moveSpeed > 2.2 && z.state !== 'dying' && (P[j] - cam.x) ** 2 + (P[j + 2] - cam.z) ** 2 < 900) {
            game.effects.add.spawn({ x: P[j], y: P[j + 1], z: P[j + 2], life: 0.22, size: 0.035, size1: 0.005, r: c.r * 0.6, g: c.g * 0.6, b: c.b * 0.6, alpha: 0.8 });
          }
        }
        A[i + k] = a;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }

  reset() {
    this.alpha.fill(0);
    this.geo.attributes.alpha.needsUpdate = true;
  }
}

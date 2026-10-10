// ─────────────────────────────────────────────────────────────
//  Lichtkegel und Lichthöfe: Unter jeder Lampe ein weicher, staubiger
//  Kegel im Dunst, um jede Glühbirne ein Lichthof im Nebel. Alle Kegel
//  bzw. Höfe einer Karte sind je ein InstancedMesh (zwei Draw-Calls).
//  Farbe und Helligkeit folgen der Glühbirne → Flackern und Strom
//  wirken automatisch mit.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { CELL } from '../config.js';

const SHAFT_VS = /* glsl */`
	#include <common>
	#include <fog_pars_vertex>
	varying float vAlong;
	varying vec3 vN, vV, vCol, vW;
	void main() {
		vAlong = - position.y;
		vCol = instanceColor;
		vec4 w = modelMatrix * instanceMatrix * vec4( position, 1.0 );
		vW = w.xyz;
		vec4 mvPosition = viewMatrix * w;
		vV = mvPosition.xyz;
		vN = normalize( mat3( viewMatrix ) * ( transpose( inverse( mat3( modelMatrix * instanceMatrix ) ) ) * normal ) );
		gl_Position = projectionMatrix * mvPosition;
		#include <fog_vertex>
	}`;

const SHAFT_FS = /* glsl */`
	#include <common>
	#include <fog_pars_fragment>
	uniform float uTime, uStrength;
	varying float vAlong;
	varying vec3 vN, vV, vCol, vW;
	void main() {
		float a = vAlong;
		float fall = smoothstep( 0.0, 0.14, a ) * pow( max( 1.0 - a, 0.0 ), 1.25 );
		float facing = abs( dot( normalize( vN ), normalize( - vV ) ) );
		float edge = facing * facing;
		float near = smoothstep( 0.5, 2.4, length( vV ) );
		// langsam wirbelnder Staub
		float t = uTime;
		float n = sin( vW.x * 2.3 + t * 0.35 ) * sin( vW.y * 1.9 - t * 0.5 ) * sin( vW.z * 2.1 + t * 0.27 );
		vec3 c = vCol * ( fall * edge * near * uStrength * ( 0.8 + 0.35 * n ) );
		gl_FragColor = vec4( c, 1.0 );
		#ifdef FOG_EXP2
			gl_FragColor.rgb *= exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
		#endif
	}`;

const HALO_VS = /* glsl */`
	#include <common>
	#include <fog_pars_vertex>
	varying vec2 vUv;
	varying vec3 vCol;
	void main() {
		vUv = uv;
		vCol = instanceColor;
		vec4 c = viewMatrix * modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
		float s = length( instanceMatrix[ 0 ].xyz );
		vec4 mvPosition = c + vec4( position.xy * s, 0.0, 0.0 );
		// Richtung Kamera schieben, damit der Hof nicht in Lampenschirm oder Decke steckt
		mvPosition.xyz += normalize( - c.xyz ) * min( s * 0.5, length( c.xyz ) * 0.5 );
		gl_Position = projectionMatrix * mvPosition;
		#include <fog_vertex>
	}`;

const HALO_FS = /* glsl */`
	#include <common>
	#include <fog_pars_fragment>
	uniform float uStrength;
	varying vec2 vUv;
	varying vec3 vCol;
	void main() {
		float r = length( vUv - 0.5 ) * 2.0;
		float g = exp( - r * r * 5.0 ) * ( 1.0 - smoothstep( 0.7, 1.0, r ) );
		gl_FragColor = vec4( vCol * g * uStrength, 1.0 );
		#ifdef FOG_EXP2
			gl_FragColor.rgb *= exp( - fogDensity * fogDensity * vFogDepth * vFogDepth * 0.45 );
		#endif
	}`;

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();
const DOWN = new THREE.Vector3(0, -1, 0);

export class LightShafts {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.list = [];
    this.opts = opts;
    this.time = { value: 0 };
    this.t = 0;
  }

  // pos: Glühbirne · dir: Richtung · length/radius in Metern · bulb: Mesh mit HDR-Farbe
  add(e) { this.list.push({ dir: DOWN.clone(), strength: 1, halo: 1, ...e }); }

  // Größte Kegelbreite, bevor der Kegel eine Wand schneidet (harte Kante vermeiden)
  static fitRadius(map, x, z, r) {
    let best = r;
    const c0x = Math.floor(x / CELL), c0y = Math.floor(z / CELL), n = Math.ceil(r / CELL) + 1;
    for (let y = c0y - n; y <= c0y + n; y++) for (let xx = c0x - n; xx <= c0x + n; xx++) {
      const c = map.get(xx, y);
      if (!c || (c.type !== 'wall' && c.type !== 'door' && c.type !== 'window')) continue;
      const qx = Math.max(xx * CELL, Math.min(x, (xx + 1) * CELL)), qz = Math.max(y * CELL, Math.min(z, (y + 1) * CELL));
      best = Math.min(best, Math.hypot(qx - x, qz - z) - 0.12);
    }
    return Math.max(0.25, best);
  }

  build() {
    const n = this.list.length;
    if (!n) return;
    const fogU = THREE.UniformsLib.fog;
    const mk = (vs, fs, u) => new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([fogU, u]), vertexShader: vs, fragmentShader: fs,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, side: THREE.DoubleSide,
    });
    const cone = new THREE.ConeGeometry(1, 1, 28, 1, true);
    cone.translate(0, -0.5, 0); // Spitze im Ursprung, Kegel zeigt nach unten (0 … -1)
    this.shaftMat = mk(SHAFT_VS, SHAFT_FS, { uTime: { value: 0 }, uStrength: { value: this.opts.shaft ?? 0.045 } });
    this.shaftMat.uniforms.uTime = this.time;
    this.shafts = new THREE.InstancedMesh(cone, this.shaftMat, n);
    this.haloMat = mk(HALO_VS, HALO_FS, { uStrength: { value: this.opts.halo ?? 0.07 } });
    this.haloMat.side = THREE.FrontSide;
    this.halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.haloMat, n);
    for (const [im, order] of [[this.shafts, 11], [this.halos, 12]]) {
      im.frustumCulled = false;
      im.renderOrder = order;
      im.userData.dynamic = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) im.setColorAt(i, new THREE.Color(0, 0, 0));
      this.scene.add(im);
    }
    this.shafts.name = 'light_shafts';
    this.halos.name = 'light_halos';
    this.list.forEach((e, i) => {
      _q.setFromUnitVectors(DOWN, e.dir.clone().normalize());
      e.mShaft = new THREE.Matrix4().compose(e.pos, _q, _s.set(e.radius, e.length, e.radius));
      e.mHalo = new THREE.Matrix4().compose(e.pos, _q.identity(), _s.setScalar(e.haloSize ?? 1.3));
      e.shown = true;
      this.shafts.setMatrixAt(i, e.mShaft);
      this.halos.setMatrixAt(i, e.mHalo);
    });
  }

  update(dt, cam) {
    if (!this.shafts) return;
    this.time.value += dt;
    const sc = this.shafts.instanceColor, hc = this.halos.instanceColor;
    // Ferne Lampen (im Nebel verschwunden) gar nicht zeichnen
    this.t -= dt;
    const recull = this.t <= 0 && cam;
    if (recull) this.t = 0.3;
    this.list.forEach((e, i) => {
      if (recull) {
        const far = (e.pos.x - cam.x) ** 2 + (e.pos.z - cam.z) ** 2 > (this.opts.range ?? 75) ** 2;
        if (far === e.shown) {
          e.shown = !far;
          this.shafts.setMatrixAt(i, far ? _m.makeScale(0, 0, 0) : e.mShaft);
          this.halos.setMatrixAt(i, far ? _m.makeScale(0, 0, 0) : e.mHalo);
          this.shafts.instanceMatrix.needsUpdate = this.halos.instanceMatrix.needsUpdate = true;
        }
      }
      const c = e.bulb ? e.bulb.material.color : e.color;
      const k = e.strength, h = e.halo;
      sc.setXYZ(i, c.r * k, c.g * k, c.b * k);
      hc.setXYZ(i, c.r * h, c.g * h, c.b * h);
    });
    sc.needsUpdate = hc.needsUpdate = true;
  }

  dispose() {
    for (const im of [this.shafts, this.halos]) if (im) { im.geometry.dispose(); im.material.dispose(); im.dispose(); im.removeFromParent(); }
  }
}

// Kegel für alle Strahler mit Glühbirne einer Karte anlegen
export function collectShafts(map, shafts) {
  if (map.scene) map.scene.updateMatrixWorld(true); // Weltpositionen der Glühbirnen
  const fromSpot = (bulb, target, distance, angle, strength = 1) => {
    if (!bulb) return;
    const pos = bulb.getWorldPosition(new THREE.Vector3());
    const dir = target.clone().sub(pos).normalize();
    if (dir.y > -0.5) return; // nur Lampen, die nach unten leuchten
    const toFloor = pos.y / -dir.y;
    const length = Math.min(toFloor * 0.98, distance || 12);
    const want = Math.tan(Math.min(angle ?? 1, 1.1) * 0.4) * length;
    const radius = LightShafts.fitRadius(map, pos.x + dir.x * length * 0.6, pos.z + dir.z * length * 0.6, want);
    shafts.add({ pos: pos.addScaledVector(dir, 0.06), dir, length, radius, bulb, strength });
  };
  for (const e of map.lights) {
    const l = e.light;
    if (!e.bulb || !l.isSpotLight) continue;
    fromSpot(e.bulb, l.target.position, l.distance, l.angle);
  }
  if (map.lightPool) for (const s of map.lightPool.sources) {
    if (s.type !== 'spot' || !s.bulb) continue;
    fromSpot(s.bulb, s.target || new THREE.Vector3(s.pos.x, 0, s.pos.z), s.distance, s.angle);
  }
}

// ─────────────────────────────────────────────────────────────
//  Atmosphäre: Bodennebel mit treibenden Schwaden, Mondschein im Nebel,
//  Himmelskuppel (Verlauf, Wolken, Mond, Sterne, Baumlinie, Horizont-
//  leuchten) und eine eigene Nacht-Umgebung für Spiegelungen.
//  Der Nebel wird in die Standard-Shader von three.js eingebaut, damit
//  jedes Material (auch Sprites und Glühbirnen) gleich aussieht. Himmel
//  und Nebel benutzen dieselbe Farbformel → kein sichtbarer Horizont-Saum.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { ValueNoise, mulberry32 } from '../core/noise.js';

// Gemeinsame Nebelwerte. Float32Arrays werden beim Klonen der Uniforms nicht
// kopiert → alle Materialien lesen dieselben, laufend aktualisierten Werte.
export const FOG = {
  p: new Float32Array([0, 0.8, 0, 0]), //      x Bodennebel-Dichte · y Abnahme je Meter Höhe · z Schwaden · w Zeit
  moon: new Float32Array([0.8, 0.42, 0.42, 0]), // xyz Richtung zum Mond
  glow: new Float32Array([0, 0, 0, 8]), //     rgb Mondschein im Nebel · w Bündelung
  warm: new Float32Array([0, 0, 0, 0]), //     rgb warmes Leuchten am Horizont
  warmDir: new Float32Array([1, 0, 0, 0]), //  xy Richtung (Welt-x/z)
};

const FOG_UNIFORMS = { fogP: FOG.p, fogMoon: FOG.moon, fogGlow: FOG.glow, fogWarm: FOG.warm, fogWarmDir: FOG.warmDir };

// Gleiche Nebelfarbe für Himmel und Landschaft
const FOG_TINT = /* glsl */`
	vec3 fogTint( vec3 dir, vec3 base ) {
		float mu = max( dot( dir, fogMoon.xyz ), 0.0 );
		vec3 c = base + fogGlow.rgb * pow( mu, fogGlow.w );
		float w = max( dot( normalize( dir.xz + vec2( 1e-5 ) ), fogWarmDir.xy ), 0.0 );
		return c + fogWarm.rgb * ( w * w * w ) * exp( - max( dir.y, 0.0 ) * 9.0 );
	}`;

function installFog() {
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogWorld;
#endif`;
  // Weltposition aus der Kameraposition (Ansichtsmatrix ist starr → Transponierte = Inverse)
  C.fog_vertex = /* glsl */`
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogWorld = ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix );
#endif`;
  C.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorld;
	uniform vec4 fogP;
	uniform vec4 fogMoon;
	uniform vec4 fogGlow;
	uniform vec4 fogWarm;
	uniform vec4 fogWarmDir;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
	float fogHash( vec2 p ) {
		vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
		p3 += dot( p3, p3.yzx + 33.33 );
		return fract( ( p3.x + p3.y ) * p3.z );
	}
	float fogNoise( vec2 p ) {
		vec2 i = floor( p ), f = fract( p );
		f = f * f * ( 3.0 - 2.0 * f );
		return mix( mix( fogHash( i ), fogHash( i + vec2( 1.0, 0.0 ) ), f.x ),
			mix( fogHash( i + vec2( 0.0, 1.0 ) ), fogHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
	}
	${FOG_TINT}
#endif`;
  C.fog_fragment = /* glsl */`
#ifdef USE_FOG
	vec3 fogRay = vFogWorld - cameraPosition;
	float fogLen = max( length( fogRay ), 1e-4 );
	#ifdef FOG_EXP2
		float fogOD = fogDensity * fogDensity * vFogDepth * vFogDepth;
	#else
		float fogOD = - log( max( 1.0 - smoothstep( fogNear, fogFar, vFogDepth ), 1e-4 ) );
	#endif
	if ( fogP.x > 0.0 ) {
		// Bodennebel: Dichte fällt mit der Höhe exponentiell ab, über den Blickstrahl integriert
		float fb = fogP.y, fdy = fogRay.y * fb;
		float fk = abs( fdy ) > 1e-3 ? ( 1.0 - exp( - fdy ) ) / fdy : 1.0 - 0.5 * fdy;
		float fm = fogP.x * exp( - fb * max( cameraPosition.y, 0.0 ) ) * fk * fogLen;
		if ( fogP.z > 0.0 ) {
			// Treibende Schwaden
			vec2 fq = vFogWorld.xz * 0.07 + vec2( fogP.w * 0.05, fogP.w * 0.021 );
			float fn = fogNoise( fq ) * 0.65 + fogNoise( fq * 2.3 + 7.1 ) * 0.35;
			fm *= 1.0 + ( fn - 0.5 ) * 2.0 * fogP.z;
		}
		fogOD += max( fm, 0.0 );
	}
	float fogFactor = 1.0 - exp( - fogOD );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint( fogRay / fogLen, fogColor ), fogFactor );
#endif`;
  for (const k in THREE.ShaderLib) {
    const u = THREE.ShaderLib[k].uniforms;
    if (u && u.fogColor) for (const n in FOG_UNIFORMS) u[n] = { value: FOG_UNIFORMS[n] };
  }
  const lib = { ...THREE.UniformsLib.fog };
  for (const n in FOG_UNIFORMS) lib[n] = { value: FOG_UNIFORMS[n] };
  THREE.UniformsLib.fog = lib;
}
installFog();

// Nebelwerte einer Karte setzen (vor jedem Bild, wegen Splitscreen je Spieler)
export function applyFog(a) {
  FOG.p[0] = a.mist; FOG.p[1] = a.mistFalloff; FOG.p[2] = a.mistNoise; FOG.p[3] = a.time;
  FOG.moon.set(a.moonDir);
  FOG.glow[0] = a.glow[0]; FOG.glow[1] = a.glow[1]; FOG.glow[2] = a.glow[2]; FOG.glow[3] = a.glowPow;
  FOG.warm[0] = a.warm[0]; FOG.warm[1] = a.warm[1]; FOG.warm[2] = a.warm[2];
  FOG.warmDir[0] = a.warmDir[0]; FOG.warmDir[1] = a.warmDir[1];
}

const lin = (hex, k = 1) => { const c = new THREE.Color(hex); return [c.r * k, c.g * k, c.b * k]; };

// Kartenwerte mit Vorgaben auffüllen
export function atmoSettings(env = {}) {
  const md = new THREE.Vector3(...(env.moonDir || [0.8, 0.42, 0.42])).normalize();
  const wd = new THREE.Vector2(...(env.warmDir || [-0.6, 0.8])).normalize();
  return {
    mist: env.mist ?? 0.05, mistFalloff: env.mistFalloff ?? 0.75, mistNoise: env.mistNoise ?? 0.6,
    mistIndoor: env.mistIndoor ?? 0.3,
    moonDir: [md.x, md.y, md.z], glow: lin(env.glowColor ?? 0x7d93bd, env.glow ?? 0.12), glowPow: env.glowPow ?? 6,
    warm: lin(env.warmColor ?? 0xffa060, env.warm ?? 0.012), warmDir: [wd.x, wd.y],
    zenith: lin(env.zenith ?? 0x050a16), clouds: env.clouds ?? 0.5, cloudColor: lin(env.cloudColor ?? 0x222b3b),
    treeline: env.treeline ?? 0.75, time: 0,
  };
}

// ── Texturen für den Himmel ────────────────────────────────────
// Wolken: kachelbares Rauschen mit verzerrten Koordinaten (R: grob, G: fein)
function cloudTexture(seed = 71, size = 256) {
  const n = new ValueNoise(seed), n2 = new ValueNoise(seed + 1);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const wx = n2.fbm(u * 4, v * 4, 3, 4) - 0.5, wy = n2.fbm(u * 4 + 5.2, v * 4 + 1.3, 3, 4) - 0.5;
    const a = n.fbm((u + wx * 0.12) * 4, (v + wy * 0.12) * 4, 6, 4);
    const b = n2.fbm(u * 8 + 3.1, v * 8 + 7.7, 4, 8);
    const i = (y * size + x) * 4;
    data[i] = Math.min(255, Math.max(0, (a - 0.5) * 1.9 * 255 + 128));
    data[i + 1] = Math.min(255, Math.max(0, (b - 0.5) * 1.6 * 255 + 128));
    data[i + 2] = 0; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// Baumlinie und Hügel am Horizont als Höhenprofil (R = Höhe über dem Horizont)
function treelineTexture(seed = 73, size = 2048) {
  const r = mulberry32(seed), n = new ValueNoise(seed);
  const h = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const u = i / size;
    h[i] = 0.012 + n.fbm(u * 6, 0.5, 4, 6) * 0.03 + Math.max(0, n.fbm(u * 2 + 9, 1.5, 3, 2) - 0.45) * 0.08;
  }
  // Nadelbäume, Gruppen und Lücken; ab und zu ein Strommast
  for (let k = 0; k < 420; k++) {
    const c = r() * size;
    if (n.fbm((c / size) * 5 + 3, 4.5, 3, 5) < 0.42) continue;
    const ht = 0.012 + r() * 0.03, w = 2 + r() * 5;
    for (let d = -w; d <= w; d++) {
      const i = ((Math.round(c + d) % size) + size) % size;
      const prof = 1 - Math.abs(d) / (w + 0.5);
      h[i] = Math.max(h[i], h[Math.round(c) % size] + ht * prof * (0.8 + 0.2 * Math.sin(d * 3.1)));
    }
  }
  for (let k = 0; k < 6; k++) {
    const c = Math.floor(r() * size);
    for (let d = -1; d <= 1; d++) { const i = (c + d + size) % size; h[i] = Math.max(h[i], 0.075); }
    for (let d = -4; d <= 4; d++) { const i = (c + d + size) % size; h[i] = Math.max(h[i], d === -4 || d === 4 ? 0.066 : 0.07); }
  }
  const data = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) { data[i * 4] = Math.min(255, h[i] * 2000); data[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, size, 1);
  t.wrapS = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const CLOUD_UV = /* glsl */`
	vec2 cloudUv( vec3 d ) { return d.xz / ( d.y + 0.1 ) * 0.12 + uTime * vec2( 0.0025, 0.001 ); }
	float cloudDensity( vec3 d ) {
		vec2 uv = cloudUv( d );
		float c = texture2D( uClouds, uv ).r * 0.72 + texture2D( uClouds, uv * 2.9 + vec2( 0.37, 0.71 ) ).g * 0.28;
		return smoothstep( uCover, uCover + 0.3, c ) * smoothstep( 0.0, 0.22, d.y );
	}`;

const SKY_VS = /* glsl */`
	varying vec3 vDir;
	void main() {
		vDir = position;
		vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
		gl_Position = vec4( p.xy, p.w * 0.99999, p.w );
	}`;

const SKY_FS = /* glsl */`
	uniform vec3 uHorizon, uZenith, uCloudCol, uMoonRight, uMoonUp;
	uniform float uTime, uCover, uMoonSize, uMoonBright, uTree;
	uniform sampler2D uClouds, uMoonTex, uTreeTex;
	uniform vec4 fogMoon, fogGlow, fogWarm, fogWarmDir;
	varying vec3 vDir;
	${FOG_TINT}
	${CLOUD_UV}
	void main() {
		vec3 d = normalize( vDir );
		float h = d.y, mu = max( dot( d, fogMoon.xyz ), 0.0 );
		vec3 horizon = fogTint( d, uHorizon );
		vec3 col = mix( horizon, uZenith + fogGlow.rgb * pow( mu, fogGlow.w ) * 0.6, smoothstep( 0.0, 0.55, max( h, 0.0 ) ) );
		col += fogGlow.rgb * ( pow( mu, 40.0 ) * 1.2 + pow( mu, 400.0 ) * 1.6 );
		float dens = 0.0;
		if ( h > 0.0 && uCover < 1.0 ) {
			dens = cloudDensity( d );
			float thin = 1.0 - smoothstep( 0.0, 0.8, dens );
			vec3 cc = uCloudCol + fogGlow.rgb * pow( mu, 3.0 ) * ( 0.5 + thin * 2.2 );
			col = mix( col, cc, dens * 0.92 );
		}
		// Mond (verschwindet teilweise hinter Wolken)
		vec2 m = vec2( dot( d, uMoonRight ), dot( d, uMoonUp ) ) / uMoonSize;
		if ( dot( d, fogMoon.xyz ) > 0.0 && dot( m, m ) < 2.0 ) {
			vec4 mt = texture2D( uMoonTex, 0.5 + m * 0.39 );
			col = mix( col, mt.rgb * uMoonBright, mt.a * ( 1.0 - dens * 0.85 ) );
		}
		// Baumlinie: dunkle Silhouette vor dem Nebelhorizont (gegen den Mond am deutlichsten)
		if ( uTree > 0.0 && h < 0.14 ) {
			float az = atan( d.z, d.x ) / 6.2831853 + 0.5;
			float th = texture2D( uTreeTex, vec2( az, 0.5 ) ).r * 0.1275;
			float edge = fwidth( h ) * 1.5 + 1e-4;
			float s = 1.0 - smoothstep( th - edge, th + edge, h );
			col = mix( col, horizon * 0.42 + uZenith * 0.3, s * uTree );
		}
		gl_FragColor = vec4( col, 1.0 );
		#include <tonemapping_fragment>
		#include <colorspace_fragment>
	}`;

const STAR_VS = /* glsl */`
	attribute float aMag;
	uniform float uTime, uCover, uPx;
	uniform sampler2D uClouds;
	varying float vA;
	${CLOUD_UV}
	void main() {
		vec3 d = normalize( position );
		vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * d, 1.0 );
		gl_Position = vec4( p.xy, p.w * 0.99999, p.w );
		float tw = 0.7 + 0.3 * sin( uTime * ( 1.5 + aMag * 4.0 ) + position.x * 0.37 );
		vA = aMag * tw * ( 1.0 - cloudDensity( d ) ) * smoothstep( 0.03, 0.3, d.y );
		gl_PointSize = ( 1.2 + aMag * 1.4 ) * uPx;
	}`;

const STAR_FS = /* glsl */`
	uniform vec3 uColor;
	varying float vA;
	void main() {
		float a = smoothstep( 0.5, 0.1, length( gl_PointCoord - 0.5 ) ) * vA;
		gl_FragColor = vec4( uColor * a, 1.0 );
	}`;

// ── Himmel ─────────────────────────────────────────────────────
export class Sky {
  constructor(scene, M, a, fogColor, pixelRatio = 1) {
    this.a = a;
    const md = new THREE.Vector3(...a.moonDir);
    const right = new THREE.Vector3().crossVectors(md, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, md).normalize();
    this.clouds = cloudTexture();
    this.tree = treelineTexture();
    const fog = (n) => ({ value: FOG_UNIFORMS[n] });
    this.uniforms = {
      uHorizon: { value: new THREE.Vector3(fogColor.r, fogColor.g, fogColor.b) },
      uZenith: { value: new THREE.Vector3(...a.zenith) },
      uCloudCol: { value: new THREE.Vector3(...a.cloudColor) },
      uMoonRight: { value: right }, uMoonUp: { value: up },
      uTime: { value: 0 }, uCover: { value: 1 - a.clouds * 0.62 }, uMoonSize: { value: 0.045 }, uMoonBright: { value: 1.25 },
      uTree: { value: a.treeline },
      uClouds: { value: this.clouds }, uMoonTex: { value: M.tex.moon }, uTreeTex: { value: this.tree },
      fogMoon: fog('fogMoon'), fogGlow: fog('fogGlow'), fogWarm: fog('fogWarm'), fogWarmDir: fog('fogWarmDir'),
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: this.uniforms, depthWrite: false, side: THREE.BackSide, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = 1000; // nach allen undurchsichtigen Objekten → nur sichtbare Pixel kosten Zeit
    this.dome.userData.dynamic = true;
    this.dome.name = 'sky';
    scene.add(this.dome);

    // Sterne
    const N = 1800, pos = new Float32Array(N * 3), mag = new Float32Array(N);
    const r = mulberry32(77);
    for (let i = 0; i < N; i++) {
      const th = r() * Math.PI * 2, y = 0.02 + r() * 0.98, s = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(th) * s * 100; pos[i * 3 + 1] = y * 100; pos[i * 3 + 2] = Math.sin(th) * s * 100;
      mag[i] = Math.pow(r(), 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    this.starUniforms = {
      uTime: this.uniforms.uTime, uCover: this.uniforms.uCover, uClouds: this.uniforms.uClouds,
      uPx: { value: pixelRatio }, uColor: { value: new THREE.Color(0.75, 0.8, 1.0) },
    };
    const sm = new THREE.ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, uniforms: this.starUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.stars = new THREE.Points(sg, sm);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = 1001;
    this.stars.userData.dynamic = true;
    scene.add(this.stars);
  }

  setPixelRatio(pr) { this.starUniforms.uPx.value = pr; }

  update(time, horizon) {
    this.uniforms.uTime.value = time;
    if (horizon) this.uniforms.uHorizon.value.set(horizon.r, horizon.g, horizon.b);
  }

  dispose() {
    this.clouds.dispose(); this.tree.dispose();
    for (const o of [this.dome, this.stars]) { o.geometry.dispose(); o.material.dispose(); o.removeFromParent(); }
  }
}

// ── Nacht-Umgebung für Spiegelungen ────────────────────────────
// Dunkler Himmelsverlauf mit Mondschein, schwacher Boden, ein paar warme
// Lampen über Kopf – Metall und nasse Flächen spiegeln so eine Nacht statt
// eines hellen Studios.
export function nightEnvironment(renderer, a = atmoSettings(), o = {}) {
  const scene = new THREE.Scene();
  const md = new THREE.Vector3(...a.moonDir);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uMoon: { value: md }, uSky: { value: o.sky ?? 1 }, uGround: { value: o.ground ?? 1 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform vec3 uMoon; uniform float uSky, uGround; varying vec3 vD;
      void main(){
        vec3 d = normalize(vD);
        float h = d.y, mu = max(dot(d, uMoon), 0.0);
        vec3 sky = mix(vec3(0.20, 0.23, 0.30), vec3(0.10, 0.13, 0.22), smoothstep(0.0, 0.7, h)) * uSky;
        vec3 ground = mix(vec3(0.075, 0.068, 0.062), vec3(0.04, 0.036, 0.034), smoothstep(0.0, -0.6, h)) * uGround;
        vec3 c = h > 0.0 ? sky : ground;
        c += (vec3(0.45, 0.55, 0.75) * pow(mu, 12.0) + vec3(3.0, 3.2, 3.6) * pow(mu, 900.0)) * uSky;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(20, 48, 24), mat));
  // Warme Lampen über Kopf und ein kaltes Fenster
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 9, 4.8) });
  const r = mulberry32(5);
  for (let i = 0; i < 7; i++) {
    const a2 = (i / 7) * Math.PI * 2 + r() * 0.5, d = 3 + r() * 5;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.22 + r() * 0.12, 10, 8), lamp);
    m.position.set(Math.cos(a2) * d, 3.5 + r() * 2.5, Math.sin(a2) * d);
    scene.add(m);
  }
  const win = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.6, 0.85), side: THREE.DoubleSide }));
  win.position.copy(md).multiplyScalar(12).setY(2.5);
  win.lookAt(0, 2.5, 0);
  scene.add(win);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(scene, 0.02).texture;
  pm.dispose();
  scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return tex;
}

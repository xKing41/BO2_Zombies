// ─────────────────────────────────────────────────────────────
//  Oberflächen-Variation für Foto-Texturen. Fotos wiederholen sich alle
//  2–3 m und wirken nachts gleichförmig. Ein großräumiges Rauschen in
//  Weltkoordinaten legt deshalb Flecken und Wasserränder darüber, auf
//  Böden zusätzlich nasse, glänzende Pfützen (in denen sich die Lampen
//  spiegeln). Wände können einen Sockelanstrich bekommen: unten dunkler
//  mit Trennlinie – wie in alten Bahnhofshallen und Lagern.
// ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { ValueNoise } from '../core/noise.js';

let NOISE = null;
// Kachelbares Rauschen: R grob (Flecken), G mittel, B Pfützenfeld – auf 0..1 gestreckt
function noiseTex() {
  if (NOISE) return NOISE;
  const S = 256, layers = [new ValueNoise(901), new ValueNoise(902), new ValueNoise(903)];
  const raw = layers.map((n, k) => {
    const a = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) a[y * S + x] = n.fbm((x / S) * [4, 12, 6][k], (y / S) * [4, 12, 6][k], 4, [4, 12, 6][k]);
    let lo = 1, hi = 0;
    for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
    for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) / Math.max(1e-6, hi - lo);
    return a;
  });
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = raw[0][i] * 255; data[i * 4 + 1] = raw[1][i] * 255; data[i * 4 + 2] = raw[2][i] * 255; data[i * 4 + 3] = 255;
  }
  NOISE = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  NOISE.wrapS = NOISE.wrapT = THREE.RepeatWrapping;
  NOISE.magFilter = THREE.LinearFilter;
  NOISE.minFilter = THREE.LinearMipmapLinearFilter;
  NOISE.generateMipmaps = true;
  NOISE.needsUpdate = true;
  return NOISE;
}

const PARS = /* glsl */`
	uniform sampler2D uSvNoise;
	uniform vec4 uSv;      // x Flecken (Helligkeit ±), y Rauheits-Streuung, z Pfützen, w Fleckengröße (m)
	uniform vec4 uSvBand;  // x Sockelhöhe (m), y Stärke, z Linienbreite (m), w an
	uniform vec3 uSvBandColor;
	varying vec3 vSvWorld;`;

// Vor der Beleuchtung: Farbe, Rauheit und Normale sind fertig gerechnet
const FRAG = /* glsl */`
	{
		vec3 svN = transformDirectionByInverseViewMatrix( nonPerturbedNormal, viewMatrix );
		vec3 svA = abs( svN );
		float svWall = 1.0 - smoothstep( 0.4, 0.7, svA.y );
		vec2 svP = svA.y > 0.6 ? vSvWorld.xz : ( svA.x > svA.z ? vSvWorld.zy : vSvWorld.xy );
		vec4 svN1 = texture2D( uSvNoise, svP / uSv.w );
		vec4 svN2 = texture2D( uSvNoise, svP / ( uSv.w * 0.31 ) + vec2( 0.37, 0.71 ) );
		float svStain = ( svN1.r - 0.5 ) * 1.3 + ( svN2.g - 0.5 ) * 0.7;
		// Wände: senkrechte Schlieren (herablaufendes Wasser, Ruß) – Rauschen stark gestreckt
		vec4 svN3 = texture2D( uSvNoise, vec2( svP.x / ( uSv.w * 0.4 ), svP.y / ( uSv.w * 2.2 ) ) + vec2( 0.11, 0.53 ) );
		float svRun = smoothstep( 0.58, 0.92, svN3.g ) * smoothstep( 0.35, 0.65, svN1.r );
		svStain -= svWall * svRun * ( 0.35 + 0.35 * smoothstep( 1.0, 3.5, vSvWorld.y ) );
		diffuseColor.rgb *= clamp( 1.0 + svStain * uSv.x, 0.35, 1.6 );
		roughnessFactor = clamp( roughnessFactor * ( 1.0 + ( svN2.r - 0.5 ) * uSv.y ), 0.03, 1.0 );
		// Wände: aufsteigende Nässe unten etwas dunkler
		diffuseColor.rgb *= 1.0 - svWall * uSv.x * 0.5 * ( 1.0 - smoothstep( 0.0, 0.9 + svN1.g * 0.6, vSvWorld.y ) );
		// Böden: Pfützen – dunkler, glatt, spiegelnd, Normale flach
		float svWet = smoothstep( 0.8, 0.95, svN.y ) * smoothstep( 0.7, 0.78, svN1.b + ( svN2.g - 0.5 ) * 0.18 ) * uSv.z;
		float svDamp = smoothstep( 0.8, 0.95, svN.y ) * smoothstep( 0.55, 0.68, svN1.b ) * uSv.z;
		diffuseColor.rgb *= 1.0 - svDamp * 0.25 - svWet * 0.3;
		roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.55, svDamp );
		roughnessFactor = mix( roughnessFactor, 0.12, svWet );
		normal = normalize( mix( normal, nonPerturbedNormal, svWet * 0.92 ) );
		// Sockelanstrich (nur senkrechte Flächen)
		if ( uSvBand.w > 0.5 ) {
			float svH = vSvWorld.y;
			float svBelow = ( 1.0 - smoothstep( uSvBand.x - 0.005, uSvBand.x + 0.005, svH ) ) * svWall;
			float svLine = ( 1.0 - smoothstep( uSvBand.z * 0.5, uSvBand.z, abs( svH - uSvBand.x - uSvBand.z ) ) ) * svWall;
			diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * uSvBandColor, svBelow * uSvBand.y );
			roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.75, svBelow );
			diffuseColor.rgb *= 1.0 - svLine * 0.55;
		}
	}`;

/**
 * Variation an ein (Foto-)Material hängen.
 * o.stain Fleckenstärke, o.rough Rauheits-Streuung, o.wet Pfützen (nur Böden), o.size Fleckengröße in m,
 * o.band { h, color, strength, line } Sockelanstrich.
 */
export function surfaceVar(m, o = {}) {
  if (!m || m.userData.surfaceVar) return m;
  const b = o.band;
  const u = {
    uSvNoise: { value: noiseTex() },
    uSv: { value: new THREE.Vector4(o.stain ?? 0.25, o.rough ?? 0.4, o.wet ?? 0, o.size ?? 9) },
    uSvBand: { value: new THREE.Vector4(b?.h ?? 1.2, b ? (b.strength ?? 1) : 0, b?.line ?? 0.05, b ? 1 : 0) },
    uSvBandColor: { value: new THREE.Color(b?.color ?? 0x666666) },
  };
  m.userData.surfaceVar = u;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey.call(m);
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSvWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n\tvSvWorld = ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix );');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PARS)
      .replace('#include <lights_physical_fragment>', FRAG + '\n#include <lights_physical_fragment>');
  };
  m.customProgramCacheKey = () => prevKey + '|sv';
  m.needsUpdate = true;
  return m;
}

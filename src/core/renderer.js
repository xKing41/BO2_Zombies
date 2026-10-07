import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { IS_MOBILE } from './platform.js';

// lightTier/shadowTier: welche Lichter bzw. Schatten aktiv sind (siehe GameMap.addLight)
export const QUALITY = {
  hoch: { pixelRatio: 1.5, shadows: true, shadowSize: 2048, shadowTier: 3, msaa: 4, bloom: true, lightTier: 3, texScale: 1, hrtf: true },
  mittel: { pixelRatio: 1.25, shadows: true, shadowSize: 1024, shadowTier: 2, msaa: 2, bloom: true, lightTier: 2, texScale: 1, hrtf: true },
  niedrig: { pixelRatio: 1.0, shadows: false, shadowSize: 1024, shadowTier: 0, msaa: 0, bloom: true, lightTier: 1, texScale: 0.5, hrtf: false },
  minimal: { pixelRatio: 0.75, shadows: false, shadowSize: 512, shadowTier: 0, msaa: 0, bloom: false, lightTier: 1, texScale: 0.5, hrtf: false },
};

// "auto": Handys & Tablets starten mit "niedrig", Computer mit "hoch";
// die dynamische Auflösung gleicht den Rest aus.
export function resolveQuality(name) {
  if (QUALITY[name]) return name;
  return IS_MOBILE ? 'niedrig' : 'hoch';
}

// Rendert die Waffen-Szene über die Welt (eigener Tiefenpuffer → keine Clipping-Probleme)
class OverlayPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
  }
  render(renderer, writeBuffer, readBuffer) {
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
  }
}

// Begrenzt HDR-Werte und entfernt NaN/Inf (sonst verschmiert der Bloom einzelne
// überlaufende Glanzlichter zu einem schwarzen Bild)
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c.rgb)) || any(isinf(c.rgb))) c.rgb = vec3(0.0);
      gl_FragColor = vec4(min(c.rgb, vec3(48.0)), 1.0); }`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDamage: { value: 0 },
    uDesat: { value: 0 },
    uFlash: { value: 0 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.035 },
    uAberr: { value: 1.0 },
    uPap: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uDamage, uDesat, uFlash, uVignette, uGrain, uAberr, uPap;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r = length(c);
      float ab = uAberr * (0.0015 + r * 0.006 + uDamage * 0.01);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ab).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ab).b;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      // Color-Grading: kühle Schatten, warme Lichter
      col = mix(col * vec3(0.9, 1.0, 1.1), col, smoothstep(0.0, 0.45, l));
      col = mix(col, col * vec3(1.06, 1.0, 0.9), smoothstep(0.55, 1.0, l));
      col = mix(col, vec3(l), uDesat);
      // Schaden: roter, pulsierender Rand
      float edge = smoothstep(0.25, 0.8, r);
      col = mix(col, vec3(0.35, 0.0, 0.0) + col * 0.25, clamp(edge * uDamage * 1.4, 0.0, 0.9));
      col = mix(col, col * vec3(0.8, 0.6, 1.2) + vec3(0.04, 0.0, 0.1), uPap * edge);
      col *= 1.0 - uVignette * smoothstep(0.3, 0.85, r);
      float g = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime * 7.13) * 91.0) - 0.5;
      col += g * uGrain * (0.6 + (1.0 - l));
      col = mix(col, vec3(1.0, 0.98, 0.94), uFlash);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class RenderSystem {
  constructor(canvas, qualityName = 'hoch') {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.qualityName = resolveQuality(qualityName);
    this.quality = QUALITY[this.qualityName];
    this.scale = 1; // dynamische Auflösung (0.55 … 1)
  }

  get pixelRatio() { return Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio) * this.scale; }

  setScale(s) {
    this.scale = s;
    const pr = this.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    this.resize();
  }

  setup(scene, camera, vmScene, vmCamera) {
    this.scene = scene; this.camera = camera; this.vmScene = vmScene; this.vmCamera = vmCamera;
    this.build();
    window.addEventListener('resize', () => this.resize());
  }

  build() {
    const q = this.quality;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = q.shadows;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa });
    if (this.composer) this.composer.dispose();
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new OverlayPass(this.vmScene, this.vmCamera));
    this.composer.addPass(new ShaderPass(SanitizeShader));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.55, 0.85);
    this.bloom.enabled = q.bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.resize();
  }

  setQuality(name) {
    this.qualityName = resolveQuality(name);
    this.quality = QUALITY[this.qualityName];
    this.scale = 1;
    this.build();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
    if (this.onResize) this.onResize(w, h);
  }

  get uniforms() { return this.grade.uniforms; }

  render() { this.composer.render(); }
}

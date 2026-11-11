// Post chain: the scene (MSAA, half-float, alpha kept) -> tilt-shift "miniature" blur (sharp band around the active
// floor, soft toward the top and bottom edges; `?tiltshift=0` leaves it out) -> OutputPass (tone mapping + sRGB) ->
// the studio pass (studio.js: white backdrop + the building's soft shadow aura), which is what reaches the screen.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { StudioPass } from './studio.js?v=19';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';

// The link tubes live on layer 1 and are drawn after tone mapping, so purple and green stay vivid in daylight.
class NeonPass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.clear = false;
    this.needsSwap = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    const target = this.renderToScreen ? null : readBuffer;
    const mask = this.camera.layers.mask;
    const tone = renderer.toneMapping;
    const autoClear = renderer.autoClear;
    this.camera.layers.set(1);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
    renderer.toneMapping = tone;
    this.camera.layers.mask = mask;
  }
}

const TiltShiftShader = {
  name: 'BotHQTiltShift',
  uniforms: {
    tDiffuse: { value: null },
    dir: { value: new THREE.Vector2(1, 0) },     // texel step (1/w, 0) or (0, 1/h)
    focus: { value: 0.5 },                      // uv.y of the sharp line
    band: { value: 0.24 },                       // half height of the fully sharp band (uv)
    falloff: { value: 0.5 },                   // uv distance over which the blur ramps up
    strength: { value: 1.5 },                   // blur radius in px at full effect
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 dir;
    uniform float focus, band, falloff, strength;
    varying vec2 vUv;
    void main() {
      float d = max( 0.0, abs( vUv.y - focus ) - band );
      float amt = smoothstep( 0.0, falloff, d );
      vec2 s = dir * strength * amt;
      vec4 c = texture2D( tDiffuse, vUv ) * 0.2270270270;
      c += texture2D( tDiffuse, vUv + s * 1.3846153846 ) * 0.3162162162;
      c += texture2D( tDiffuse, vUv - s * 1.3846153846 ) * 0.3162162162;
      c += texture2D( tDiffuse, vUv + s * 3.2307692308 ) * 0.0702702703;
      c += texture2D( tDiffuse, vUv - s * 3.2307692308 ) * 0.0702702703;
      gl_FragColor = c;
    }`,
};

export function tiltShiftEnabled() {
  return new URLSearchParams(location.search).get('tiltshift') === '1';
}

export function createPost(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr);
  // MSAA only where the scene is drawn: the ping-pong partner is a plain half-float target (saves ~25% VRAM)
  composer.renderTarget2.dispose();
  composer.renderTarget2 = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType });
  composer.writeBuffer = composer.renderTarget2;
  composer.readBuffer = composer.renderTarget1;
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.42;
  gtao.enabled = false;
  composer.addPass(gtao);
  const h = new ShaderPass(TiltShiftShader);
  const v = new ShaderPass(TiltShiftShader);      // ShaderPass clones the uniforms, so each pass owns its own
  h.enabled = v.enabled = tiltShiftEnabled();
  composer.addPass(h);
  composer.addPass(v);
  composer.addPass(new OutputPass());
  const studio = new StudioPass(scene, camera);
  composer.addPass(studio);
  composer.addPass(new NeonPass(scene, camera));
  // After the studio backdrop, so only bright lamps and neon bloom. Off on the low quality setting.
  const bokeh = new BokehPass(scene, camera, { focus: 20, aperture: 0.00012, maxblur: 0.006 });
  bokeh.materialBokeh.defines.PERSPECTIVE_CAMERA = 1;
  bokeh.materialBokeh.needsUpdate = true;
  bokeh.enabled = false;
  composer.addPass(bokeh);
  // High threshold so the purple backdrop stays quiet and only lamps, screens and neon bloom.
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x * pr, size.y * pr), 0.12, 0.2, 0.96);
  bloom.enabled = false;
  composer.addPass(bloom);
  const smaa = new SMAAPass(size.x * pr, size.y * pr);
  const fxaa = new ShaderPass(FXAAShader);
  fxaa.enabled = false;
  composer.addPass(smaa);
  composer.addPass(fxaa);

  const api = {
    composer,
    setSize(w, hgt) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, hgt);
      const pxW = w * renderer.getPixelRatio(), pxH = hgt * renderer.getPixelRatio();
      h.uniforms.dir.value.set(1 / pxW, 0);
      v.uniforms.dir.value.set(0, 1 / pxH);
      fxaa.material.uniforms.resolution.value.set(1 / pxW, 1 / pxH);
      this.base = 1.05 * renderer.getPixelRatio();
      h.uniforms.strength.value = v.uniforms.strength.value = this.base;
    },
    setAa(mode) {
      const sharp = mode !== 'fxaa';
      smaa.enabled = sharp;
      fxaa.enabled = !sharp;
    },
    setBloom(on) { bloom.enabled = !!on; },
    setAo(on) { gtao.enabled = !!on; },
    setDof(distance) {
      const on = distance > 0;
      bokeh.enabled = on;
      if (on) bokeh.uniforms.focus.value = distance;
    },
    render(focusV, dt, intensity = 1) {
      h.uniforms.focus.value = v.uniforms.focus.value = focusV;
      h.uniforms.strength.value = v.uniforms.strength.value = this.base * intensity;
      composer.render(dt);
    },
  };
  api.setSize(size.x, size.y);
  return api;
}

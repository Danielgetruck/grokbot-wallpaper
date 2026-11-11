// Procedural night city around the office. One instanced mesh for the towers, one sky dome.
import * as THREE from 'three';

const SKY_FS = /* glsl */`
  uniform float uTime;
  varying vec3 vDir;
  void main() {
    float h = normalize(vDir).y;
    vec3 top = vec3(0.015, 0.012, 0.03);
    vec3 hor = vec3(0.10, 0.07, 0.18);
    vec3 col = mix(hor, top, smoothstep(-0.05, 0.55, h));
    vec3 cell = floor(normalize(vDir) * 220.0);
    float n = fract(sin(dot(cell.xy + cell.yz, vec2(12.9898, 78.233))) * 43758.5453);
    float star = step(0.985, n) * (0.45 + 0.55 * sin(uTime * 1.8 + n * 30.0));
    col += vec3(0.82, 0.86, 1.0) * star;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const TOWER_FS = /* glsl */`
  varying vec2 vUv;
  varying float vSeed;
  varying vec3 vWorld;
  void main() {
    vec3 body = vec3(0.045, 0.044, 0.055);
    vec2 grid = vec2(5.0 + floor(vSeed * 3.0), 9.0 + floor(vSeed * 6.0));
    vec2 g = fract(vUv * grid);
    float win = step(0.28, g.x) * step(g.x, 0.72) * step(0.22, g.y) * step(g.y, 0.78);
    float lit = step(0.48, fract(sin(dot(floor(vUv * grid) + vSeed * 19.0, vec2(12.9, 78.2))) * 43758.5));
    vec3 warm = vec3(0.95, 0.72, 0.38);
    vec3 cool = vec3(0.45, 0.62, 0.85);
    vec3 lamp = mix(warm, cool, step(0.62, vSeed));
    vec3 col = mix(body, lamp, win * lit * 0.9);
    float fogF = clamp(1.0 - exp(-0.006 * length(vWorld)), 0.0, 0.72);
    gl_FragColor = vec4(mix(col, vec3(0.05, 0.04, 0.08), fogF), 1.0);
  }
`;

const TOWER_VS = /* glsl */`
  attribute float aSeed;
  varying vec2 vUv;
  varying float vSeed;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vSeed = aSeed;
    vec4 world = instanceMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

function skyDome() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vDir = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: SKY_FS,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(240, 24, 16), mat);
  mesh.name = 'night-sky';
  mesh.frustumCulled = false;
  mesh.userData.sky = mat;
  return mesh;
}

function towers() {
  const count = 96;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const seeds = new Float32Array(count);
  const mesh = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({
    vertexShader: TOWER_VS,
    fragmentShader: TOWER_FS,
    fog: false,
  }), count);
  mesh.name = 'skyline';
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  let i = 0;
  const rings = [
    { n: 28, r0: 26, r1: 40, h0: 14, h1: 32, w0: 2.4, w1: 5 },
    { n: 32, r0: 62, r1: 88, h0: 14, h1: 36, w0: 3, w1: 6 },
    { n: 36, r0: 100, r1: 150, h0: 22, h1: 64, w0: 4, w1: 8 },
  ];
  for (const ring of rings) {
    for (let k = 0; k < ring.n && i < count; k++, i++) {
      const a = (k / ring.n) * Math.PI * 2 + ring.r0 * 0.01;
      const rad = ring.r0 + Math.random() * (ring.r1 - ring.r0);
      const w = ring.w0 + Math.random() * (ring.w1 - ring.w0);
      const d = ring.w0 + Math.random() * (ring.w1 - ring.w0);
      const h = ring.h0 + Math.random() * (ring.h1 - ring.h0);
      dummy.position.set(Math.cos(a) * rad, h / 2, Math.sin(a) * rad);
      dummy.scale.set(w, h, d);
      dummy.rotation.y = Math.random() * 0.4;
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      seeds[i] = Math.random();
    }
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  mesh.count = i;
  return mesh;
}

/** Night sky and a skyline. Parallax comes from the camera moving through real geometry. */
export function installCity(scene) {
  const g = new THREE.Group();
  g.name = 'night-city';
  const sky = skyDome();
  g.add(sky);
  g.add(towers());
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(200, 48),
    new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.15;
  g.add(ground);
  scene.add(g);
  scene.fog = new THREE.FogExp2(0x0c0a16, 0.0055);
  return {
    tick(t) { sky.userData.sky.uniforms.uTime.value = t; },
  };
}

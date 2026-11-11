// Daytime campus around the office: sky, lawns, gardens, and a low city only on the far horizon.
import * as THREE from 'three';
import { sharpTexture } from './tex.js?v=17';

const SKY_FS = /* glsl */`
  uniform float uTime;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 zenith = vec3(0.30, 0.55, 0.86);
    vec3 hor = vec3(0.74, 0.86, 0.96);
    vec3 col = mix(hor, zenith, smoothstep(-0.04, 0.62, h));
    float n = sin(d.x * 5.5 + uTime * 0.04) * sin(d.z * 4.6) * sin((d.x + d.z) * 2.7 + 1.3);
    float band = smoothstep(0.02, 0.28, h) * (1.0 - smoothstep(0.42, 0.78, h));
    float cloud = smoothstep(0.28, 0.72, n) * band;
    col = mix(col, vec3(0.94, 0.96, 0.98), cloud * 0.75);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

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
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(280, 28, 16), mat);
  mesh.name = 'day-sky';
  mesh.frustumCulled = false;
  mesh.userData.sky = mat;
  return mesh;
}

function grassTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#3e8f45';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2800; i++) {
    g.fillStyle = i % 3 === 0 ? '#4ea354' : '#347a3c';
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(18, 18);
  map.colorSpace = THREE.SRGBColorSpace;
  return sharpTexture(map);
}

function place(mesh, i, x, y, z, sx, sy, sz, ry = 0) {
  const o = place.dummy || (place.dummy = new THREE.Object3D());
  o.position.set(x, y, z);
  o.scale.set(sx, sy, sz);
  o.rotation.set(0, ry, 0);
  o.updateMatrix();
  mesh.setMatrixAt(i, o.matrix);
}

function lawns() {
  const g = new THREE.Group();
  g.name = 'campus-ground';
  const grass = new THREE.Mesh(
    new THREE.CircleGeometry(150, 64),
    new THREE.MeshStandardMaterial({ map: grassTexture(), color: 0xffffff, roughness: 0.92, metalness: 0 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.05;
  grass.receiveShadow = true;
  g.add(grass);

  const path = new THREE.Mesh(
    new THREE.RingGeometry(15.4, 17.6, 72),
    new THREE.MeshStandardMaterial({ color: 0xd7c7a4, roughness: 0.86, metalness: 0.02 }),
  );
  path.rotation.x = -Math.PI / 2;
  path.position.y = -0.03;
  path.receiveShadow = true;
  g.add(path);

  const stripMat = new THREE.MeshStandardMaterial({ color: 0xd2c29a, roughness: 0.88 });
  for (const rot of [0.15, Math.PI / 2 + 0.1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 14), stripMat);
    strip.position.set(Math.sin(rot) * 22, -0.02, Math.cos(rot) * 22);
    strip.rotation.y = rot;
    strip.receiveShadow = true;
    g.add(strip);
  }
  return g;
}

function gardens(rand) {
  const g = new THREE.Group();
  g.name = 'gardens';
  const beds = 12;
  const soil = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x6a4a32, roughness: 0.9 }),
    beds,
  );
  const flowers = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.2, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }),
    beds * 7,
  );
  const palette = [0xf472b6, 0xfbbf24, 0xf8fafc, 0xc084fc, 0xfb7185, 0xfde68a];
  let fi = 0;
  for (let i = 0; i < beds; i++) {
    const a = (i / beds) * Math.PI * 2 + 0.4;
    const rad = 16.2 + rand() * 3.2;
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    place(soil, i, x, 0.06, z, 1.5 + rand(), 0.12, 0.9 + rand() * 0.5, a);
    const n = 5 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const fx = x + (rand() - 0.5) * 1.1;
      const fz = z + (rand() - 0.5) * 0.7;
      place(flowers, fi, fx, 0.22, fz, 0.7 + rand() * 0.6, 0.7, 0.7 + rand() * 0.5);
      flowers.setColorAt(fi, new THREE.Color(palette[(i + k) % palette.length]));
      fi++;
    }
  }
  flowers.count = fi;
  const hedges = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x2c7a3a, roughness: 0.78 }),
    28,
  );
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const rad = 19.5 + (i % 3) * 0.7;
    place(hedges, i, Math.cos(a) * rad, 0.38, Math.sin(a) * rad, 2.4, 0.7 + (i % 2) * 0.15, 0.45, a);
  }
  g.add(soil, flowers, hedges);
  return g;
}

function trees(rand) {
  const g = new THREE.Group();
  g.name = 'trees';
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.12, 0.16, 1, 12),
    new THREE.MeshStandardMaterial({ color: 0x6b4630, roughness: 0.85 }),
    28,
  );
  const round = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.55, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x2f8f3e, roughness: 0.72 }),
    18,
  );
  const pines = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.7, 1.6, 14),
    new THREE.MeshStandardMaterial({ color: 0x1f6b34, roughness: 0.75 }),
    10,
  );
  let ri = 0;
  let pi = 0;
  let ti = 0;
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + 0.15;
    const nearCam = Math.abs(((a - Math.PI / 4 + Math.PI) % (Math.PI * 2)) - Math.PI) < 0.55;
    if (nearCam) continue;
    const rad = 20 + rand() * 3.2;
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    const pine = i % 3 === 0;
    const h = pine ? 2.2 + rand() * 1.6 : 1.5 + rand() * 1.3;
    place(trunks, ti, x, h * 0.35, z, 1, h * 0.7, 1);
    ti++;
    if (pine && pi < 10) {
      place(pines, pi, x, h * 0.85, z, 1.1 + rand() * 0.5, 1.3 + rand() * 0.6, 1.1 + rand() * 0.4);
      pi++;
    } else if (ri < 18) {
      const s = 1.1 + rand() * 0.7;
      place(round, ri, x, h * 0.75, z, s, s * 0.85, s);
      ri++;
    }
  }
  round.count = ri;
  pines.count = pi;
  trunks.count = ti;
  g.add(trunks, round, pines);
  return g;
}

// Low blocks on the horizon, opposite the default camera (yaw π/4), never near the office.
function horizon(rand) {
  const count = 18;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.ShaderMaterial({
      vertexShader: `
        attribute float aSeed;
        varying float vSeed;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vSeed = aSeed;
          vec4 world = instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        varying float vSeed;
        varying vec2 vUv;
        void main() {
          vec3 stone = vec3(0.58, 0.52, 0.46);
          vec3 glass = vec3(0.46, 0.56, 0.66);
          vec3 warm = vec3(0.64, 0.54, 0.44);
          vec3 body = mix(stone, mix(warm, glass, step(0.66, vSeed)), step(0.33, vSeed));
          vec2 g = fract(vUv * vec2(4.0, 6.0));
          float win = step(0.28, g.x) * step(g.x, 0.72) * step(0.3, g.y) * step(g.y, 0.7);
          vec3 pane = body * 0.82 + vec3(0.45, 0.58, 0.7) * 0.18;
          gl_FragColor = vec4(mix(body, pane, win * 0.55), 1.0);
        }
      `,
      fog: false,
    }),
    count,
  );
  mesh.name = 'horizon-city';
  mesh.frustumCulled = false;
  const seeds = new Float32Array(count);
  const far = Math.PI / 4 + Math.PI;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const a = far + (rand() - 0.5) * 1.35;
    const rad = 33 + rand() * 8;
    const w = 2.4 + rand() * 2;
    const d = 2.2 + rand() * 1.6;
    const h = 3.4 + rand() * 3.2;
    dummy.position.set(Math.cos(a) * rad, h / 2, Math.sin(a) * rad);
    dummy.scale.set(w, h, d);
    dummy.rotation.y = rand() * 0.5;
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    seeds[i] = rand();
  }
  mesh.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  return mesh;
}

/** Bright day sky, gardens around the building, and a distant low skyline. */
export function installCity(scene) {
  const rand = mulberry32(0x51f00d);
  const g = new THREE.Group();
  g.name = 'day-campus';
  const sky = skyDome();
  g.add(sky, lawns(), gardens(rand), trees(rand), horizon(rand));
  scene.add(g);
  scene.fog = new THREE.FogExp2(0xc5daf0, 0.0016);
  return {
    tick(t) { sky.userData.sky.uniforms.uTime.value = t; },
  };
}

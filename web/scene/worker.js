// Seated office worker: shared shapes, one accent colour, a few moving joints.
import * as THREE from 'three';

const skinMat = new THREE.MeshStandardMaterial({ color: 0xe6c2a6, roughness: 0.55, metalness: 0.02 });
const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1e2430, roughness: 0.8 });
const shoeMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.45, metalness: 0.2 });
const sleeveGeo = new THREE.CapsuleGeometry(0.045, 0.28, 3, 6);
const thighGeo = new THREE.CapsuleGeometry(0.055, 0.2, 3, 6);
const shinGeo = new THREE.CapsuleGeometry(0.042, 0.22, 3, 6);

function accentMaterial(hex) {
  const c = new THREE.Color(hex);
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.08, emissive: c, emissiveIntensity: 0.08 });
}

function parseColor(value) {
  if (typeof value === 'number') return value;
  const s = String(value || '').trim();
  if (/^#?[0-9a-f]{6}$/i.test(s)) return s.startsWith('#') ? s : `#${s}`;
  return '#7c6cff';
}

/** A stylized person already sitting, facing +Z toward the desk. */
export function createWorker({ color, lead = false } = {}) {
  const shirt = accentMaterial(parseColor(color));
  const g = new THREE.Group();
  g.name = 'worker';

  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.2), pantsMat);
  hips.position.set(0, 0.54, 0.04);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.16), shirt);
  torso.position.set(0, 0.78, 0.08);
  torso.rotation.x = 0.18;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.06, 8), skinMat);
  neck.position.set(0, 0.98, 0.12);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.08, 0.14);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), skinMat);
  head.scale.set(1, 1.05, 0.95);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 10), shirt);
  hair.scale.set(1, 0.55, 1);
  hair.position.y = 0.07;
  const eyeGeo = new THREE.SphereGeometry(0.022, 8, 6);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.2 });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.name = 'eye_L'; eyeL.position.set(-0.045, 0.02, 0.11);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.name = 'eye_R'; eyeR.position.set(0.045, 0.02, 0.11);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.01), shirt);
  visor.position.set(0, 0.02, 0.125);
  headPivot.add(head, hair, eyeL, eyeR, visor);

  for (const x of [-0.09, 0.09]) {
    const thigh = new THREE.Mesh(thighGeo, pantsMat);
    thigh.position.set(x, 0.48, 0.16);
    thigh.rotation.x = Math.PI / 2;
    const shin = new THREE.Mesh(shinGeo, pantsMat);
    shin.position.set(x, 0.26, 0.3);
    shin.rotation.x = 0.15;
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.14), shoeMat);
    shoe.position.set(x, 0.08, 0.34);
    g.add(thigh, shin, shoe);
  }
  g.add(hips, torso, neck, headPivot);

  function arm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.22, 0.96, 0.1);
    const limb = new THREE.Mesh(sleeveGeo, shirt);
    limb.position.set(side * 0.02, -0.16, 0.22);
    limb.rotation.x = 1.45;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), skinMat);
    hand.position.set(side * 0.02, -0.22, 0.38);
    pivot.add(limb, hand);
    g.add(pivot);
    return pivot;
  }
  const armL = arm(-1);
  const armR = arm(1);

  let glow = null;
  if (lead) {
    const cup = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 10), new THREE.MeshStandardMaterial({ color: 0x111318, metalness: 0.6, roughness: 0.3 }));
    cup.position.set(0.12, 0.02, 0);
    cup.rotation.y = Math.PI / 2;
    const mic = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.1), new THREE.MeshStandardMaterial({ color: 0x222, metalness: 0.5, roughness: 0.3 }));
    mic.position.set(0.06, -0.04, 0.08);
    headPivot.add(cup, mic);
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.008), new THREE.MeshStandardMaterial({
      color: 0xf5e6ff, emissive: 0xe9d5ff, emissiveIntensity: 0.8, roughness: 0.3,
    }));
    badge.position.set(0.08, 0.78, 0.16);
    g.add(badge);
    glow = badge;
  }

  return { group: g, eyes: [eyeL, eyeR], head: headPivot, armL, armR, glow };
}

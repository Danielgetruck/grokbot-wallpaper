// Shared texture quality. setMaxAnisotropy runs once the renderer exists; every canvas map calls sharpTexture.
import * as THREE from 'three';

let maxAniso = 8;

export function setMaxAnisotropy(n) {
  maxAniso = Math.max(1, n || 1);
}

/** Mipmaps on, linear filters, and the GPU's max anisotropy so floors and signs stay sharp at an angle. */
export function sharpTexture(tex) {
  if (!tex) return tex;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAniso;
  tex.needsUpdate = true;
  return tex;
}

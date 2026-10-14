import * as THREE from './vendor/three.module.js';
import { createPresenceRenderer as createRenderer } from './renderer-core.mjs';

export function createPresenceRenderer(options) {
  return createRenderer(THREE, options);
}

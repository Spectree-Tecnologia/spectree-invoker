import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPresenceRenderer } from '../presence/renderer-core.mjs';
import { freshSurface, startPageLifecycle } from '../presence/lifecycle.mjs';

// Real Three scene/resources; only the browser driver is substituted. These checks
// prove ownership and scheduling, not shader compilation or physical GPU release.
function fixture({ reduced = false, floatingPoint = true, constructionError = false } = {}) {
  const frames = new Map(), resources = new Map(), targets = [];
  let sequence = 0, now = 0, disconnected = 0, unavailable = 0;
  const observe = resource => {
    if (!resource || resources.has(resource)) return;
    resources.set(resource, 0); resource.addEventListener('dispose', () => resources.set(resource, resources.get(resource) + 1));
  };
  class Target extends THREE.WebGLRenderTarget {
    constructor(...args) { super(...args); targets.push(this); observe(this); }
  }
  const document = new EventTarget(); document.hidden = false;
  document.createElement = () => ({ width: 0, height: 0, getContext: () => ({
    createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
  }) });
  const preference = new EventTarget(); preference.matches = reduced;
  const canvas = new EventTarget(); canvas.dataset = {}; canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500 });
  const world = { clientWidth: 1000, clientHeight: 500 };
  const view = { status: 'available', focus: 'invoker', specialist: 'architect', motion: true, visible: true, speaker: null, energy: 0 };
  const driver = { disposeCalls: 0, renders: 0, extensions: { has: () => floatingPoint }, info: { memory: {}, programs: [] },
    setPixelRatio(ratio) { this.ratio = ratio; }, getPixelRatio() { return this.ratio; }, setSize() {}, setRenderTarget() {},
    render(scene) {
      this.renders++; if (scene.children.some(child => child.isGroup)) this.scene = scene;
      scene.traverse(object => {
        if (object.geometry && !object.isSprite) observe(object.geometry);
        if (object.material) { observe(object.material); observe(object.material.map); }
      });
    }, dispose() { this.disposeCalls++; },
  };
  const environment = { document, devicePixelRatio: 2, AbortController,
    matchMedia: () => preference,
    requestAnimationFrame: callback => { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    ResizeObserver: class { observe() {} disconnect() { disconnected++; } },
    createWebGLRenderer: () => { if (constructionError) throw new Error('WebGL unavailable'); return driver; },
  };
  return { canvas, document, preference, view, frames, driver, resources, targets,
    get unavailable() { return unavailable; }, get disconnected() { return disconnected; },
    create() { return createPresenceRenderer({ ...THREE, WebGLRenderTarget: Target },
      { canvas, world, read: () => view, onUnavailable: () => unavailable++ }, environment); },
    frame() { const current = [...frames.values()]; frames.clear(); now += 16.667; current.forEach(callback => callback(now)); },
    pointer() { const event = new Event('pointermove'); Object.assign(event, { clientX: 950, clientY: 50 }); canvas.dispatchEvent(event); },
  };
}

test('reduced-motion preference draws a static frame and suppresses pointer/blink animation', () => {
  const f = fixture({ reduced: true }), renderer = f.create(); renderer.invalidate(); f.frame();
  assert.equal(f.frames.size, 0); assert.equal(f.canvas.dataset.gaze, '0.000');
  const frames = f.canvas.dataset.frames; f.pointer(); f.frame(); assert.equal(f.canvas.dataset.frames, frames);
  f.view.speaker = 'architect'; f.view.energy = .8; renderer.invalidate(); f.frame();
  const groups = f.driver.scene.children.filter(object => object.isGroup);
  assert.equal(groups[0].children[0].material.uniforms.power.value, 0);
  assert.equal(groups[1].children[0].material.uniforms.power.value, .8 * .22);
  assert.equal(Math.abs(groups[0].rotation.x), 0); assert.equal(Math.abs(groups[1].rotation.y), 0);
  f.view.speaker = null; f.view.energy = 0; renderer.invalidate(); f.frame();
  assert.equal(f.frames.size, 0); renderer.dispose();
});

test('changing system preference or hiding the page stops scheduling until explicitly invalidated', () => {
  const f = fixture(), renderer = f.create(); renderer.invalidate(); f.frame(); f.pointer(); f.frame();
  assert.ok(Number(f.canvas.dataset.gaze) > 0);
  f.preference.matches = true; f.preference.dispatchEvent(new Event('change')); f.frame();
  assert.equal(f.canvas.dataset.gaze, '0.000'); assert.equal(f.frames.size, 0);
  f.preference.matches = false; f.preference.dispatchEvent(new Event('change')); f.frame(); assert.equal(f.frames.size, 1);
  f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange')); assert.equal(f.frames.size, 0);
  renderer.invalidate(); assert.equal(f.frames.size, 0);
  f.document.hidden = false; f.document.dispatchEvent(new Event('visibilitychange')); f.frame();
  f.view.visible = false; f.frame(); assert.equal(f.frames.size, 0); renderer.dispose();
});

test('context loss cancels frames and disposes shared Three resources exactly once', () => {
  const f = fixture(), renderer = f.create(); renderer.invalidate(); f.frame();
  const groups = f.driver.scene.children.filter(object => object.isGroup);
  assert.equal(groups[0].children[0].geometry, groups[1].children[0].geometry);
  const before = new Map(f.resources); // Render-target resizing legitimately disposes prior buffers.
  const event = new Event('webglcontextlost', { cancelable: true }); f.canvas.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true); assert.equal(f.unavailable, 1);
  assert.equal(f.frames.size, 0); assert.equal(f.disconnected, 1); assert.equal(f.driver.disposeCalls, 1);
  assert.equal(f.targets.length, 3); assert.ok(f.resources.size > 10);
  assert.ok([...f.resources].every(([resource, count]) => count === before.get(resource) + 1));
  const draws = f.driver.renders; renderer.dispose(); renderer.invalidate(); f.pointer(); f.frame();
  assert.equal(f.driver.renders, draws); assert.equal(f.driver.disposeCalls, 1);
  assert.ok([...f.resources].every(([resource, count]) => count === before.get(resource) + 1));
});

test('renderer initialization failure and unsupported color targets release partial ownership', () => {
  const absent = fixture({ constructionError: true }); assert.throws(() => absent.create(), /WebGL unavailable/);
  assert.equal(absent.frames.size, 0);
  const unsupported = fixture({ floatingPoint: false }); assert.throws(() => unsupported.create(), /color targets unavailable/);
  assert.equal(unsupported.driver.disposeCalls, 1); assert.equal(unsupported.frames.size, 0);
});

test('leaving and restoring a cached page rebuilds once without retaining old session effects', () => {
  const target = new EventTarget(), instances = [];
  const lifecycle = startPageLifecycle(target, () => {
    const instance = { disposed: 0, dispose() { this.disposed++; } }; instances.push(instance); return instance;
  });
  const restore = () => { const event = new Event('pageshow'); event.persisted = true; target.dispatchEvent(event); };
  target.dispatchEvent(new Event('pageshow')); assert.equal(instances.length, 1);
  target.dispatchEvent(new Event('pagehide')); target.dispatchEvent(new Event('pagehide'));
  assert.equal(instances[0].disposed, 1);
  restore(); restore(); assert.equal(instances.length, 2); assert.equal(instances[1].disposed, 0);
  lifecycle.dispose(); lifecycle.dispose(); restore();
  assert.equal(instances[1].disposed, 1); assert.equal(instances.length, 2);
});

test('restoration replaces previously bound media/canvas and removes obsolete diagnostic state', () => {
  const nodes = {};
  function element(name) {
    return { name, dataset: { frames: '99', speaker: 'architect' }, hidden: true, src: 'old.mp3',
      cloneNode() { return element(name); }, replaceWith(next) { nodes[name] = next; },
      removeAttribute(key) { delete this[key]; },
    };
  }
  nodes.audio = element('audio'); nodes.canvas = element('canvas'); const old = { ...nodes };
  const surface = freshSurface({ querySelector: name => nodes[name] });
  assert.notEqual(surface.audio, old.audio); assert.notEqual(surface.canvas, old.canvas);
  assert.equal(surface.audio.src, undefined); assert.equal(surface.canvas.hidden, false);
  assert.deepEqual(surface.canvas.dataset, {});
  assert.equal(nodes.audio, surface.audio); assert.equal(nodes.canvas, surface.canvas);
});

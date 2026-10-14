// A restored document needs fresh media/canvas elements: a closed AudioContext
// does not make a previously connected HTMLMediaElement a new source.
export function freshSurface(root) {
  const replace = selector => {
    const previous = root.querySelector(selector), next = previous.cloneNode(false);
    for (const key of Object.keys(next.dataset)) delete next.dataset[key];
    previous.replaceWith(next); return next;
  };
  const audio = replace('audio'); audio.removeAttribute('src');
  const canvas = replace('canvas'); canvas.hidden = false;
  return { audio, canvas };
}

export function startPageLifecycle(target, mount) {
  let current;
  const start = () => { if (!current) current = mount(); };
  const stop = () => { const previous = current; current = undefined; previous?.dispose(); };
  const restore = event => { if (event.persisted) start(); };
  target.addEventListener('pagehide', stop);
  target.addEventListener('pageshow', restore);
  start();
  return { dispose() {
    target.removeEventListener('pagehide', stop); target.removeEventListener('pageshow', restore); stop();
  } };
}

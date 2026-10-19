/* SoundCloud uses detached audio elements. Observe normal playback events only.
   No audio capture, network interception, player commands or page internals. */
(() => {
  'use strict';
  if (window.__scWaveMediaBridge) return;
  window.__scWaveMediaBridge = true;
  const original = HTMLMediaElement.prototype.play;
  const attached = new WeakSet();
  let latest;
  HTMLMediaElement.prototype.play = function (...args) {
    if (!attached.has(this)) {
      attached.add(this);
      this.addEventListener('playing', () => { latest = this; });
      this.addEventListener('ended', () => {
        if (latest === this) window.dispatchEvent(new CustomEvent('scwave:ended', {
          detail: JSON.stringify({duration: this.duration, time: this.currentTime})
        }));
      });
    }
    return Reflect.apply(original, this, args);
  };
})();

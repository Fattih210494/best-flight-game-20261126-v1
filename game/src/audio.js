// WebAudio synth only — no audio files. Engine pitch follows throttle and
// spool, wind follows speed, plus touchdown / stall / ring / cash cues.
export function createAudio() {
  let ctx = null;
  let engineOsc1 = null, engineOsc2 = null, engineGain = null;
  let windSrc = null, windGain = null, windFilter = null;
  let muted = false;
  let stallTimer = 0;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return false;
    }
    // Engine: two detuned saws through a lowpass.
    engineOsc1 = ctx.createOscillator();
    engineOsc1.type = 'sawtooth';
    engineOsc1.frequency.value = 55;
    engineOsc2 = ctx.createOscillator();
    engineOsc2.type = 'sawtooth';
    engineOsc2.frequency.value = 55.7;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc1.connect(lp); engineOsc2.connect(lp);
    lp.connect(engineGain); engineGain.connect(ctx.destination);
    engineOsc1.start(); engineOsc2.start();
    // Wind: looped noise through a bandpass.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    windSrc = ctx.createBufferSource();
    windSrc.buffer = buf; windSrc.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 500;
    windFilter.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter); windFilter.connect(windGain); windGain.connect(ctx.destination);
    windSrc.start();
    return true;
  }

  function blip(freq, dur, type = 'sine', vol = 0.15, when = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }

  return {
    unlock() { ensure(); },
    setMuted(m) {
      muted = m;
      if (engineGain) engineGain.gain.value = m ? 0 : engineGain.gain.value;
      if (windGain) windGain.gain.value = m ? 0 : windGain.gain.value;
    },
    update(throttle, spool, speed, flying, stalled) {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      const rpm = 40 + spool * 90 + throttle * 60 + speed * 0.35;
      engineOsc1.frequency.setTargetAtTime(rpm, t, 0.08);
      engineOsc2.frequency.setTargetAtTime(rpm * 1.012, t, 0.08);
      engineGain.gain.setTargetAtTime(spool * 0.05 + throttle * spool * 0.05, t, 0.1);
      windFilter.frequency.setTargetAtTime(300 + speed * 9, t, 0.1);
      windGain.gain.setTargetAtTime(Math.min(0.12, speed * 0.0012), t, 0.1);
      // Stall warning: 880 Hz beep ~3 Hz while stalled.
      if (stalled && flying) {
        stallTimer -= 1 / 60;
        if (stallTimer <= 0) { blip(880, 0.12, 'square', 0.08); stallTimer = 0.33; }
      }
    },
    engineStart() { blip(120, 0.5, 'sawtooth', 0.1); blip(180, 0.4, 'sawtooth', 0.08, 0.15); },
    touchdown() { blip(90, 0.25, 'sine', 0.25); blip(60, 0.3, 'sine', 0.2, 0.05); },
    ring() { blip(660, 0.15, 'sine', 0.15); blip(880, 0.2, 'sine', 0.15, 0.1); blip(1320, 0.3, 'sine', 0.15, 0.2); },
    crash() { blip(160, 0.5, 'sawtooth', 0.2); blip(80, 0.7, 'sawtooth', 0.2, 0.1); },
    click() { blip(700, 0.06, 'sine', 0.08); },
    cash() { blip(880, 0.12, 'sine', 0.12); blip(1320, 0.2, 'sine', 0.12, 0.09); },
    fanfare() { [523, 659, 784, 1046].forEach((f, i) => blip(f, 0.3, 'sine', 0.12, i * 0.12)); },
  };
}

// sfx.js — tiny Web Audio synth (no asset files). All sounds fail silently if
// the browser has no AudioContext (e.g. headless). Call sfx.unlock() from a
// user-gesture handler so the context starts permitted.
const sfx = (() => {
    let ctx = null;
    let muted = false;

    function unlock() {
        if (!ctx) {
            try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
            catch (e) { ctx = null; }
        }
        if (ctx && ctx.state === 'suspended') ctx.resume();
    }

    // tone: oscillator with exponential pitch + volume ramp
    function tone({ type = 'square', from = 440, to = 440, dur = 0.1, vol = 0.15, delay = 0 }) {
        if (!ctx || muted) return;
        const t = ctx.currentTime + delay;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(Math.max(from, 1), t);
        o.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + dur + 0.05);
    }

    // noise: decaying lowpassed white-noise burst (explosions)
    function noise({ dur = 0.3, vol = 0.2, cutoff = 1000, delay = 0 }) {
        if (!ctx || muted) return;
        const t = ctx.currentTime + delay;
        const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = cutoff;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(f).connect(g).connect(ctx.destination);
        src.start(t);
    }

    return {
        unlock,
        shoot:    () => tone({ type: 'square',   from: 880, to: 160, dur: 0.12, vol: 0.07 }),
        boom:     () => { noise({ dur: 0.25, vol: 0.25, cutoff: 900 }); tone({ type: 'triangle', from: 220, to: 40, dur: 0.2, vol: 0.12 }); },
        damage:   () => {
            // two descending buzz pulses ("wah-wah") — distinct ouch, not an explosion
            tone({ type: 'square', from: 400, to: 200, dur: 0.15, vol: 0.14 });
            tone({ type: 'square', from: 200, to: 90, dur: 0.3, vol: 0.16, delay: 0.15 });
        },
        gameover: () => {
            // slow descending E-minor arpeggio; the last note bends down and drags out
            tone({ type: 'triangle', from: 329.6, to: 329.6, dur: 0.22, vol: 0.16 });
            tone({ type: 'triangle', from: 261.6, to: 261.6, dur: 0.22, vol: 0.16, delay: 0.22 });
            tone({ type: 'triangle', from: 220.0, to: 220.0, dur: 0.22, vol: 0.16, delay: 0.44 });
            tone({ type: 'triangle', from: 164.8, to: 140, dur: 0.9, vol: 0.18, delay: 0.66 });
        },
        setMuted: (m) => { muted = !!m; },
        isMuted: () => muted,
    };
})();

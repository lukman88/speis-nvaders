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

    // --- Chiptune music loop ---
    // Menacing take: low-register square melody over an Am–F–Dm–E7 loop
    // (32 eighth-note steps, ~107 BPM). The menace comes from half-step grinds
    // (B3→Bb3), the G# leading tone under the final E7, and a single sustained
    // triangle root drone per bar instead of a pumping pattern. Lookahead
    // scheduler on the AudioContext clock: tick() at 60ms schedules everything
    // due within 0.3s, so the loop is drift-free and mute takes effect within
    // one window.
    // Normal: menacing Am–F–Dm–E7, ~107 BPM, square melody, sustained bass drones
    const MUSIC = {
        step: 0.28,
        melody: [
            220.00, null, null, 233.08, 261.63, null, null, null,
            293.66, null, 261.63, null, 233.08, 220.00, null, null,
            220.00, null, 246.94, 233.08, null, null, 196.00, null,
            207.65, null, null, 246.94, null, 220.00, null, null,
        ],
        bass: [
            110.00, null, null, null, null, null, null, null,
            87.31,  null, null, null, null, null, null, null,
            73.42,  null, null, null, null, null, null, null,
            82.41,  null, null, null, null, null, null, null,
        ],
        wave: 'square',
        melodyVol: 0.05,
        bassVol: 0.09,
        bassDurMul: 7.8, // sustained drone
    };

    // Boss: high-stress A-minor, ~143 BPM, sawtooth melody, pumping eighth-note bass.
    // No rests in the melody — relentless drive. Chromatic grinds (B3↔A3, G#3 under E7)
    // keep tension high. The bass pumps every eighth for a driving heartbeat.
    const BOSS_MUSIC = {
        step: 0.21,
        melody: [
            220.00, 220.00, 261.63, 220.00, 246.94, 220.00, 196.00, 220.00, // Am: A A C A Bb A G A
            174.61, 174.61, 220.00, 174.61, 196.00, 174.61, 220.00, 174.61, // F:  F F A F G  F A F
            293.66, 293.66, 349.23, 293.66, 329.63, 293.66, 261.63, 293.66, // Dm: D D F D E  D C D
            164.81, 207.65, 329.63, 207.65, 185.00, 164.81, 155.56, 164.81, // E7: E G# E4 G# F# E D# E
        ],
        bass: [
            110.00, 110.00, 110.00, 110.00, 110.00, 110.00, 110.00, 110.00,
            87.31,  87.31,  87.31,  87.31,  87.31,  87.31,  87.31,  87.31,
            73.42,  73.42,  73.42,  73.42,  73.42,  73.42,  73.42,  73.42,
            82.41,  82.41,  82.41,  82.41,  82.41,  82.41,  82.41,  82.41,
        ],
        wave: 'sawtooth',
        melodyVol: 0.04,
        bassVol: 0.10,
        bassDurMul: 0.85, // short punchy hits, not drones
    };

    const TRACKS = { normal: MUSIC, boss: BOSS_MUSIC };
    let activeTrack = MUSIC;
    let musicTimer = null;
    let musicStep = 0;
    let musicNext = 0;

    function musicTick() {
        if (!ctx || !musicTimer) return;
        const tr = activeTrack;
        while (musicNext < ctx.currentTime + 0.3) {
            const i = musicStep % tr.melody.length;
            const m = tr.melody[i];
            const b = tr.bass[i];
            if (!muted) {
                if (m) tone({ type: tr.wave, from: m, to: m, dur: tr.step * 0.9, vol: tr.melodyVol, delay: musicNext - ctx.currentTime });
                if (b) tone({ type: 'triangle', from: b, to: b, dur: tr.step * tr.bassDurMul, vol: tr.bassVol, delay: musicNext - ctx.currentTime });
            }
            musicStep++;
            musicNext += tr.step;
        }
    }

    function startMusic(track) {
        if (!ctx) return;
        stopMusic();
        activeTrack = TRACKS[track] || MUSIC;
        musicStep = 0;
        musicNext = ctx.currentTime + 0.1;
        musicTimer = setInterval(musicTick, 60);
        musicTick();
    }

    function stopMusic() {
        if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    }

    return {
        unlock,
        shoot:    () => tone({ type: 'square',   from: 880, to: 160, dur: 0.12, vol: 0.07 }),
        boom:     () => { noise({ dur: 0.25, vol: 0.25, cutoff: 900 }); tone({ type: 'triangle', from: 220, to: 40, dur: 0.2, vol: 0.12 }); },
        hit:      () => tone({ type: 'square', from: 300, to: 180, dur: 0.06, vol: 0.08 }),  // wounded tier, not a kill
        shield:   () => tone({ type: 'triangle', from: 500, to: 220, dur: 0.05, vol: 0.05 }), // bullet eats a shield tile
        powerup:  () => {
            // bright ascending major arpeggio — "you got a bonus!"
            tone({ type: 'square', from: 440, to: 440, dur: 0.08, vol: 0.10 });
            tone({ type: 'square', from: 554.4, to: 554.4, dur: 0.08, vol: 0.10, delay: 0.08 });
            tone({ type: 'square', from: 659.3, to: 659.3, dur: 0.12, vol: 0.12, delay: 0.16 });
        },
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
        bossAppear: () => {
            // rising menace: low sawtooth swell + a dissonant two-note sting
            tone({ type: 'sawtooth', from: 60, to: 180, dur: 0.5, vol: 0.14 });
            tone({ type: 'square', from: 220, to: 233, dur: 0.5, vol: 0.08, delay: 0.1 });
        },
        bossDie: () => {
            // core collapse: big downward saw crash + noise blast + rising shock ring
            noise({ dur: 0.6, vol: 0.3, cutoff: 600 });
            tone({ type: 'sawtooth', from: 200, to: 30, dur: 0.7, vol: 0.2 });
            tone({ type: 'triangle', from: 100, to: 400, dur: 0.4, vol: 0.12, delay: 0.2 });
        },
        startMusic,
        stopMusic,
        musicRunning: () => musicTimer !== null,
        setMuted: (m) => { muted = !!m; },
        isMuted: () => muted,
    };
})();

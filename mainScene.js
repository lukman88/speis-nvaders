// mainScene.js
// Enemy-side speed/fire-rate multipliers per difficulty. Easy = 25% slower than
// the original tuning (1.0 = Normal), +5% per step above Normal.
const DIFFICULTIES = ['EASY', 'NORMAL', 'HARD', 'VERY HARD'];
const DIFFICULTY_MUL = [0.75, 1, 1.3, 1.6];
// Easy halves enemy HP (fewer shots to kill) and fires 50% less often.
// Hard/Very Hard keep base HP but fire faster.
const DIFFICULTY_HP_MUL   = [0.5, 1, 1, 1];
const DIFFICULTY_FIRE_MUL = [1.6, 1, 0.75, 0.55]; // multiplies shot interval: higher = fewer shots

// --- High score persistence (localStorage; survives reload, degrades to 0 in private mode) ---
const HIGHSCORE_KEY = 'si-highscore';
function loadHighScore() {
    try { return parseInt(localStorage.getItem(HIGHSCORE_KEY), 10) || 0; } catch (e) { return 0; }
}
function saveHighScore(v) {
    try { localStorage.setItem(HIGHSCORE_KEY, String(v)); } catch (e) { /* storage unavailable */ }
}

class MainScene extends Phaser.Scene {
    constructor() {
        super('MainScene');
    }

    create() {
        this.createTextures();
        console.info('[SI] mainScene rev: per-wave starfield + css 3d title'); // fingerprint — if the console doesn't show this after reload, the browser cached an old copy
        this.createStarfield();

        // --- Input (keys created once — JustDown only works on persistent key objects) ---
        this.cursors = this.input.keyboard.createCursorKeys();
        this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this.restartKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
        this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
        this.escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
        this.mKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.M);
        // All persistent input listeners live in registerInputListeners() — see
        // the comment there for why they must not be re-registered per restart.
        this.registerInputListeners();

        this.soundOn = !sfx.isMuted(); // mute state is global, survives scene restarts







        this.highScore = loadHighScore();
        // Touch/mouse: drag to move the ship, hold to auto-fire.
        this.pointerX = null;
        this.pointerHeld = false;

        this.showTitle();
    }

    // One-time input listeners. create() re-runs on every scene.restart()
    // (R restart, QUIT TO TITLE), and re-adding these document/window handlers
    // each time stacks another copy per restart — every later tap then runs
    // N copies of the same handler. The scene object persists across restarts,
    // so registering once for its lifetime is enough.
    registerInputListeners() {
        if (this.inputListenersRegistered) return;
        this.inputListenersRegistered = true;

        // Browsers only allow audio after a user gesture; any keypress counts
        this.input.keyboard.on('keydown', () => sfx.unlock());
        // Mobile browsers require a native DOM user gesture to unlock AudioContext;
        // Phaser's pointer events don't always carry the user-activation flag.
        document.addEventListener('touchstart', () => sfx.unlock(), { once: true, passive: true });
        document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

        // Mobile mute button (DOM overlay, top-right corner)
        const muteBtn = document.getElementById('mute-btn');
        if (muteBtn) muteBtn.addEventListener('click', () => this.toggleSound());
        // Fullscreen toggle (desktop only — iOS Safari lacks requestFullscreen for divs).
        // Refresh the scale once the transition promise resolves: the fullscreenchange
        // listener's rAF/timeout refresh can measure the pre-transition layout and
        // leave the canvas sized for the wrong box (zoomed-in/overflowing canvas).
        const fsBtn = document.getElementById('fs-btn');
        if (fsBtn) fsBtn.addEventListener('click', () => {
            if (document.fullscreenElement) document.exitFullscreen().then(() => this.scale.refresh(), () => {});
            else this.goFullscreen();
        });
        // Menu button (mobile): return to title screen
        const menuBtn = document.getElementById('menu-btn');
        if (menuBtn) menuBtn.addEventListener('pointerdown', () => this.goToTitle());

        // Re-measure the canvas when the window resizes or the phone rotates.
        // Critical: the container is display:none in portrait, so Phaser can't
        // size the canvas on init. This refresh picks up the new size after rotation.
        window.addEventListener('resize', () => this.scale.refresh());
        // Delay: CSS media queries need a tick to apply before Phaser measures
        window.addEventListener('orientationchange', () => {
            setTimeout(() => this.scale.refresh(), 150);
        });
        // rAF x2 + timeout: wait for the browser to finish relayout after fullscreen change.
        // Exiting fullscreen can leave the canvas zoomed in if refresh fires before
        // the container's CSS dimensions are updated.
        document.addEventListener('fullscreenchange', () => {
            requestAnimationFrame(() => requestAnimationFrame(() => this.scale.refresh()));
            setTimeout(() => this.scale.refresh(), 150);
        });

        // Touch/mouse: drag to move the ship, hold to auto-fire. DOM-level so taps
        // outside the canvas (letterbox areas on mobile) also control the ship.
        const canvas = this.game.canvas;
        const toGameX = (clientX) => {
            const r = canvas.getBoundingClientRect();
            return r.width > 0 ? Phaser.Math.Clamp((clientX - r.left) / r.width * 800, 0, 800) : null;
        };
        // One owner for the game-over/stage-clear transitions: this DOM handler
        // sees every tap, inside and outside the canvas, so the gesture means the
        // same thing everywhere and a single tap can't be double-handled by a
        // second (Phaser) pointer listener. The transitions run synchronously, so
        // no tap flags are needed — the state has changed before the next tap lands.
        document.addEventListener('pointerdown', (e) => {
            if (e.target.closest('#mute-btn') || e.target.closest('#menu-btn')) return;
            if (this.gameState === 'gameover') { this.goToTitle(); return; }
            if (this.gameState === 'stageclear' && this.stageClearReady) { this.nextWave(); return; }
            const gx = toGameX(e.clientX);
            if (gx !== null) { this.pointerX = gx; this.pointerHeld = true; }
        });
        document.addEventListener('pointermove', (e) => {
            if (!this.pointerHeld) return;
            if (e.target.closest('#mute-btn') || e.target.closest('#menu-btn')) return;
            const gx = toGameX(e.clientX);
            if (gx !== null) this.pointerX = gx;
        });
        document.addEventListener('pointerup', () => { this.pointerHeld = false; });
    }

    // Title screen. A state, not a scene: this build's SceneManager mangles
    // object-form scene entries ({key, scene}) — the key ends up pointing at a
    // bare Scene with no create(), so scene arrays beyond [OneScene] are off-limits.
    showTitle() {
        this.gameState = 'title'; // 'title' | 'playing' | 'stageclear' | 'paused' | 'gameover'
        this.titleUI = this.add.container(0, 0);
        this.title3dEl = document.getElementById('title-3d'); // 3D title overlay, see index.html

        // Classic invader logo from a pixel matrix, 2-frame walk animation
        const frames = [
            [
                '..X.........X..',
                '...X.......X...',
                '...XXXXXXXXX...',
                '..XX.XXXXX.XX..',
                'XXXXXXXXXXXXXXX',
                'X.XXXXXXXXXXX.X',
                'X.XXXXXXXXXXX.X',
                '...XX.XXX.XX...',
            ],
            [
                '..X.........X..',
                '.X..X.....X..X.',
                '.X.XXXXXXXX.X.X',
                'XXX.XXXXXXX.XXX',
                'X.XXXXXXXXXXX.X',
                'X.XXXXXXXXXXX.X',
                'X.XXXXXXXXXXX.X',
                '..XX.......XX..',
            ],
        ];
        const cell = 8;
        const lg = this.add.graphics();
        const draw = (f) => {
            const rows = frames[f];
            lg.clear();
            lg.fillStyle(0x44ff66, 1);
            const ox = 400 - (rows[0].length * cell) / 2;
            rows.forEach((row, y) => {
                for (let x = 0; x < row.length; x++) {
                    if (row[x] === 'X') lg.fillRect(ox + x * cell, 110 + y * cell, cell, cell);
                }
            });
        };
        this.logoFrame = 0;
        draw(this.logoFrame);
        this.titleUI.add(lg);
        this.logoTimer = this.time.addEvent({
            delay: 500, loop: true,
            callback: () => { this.logoFrame = 1 - this.logoFrame; draw(this.logoFrame); },
        });

        // 3D title is a DOM overlay (index.html #title-3d): this build has no skew API and
        // its generated-texture pipeline is buggy, so CSS perspective + text-shadow wins
        if (this.title3dEl) this.title3dEl.classList.add('on');
        // --- Difficulty picker (neon arcade style) ---
        this.difficulty = 1;
        const diffGlow = 0x2de1ff; // cyan
        const refreshDiff = () => {
            this.diffBtns.forEach((b, j) => {
                const sel = j === this.difficulty;
                b.rect.setStrokeStyle(2, sel ? diffGlow : 0x1a3a4a, sel ? 1 : 0.5);
                b.rect.setFillStyle(sel ? 0x0a2a3a : 0x0a1520);
                b.glow.fillStyle(diffGlow, sel ? 0.25 : 0.06);
                b.glow.fillRoundedRect(190 + j * 140 - 70 - 4, 300 - 26, 148, 52, 6);

                b.label.setColor(sel ? '#fff' : '#4a8a9a');
            });
        };
        this.diffBtns = DIFFICULTIES.map((name, i) => {
            const x = 190 + i * 140;
            const glow = this.add.graphics();
            glow.fillStyle(diffGlow, 0.06);
            glow.fillRoundedRect(x - 70 - 4, 300 - 26, 148, 52, 6);

            const rect = this.add.rectangle(x, 300, 128, 44, 0x0a1520, 1)

                .setStrokeStyle(2, 0x1a3a4a, 0.5)
                .setInteractive({ useHandCursor: true });
            const label = this.add.text(x, 300, name, { fontFamily: 'monospace', fontSize: '15px', color: '#4a8a9a', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);

            rect.on('pointerover', () => { if (i !== this.difficulty) { rect.setFillStyle(0x0f2535); rect.setStrokeStyle(2, 0x2de1ff, 0.7); } });
            rect.on('pointerout', refreshDiff);
            rect.on('pointerdown', () => { this.difficulty = i; refreshDiff(); sfx.shoot(); });
            this.titleUI.add([glow, rect, label]);
            return { rect, label, glow };
        });
        refreshDiff();

        // --- START GAME (pulsing green neon) ---
        const startGlow = this.add.graphics();
        startGlow.fillStyle(0x44ff66, 0.2);
        startGlow.fillRoundedRect(400 - 128, 395 - 36, 264, 76, 8);

        const startBtn = this.add.rectangle(400, 395, 240, 64, 0x0a1a10, 1)

            .setStrokeStyle(3, 0x44ff66, 0.9)
            .setInteractive({ useHandCursor: true });
        const startShadow = this.add.text(400, 397, 'START GAME', { fontFamily: 'monospace', fontSize: '28px', color: 0x44ff66, stroke: '#000', strokeThickness: 5 }).setOrigin(0.5).setAlpha(0.4);

        const startLabel = this.add.text(400, 395, 'START GAME', { fontFamily: 'monospace', fontSize: '28px', color: '#fff', stroke: '#003311', strokeThickness: 2 }).setOrigin(0.5);

        startBtn.on('pointerover', () => {
            startBtn.setFillStyle(0x1a3a28);
            startBtn.setStrokeStyle(3, 0x66ff88, 1);
            startGlow.fillStyle(0x44ff66, 0.35);
                startGlow.fillRoundedRect(400 - 130, 395 - 38, 268, 80, 10);

        });
        startBtn.on('pointerout', () => {
            startBtn.setFillStyle(0x0a1a10);
            startBtn.setStrokeStyle(3, 0x44ff66, 0.9);
            startGlow.fillStyle(0x44ff66, 0.2);
                startGlow.fillRoundedRect(400 - 128, 395 - 36, 264, 76, 8);

        });
        startBtn.on('pointerdown', () => this.startGame());
        // Pulsing glow animation
        this.tweens.add({ targets: startGlow, alpha: 0.5, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
        this.titleUI.add([startGlow, startBtn, startShadow, startLabel]);

        // --- High score ---
        this.titleUI.add(this.add.text(400, 180, 'HIGH SCORE', { fontFamily: 'monospace', fontSize: '14px', color: '#886622', stroke: '#000', strokeThickness: 2 }).setOrigin(0.5));


        this.titleUI.add(this.add.text(400, 205, String(this.highScore).padStart(5, '0'), { fontFamily: 'monospace', fontSize: '22px', color: '#ffd23d', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5));




        // --- Sound toggle (magenta accent) ---
        const sndGlow = this.add.graphics();
        sndGlow.fillStyle(0xff2d78, 0.08);
        sndGlow.fillRoundedRect(400 - 124, 470 - 26, 252, 52, 6);

        const sndBtn = this.add.rectangle(400, 470, 240, 48, 0x1a0a12, 1)

            .setStrokeStyle(2, 0xff2d78, 0.6)
            .setInteractive({ useHandCursor: true });
        const sndLabel = this.add.text(400, 470, 'SOUND: ' + (this.soundOn ? 'ON' : 'OFF'), { fontFamily: 'monospace', fontSize: '18px', color: this.soundOn ? '#ff6699' : '#663344', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);

        sndBtn.on('pointerover', () => { sndBtn.setFillStyle(0x2a1520); sndBtn.setStrokeStyle(2, 0xff4488, 0.9); });
        sndBtn.on('pointerout', () => { sndBtn.setFillStyle(0x1a0a12); sndBtn.setStrokeStyle(2, 0xff2d78, 0.6); sndLabel.setColor(this.soundOn ? '#ff6699' : '#663344'); });
        sndBtn.on('pointerdown', () => this.toggleSound());
        this.titleUI.add([sndGlow, sndBtn, sndLabel]);
        this.muteLabel = sndLabel;
    }

    // Interactive button: rectangle takes the input, text is just the label
    makeButton(parent, x, y, w, h, text, cb, fontSize = '22px') {
        const btn = this.add.rectangle(x, y, w, h, 0x0d2818, 1).setInteractive({ useHandCursor: true });
        const label = this.add.text(x, y, text, { fontFamily: 'monospace', fontSize, color: '#44ff66' }).setOrigin(0.5);
        btn.on('pointerover', () => btn.setFillStyle(0x1d4d33));
        btn.on('pointerout', () => btn.setFillStyle(0x0d2818));
        btn.on('pointerdown', () => cb());
        parent.add([btn, label]);
        return { btn, label };
    }

    // M key and the title/pause sound buttons all funnel here. muteLabel is a
    // reference into a UI container (title/pause) that gets destroyed, so guard
    // against writing into a dead Text (that threw and killed the game loop).
    toggleSound() {
        this.soundOn = !this.soundOn;
        sfx.setMuted(!this.soundOn);
        if (this.soundOn) sfx.shoot(); // confirmation blip only when unmuting
        if (this.muteLabel && !this.muteLabel.destroyed) {
            this.muteLabel.setText('SOUND: ' + (this.soundOn ? 'ON' : 'OFF'));
            this.muteLabel.setColor(this.soundOn ? '#ff6699' : '#663344');
        }

        const mb = document.getElementById('mute-btn');
        if (mb) mb.textContent = this.soundOn ? '\u{1F50A}' : '\u{1F507}';
    }
    goFullscreen() {
        const el = document.getElementById('game-container');
        // Refresh once the browser has actually entered fullscreen (the promise
        // resolves after the transition), so scale.refresh measures the new box.
        if (el && el.requestFullscreen) el.requestFullscreen().then(() => this.scale.refresh()).catch(() => {});
    }

    // Menu button: clean up all game state and return to title
    goToTitle() {
        sfx.stopMusic();
        sfx.stopMarch();
        this.physics.pause();
        if (this.titleUI) { this.titleUI.destroy(); this.titleUI = null; this.muteLabel = null; }
        if (this.stageClearUI) { this.stageClearUI.destroy(); this.stageClearUI = null; }
        if (this.pauseUI) { this.pauseUI.destroy(); this.pauseUI = null; }
        if (this.gameOverUI) { this.gameOverUI.destroy(); this.gameOverUI = null; }
        // Power-up visuals are scene-level; update() returns early in the 'title'
        // state, so their "hide when expired" branch never runs — tear them down here.
        if (this.shieldBubble) { this.shieldBubble.destroy(); this.shieldBubble = null; }
        if (this.laserSprite) { this.laserSprite.destroy(); this.laserSprite = null; }

        if (this.invaderGroup) this.invaderGroup.clear(true);
        if (this.playerBullets) this.playerBullets.clear(true);
        if (this.enemyBullets) this.enemyBullets.clear(true);
        if (this.bossHazards) this.bossHazards.clear(true);
        if (this.bossGroup) this.bossGroup.clear(true);
        if (this.powerUps) this.powerUps.clear(true);
        if (this.ufoGroup) this.ufoGroup.clear(true);
        if (this.shields) { this.shields.forEach(s => s.destroy()); this.shields = null; }
        if (this.player) { this.player.destroy(); this.player = null; }
        this.boss = null;
        this.ufo = null;
        if (this.hud) { this.hud.destroy(); this.hud = null; }
        this.gameState = 'title';
        this.score = 0;
        this.lives = 3;
        this.waveCounter = 1;
        this.showTitle();
    }


    startGame() {
        if (this.title3dEl) this.title3dEl.classList.remove('on');
        if (this.titleUI) { this.titleUI.destroy(); this.titleUI = null; this.muteLabel = null; }
        sfx.unlock(); // pointerdown/keydown are user gestures — audio is allowed now
        sfx.shoot();
        sfx.startMusic(); // chiptune loop until game over / quit to title
        this.physics.resume(); // showPause() pauses it
        // Auto-fullscreen is a mobile-only affordance: Chrome desktop grew the
        // element Fullscreen API, so the old "no-op on desktop" is no longer true
        // and the game jumped zoomed-in on start. Desktop keeps the fs-btn opt-in.
        if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) this.goFullscreen();

        // --- Game state ---
        this.gameState = 'playing';
        this.score = 0;
        this.lives = 3;
        this.waveCounter = 1;
        this.diffMul = DIFFICULTY_MUL[this.difficulty || 0]; // enemy speed + fire-rate scale
        this.hpMul   = DIFFICULTY_HP_MUL[this.difficulty || 0];   // enemy HP scale (easy = half)
        this.fireMul = DIFFICULTY_FIRE_MUL[this.difficulty || 0]; // shot interval scale (easy = fewer shots)
        this.moveDirection = 1;      // 1 for moving right, -1 for moving left
        this.freezeUntil = 0;        // hit-stop gate, see update()

        // --- Shooting state ---
        this.lastShotTime = 0;
        this.bulletCooldown = 200;   // milliseconds between player shots
        this.lastEnemyShotTime = 0;
        this.lastDiveTime = 0;
        this.enemyShotInterval = 1000;

        // --- Player ---
        this.player = this.physics.add.sprite(400, 550, 'player-a');
        this.player.setCollideWorldBounds(true);
        this.player.setDepth(10);

        // --- Bullet groups (velocity in config: groups zero child velocity on add) ---
        this.playerBullets = this.physics.add.group({ classType: BulletBullet, velocityY: -800 });
        this.enemyBullets = this.physics.add.group({ classType: EnemyBullet, velocityY: 350 * this.diffMul });

        // --- Invaders (spawned once per wave) ---
        this.invaderGroup = this.physics.add.group();
        // Boss (every 3rd wave): its 6 members live in bossGroup; detached parts
        // fall as hazards in bossHazards. beginWave() picks boss vs formation.
        this.bossGroup = this.physics.add.group();
        this.bossHazards = this.physics.add.group({ classType: BossHazard, velocityY: 240 * this.diffMul });
        this.ufoGroup = this.physics.add.group();
        this.boss = null;
        this.isBossWave = false;
        this.beginWave();

        // --- Shields: four classic destructible barriers, restored fresh each wave ---
        this.shields = [76, 276, 476, 676].map(x => new Shield(this, x, 495));

        // --- Power-ups: falling gifts that grant temporary combat boosts ---
        this.powerUps = this.physics.add.group({ classType: PowerUp });
        this.rapidUntil = 0;   // timestamp when rapid-fire expires
        this.spreadUntil = 0;  // timestamp when spread-shot expires
        this.killsSinceDrop = 0; // guaranteed-drop cadence counter
        this.shieldUntil = 0;   // timestamp when shield-bubble expires
        this.laserUntil = 0;    // timestamp when laser beam expires
        this.slowMoUntil = 0;   // timestamp when slow-mo expires
        this.ghostUntil = 0;    // timestamp when ghost mode expires
        this.blackholeUntil = 0;// timestamp when black hole expires
        this.shieldBubble = null; // visual dome sprite (created on pickup)
        this.laserSprite = null;  // visual beam sprite (created on pickup)

        // --- Combo: rapid-kill multiplier (×2–×5), resets after 1.5s idle ---
        this.comboCount = 0;
        this.lastKillTime = 0;

        // --- UFO / Mystery ship: appears every 15–25s, worth 50–300 pts ---
        this.ufo = null;
        this.ufoNextSpawn = this.time.now + 15000;
        this.totalInvaders = 0;

        // Shared 2-frame walk cycle, synced across the whole formation
        // ponytail: fixed 400ms tick; the arcade original ties the step to march speed.
        // No TimerEvent.pause() in this build, so freezing is a flag the tick checks.
        this.invaderFrame = 0;
        this.invaderAnimOff = false;
        this.invaderAnim = this.time.addEvent({
            delay: 400, loop: true,
            callback: () => {
                if (this.invaderAnimOff) return;
                this.invaderFrame = 1 - this.invaderFrame;
                const key = this.invaderFrame ? 'invader2' : 'invader';
                this.invaderGroup.children.iterate(i => { if (i.isAlive) i.setTexture(key); });
            },
        });

        // --- HUD ---
        this.hudText = this.add.text(10, 8, '', { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff' });
        this.updateHud();
        // Power-up timer: shows remaining seconds for active boosts (updated every frame)
        this.powerupHud = this.add.text(10, 28, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ffd700' });

        // --- Impact FX: two one-shot particle emitters, repositioned per burst ---
        this.hitFX = this.add.particles(0, 0, 'spark', {
            speed: { min: 40, max: 160 },
            scale: { start: 0.7, end: 0 },
            alpha: { start: 1, end: 0 },
            lifespan: 300,
            emitting: false,
        }).setDepth(20);

        this.boomFX = this.add.particles(0, 0, 'spark', {
            speed: { min: 60, max: 260 },
            scale: { start: 1.5, end: 0 },   // 6px chunks shrinking to nothing
            alpha: { start: 1, end: 0 },
            rotation: { min: 0, max: 360 },
            rotate: { min: -300, max: 300 }, // tumble like debris
            lifespan: 600,
            emitting: false,
        }).setDepth(20);

        // --- Collisions ---
        // this build has no body.setInvincible, so invincibility is a plain time gate
        this.invincibleUntil = 0;
        this.physics.add.overlap(this.playerBullets, this.invaderGroup, (bullet, invader) => {
            if (!invader.isAlive || bullet.destroyed) return;
            const died = invader.takeDamage();
            bullet.destroy();
            if (died) {
                // Combo: kills within 1.5s of each other build a ×2–×5 multiplier
                const now = this.time.now;
                this.comboCount = (now - this.lastKillTime < 1500) ? this.comboCount + 1 : 1;
                this.lastKillTime = now;
                const comboMul = Math.min(this.comboCount, 5);
                this.score += invader.points * this.waveCounter * comboMul;
                sfx.boom();
                // Power-up drop: 5% chance per kill, guaranteed every 15 kills
                this.killsSinceDrop++;
                if (this.killsSinceDrop >= 15 || Math.random() < 0.05) {
                    this.killsSinceDrop = 0;
                    const types = ['rapid', 'spread', 'shield', 'laser', 'slowmo', 'ghost', 'blackhole'];
                    const type = types[Math.floor(Math.random() * types.length)];
                    this.powerUps.create(invader.x, invader.y, type);
                }
                // wave-cleared hand-off happens in update() — one check for every death path
            } else {
                // Wounded tier: flash + tick, no score
                sfx.hit();
                this.tweens.add({ targets: invader, scale: 1.35, duration: 60, yoyo: true });
            }
        });

        // Boss: player bullets erode parts / the core (boss waves only; bossGroup is empty otherwise)
        this.physics.add.overlap(this.playerBullets, this.bossGroup, (bullet, part) => {
            if (!this.boss || !part.body) return;
            bullet.destroy();
            const result = this.boss.hitBullet(part);
            if (result === 'wounded') {
                sfx.hit();
            } else if (result === 'detached') {
                this.score += 50;
                this.updateHud();
            } // 'defeated' is handled by the boss -> onBossDefeated()
        });

        // UFO: player bullets score 50–300 pts, 30% chance to drop a power-up
        this.physics.add.overlap(this.playerBullets, this.ufoGroup, (bullet, ufo) => {
            if (!ufo || ufo.destroyed) return;
            bullet.destroy();
            ufo.destroy();
            this.ufo = null;
            const pts = 50 + Math.floor(Math.random() * 6) * 50; // 50,100,...,300
            this.score += pts;
            sfx.boom();
            this.burst(this.boomFX, ufo.x, ufo.y, 0xaa66ee, 20);
            this.updateHud();
            if (Math.random() < 0.3) {
                const types = ['rapid', 'spread', 'shield', 'laser', 'slowmo', 'ghost', 'blackhole'];
                this.powerUps.create(ufo.x, ufo.y, types[Math.floor(Math.random() * types.length)]);
            }
        });

        // Detached parts fall as hazards: they cost a life, same as a bullet hit
        this.physics.add.overlap(this.player, this.bossHazards, (player, hazard) => {
            if (this.gameState !== 'playing') return;
            if (this.time.now < this.invincibleUntil) return;
            hazard.destroy();
            this.loseLife();
        });

        // this build calls single-body×group handlers as (sprite, groupChild)
        this.physics.add.overlap(this.player, this.enemyBullets, (player, bullet) => {
            if (bullet && bullet.body) bullet.destroy(); // absorb the bullet even while invincible
            // Ghost mode: bullets pass through harmlessly
            if (this.time.now < this.ghostUntil) return;
            this.burst(this.hitFX, player.x, player.y - 10, 0xff5555, 10);
            if (this.time.now < this.invincibleUntil) return;
            this.loseLife();
        });

        // Power-up collection: player overlap grants the timed effect
        const PU_DUR = { rapid: 8000, spread: 8000, shield: 5000, laser: 3000, slowmo: 6000, ghost: 4000, blackhole: 4000 };
        const PU_TINT = { rapid: 0xffd700, spread: 0x00e5ff, shield: 0x00e5ff, laser: 0xff3333, slowmo: 0x3366ff, ghost: 0xddddff, blackhole: 0xaa44ff };
        this.physics.add.overlap(this.player, this.powerUps, (player, pu) => {
            if (!pu || pu.destroyed) return;
            const now = this.time.now;
            const dur = PU_DUR[pu.puType] || 8000;
            switch (pu.puType) {
                case 'rapid': this.rapidUntil = now + dur; break;
                case 'spread': this.spreadUntil = now + dur; break;
                case 'shield':
                    this.shieldUntil = now + dur;
                    if (!this.shieldBubble) {
                        this.shieldBubble = this.add.circle(0, 0, 28, 0x00e5ff, 0.15).setStrokeStyle(2, 0x00e5ff, 0.6).setDepth(20).setVisible(false);
                    }
                    break;
                case 'laser':
                    this.laserUntil = now + dur;
                    if (!this.laserSprite) {
                        this.laserSprite = this.add.rectangle(0, 0, 4, 600, 0xff3333, 0.7).setDepth(15).setVisible(false);
                    }
                    break;
                case 'slowmo': this.slowMoUntil = now + dur; break;
                case 'ghost': this.ghostUntil = now + dur; break;
                case 'blackhole': this.blackholeUntil = now + dur; break;
            }
            sfx.powerup();
            this.burst(this.boomFX, pu.x, pu.y, PU_TINT[pu.puType] || 0xffffff, 16);
            pu.destroy();
        });
    }

    // One-shot particle burst at (x, y). emitter is preconfigured, we just aim + tint + fire.
    burst(emitter, x, y, tint, count) {
        emitter.setPosition(x, y);
        emitter.setParticleTint(tint);
        emitter.explode(count);
    }

    // Slow-mo rescale for anything with momentum (bullets, divers, boss hazards).
    // Bodies carry _slowFactor so the rescale is applied once per state change,
    // never compounded per frame. Gravity scales by ratio² alongside velocity:
    // fireArcAt()/diveAt() set a matched velocity+gravity pair calibrated to hit
    // a locked target at t = T, and scaling gravity by ratio² keeps that parabola
    // exact — the body just traverses it slower and still lands on target.
    applySlowMo(list, mul) {
        for (const o of list) {
            if (!o.body) continue;
            const prev = o._slowFactor || 1;
            if (prev !== mul) {
                const ratio = mul / prev;
                o.body.velocity.x *= ratio;
                o.body.velocity.y *= ratio;
                o.body.gravity.y *= ratio * ratio;
                o._slowFactor = mul;
            }
        }
    }

    update(time, delta) {
        // M mutes/unmutes in any state (title, playing, pause, game over)
        if (Phaser.Input.Keyboard.JustDown(this.mKey)) this.toggleSound();

        if (this.gameState === 'title') {
            // Enter or Space both start: Space is the muscle-memory key (it fires in-game)
            if (Phaser.Input.Keyboard.JustDown(this.enterKey) || Phaser.Input.Keyboard.JustDown(this.spaceKey)) this.startGame();
            return;
        }

        if (this.gameState === 'paused') {
            if (Phaser.Input.Keyboard.JustDown(this.escKey)) this.resumeGame();
            return;
        }

        if (this.gameState === 'gameover') {
            if (Phaser.Input.Keyboard.JustDown(this.restartKey)) this.scene.restart();
            return;
        }

        if (this.gameState === 'stageclear') {
            this.updateStarfield(); // keep the break screen alive with drifting stars
            // Only advance once the fly-through has finished and the message is on screen
            if (this.stageClearReady && Phaser.Input.Keyboard.JustDown(this.spaceKey)) this.nextWave();
            return;
        }

        // Esc pauses mid-play (only reachable in 'playing' at this point)
        if (Phaser.Input.Keyboard.JustDown(this.escKey)) { this.showPause(); return; }

        // Hit-stop: brief full freeze after losing a life so the loss lands (see loseLife)
        if (this.time.now < this.freezeUntil) return;


        // 0. Wave cleared: the last invader can also die off-screen (diving arc) or by
        //    ramming the player, neither of which goes through the bullet overlap handler.
        //    Boss waves have no formation (invaderGroup is empty) — the boss ends its own wave.
        if (!this.isBossWave && this.invaderGroup.countActive(true) === 0) { this.showStageClear(); return; }

        // 0. Background drift (scenery keeps moving even when the player waits)
        this.updateStarfield();

        // 1. Player movement + afterburner flicker (swap short/long flame textures ~12fps)
        this.player.setTexture(Math.floor(this.time.now / 85) % 2 ? 'player-b' : 'player-a');
        let vx = 0;
        if (this.cursors.left.isDown) {
            vx = -300;
        } else if (this.cursors.right.isDown) {
            vx = 300;
        } else if (this.pointerX !== null && this.pointerHeld) {
            // Touch/mouse: proportional pull toward the finger, clamped to ship speed
            vx = Phaser.Math.Clamp((this.pointerX - this.player.x) * 6, -300, 300);
        }
        this.player.setVelocityX(vx);
        // Bank into the turn: ease the ship toward a lean in the travel direction, level out when coasting
        const targetAngle = vx < 0 ? -10 : vx > 0 ? 10 : 0;
        this.player.setAngle(Phaser.Math.Linear(this.player.angle, targetAngle, 0.3));

        // 2. Player shooting (hold to auto-fire; the cooldown still caps the rate)
        // Rapid power-up halves the cooldown; spread fires a 3-way fan
        if (this.spaceKey.isDown || (this.pointerHeld && this.pointerX !== null)) { // touch: hold to auto-fire
            const now = this.time.now;
            const rapidActive = now < this.rapidUntil;
            const cooldown = rapidActive ? this.bulletCooldown * 0.5 : this.bulletCooldown;
            if (now - this.lastShotTime > cooldown) {
                const spreadActive = now < this.spreadUntil;
                if (spreadActive) {
                    // 3-way fan: center + ±12°
                    const baseVY = -800;
                    const angles = [-0.21, 0, 0.21]; // radians (~±12°)
                    for (const a of angles) {
                        const b = this.playerBullets.create(this.player.x, this.player.y - 65);
                        b.setVelocity(Math.sin(a) * baseVY, Math.cos(a) * baseVY);
                    }
                } else {
                    this.playerBullets.create(this.player.x, this.player.y - 65);
                }
                this.lastShotTime = now;
                sfx.shoot();
            }
        }

        // 2.5 Shields: both bullet types erode tiles and stop on contact
        for (const b of this.playerBullets.getChildren().slice()) {
            if (!b.body) continue;
            for (const s of this.shields) {
                if (s.erode(b.body.left, b.body.top, b.body.width, b.body.height)) { b.destroy(); sfx.shield(); break; }
            }
        }
        for (const b of this.enemyBullets.getChildren().slice()) {
            if (!b.body) continue;
            for (const s of this.shields) {
                if (s.erode(b.body.left, b.body.top, b.body.width, b.body.height)) { b.destroy(); sfx.shield(); break; }
            }
        }

        // 3. Invader formation movement + enemy fire
        // getChildren() returns the LIVE group array — slice so any later destroy can't skew iteration
        const invaders = this.invaderGroup.getChildren().slice();

        // Slow-mo rescale: outside the formation gate below — boss waves have an
        // empty formation (the gate is skipped every frame), divers keep flying
        // on their locked parabolas, and the stage-intro swoop shouldn't gate
        // projectile slowing either.
        const slowMoMul = this.time.now < this.slowMoUntil ? 0.4 : 1;
        this.applySlowMo(this.playerBullets.getChildren().slice(), slowMoMul);
        this.applySlowMo(this.enemyBullets.getChildren().slice(), slowMoMul);
        this.applySlowMo(this.bossHazards.getChildren().slice(), slowMoMul);
        this.applySlowMo(invaders.filter(i => i.isAlive && i.diving), slowMoMul);

        if (invaders.length > 0 && !this.stageIntro) {
            let maxRight = -Infinity;
            let minLeft = Infinity;
            let maxBottom = -Infinity;
            for (const inv of invaders) {
                if (inv.diving) continue; // divers have left the formation; don't steer them or count their bounds
                if (inv.body.right > maxRight) maxRight = inv.body.right;
                if (inv.body.left < minLeft) minLeft = inv.body.left;
                if (inv.body.bottom > maxBottom) maxBottom = inv.body.bottom;
            }

            const margin = 10;
            const hitEdge =
                (this.moveDirection === 1 && maxRight >= this.sys.game.config.width - margin) ||
                (this.moveDirection === -1 && minLeft <= margin);

            if (hitEdge) {
                this.moveDirection *= -1;
                // Drop the formation — unless the next drop would land on the player.
                // Then it camps just above the ship and keeps strafing + firing:
                // only bullets can drain lives, the player can still fight their way out.
                if (maxBottom + Invader.VERTICAL_DROP <= this.player.y - 26) {
                    for (const inv of invaders) if (!inv.diving) inv.y += Invader.VERTICAL_DROP;
                }
            }

            const total = this.totalInvaders || invaders.length;
            const killed = total - invaders.filter(i => i.isAlive && !i.diving).length;
            const speed = (Invader.INITIAL_SPEED_X + (this.waveCounter - 1) * 20) * this.diffMul * slowMoMul * (1 + (killed / Math.max(1, total)) * 0.8);
            for (const inv of invaders) {
                if (!inv.isAlive || inv.diving) continue;
                inv.setVelocityX(speed * this.moveDirection);
            }

            const now = this.time.now;
            const alive = invaders.filter(i => i.isAlive);

            // Enemy fire: rate-limited, random shooter per volley.
            // Guard the empty list: once the last survivor is diving, pick([]) returns
            // undefined and attemptShoot() throws, killing the game loop (the stage-end freeze)
            const shooters = alive.filter(i => !i.diving);
            if (shooters.length > 0 && now - this.lastEnemyShotTime >= this.enemyShotInterval && Phaser.Math.RND.frac() < 0.5) {
                Phaser.Math.RND.pick(shooters).attemptShoot();
            }

            // Occasionally one invader breaks off and dives on the player.
            // A flashing "!" locks the strike point 700ms early so the player can dodge it.
            if (now - this.lastDiveTime >= 5000 / this.diffMul && Phaser.Math.RND.frac() < 0.5) { // harder = more frequent dives
                const candidates = alive.filter(i => !i.diving);
                if (candidates.length > 0) {
                    // Deeper rows dive more often (weight 1+row): "the lower they go, the scarier they get"
                    let total = 0;
                    for (const c of candidates) total += 1 + c.row;
                    let r = Phaser.Math.RND.frac() * total;
                    let inv = candidates[candidates.length - 1];
                    for (const c of candidates) { r -= 1 + c.row; if (r <= 0) { inv = c; break; } }
                    const tx = this.player.x, ty = this.player.y; // lock the strike point when the warning shows
                    this.lastDiveTime = now;
                    const warn = this.add.text(tx, ty - 50, '!', { fontFamily: 'monospace', fontSize: '32px', color: '#ff4444' })
                        .setOrigin(0.5).setDepth(30);
                    this.diveWarn = warn;
                    this.tweens.add({ targets: warn, alpha: 0, duration: 100, yoyo: true, repeat: 3 }); // ~700ms blink
                    this.time.delayedCall(700, () => {
                        warn.destroy();
                        this.diveWarn = null;
                        if (this.gameState === 'playing' && inv.isAlive) inv.diveAt(tx, ty);
                    });
                }
            }

            // Resolve dives: tumble through the air, hit the player, or fade off-screen
            const H = this.sys.game.config.height;
            const W = this.sys.game.config.width;
            for (const inv of invaders) {
                if (!inv.isAlive || !inv.diving) continue;
                inv.setAngle(Phaser.Math.RadToDeg(Math.atan2(inv.body.velocity.y, inv.body.velocity.x)) - 90);
                if (inv.y > H + 40 || inv.x < -40 || inv.x > W + 40) { inv.takeDamage(); continue; }
                if (Math.hypot(inv.x - this.player.x, inv.y - this.player.y) < 26) {
                    inv.takeDamage();
                    if (this.time.now < this.invincibleUntil) this.burst(this.hitFX, inv.x, inv.y, 0xff5555, 10); // blocked by the shield, no damage
                    else this.loseLife();
                }
            }
        }

        // 3b. Boss movement + attacks (boss waves have no formation, so the block above is skipped)
        if (this.isBossWave && this.boss && this.boss.alive) {
            this.boss.update(this.time.now, delta);
        }

        // 3a. March sound: tempo tracks remaining invaders (full = slow, few = fast)
        if (this.gameState === 'playing' && !this.isBossWave) {
            const aliveCount = invaders.filter(i => i.isAlive && !i.diving).length;
            if (aliveCount > 0) {
                sfx.setMarchTempo(aliveCount / Math.max(1, this.totalInvaders));
            }
        }

        // 3d. UFO / Mystery ship: spawn every 15–25s, cross the top, despawn off-screen
        if (this.gameState === 'playing') {
            const now = this.time.now;
            if (!this.ufo && now >= this.ufoNextSpawn) {
                const fromLeft = Math.random() < 0.5;
                this.ufo = this.physics.add.sprite(fromLeft ? -30 : 830, 42, 'ufo');
                this.ufo.setDepth(15);
                this.ufo.body.setAllowGravity(false);
                this.ufo.body.enable = true;
                this.ufoGroup.add(this.ufo);
                this.ufo.setVelocityX(fromLeft ? 120 : -120);
            }
            if (this.ufo && !this.ufo.destroyed) {
                if (this.ufo.x < -50 || this.ufo.x > 850) {
                    this.ufo.destroy();
                    this.ufo = null;
                }
            }
            // Schedule the next UFO appearance
            if (!this.ufo && now >= this.ufoNextSpawn + 5000) {
                this.ufoNextSpawn = now + 15000 + Math.random() * 10000;
            }
        }

        // 3e. Combo decay: if >1.5s since last kill, reset and refresh HUD
        if (this.comboCount > 0 && this.time.now - this.lastKillTime > 1500) {
            this.comboCount = 0;
            this.updateHud();
        }

        // 3c. Power-ups: drift, pulse, vanish off the bottom
        for (const pu of this.powerUps.getChildren().slice()) {
            if (pu.destroyed) continue;
            pu.update(this.time.now);
        }

        // 3d. Power-up HUD: show remaining seconds for active boosts
        const now = this.time.now;
        {
            const parts = [];
            const r = Math.max(0, this.rapidUntil - now);
            const s = Math.max(0, this.spreadUntil - now);
            const sh = Math.max(0, this.shieldUntil - now);
            const l = Math.max(0, this.laserUntil - now);
            const sm = Math.max(0, this.slowMoUntil - now);
            const g = Math.max(0, this.ghostUntil - now);
            const bh = Math.max(0, this.blackholeUntil - now);
            if (r > 0) parts.push('RAPID');
            if (s > 0) parts.push('SPREAD');
            if (sh > 0) parts.push('SHIELD');
            if (l > 0) parts.push('LASER');
            if (sm > 0) parts.push('SLOW-MO');
            if (g > 0) parts.push('GHOST');
            if (bh > 0) parts.push('BLACK HOLE');
            if (parts.length > 0) {
                const secs = Math.ceil(Math.max(r, s, sh, l, sm, g, bh) / 1000);
                this.powerupHud.setText(parts.join(' + ') + ` ${secs}s`);
            } else {
                this.powerupHud.setText('');
            }
        }

        // 3e. Active power-up effects
        const now2 = this.time.now;
        // Shield bubble: dome follows the player + grants invincibility
        const shieldActive = now2 < this.shieldUntil;
        if (this.shieldBubble) {
            if (shieldActive) {
                this.shieldBubble.setVisible(true).setPosition(this.player.x, this.player.y);
                this.invincibleUntil = Math.max(this.invincibleUntil, this.shieldUntil);
            } else {
                this.shieldBubble.setVisible(false);
            }
        }
        // Ghost: ship becomes translucent; enemy bullets pass through (handled in overlap)
        const ghostActive = now2 < this.ghostUntil;
        this.player.setAlpha(ghostActive ? 0.4 : 1);
        // Laser beam: vertical column from top of screen to the ship; kills anything in its path
        const laserActive = now2 < this.laserUntil;
        if (this.laserSprite) {
            if (laserActive) {
                this.laserSprite.setVisible(true).setPosition(this.player.x, this.player.y - 300);
                // Kill any invader whose body overlaps the beam column
                const beamL = this.player.x - 6, beamR = this.player.x + 6;
                for (const inv of this.invaderGroup.getChildren().slice()) {
                    if (!inv.isAlive || !inv.body) continue;
                    if (inv.body.right > beamL && inv.body.left < beamR) {
                        inv.takeDamage();
                        this.burst(this.boomFX, inv.x, inv.y, 0xff6644, 14);
                    }
                }
            } else {
                this.laserSprite.setVisible(false);
            }
        }
        // Black hole: pull all living invaders toward the screen center
        const bhActive = now2 < this.blackholeUntil;
        if (bhActive) {
            const cx = this.sys.game.config.width / 2, cy = this.sys.game.config.height / 2;
            for (const inv of this.invaderGroup.getChildren().slice()) {
                if (!inv.isAlive || !inv.body || inv.diving) continue;
                const dx = cx - inv.x, dy = cy - inv.y;
                const dist = Math.hypot(dx, dy);
                if (dist < 100) continue; // stop pulling near center to avoid full convergence
                const pull = 120; // px/s attraction
                inv.setVelocityX((dx / dist) * pull);
                inv.setVelocityY((dy / dist) * pull);
            }
        }


        // 4. Bullet cleanup off-screen (slice: destroy() splices the live group array)
        for (const b of this.playerBullets.getChildren().slice()) if (b.isOutOfBounds()) b.destroy();
        for (const b of this.enemyBullets.getChildren().slice()) {
            if (b.isOutOfBounds()) b.destroy();
            // Arc shots tumble through the air: point the sprite along its velocity
            else if (b.isArc) b.setAngle(Phaser.Math.RadToDeg(Math.atan2(b.body.velocity.y, b.body.velocity.x)) - 90);
        }

        // 5. Detached-part hazards: fall, erode shields on contact, vanish off the bottom
        for (const h of this.bossHazards.getChildren().slice()) {
            if (h.isOutOfBounds()) { h.destroy(); continue; }
            for (const sh of this.shields) {
                if (sh.erode(h.x, h.y + h.displayHeight / 2)) {
                    h.destroy();
                    sfx.shield();
                    break;
                }
            }
        }
    }

    // --- Wave Management and Spawning ---

    /**
     * Spawns the initial formation of invaders on screen. Called once per wave.
     */
    spawnInvaders() {
        this.invaderGroup.clear(true);

        const W = this.sys.game.config.width;
        const H = this.sys.game.config.height;
        const startX = (W - 1) / 2;
        const startY = 80;
        const spacingX = 70; // Horizontal gap between invader columns
        const spacingY = 40; // Vertical gap between invader rows
        const rowColors = [0xffffff, 0x66ffff, 0x66ff99, 0xffaa33, 0xff5544];

        // Stage intro: invaders start on a ring off the screen edge and swoop into their slots.
        // Pattern cycles every 4 waves: grid → V → diamond → wall
        const pattern = (this.waveCounter - 1) % 4;
        const slots = [];
        for (let r = 0; r < Invader.ROWS; ++r) {
            for (let c = 0; c < Invader.COLS; ++c) {
                let rowWidth = spacingX;
                if (pattern === 1) {
                    // V: top row narrow, bottom row full width
                    rowWidth = spacingX * (0.3 + 0.7 * (r / (Invader.ROWS - 1)));
                } else if (pattern === 2) {
                    // Diamond: middle row widest
                    const mid = (Invader.ROWS - 1) / 2;
                    rowWidth = spacingX * (0.3 + 0.7 * (1 - Math.abs(r - mid) / mid));
                } else if (pattern === 3) {
                    // Wall: uniformly wider than grid
                    rowWidth = spacingX * 1.05;
                }
                const sx = W / 2 - ((Invader.COLS - 1) * rowWidth / 2) + (c * rowWidth);
                const sy = startY + (r * spacingY);
                slots.push([sx, sy]);
            }
        }
        this.stageIntro = true;
        const N = slots.length;
        this.totalInvaders = N;
        const R = Math.max(W, H) * 0.62; // ring pokes past every screen edge
        slots.forEach(([sx, sy], i) => {
            const a = (i / N) * Math.PI * 2;
            const invader = new Invader(this, W / 2 + Math.cos(a) * R, H / 2 + Math.sin(a) * R, 'invader', Math.floor(i / Invader.COLS));
            invader.addToDisplayList(this.sys.displayList); // `new` + group.add never renders
            invader.setOrigin(0.5);
            invader.setTint(rowColors[Math.floor(i / Invader.COLS) % rowColors.length]);
            invader.hp = Math.max(1, Math.ceil(invader.hp * this.hpMul)); // easy = fewer shots to kill
            this.invaderGroup.add(invader);
            this.tweens.add({
                targets: invader, x: sx, y: sy, duration: 700, ease: 'Cubic.In', delay: i * 20,
                onComplete: i === N - 1 ? () => { this.stageIntro = false; } : undefined,
            });
        });

        // Reset per-wave state
        this.moveDirection = 1;
        this.lastEnemyShotTime = this.time.now;
        this.enemyShotInterval = Math.max(300, (1000 - (this.waveCounter - 1) * 150) / this.diffMul * this.fireMul);
    }

    // Wave dispatcher: every 3rd wave (3, 6, 9...) is a boss fight; the rest are
    // normal formations. Regular waves on non-multiples are unchanged.
    beginWave() {
        if (this.waveCounter % 3 === 0) this.spawnBoss();
        else {
            this.spawnInvaders();
            sfx.startMarch(55, 55, 55, 49); // A1 A1 A1 G1 - classic 4-note march
        }
    }

    spawnBoss() {
        this.isBossWave = true;
        // Appearance = which boss fight this is (1st, 2nd, ...) so wave 3 and wave 6 differ
        const appearance = Math.floor((this.waveCounter - 3) / 3);
        this.boss = new Boss(this, appearance, this.waveCounter);
        sfx.bossAppear();
        sfx.startMusic('boss'); // high-stress track for the fight
        this.cameras.main.shake(160, 0.02); // the arena shudders as it arrives
        // Reset the shared enemy-fire bookkeeping so the dive kamikaze is well-spaced
        this.lastEnemyShotTime = this.time.now;
        this.enemyShotInterval = Math.max(300, (1000 - (this.waveCounter - 1) * 150) / this.diffMul * this.fireMul);
    }

    // Called by the boss when its core is destroyed: ends the wave.
    onBossDefeated() {
        this.score += 300; // boss bounty
        this.updateHud();
        this.isBossWave = false;
        this.boss = null;
        this.bossGroup.clear(true);
        sfx.startMusic('normal'); // back to the menacing loop
        // 2s breather after the explosion before the stage-clear screen appears
        this.time.delayedCall(2000, () => this.showStageClear());
    }

    showStageClear() {
        this.gameState = 'stageclear';
        sfx.stopMarch();
        this.stageClearReady = false; // hold the Space advance until the fly-through lands the message
        // Clear leftover projectiles so nothing keeps hitting the ship during the breather.
        this.playerBullets.clear(true);
        this.enemyBullets.clear(true);
        if (this.laserSprite) this.laserSprite.setVisible(false);
        this.tweens.killTweensOf(this.invaderGroup.getChildren()); // stage-intro swoop may still be running
        this.stageIntro = false;
        // Boss wave: sweep any leftover boss + falling hazards (usually already gone on defeat)
        this.bossHazards.clear(true);
        if (this.boss) { this.boss.members.forEach(mm => { if (mm.body) mm.destroy(); }); this.bossGroup.clear(true); this.boss = null; }
        this.isBossWave = false;

        // Fly-through: launch the ship off the top of the screen trailing afterburner fire.
        // Body disabled so world-bounds can't clamp it, and collisions stay quiet while it's gone.
        const H = this.sys.game.config.height;
        this.player.setAngle(0);
        this.player.body.enable = false;
        this.player.setPosition(this.player.x, H + 30); // start just below the screen

        // Afterburner trail: the ship flies straight up, so the trail is a vertical flame
        // drawn with Graphics (reliable positioning). A 16ms chaser re-draws it each tick.
        const trail = this.add.graphics().setDepth(9); // just under the ship (depth 10)
        const drawTrail = () => {
            trail.clear();
            const x = this.player.x;
            const topY = this.player.y + 6;
            const segs = 20;                              // ~100px plume
            const flick = Phaser.Math.FloatBetween(0.85, 1.1); // subtle flame flicker
            for (let i = 0; i < segs; i++) {
                const t = i / (segs - 1);                 // 0 at ship -> 1 at tail tip
                const w = Math.max(1, 18 * (1 - t) * flick);
                // hot core near the ship cooling to embers at the tail
                const c = i < 6 ? 0xffe08a : i < 14 ? 0xffb03a : 0xff5a2a;
                trail.fillStyle(c, 1 - t * 0.85);
                trail.fillRect(x - w / 2, topY + i * 5, w, 6);
            }
        };
        const chaser = this.time.addEvent({ delay: 16, loop: true, callback: drawTrail });

        this.tweens.add({
            targets: this.player,
            y: -60, // past the top edge
            duration: 900,
            ease: 'Cubic.In', // accelerating launch
            onComplete: () => {
                chaser.remove(false);
                trail.clear();
                trail.destroy();
                this.player.setVisible(false); // stay hidden until the next wave respawns it
                this.showStageClearMessage();
            },
        });
    }

    showStageClearMessage() {
        this.stageClearUI = this.add.container(0, 0).setDepth(100);
        this.stageClearUI.add(this.add.text(400, 270, `STAGE ${this.waveCounter} CLEAR`, { fontFamily: 'monospace', fontSize: '46px', color: '#39ff88' }).setOrigin(0.5));
        const hint = this.add.text(400, 330, 'Press SPACE or tap for the next stage', { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff' }).setOrigin(0.5);

        this.tweens.add({ targets: hint, alpha: 0.3, duration: 500, yoyo: true, repeat: -1 });
        this.stageClearUI.add(hint);
        this.stageClearReady = true;
    }

    nextWave() {
        if (this.stageClearUI) { this.stageClearUI.destroy(); this.stageClearUI = null; }
        this.stageClearReady = false;
        this.gameState = 'playing';
        // Respawn the ship: the fly-through left it hidden and off the top of the screen
        this.player.setVisible(true);
        this.player.setAngle(0);
        this.player.setPosition(400, 550);
        this.player.body.enable = true;
        this.waveCounter++;
        // Shields persist across levels; only restored fresh after a boss wave
        if ((this.waveCounter - 1) % 3 === 0) {
            if (this.shields) this.shields.forEach(s => s.destroy());
            this.shields = [76, 276, 476, 676].map(x => new Shield(this, x, 495));
        }
        // Clear lingering power-up sprites; active boost timers carry over to the next wave
        this.powerUps.clear(true);
        this.killsSinceDrop = 0;
        this.createStarfield(); // new planet, new sky
        this.beginWave(); // boss (every 3rd wave) or a normal formation
        this.updateHud();
    }

    // --- HUD / Game State Helpers ---

    updateHud() {
        const combo = (this.comboCount > 1 && this.time.now - this.lastKillTime < 1500) ? `  COMBO ×${Math.min(this.comboCount, 5)}` : '';
        this.hudText.setText(`SCORE ${String(this.score).padStart(5, '0')}   HI ${String(Math.max(this.highScore, this.score)).padStart(5, '0')}   LIVES ${this.lives}   WAVE ${this.waveCounter}${combo}`);
    }

    loseLife() {
        if (this.gameState !== 'playing') return;
        this.lives--;
        this.updateHud();
        // The ship takes a chunk out of it: green debris flies off on every hit
        this.burst(this.boomFX, this.player.x, this.player.y, 0x44ff66, 20);
        this.cameras.main.shake(200, 0.03);
        if (this.lives <= 0) {
            sfx.damage();
            this.gameOver();
        } else {
            // Hit-stop: 70ms full freeze so the loss lands. Physics pauses for the
            // same window; it only resumes if we're still playing and not paused
            // (invaderAnimOff is the pause flag — showPause() sets it).
            this.freezeUntil = this.time.now + 70;
            this.physics.pause();
            this.time.delayedCall(70, () => {
                if (this.gameState === 'playing' && !this.invaderAnimOff) this.physics.resume();
            });
            // Brief invincibility so a volley of bullets can't drain all lives at once.
            // Blink + shrink instead of flat 40% alpha: the ship reads as falling apart
            this.invincibleUntil = this.time.now + 1500;
            this.tweens.add({
                targets: this.player,
                alpha: 0.25,
                scale: 0.75,
                duration: 120,
                yoyo: true,
                repeat: 5, // ~1.4s, ends back at alpha 1 / scale 1
            });
        }
    }

    showPause() {
        this.gameState = 'paused';
        this.physics.pause(); // freeze bullets + invader march
        this.invaderAnimOff = true; // freeze the walk cycle too (scene clock keeps running)
        this.pauseUI = this.add.container(0, 0).setDepth(100); // must cover invaders, which sort above the overlay at depth 0
        this.pauseUI.add(this.add.rectangle(400, 300, 800, 600, 0x000000, 0.75));
        this.pauseUI.add(this.add.text(400, 160, 'PAUSED', { fontFamily: 'monospace', fontSize: '40px', color: '#ffffff' }).setOrigin(0.5));
        this.makeButton(this.pauseUI, 400, 270, 300, 56, 'RESUME', () => this.resumeGame());
        const sound = this.makeButton(this.pauseUI, 400, 350, 300, 56, 'SOUND: ' + (this.soundOn ? 'ON' : 'OFF'), () => this.toggleSound());
        this.muteLabel = sound.label;
        this.makeButton(this.pauseUI, 400, 430, 300, 56, 'QUIT TO TITLE', () => { sfx.stopMusic(); this.scene.restart(); });
    }

    resumeGame() {
        if (this.pauseUI) { this.pauseUI.destroy(); this.pauseUI = null; this.muteLabel = null; }
        this.gameState = 'playing';
        this.physics.resume();
        this.invaderAnimOff = false;
    }

    gameOver() {
        if (this.gameState !== 'playing') return;
        this.gameState = 'gameover';
        sfx.stopMusic();
        sfx.stopMarch();
        sfx.gameover();

        // High score: persist the best run (localStorage)
        const isNewBest = this.score > this.highScore;
        if (isNewBest) { this.highScore = this.score; saveHighScore(this.highScore); }

        // Freeze everything on screen
        this.playerBullets.clear(true);
        this.enemyBullets.clear(true);
        this.tweens.killTweensOf(this.invaderGroup.getChildren()); // stop the stage-intro swoop too
        this.stageIntro = false;
        this.invaderGroup.getChildren().forEach(i => i.setVelocity(0, 0));
        this.invaderAnimOff = true; // formation stands still on the game-over screen
        // Boss: stand it still and clear any falling hazards
        this.bossHazards.clear(true);
        if (this.boss) this.boss.members.forEach(mm => { if (mm.body) mm.setVelocity(0, 0); });
        this.isBossWave = false;
        this.player.setVelocity(0, 0);

        // Dim the frozen battlefield so the text reads over it. Container like pauseUI/stageClearUI
        // so goToTitle() can destroy it cleanly.
        this.gameOverUI = this.add.container(0, 0).setDepth(100);
        this.gameOverUI.add(this.add.rectangle(400, 300, 800, 600, 0x000000, 0.75));
        this.gameOverUI.add(this.add.text(400, 280, 'GAME OVER', { fontFamily: 'monospace', fontSize: '48px', color: '#ff5544' }).setOrigin(0.5));
        this.gameOverUI.add(this.add.text(400, 330, `FINAL SCORE ${this.score}\nHIGH SCORE ${String(this.highScore).padStart(5, '0')}${isNewBest ? '  NEW BEST!' : ''}\nPress R or tap to restart`, { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff' }).setOrigin(0.5));

    }

    // --- Procedural Textures (no external assets needed) ---

    createTextures() {
        let g = this.make.graphics({ add: false });

        // Player ship (40 x 32) — pointed hull, swept wings, cockpit, flickering twin afterburners
        const drawShip = (flameLen) => {
            g.clear();
            g.fillStyle(0x1a5c3c, 1);
            g.fillPoints([{ x: 14, y: 10 }, { x: 0, y: 25 }, { x: 5, y: 27 }, { x: 13, y: 20 }], true);   // left wing
            g.fillPoints([{ x: 26, y: 10 }, { x: 40, y: 25 }, { x: 35, y: 27 }, { x: 27, y: 20 }], true);  // right wing
            g.fillStyle(0x39ff88, 1);
            g.fillPoints([{ x: 20, y: 0 }, { x: 27, y: 12 }, { x: 28, y: 22 }, { x: 12, y: 22 }, { x: 13, y: 12 }], true); // hull
            g.fillStyle(0xc8fff0, 1);
            g.fillEllipse(20, 10, 6, 9);   // cockpit
            g.fillStyle(0x1a5c3c, 1);
            g.fillRect(13, 22, 14, 3);     // engine nacelle
            g.fillStyle(0xffb03a, 1);
            g.fillRect(14, 25, 4, flameLen);   // left thruster
            g.fillRect(22, 25, 4, flameLen);   // right thruster
            g.fillStyle(0xfff2a0, 1);
            g.fillRect(15, 26, 2, 2);      // thruster cores
            g.fillRect(23, 26, 2, 2);
        };
        drawShip(3);
        g.generateTexture('player-a', 40, 32);
        drawShip(7);
        g.generateTexture('player-b', 40, 32);
        g.destroy();

        // Invader (32 x 24) — drawn in white so per-row tinting works
        g = this.make.graphics({ add: false });
        g.fillStyle(0xffffff, 1);
        g.fillRect(8, 0, 4, 4);    // left antenna
        g.fillRect(20, 0, 4, 4);   // right antenna
        g.fillRect(4, 4, 24, 12);  // body
        g.fillStyle(0x333333, 1);
        g.fillRect(9, 7, 5, 5);    // left eye
        g.fillRect(18, 7, 5, 5);   // right eye
        g.fillStyle(0xffffff, 1);
        g.fillRect(4, 16, 4, 8);   // legs
        g.fillRect(14, 16, 4, 8);
        g.fillRect(24, 16, 4, 8);
        g.generateTexture('invader', 32, 24);
        g.destroy();

        // Invader, frame 2: same body, legs raised 4px (the walk cycle)
        g = this.make.graphics({ add: false });
        g.fillStyle(0xffffff, 1);
        g.fillRect(8, 0, 4, 4);
        g.fillRect(20, 0, 4, 4);
        g.fillRect(4, 4, 24, 12);
        g.fillStyle(0x333333, 1);
        g.fillRect(9, 7, 5, 5);
        g.fillRect(18, 7, 5, 5);
        g.fillStyle(0xffffff, 1);
        g.fillRect(4, 12, 4, 8);   // legs up
        g.fillRect(14, 12, 4, 8);
        g.fillRect(24, 12, 4, 8);
        g.generateTexture('invader2', 32, 24);
        g.destroy();

        // UFO / Mystery ship (48 x 20) — classic saucer: wide disc + dome + lights
        g = this.make.graphics({ add: false });
        g.fillStyle(0x8844cc, 1);
        g.fillEllipse(24, 14, 48, 12);   // main disc
        g.fillStyle(0xaa66ee, 1);
        g.fillEllipse(24, 10, 32, 8);   // upper disc
        g.fillStyle(0x44ccff, 1);
        g.fillEllipse(24, 8, 16, 10);   // dome
        g.fillStyle(0xff4444, 1);
        g.fillCircle(8, 14, 2);          // port lights
        g.fillCircle(16, 16, 2);
        g.fillStyle(0x44ff44, 1);
        g.fillCircle(24, 17, 2);
        g.fillStyle(0x4444ff, 1);
        g.fillCircle(32, 16, 2);
        g.fillCircle(40, 14, 2);
        g.generateTexture('ufo', 48, 20);
        g.destroy();

        // Player bullet (4 x 10)
        g = this.make.graphics({ add: false });
        g.fillStyle(0xffffff, 1);
        g.fillRect(0, 0, 4, 10);
        g.generateTexture('player-bullet', 4, 10);
        g.destroy();

        // Enemy bullet (6 x 12) — zigzag
        g = this.make.graphics({ add: false });
        g.fillStyle(0xff5555, 1);
        g.fillRect(3, 0, 3, 4);
        g.fillRect(0, 4, 3, 4);
        g.fillRect(3, 8, 3, 4);
        g.generateTexture('enemy-bullet', 6, 12);
        g.destroy();

        // Boss core (72 x 44) — menacing hull, glowing center, twin eyes. White for per-appearance tint.
        g = this.make.graphics({ add: false });
        g.fillStyle(0xffffff, 1);
        g.fillPoints([{ x: 36, y: 0 }, { x: 72, y: 14 }, { x: 72, y: 30 }, { x: 48, y: 44 }, { x: 24, y: 44 }, { x: 0, y: 30 }, { x: 0, y: 14 }], true); // hull
        g.fillStyle(0x222222, 1);
        g.fillEllipse(36, 24, 22, 16);   // dark core face
        g.fillStyle(0xffffff, 1);
        g.fillRect(20, 16, 12, 8);       // left eye
        g.fillRect(40, 16, 12, 8);       // right eye
        g.fillRect(12, 34, 48, 4);       // jaw line
        g.generateTexture('boss-core', 72, 44);
        g.destroy();

        // Boss part / turret (38 x 30) — a chunk of armor that peels off.
        g = this.make.graphics({ add: false });
        g.fillStyle(0xffffff, 1);
        g.fillRect(2, 6, 34, 18);        // armor slab
        g.fillRect(14, 0, 10, 8);        // top fin
        g.fillStyle(0x333333, 1);
        g.fillCircle(19, 15, 5);         // turret barrel
        g.generateTexture('boss-part', 38, 30);
        g.destroy();

        // Boss hazard (20 x 20) — a spiky falling chunk (mini-bomb).
        g = this.make.graphics({ add: false });
        g.fillStyle(0xffffff, 1);
        g.fillPoints([{ x: 10, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 10 }], true); // diamond
        g.fillRect(8, 8, 4, 4);          // hot center
        g.generateTexture('boss-hazard', 20, 20);
        g.destroy();

        // Spark (4 x 4) — white so per-burst tinting works (small texture, renders fine)
        g = this.make.graphics({ add: false });
        g.fillStyle(0xffffff, 1);
        g.fillRect(0, 0, 4, 4);
        g.generateTexture('spark', 4, 4);
        g.destroy();

        // Power-up: rapid fire (24 x 24) — gold gift box with lightning bolt
        g = this.make.graphics({ add: false });
        g.fillStyle(0x2a1a00, 1);
        g.fillRect(2, 2, 20, 20);       // box body
        g.fillStyle(0xffd700, 1);
        g.fillRect(2, 2, 20, 4);        // lid
        g.fillRect(10, 2, 4, 20);       // vertical ribbon
        g.fillRect(2, 10, 20, 4);       // horizontal ribbon
        g.fillStyle(0xffff80, 1);
        g.fillPoints([{ x: 13, y: 5 }, { x: 9, y: 12 }, { x: 12, y: 12 }, { x: 10, y: 18 }, { x: 16, y: 11 }, { x: 13, y: 11 }], true); // lightning bolt
        g.generateTexture('powerup-rapid', 24, 24);
        g.destroy();

        // Power-up: spread shot (24 x 24) — cyan gift box with fan arrows
        g = this.make.graphics({ add: false });
        g.fillStyle(0x001a2a, 1);
        g.fillRect(2, 2, 20, 20);       // box body
        g.fillStyle(0x00e5ff, 1);
        g.fillRect(2, 2, 20, 4);        // lid
        g.fillRect(10, 2, 4, 20);       // vertical ribbon
        g.fillRect(2, 10, 20, 4);       // horizontal ribbon
        g.fillStyle(0x80f0ff, 1);
        g.fillTriangle(12, 16, 6, 8, 9, 8);   // left arrow
        g.fillTriangle(12, 16, 18, 8, 15, 8); // right arrow
        g.fillTriangle(12, 16, 12, 6, 9, 9);  // center arrow
        g.generateTexture('powerup-spread', 24, 24);
        g.destroy();

        // Power-up: shield bubble (24 x 24) — dark box + cyan dome
        g = this.make.graphics({ add: false });
        g.fillStyle(0x001520, 1);
        g.fillRect(2, 2, 20, 20);
        g.fillStyle(0x00e5ff, 1);
        g.fillRect(2, 2, 20, 3);        // lid
        g.fillCircle(12, 14, 7);        // dome
        g.fillStyle(0x80f0ff, 1);
        g.fillCircle(12, 14, 4);        // inner glow
        g.generateTexture('powerup-shield', 24, 24);
        g.destroy();

        // Power-up: laser beam (24 x 24) — dark box + red vertical beam
        g = this.make.graphics({ add: false });
        g.fillStyle(0x200000, 1);
        g.fillRect(2, 2, 20, 20);
        g.fillStyle(0xff3333, 1);
        g.fillRect(2, 2, 20, 3);        // lid
        g.fillRect(10, 6, 4, 14);       // beam column
        g.fillStyle(0xffaaaa, 1);
        g.fillRect(11, 6, 2, 14);       // beam core
        g.generateTexture('powerup-laser', 24, 24);
        g.destroy();

        // Power-up: slow-mo (24 x 24) — dark box + blue clock
        g = this.make.graphics({ add: false });
        g.fillStyle(0x000a20, 1);
        g.fillRect(2, 2, 20, 20);
        g.fillStyle(0x3366ff, 1);
        g.fillRect(2, 2, 20, 3);        // lid
        g.strokeCircle(12, 14, 7, 0x6699ff, 2); // clock face
        g.fillCircle(12, 14, 1.5, 0x99ccff);    // center dot
        g.fillStyle(0x99ccff, 1);
        g.fillRect(11, 9, 2, 5);        // clock hand (up)
        g.fillRect(12, 13, 5, 2);       // clock hand (right)
        g.generateTexture('powerup-slowmo', 24, 24);
        g.destroy();

        // Power-up: ghost (24 x 24) — dark box + white ghost shape
        g = this.make.graphics({ add: false });
        g.fillStyle(0x0a0a14, 1);
        g.fillRect(2, 2, 20, 20);
        g.fillStyle(0x8888aa, 1);
        g.fillRect(2, 2, 20, 3);        // lid
        g.fillStyle(0xddddff, 0.8);
        g.fillCircle(12, 12, 6);        // ghost head
        g.fillRect(6, 12, 12, 8);       // ghost body
        g.fillStyle(0x222244, 1);
        g.fillCircle(10, 12, 1.5);      // left eye
        g.fillCircle(14, 12, 1.5);      // right eye
        g.generateTexture('powerup-ghost', 24, 24);
        g.destroy();

        // Power-up: black hole (24 x 24) — dark box + purple swirl
        g = this.make.graphics({ add: false });
        g.fillStyle(0x0a0014, 1);
        g.fillRect(2, 2, 20, 20);
        g.fillStyle(0x6600aa, 1);
        g.fillRect(2, 2, 20, 3);        // lid
        g.strokeCircle(12, 14, 7, 0xaa44ff, 2);  // outer ring
        g.strokeCircle(12, 14, 4, 0xcc88ff, 2);  // mid ring
        g.fillCircle(12, 14, 2, 0x000000);       // event horizon
        g.fillStyle(0xddaaff, 1);
        g.fillCircle(14, 11, 1);        // accent dot
        g.generateTexture('powerup-blackhole', 24, 24);
        g.destroy();
    }

    // Drifting starfield. ponytail: redrawn into a Graphics object each frame
    // instead of a generated texture — this Phaser build only renders the top-left
    // 400x400 of large (800x600) generated textures, and a Graphics display object
    // sidesteps the texture pipeline entirely (150 fillRects/frame is trivial).
    createStarfield() {
        const W = this.sys.game.config.width;
        const H = this.sys.game.config.height;
        // Destroy + recreate each wave: reusing the Graphics object carries its
        // internal WebGL texture across the transition, and some GPU drivers
        // corrupt that texture when other display objects are destroyed/recreated
        // during the same frame (shield swap, stage-clear UI teardown). A fresh
        // allocation avoids the issue entirely; cost is one texture upload.
        if (this.starSprite) { this.starSprite.destroy(); this.starSprite = null; }
        this.starSprite = this.add.graphics().setDepth(-100);
        // Per-planet sky: seeded by the wave so each stage gets a different star layout,
        // tint and drift speed — feels like arriving somewhere new between stages
        // (waveCounter is only initialized in startGame, so create() would seed with NaN)
        const w = this.waveCounter || 1;
        let seed = ((w - 1) * 7919 + 17) >>> 0;
        const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
        this.starTint = [0xffffff, 0x7fb2ff, 0xffb35c, 0x6cff8f, 0xff7fb8, 0xb58cff][(w - 1) % 6]; // wave 1 keeps the original white stars
        this.starDrift = 0.2 + rnd() * 0.3;
        // 1–2 washed-out planet discs for depth, same seeded randomness as the stars.
        // Muted hues at low alpha so they read as distant objects, not sprites.
        const planetHues = [0x5c5a2e, 0x2e4a6b, 0x6b2e2e, 0x4a4a52]; // yellow, blue, red, gray
        const pCount = 1 + (rnd() < 0.5 ? 1 : 0);
        this.planetData = [];
        for (let i = 0; i < pCount; i++) {
            this.planetData.push({
                x: rnd() * W,
                y: rnd() * H,
                r: 25 + rnd() * 45,
                color: planetHues[Math.floor(rnd() * planetHues.length)],
                alpha: 0.09 + rnd() * 0.07,
            });
        }
        this.starData = [];
        const count = 120 + Math.floor(rnd() * 60); // 120–179 stars per planet
        for (let i = 0; i < count; i++) {
            this.starData.push({
                x: Math.floor(rnd() * W),
                y: Math.floor(rnd() * H),
                size: rnd() < 0.75 ? 1 : 2,
                alpha: 0.4 + rnd() * 0.6,
            });
        }
        this.updateStarfield(); // first draw — states that don't tick the drift (title) still show stars
    }

    // Cheap 3D sphere: 5 stacked discs whose alphas add up center-wards (radial falloff),
    // a background-colored shadow disc offset to the lower right, and a tiny lit highlight.
    drawPlanet(g, pl) {
        for (let i = 5; i >= 1; i--) { // largest first; inner discs brighten the core
            g.fillStyle(pl.color, pl.alpha * (0.15 * i));
            g.fillCircle(pl.x, pl.y, pl.r * (i / 5));
        }
        g.fillStyle(0x050514, Math.min(0.3, pl.alpha * 1.8)); // night side, bottom-right
        g.fillCircle(pl.x + pl.r * 0.25, pl.y + pl.r * 0.25, pl.r * 0.9);
        g.fillStyle(0xffffff, pl.alpha * 0.4);                // sunlit rim, top-left
        g.fillCircle(pl.x - pl.r * 0.35, pl.y - pl.r * 0.35, pl.r * 0.28);
    }

    updateStarfield() {
        const W = this.sys.game.config.width;
        const H = this.sys.game.config.height;
        const g = this.starSprite;
        g.clear();
        for (const pl of this.planetData) {
            pl.y += this.starDrift * 0.5; // half speed: parallax, planets sit behind the stars
            if (pl.y - pl.r > H) { pl.y = -pl.r; pl.x = Math.random() * W; } // re-enter at a new x
            this.drawPlanet(g, pl);
        }
        for (const st of this.starData) {
            st.y += this.starDrift;
            if (st.y >= H) st.y -= H;
            g.fillStyle(this.starTint, st.alpha);
            g.fillRect(st.x, Math.floor(st.y), st.size, st.size);
        }
    }
}

// Phaser Game Configuration
const config = {
    // Canvas 2D on mobile: immune to GPU driver bugs that corrupt WebGL textures
    // (reported: background disappears after wave 1 on real devices). Negligible
    // perf cost for a game this simple. Desktop keeps WebGL for smoothness.
    type: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? Phaser.CANVAS : Phaser.AUTO,

    width: 800,
    height: 600,
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    parent: 'game-container',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },
            debug: false
        }
    },
    scene: MainScene, // Single scene; the title screen is a state inside it (see showTitle)
    backgroundColor: '#050514',
};

// Game Instance
const game = new Phaser.Game(config);

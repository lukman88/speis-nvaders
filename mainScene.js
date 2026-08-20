// mainScene.js
class MainScene extends Phaser.Scene {
    constructor() {
        super('MainScene');
    }

    create() {
        this.createTextures();
        this.createStarfield();

        // --- Input (keys created once — JustDown only works on persistent key objects) ---
        this.cursors = this.input.keyboard.createCursorKeys();
        this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this.restartKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
        this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
        this.escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
        // Browsers only allow audio after a user gesture; any keypress counts
        this.input.keyboard.on('keydown', () => sfx.unlock());

        this.soundOn = !sfx.isMuted(); // mute state is global, survives scene restarts

        this.showTitle();
    }

    // Title screen. A state, not a scene: this build's SceneManager mangles
    // object-form scene entries ({key, scene}) — the key ends up pointing at a
    // bare Scene with no create(), so scene arrays beyond [OneScene] are off-limits.
    showTitle() {
        this.gameState = 'title'; // 'title' | 'playing' | 'stageclear' | 'paused' | 'gameover'
        this.titleUI = this.add.container(0, 0);

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

        this.titleUI.add(this.add.text(400, 250, 'SPACE INVADERS', { fontFamily: 'monospace', fontSize: '40px', color: '#ffffff' }).setOrigin(0.5));
        this.makeButton(this.titleUI, 400, 380, 230, 56, 'START GAME', () => this.startGame(), '26px');
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

    startGame() {
        if (this.logoTimer) { this.logoTimer.remove(false); this.logoTimer = null; }
        if (this.titleUI) { this.titleUI.destroy(); this.titleUI = null; }
        sfx.unlock(); // pointerdown/keydown are user gestures — audio is allowed now
        sfx.shoot();
        this.physics.resume(); // showPause() pauses it

        // --- Game state ---
        this.gameState = 'playing';
        this.score = 0;
        this.lives = 3;
        this.waveCounter = 1;
        this.moveDirection = 1;      // 1 for moving right, -1 for moving left

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
        this.enemyBullets = this.physics.add.group({ classType: EnemyBullet, velocityY: 350 });

        // --- Invaders (spawned once per wave) ---
        this.invaderGroup = this.physics.add.group();
        this.spawnInvaders();

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
                this.score += 10 * this.waveCounter;
                sfx.boom();
                this.burst(this.boomFX, invader.x, invader.y, invader.tint, 26); // .tint is a plain number in this build
                this.updateHud();
                // Wave cleared? Hand off to the stage-clear break instead of jumping straight in.
                if (this.invaderGroup.countActive(true) === 0) {
                    this.showStageClear();
                }
            }
        });

        // this build calls single-body×group handlers as (sprite, groupChild)
        this.physics.add.overlap(this.player, this.enemyBullets, (player, bullet) => {
            if (bullet && bullet.body) bullet.destroy(); // absorb the bullet even while invincible
            this.burst(this.hitFX, player.x, player.y - 10, 0xff5555, 10);
            if (this.time.now < this.invincibleUntil) return;
            this.loseLife();
        });
    }

    // One-shot particle burst at (x, y). emitter is preconfigured, we just aim + tint + fire.
    burst(emitter, x, y, tint, count) {
        emitter.setPosition(x, y);
        emitter.setParticleTint(tint);
        emitter.explode(count);
    }

    update() {
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

        // 0. Background drift (scenery keeps moving even when the player waits)
        this.updateStarfield();

        // 1. Player movement + afterburner flicker (swap short/long flame textures ~12fps)
        this.player.setTexture(Math.floor(this.time.now / 85) % 2 ? 'player-b' : 'player-a');
        let vx = 0;
        if (this.cursors.left.isDown) {
            vx = -300;
        } else if (this.cursors.right.isDown) {
            vx = 300;
        }
        this.player.setVelocityX(vx);
        // Bank into the turn: ease the ship toward a lean in the travel direction, level out when coasting
        const targetAngle = vx < 0 ? -10 : vx > 0 ? 10 : 0;
        this.player.setAngle(Phaser.Math.Linear(this.player.angle, targetAngle, 0.3));

        // 2. Player shooting (hold to auto-fire; the cooldown still caps the rate)
        if (this.spaceKey.isDown) {
            const now = this.time.now;
            if (now - this.lastShotTime > this.bulletCooldown) {
                this.playerBullets.create(this.player.x, this.player.y - 30);
                this.lastShotTime = now;
                sfx.shoot();
            }
        }

        // 3. Invader formation movement + enemy fire
        // getChildren() returns the LIVE group array — slice so any later destroy can't skew iteration
        const invaders = this.invaderGroup.getChildren().slice();
        if (invaders.length > 0) {
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

            const speed = Invader.INITIAL_SPEED_X + (this.waveCounter - 1) * 20;
            for (const inv of invaders) {
                if (!inv.isAlive || inv.diving) continue;
                inv.setVelocityX(speed * this.moveDirection);
            }

            const now = this.time.now;
            const alive = invaders.filter(i => i.isAlive);

            // Enemy fire: rate-limited, random shooter per volley
            if (now - this.lastEnemyShotTime >= this.enemyShotInterval && Phaser.Math.RND.frac() < 0.5) {
                if (alive.length > 0) Phaser.Math.RND.pick(alive.filter(i => !i.diving)).attemptShoot();
            }

            // Occasionally one invader breaks off and dives on the player.
            // A flashing "!" locks the strike point 700ms early so the player can dodge it.
            if (now - this.lastDiveTime >= 5000 && Phaser.Math.RND.frac() < 0.5) {
                const candidates = alive.filter(i => !i.diving);
                if (candidates.length > 0) {
                    const inv = Phaser.Math.RND.pick(candidates);
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
            for (const inv of invaders) {
                if (!inv.isAlive || !inv.diving) continue;
                inv.setAngle(Phaser.Math.RadToDeg(Math.atan2(inv.body.velocity.y, inv.body.velocity.x)) - 90);
                if (inv.y > H + 40 || inv.x < -40 || inv.x > H + 40) { inv.takeDamage(); continue; }
                if (Math.hypot(inv.x - this.player.x, inv.y - this.player.y) < 26) {
                    inv.takeDamage();
                    if (this.time.now < this.invincibleUntil) this.burst(this.hitFX, inv.x, inv.y, 0xff5555, 10); // blocked by the shield, no damage
                    else this.loseLife();
                }
            }
        }

        // 4. Bullet cleanup off-screen (slice: destroy() splices the live group array)
        for (const b of this.playerBullets.getChildren().slice()) if (b.isOutOfBounds()) b.destroy();
        for (const b of this.enemyBullets.getChildren().slice()) {
            if (b.isOutOfBounds()) b.destroy();
            // Arc shots tumble through the air: point the sprite along its velocity
            else if (b.isArc) b.setAngle(Phaser.Math.RadToDeg(Math.atan2(b.body.velocity.y, b.body.velocity.x)) - 90);
        }
    }

    // --- Wave Management and Spawning ---

    /**
     * Spawns the initial formation of invaders on screen. Called once per wave.
     */
    spawnInvaders() {
        this.invaderGroup.clear(true);

        const startX = (this.sys.game.config.width - 1) / 2;
        const startY = 150;
        const spacingX = 70; // Horizontal gap between invader columns
        const spacingY = 40; // Vertical gap between invader rows
        const rowColors = [0xffffff, 0x66ffff, 0x66ff99, 0xffaa33, 0xff5544];

        for (let r = 0; r < Invader.ROWS; ++r) {
            for (let c = 0; c < Invader.COLS; ++c) {
                // Calculate initial positions relative to center-aligned grid
                const x = startX - ((Invader.COLS - 1) * spacingX / 2) + (c * spacingX);
                const y = startY + (r * spacingY);

                const invader = new Invader(this, x, y, 'invader');
                invader.addToDisplayList(this.sys.displayList); // `new` + group.add never renders
                invader.setOrigin(0.5);
                invader.setTint(rowColors[r % rowColors.length]);
                this.invaderGroup.add(invader);
            }
        }

        // Reset per-wave state
        this.moveDirection = 1;
        this.lastEnemyShotTime = this.time.now;
        this.enemyShotInterval = Math.max(300, 1000 - (this.waveCounter - 1) * 150);
    }

    showStageClear() {
        this.gameState = 'stageclear';
        this.stageClearReady = false; // hold the Space advance until the fly-through lands the message
        // Clear leftover projectiles so nothing keeps hitting the ship during the breather.
        this.playerBullets.clear(true);
        this.enemyBullets.clear(true);

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
        const hint = this.add.text(400, 330, 'Press SPACE for the next stage', { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff' }).setOrigin(0.5);
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
        this.spawnInvaders();
        this.updateHud();
    }

    // --- HUD / Game State Helpers ---

    updateHud() {
        this.hudText.setText(`SCORE ${String(this.score).padStart(5, '0')}   LIVES ${this.lives}   WAVE ${this.waveCounter}`);
    }

    loseLife() {
        if (this.gameState !== 'playing') return;
        this.lives--;
        this.updateHud();
        // The ship takes a chunk out of it: green debris flies off on every hit
        this.burst(this.boomFX, this.player.x, this.player.y, 0x44ff66, 20);
        if (this.lives <= 0) {
            sfx.damage();
            this.gameOver();
        } else {
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
        const sound = this.makeButton(this.pauseUI, 400, 350, 300, 56, 'SOUND: ' + (this.soundOn ? 'ON' : 'OFF'), () => {
            this.soundOn = !this.soundOn;
            sfx.setMuted(!this.soundOn);
            sound.label.setText('SOUND: ' + (this.soundOn ? 'ON' : 'OFF'));
            if (this.soundOn) sfx.shoot(); // confirmation blip only when unmuting
        });
        this.makeButton(this.pauseUI, 400, 430, 300, 56, 'QUIT TO TITLE', () => this.scene.restart());
    }

    resumeGame() {
        if (this.pauseUI) { this.pauseUI.destroy(); this.pauseUI = null; }
        this.gameState = 'playing';
        this.physics.resume();
        this.invaderAnimOff = false;
    }

    gameOver() {
        if (this.gameState !== 'playing') return;
        this.gameState = 'gameover';
        sfx.gameover();

        // Freeze everything on screen
        this.playerBullets.clear(true);
        this.enemyBullets.clear(true);
        this.invaderGroup.getChildren().forEach(i => i.setVelocity(0, 0));
        this.invaderAnimOff = true; // formation stands still on the game-over screen
        this.player.setVelocity(0, 0);

        // Dim the frozen battlefield so the text reads over it. setDepth(100) like the pause
        // overlay: invaders/ship carry their own depth and would otherwise sort above it.
        this.add.rectangle(400, 300, 800, 600, 0x000000, 0.75).setDepth(100);
        this.add.text(400, 280, 'GAME OVER', { fontFamily: 'monospace', fontSize: '48px', color: '#ff5544' }).setOrigin(0.5).setDepth(100);
        this.add.text(400, 330, `FINAL SCORE ${this.score}\nPress R to restart`, { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff' }).setOrigin(0.5).setDepth(100);
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

        // Spark (4 x 4) — white so per-burst tinting works (small texture, renders fine)
        g = this.make.graphics({ add: false });
        g.fillStyle(0xffffff, 1);
        g.fillRect(0, 0, 4, 4);
        g.generateTexture('spark', 4, 4);
        g.destroy();
    }

    // Drifting starfield. ponytail: redrawn into a Graphics object each frame
    // instead of a generated texture — this Phaser build only renders the top-left
    // 400x400 of large (800x600) generated textures, and a Graphics display object
    // sidesteps the texture pipeline entirely (150 fillRects/frame is trivial).
    createStarfield() {
        const W = this.sys.game.config.width;
        const H = this.sys.game.config.height;
        this.starSprite = this.add.graphics().setDepth(-100);
        this.starData = [];
        for (let i = 0; i < 150; i++) {
            this.starData.push({
                x: Math.floor(Math.random() * W),
                y: Math.floor(Math.random() * H),
                size: Math.random() < 0.75 ? 1 : 2,
                alpha: 0.4 + Math.random() * 0.6,
            });
        }
    }

    updateStarfield() {
        const H = this.sys.game.config.height;
        const g = this.starSprite;
        g.clear();
        for (const st of this.starData) {
            st.y += 0.3;
            if (st.y >= H) st.y -= H;
            g.fillStyle(0xffffff, st.alpha);
            g.fillRect(st.x, Math.floor(st.y), st.size, st.size);
        }
    }
}

// Phaser Game Configuration
const config = {
    type: Phaser.AUTO, // Automatically select the best renderer
    width: 800,
    height: 600,
    parent: 'game-container', // render inside the cabinet bezel in index.html
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

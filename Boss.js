// Boss.js
// A boss is 1 core + 5 detachable parts. The parts are armor/turrets: shoot one
// off and it drops as a falling hazard (a mini-bomb). The boss dies only when the
// core is destroyed. Appearance (tint + part layout) varies per appearance index,
// so wave 3 and wave 6 look different.
//
// All 6 members are real Arcade sprites with physics bodies, added to the scene's
// this.bossGroup so the player-bullet overlap handler reaches them. Movement moves
// every member with the same velocity, so the formation stays rigid.

const BOSS_APPEARANCES = [
    // tint palette per appearance (core, parts)
    { core: 0xff4466, part: 0xff88aa },
    { core: 0x44ddff, part: 0x99eeff },
    { core: 0xffcc33, part: 0xffee99 },
    { core: 0xcc66ff, part: 0xe0aaff },
];

// Part layouts: relative offsets from the core (5 parts each). Picked per appearance.
const BOSS_LAYOUTS = [
    // "bracket": two shoulders, two mid turrets, one jaw
    [ { x: -58, y: -10 }, { x: 58, y: -10 }, { x: -38, y: 18 }, { x: 38, y: 18 }, { x: 0, y: 30 } ],
    // "wings": wide wings, high center
    [ { x: -70, y: 8 }, { x: 70, y: 8 }, { x: -30, y: -22 }, { x: 30, y: -22 }, { x: 0, y: 26 } ],
    // "crown": top arc
    [ { x: -52, y: -20 }, { x: 52, y: -20 }, { x: 0, y: -28 }, { x: -28, y: 22 }, { x: 28, y: 22 } ],
];

class Boss {
    constructor(scene, appearance, wave) {
        this.scene = scene;
        this.appearance = appearance;
        this.wave = wave;
        this.alive = true;

        const W = scene.sys.game.config.width;
        this.coreX = W / 2;
        this.coreY = 96;

        const ap = BOSS_APPEARANCES[appearance % BOSS_APPEARANCES.length];
        const layout = BOSS_LAYOUTS[appearance % BOSS_LAYOUTS.length];

        // Core (the kill target)
        this.core = scene.physics.add.sprite(this.coreX, this.coreY, 'boss-core');
        this.core.setTint(ap.core);
        this.core.setDepth(16);
        this.core.body.setAllowGravity(false);
        this.core.isBossPart = true;
        this.core.isCore = true;
        this.core.hp = Math.max(4, Math.ceil((12 + (wave - 3) * 2) * (scene.hpMul || 1))); // core is the kill target — parts are armor, not gates

        // 5 detachable parts
        this.parts = [];
        layout.forEach((off) => {
            const p = scene.physics.add.sprite(this.coreX + off.x, this.coreY + off.y, 'boss-part');
            p.setTint(ap.part);
            p.setDepth(15);
            p.body.setAllowGravity(false);
            p.isBossPart = true;
            p.isCore = false;
            p.hp = Math.max(1, Math.ceil(6 * (scene.hpMul || 1)));
            this.parts.push(p);
        });

        this.members = [this.core, ...this.parts];
        for (const mm of this.members) scene.bossGroup.add(mm);

        // Movement state
        this.dir = 1;
        this.dashDir = 1;
        this.dashTime = 0;
        this.dashCd = 1600;        // ms until the first dash
        this.lastMove = 'drift';   // 'drift' | 'dash' — exposed for tests

        // Attacks: deterministic cycle so all four types fire within a short window
        this.attackIndex = -1;
        this.attackInterval = 850; // ms between attacks
        this.lastAttack = 0;
        this.attacksFired = { straight: 0, arc: 0, burst: 0, dive: 0 };
    }

    // Live (not-yet-destroyed) part count, excluding the core.
    get partCount() { return this.parts.filter(p => !p.destroyed).length; }

    // One player-bullet hit on a part or the core.
    // @returns {string} 'wounded' | 'detached' | 'defeated'
    hitBullet(part) {
        if (!part || !part.body) return 'wounded';
        part.hp--;
        if (part.hp > 0) {
            this.scene.tweens.add({ targets: part, scale: 1.25, duration: 55, yoyo: true });
            return 'wounded';
        }
        if (part.isCore) {
            part.destroy();
            this.defeated();
            return 'defeated';
        }
        // A part peels off and drops as a falling hazard.
        this.scene.bossHazards.create(part.x, part.y);
        this.scene.burst(this.scene.boomFX, part.x, part.y, part.tint, 18);
        part.destroy();
        sfx.boom();
        return 'detached';
    }

    defeated() {
        if (!this.alive) return;
        this.alive = false;
        const s = this.scene;
        // Initial detonation: core + all parts explode simultaneously
        s.burst(s.boomFX, this.coreX, this.coreY, 0xffffff, 60);
        for (const p of this.parts) {
            if (p.body) {
                s.burst(s.boomFX, p.x, p.y, p.tint, 24);
                p.destroy();
            }
        }
        // Screen flash + heavy shake
        s.cameras.main.flash(250, 255, 255, 255);
        s.cameras.main.shake(600, 0.08);
        sfx.bossDie();
        // Staggered secondary detonations ripple outward over 600ms
        const cx = this.coreX, cy = this.coreY;
        const delays = [120, 240, 360, 480];
        const offsets = [{x:-40,y:-20},{x:40,y:-20},{x:-25,y:30},{x:25,y:30}];
        delays.forEach((d, i) => {
            s.time.delayedCall(d, () => {
                s.burst(s.boomFX, cx + offsets[i].x, cy + offsets[i].y, 0xffaa44, 30);
                s.cameras.main.shake(200, 0.04);
            });
        });
        // Final big flash as the wave ends
        s.time.delayedCall(550, () => {
            s.cameras.main.flash(150, 255, 200, 100);
            s.onBossDefeated();
        });
    }

    update(time, delta) {
        if (!this.alive) return;
        const m = this.scene.diffMul || 1;
        const W = this.scene.sys.game.config.width;

        // --- Movement: slow drift, with an occasional fast dash ---
        if (this.dashTime > 0) {
            this.dashTime -= delta;
            this.lastMove = 'dash';
        } else {
            this.dashCd -= delta;
            this.lastMove = 'drift';
            if (this.dashCd <= 0) {
                this.dashTime = 320; // dash lasts this long
                this.dashCd = 1800 + Phaser.Math.RND.frac() * 1200;
                this.dashDir = this.scene.player ? (this.scene.player.x >= this.core.x ? 1 : -1) : this.dir;
            }
        }
        const vx = this.lastMove === 'dash' ? 260 * m * this.dashDir : 42 * m * this.dir;
        // Bounce off the walls (test the core's bounds so the whole body flips together)
        if (this.core.x < 90 && vx < 0) { this.dir = 1; this.dashDir = 1; }
        else if (this.core.x > W - 90 && vx > 0) { this.dir = -1; this.dashDir = -1; }
        for (const mm of this.members) if (mm && mm.body) mm.setVelocityX(vx);

        // --- Attacks: cycle straight -> arc -> burst -> dive, rate-limited ---
        if (time - this.lastAttack >= this.attackInterval) {
            this.lastAttack = time;
            this.attackIndex = (this.attackIndex + 1) % 4;
            this.fireAttack();
        }
    }

    // The four attack types. The scene owns the bullet/invader groups + rate state.
    fireAttack() {
        const s = this.scene;
        switch (this.attackIndex) {
            case 0: this.fireStraight(); this.attacksFired.straight++; break;
            case 1: this.fireArc(); this.attacksFired.arc++; break;
            case 2: this.fireBurst(); this.attacksFired.burst++; break;
            case 3: this.fireDive(); this.attacksFired.dive++; break;
        }
    }

    // A straight volley down from up to three live parts.
    fireStraight() {
        const live = this.parts.filter(p => p.body);
        for (let i = 0; i < Math.min(3, live.length); i++) {
            const p = live[i];
            const b = new EnemyBullet(this.scene, p.x, p.y + p.displayHeight / 2);
            b.addToDisplayList(this.scene.sys.displayList);
            this.scene.enemyBullets.add(b);
        }
    }

    // An arcing shot lobs up and falls onto the player's current position.
    fireArc() {
        if (!this.scene.player) return;
        const b = new EnemyBullet(this.scene, this.core.x, this.core.y + this.core.displayHeight / 2);
        b.addToDisplayList(this.scene.sys.displayList);
        this.scene.enemyBullets.add(b);
        b.fireArcAt(this.scene.player.x, this.scene.player.y);
    }

    // A fan of bullets spreading out from the core.
    fireBurst() {
        const n = 5;
        for (let i = 0; i < n; i++) {
            const a = (i / (n - 1) - 0.5) * 1.4; // -0.7..0.7 rad around straight-down
            const b = new EnemyBullet(this.scene, this.core.x, this.core.y + this.core.displayHeight / 2);
            b.addToDisplayList(this.scene.sys.displayList);
            this.scene.enemyBullets.add(b);
            b.setVelocity(Math.sin(a) * 320, Math.cos(a) * 320);
        }
    }

    // Drop a kamikaze mini-invader that dives on the player (reuses Invader + the
    // scene's dive-resolution loop, which iterates the whole invaderGroup).
    fireDive() {
        if (!this.scene.player) return;
        const live = this.parts.filter(p => p.body);
        const from = live.length ? Phaser.Math.RND.pick(live) : this.core;
        const inv = new Invader(this.scene, from.x, from.y, 'invader', 0);
        inv.addToDisplayList(this.scene.sys.displayList);
        inv.setTint(0xff8844);
        this.scene.invaderGroup.add(inv);
        inv.diveAt(this.scene.player.x, this.scene.player.y);
    }
}

// A detached boss part: falls toward the player as a mini-bomb. Eats shields,
class BossHazard extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y) {
        super(scene, x, y, 'boss-hazard');
        this.setTint(0xff7744);
        this.setDepth(14);
        // No gravity call here: the group assigns the body after construction, and
        // the world has no gravity, so the configured velocityY drives the fall.
    }

    isOutOfBounds() {
        return this.y > this.scene.sys.game.config.height + 30;
    }
}

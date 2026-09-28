// PowerUp.js — falling gift boxes that grant temporary combat boosts.
// Seven types:
//   'rapid'     — halves the player's fire cooldown for 8s
//   'spread'    — fires 3 bullets in a fan for 8s
//   'shield'    — 5s invincibility with a visible cyan dome
//   'laser'     — continuous vertical beam for 3s
//   'slowmo'    — enemies at 40% speed for 6s
//   'ghost'     — 4s intangible (enemy bullets pass through)
//   'blackhole' — pulls all enemies toward center for 4s
// Spawned by mainScene on invader kills (chance-based + guaranteed cadence).
// Falls with a gentle sine drift + slow alpha blink (signals "safe, pick me up").
// Collected on overlap with the player.

const POWERUP_FALL_SPEED = 70;  // px/s
const POWERUP_DRIFT_AMP = 30;   // px sine amplitude
const POWERUP_DRIFT_FREQ = 1.8; // rad/s
const POWERUP_BLINK_FREQ = 2.0; // rad/s — slow blink so the player reads it as "friendly"

const POWERUP_KEYS = {
    rapid: 'powerup-rapid',
    spread: 'powerup-spread',
    shield: 'powerup-shield',
    laser: 'powerup-laser',
    slowmo: 'powerup-slowmo',
    ghost: 'powerup-ghost',
    blackhole: 'powerup-blackhole',
};

class PowerUp extends Phaser.Physics.Arcade.Sprite {
    /**
     * @param {Phaser.Scene} scene
     * @param {number} x
     * @param {number} y
     * @param {string} type
     */
    constructor(scene, x, y, type) {
        super(scene, x, y, POWERUP_KEYS[type] || 'powerup-rapid');
        this.puType = type;
        this.setDepth(18);
        this._velSet = false;
        this._driftPhase = Phaser.Math.FloatBetween(0, Math.PI * 2);
        this._baseX = x;
    }

    update(time) {
        if (!this._velSet && this.body) {
            this.setVelocityY(POWERUP_FALL_SPEED);
            this.setCollideWorldBounds(true);
            this._velSet = true;
        }
        const t = time / 1000;
        this.x = this._baseX + Math.sin(t * POWERUP_DRIFT_FREQ + this._driftPhase) * POWERUP_DRIFT_AMP;
        // Slow alpha blink: 0.45 → 1.0, signals "not dangerous, grab me"
        this.alpha = 0.725 + 0.275 * Math.sin(t * POWERUP_BLINK_FREQ + this._driftPhase);
        if (this.y > this.scene.sys.config.height + 20) this.destroy();
    }
}

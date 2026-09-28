// Invader.js
class Invader extends Phaser.Physics.Arcade.Sprite {
    // Static constants for wave configuration
    static ROWS = 5;
    static COLS = 8;
    static INITIAL_SPEED_X = 60;  // Base horizontal speed magnitude
    static VERTICAL_DROP = 20;    // One-time drop when the formation reverses

    // Tiers per row, top (index 0) to bottom (index 4): the original's
    // structure is "higher = tougher and worth more". takeDamage() drains hp,
    // dive weighting uses row (deeper rows dive more often — "the lower they
    // go, the scarier they get").
    static TIERS = [
        { hp: 3, points: 30 },
        { hp: 2, points: 20 },
        { hp: 2, points: 10 },
        { hp: 1, points: 10 },
        { hp: 1, points: 10 },
    ];

    constructor(scene, x, y, textureKey, row = 0) {
        super(scene, x, y, textureKey);
        this.setDepth(15); // Higher depth than player/bullets to show movement

        this.isAlive = true;
        this.diving = false; // true while this invader is arcing in as a kamikaze
        this.row = row;
        const tier = Invader.TIERS[row % Invader.TIERS.length];
        this.hp = tier.hp;
        this.points = tier.points;
    }

    /**
     * Kamikaze dive: breaks off the formation, lobs upward, and gravity
     * bends it down onto (tx, ty) exactly T seconds later. The scene stops
     * steering it from that moment on (it checks the hit + cleanup).
     */
    diveAt(tx, ty) {
        this.diving = true;
        const m = this.scene.diffMul || 1; // difficulty scale: higher = faster
        const T = 1.2 / m;            // seconds of flight — slow enough to see, fast enough to matter
        const vy = -350 * m;          // initial upward lob
        const arc = arcVelocity(this.x, this.y, tx, ty, T, vy);
        this.setVelocity(arc.vx, arc.vy);
        this.setGravityY(arc.gravity);
    }

    /**
     * One hit of damage. @returns {boolean} true only when this hit killed
     * the invader (caller scores/bursts then); false for a wounded survivor.
     */
    takeDamage() {
        if (!this.isAlive) return false;
        this.hp--;
        if (this.hp > 0) return false;
        this.isAlive = false;
        this.destroy(); // Removes from scene + group and frees the physics body
        return true;
    }

    /**
     * Fires a single enemy bullet straight down. The caller (MainScene) is
     * responsible for rate-limiting how often this gets called.
     */
    attemptShoot() {
        if (!this.isAlive || this.destroyed) return false;
        const bullet = new EnemyBullet(this.scene, this.x, this.y + this.displayHeight / 2);
        bullet.addToDisplayList(this.scene.sys.displayList); // `new` + group.add never renders
        this.scene.enemyBullets.add(bullet);
        this.scene.lastEnemyShotTime = this.scene.time.now;
        // Some volleys lob a ballistic arc straight at the player's position instead
        if (Phaser.Math.RND.frac() < 0.25 && this.scene.player) {
            bullet.fireArcAt(this.scene.player.x, this.scene.player.y);
        }
        return true;
    }
}

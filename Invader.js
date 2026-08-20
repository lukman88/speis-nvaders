// Invader.js
class Invader extends Phaser.Physics.Arcade.Sprite {
    // Static constants for wave configuration
    static ROWS = 5;
    static COLS = 8;
    static INITIAL_SPEED_X = 60;  // Base horizontal speed magnitude
    static VERTICAL_DROP = 20;    // One-time drop when the formation reverses

    constructor(scene, x, y, textureKey) {
        super(scene, x, y, textureKey);
        this.setDepth(15); // Higher depth than player/bullets to show movement

        this.isAlive = true;
        this.diving = false; // true while this invader is arcing in as a kamikaze
    }

    /**
     * Kamikaze dive: breaks off the formation, lobs upward, and gravity
     * bends it down onto (tx, ty) exactly T seconds later. The scene stops
     * steering it from that moment on (it checks the hit + cleanup).
     */
    diveAt(tx, ty) {
        this.diving = true;
        const T = 1.2;                 // seconds of flight — slow enough to see, fast enough to matter
        const vy = -350;               // initial upward lob
        this.setVelocity((tx - this.x) / T, vy);
        this.setGravityY(2 * (ty - this.y - vy * T) / (T * T));
    }

    takeDamage() {
        if (!this.isAlive) return false;
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

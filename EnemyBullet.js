// EnemyBullet.js
// Velocity is set by the group config in mainScene.js, not here:
// Arcade groups apply their defaults (velocity 0) to a child on add, which
// would clobber any velocity set in the constructor.
class EnemyBullet extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y) {
        super(scene, x, y, 'enemy-bullet');
        this.setDepth(13); // Show above player but below the action details
    }

    isOutOfBounds() {
        // arc shots drift in x, but they always end up falling past the bottom
        return this.y > this.scene.sys.game.config.height + 20;
    }

    /**
     * Ballistic arc shot: lobs upward, then gravity bends it down onto
     * (tx, ty) exactly T seconds later. Call AFTER the group adds the bullet,
     * so the group's default velocityY: 350 gets clobbered, not the other way round.
     */
    fireArcAt(tx, ty) {
        const T = 1.0 / 0.75;         // seconds of flight (1.0s / 0.75 = 25% slower: same arc, stretched time)
        const vy = -420;              // initial upward lob
        const g = 2 * (ty - this.y - vy * T) / (T * T); // gravity that lands on target at T
        this.setVelocity((tx - this.x) / T, vy);
        this.setGravityY(g);
        this.isArc = true;            // scene rotates the sprite to face its velocity
    }
}

// BulletBullet.js — player bullet
// Velocity is set by the group config in mainScene.js, not here:
// Arcade groups apply their defaults (velocity 0) to a child on add, which
// would clobber any velocity set in the constructor.
class BulletBullet extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y) {
        super(scene, x, y, 'player-bullet');
        this.setDepth(12); // visible over player/enemies
    }

    isOutOfBounds() {
        return this.y < -20;
    }
}

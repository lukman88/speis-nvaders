// ballistic.js — pure ballistic math shared by the invader dive (Invader.js)
// and the enemy arc shot (EnemyBullet.js). No Phaser dependency, so the math
// is unit-testable in node (test/ballistic.test.js).
//
// Given a start point (x0, y0), a target (tx, ty), a flight time T (seconds)
// and a chosen initial vertical velocity vy, the unique constant gravity g
// makes the projectile land exactly on target at t = T:
//   x(t) = x0 + vx·t                      (no horizontal acceleration)
//   y(t) = y0 + vy·t + ½·g·t²             (constant gravity)
//   => g = 2·(ty − y0 − vy·T) / T²
// The horizontal velocity is simply the closing distance over T.
function arcVelocity(x0, y0, tx, ty, T, vy) {
    return {
        vx: (tx - x0) / T,
        vy,
        gravity: 2 * (ty - y0 - vy * T) / (T * T),
    };
}

// Node export for test/ballistic.test.js (browser loads it as a plain script)
if (typeof module !== 'undefined' && module.exports) module.exports = { arcVelocity };

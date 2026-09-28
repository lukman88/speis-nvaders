// test/ballistic.test.js — unit tests for the ballistic math shared by the
// invader dive (Invader.js) and the enemy arc shot (EnemyBullet.js).
// Run: node test/ballistic.test.js
const assert = require('assert');
const { arcVelocity } = require('../ballistic.js');

// Closed-form position at time t under the solved velocity/gravity
function at(arc, x0, y0, t) {
    return { x: x0 + arc.vx * t, y: y0 + arc.vy * t + 0.5 * arc.gravity * t * t };
}

// Semi-implicit Euler integration — the same family of integration Arcade uses,
// so this checks that the solved arc survives real per-frame stepping
function simulate(arc, x0, y0, T, steps = 1000) {
    const dt = T / steps;
    let x = x0, y = y0, v = arc.vy;
    for (let i = 0; i < steps; i++) {
        x += arc.vx * dt;
        v += arc.gravity * dt;
        y += v * dt;
    }
    return { x, y };
}

let failures = 0;
function test(name, fn) {
    try { fn(); console.log(`PASS ${name}`); }
    catch (e) { failures++; console.log(`FAIL ${name}: ${e.message}`); }
}

test('vx is exactly the closing distance over T', () => {
    const arc = arcVelocity(100, 200, 400, 550, 1.2, -350);
    assert.strictEqual(arc.vx, (400 - 100) / 1.2);
});

test('lands exactly on target at t = T (closed form)', () => {
    const cases = [
        // [x0, y0, tx, ty, T, vy] — dive shape, arc-shot shape, and degenerate ones
        [100, 200, 400, 550, 1.2, -350],
        [400, 150, 400, 550, 1.333, -420],
        [10, 10, 10, 10, 1, 0],        // zero distance, zero lift
        [700, 500, 50, 100, 0.8, 100], // backward + upward target
    ];
    for (const [x0, y0, tx, ty, T, vy] of cases) {
        const arc = arcVelocity(x0, y0, tx, ty, T, vy);
        const p = at(arc, x0, y0, T);
        assert.ok(Math.abs(p.x - tx) < 1e-9, `x: ${p.x} != ${tx}`);
        assert.ok(Math.abs(p.y - ty) < 1e-9, `y: ${p.y} != ${ty}`);
    }
});

test('stays off-target before T (arc, not a straight line)', () => {
    const T = 1.2, vy = -350;
    const arc = arcVelocity(100, 200, 400, 550, T, vy);
    const mid = at(arc, 100, 200, T / 2);
    // straight-line midpoint would be ((100+400)/2, (200+550)/2) = (250, 375)
    assert.ok(Math.hypot(mid.x - 250, mid.y - 375) > 1, `midpoint too linear: ${JSON.stringify(mid)}`);
});

test('per-frame Euler integration still lands on target (arcade fidelity)', () => {
    const arc = arcVelocity(100, 200, 400, 550, 1.2, -350);
    const p = simulate(arc, 100, 200, 1.2);
    assert.ok(Math.hypot(p.x - 400, p.y - 550) < 2, `drift: ${JSON.stringify(p)}`);
});

test('gravity sign: lob up then fall to a lower target is positive g', () => {
    const arc = arcVelocity(100, 200, 400, 550, 1.2, -350);
    assert.ok(arc.gravity > 0, `gravity ${arc.gravity} should be positive (down)`);
});

test('dive regression: matches the formula previously inlined in Invader.diveAt', () => {
    // Old inline math: vx = (tx - x)/T; g = 2*(ty - y - vy*T)/(T*T)
    const m = 1.3, T = 1.2 / m, vy = -350 * m;
    const arc = arcVelocity(300, 180, 520, 550, T, vy);
    assert.strictEqual(arc.vx, (520 - 300) / T);
    assert.strictEqual(arc.gravity, 2 * (550 - 180 - vy * T) / (T * T));
});

if (failures) { console.log(`${failures} test(s) failed`); process.exit(1); }
console.log('all ballistic tests passed');

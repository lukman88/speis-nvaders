# Space Invaders — Fix Plan

> **Status: ✅ Implemented** (all 6 steps complete; syntax-checked and verified serving over HTTP)

## Current state: the game doesn't actually work

### Critical bugs (nothing happens on screen)

1. **Duplicate `update()` method in `MainScene`** (`mainScene.js`)
   The class defines `update()` twice; JS keeps only the *second* one. The first
   (which initializes `moveDirection`, `waveCounter`, and calls `spawnInvaders()`)
   is silently discarded. Result: no invaders ever spawn, and `this.moveDirection`
   stays `undefined`.

2. **Shooting can never fire** (`mainScene.js`)
   `update()` calls `this.input.keyboard.addKey(SPACE)` *every frame*, creating a
   brand-new key object each time. `JustDown()` on a freshly-added key is always
   false. The key must be created once in `create()`.

3. **Missing textures** (`mainScene.js`)
   `'player'` and `'player-bullet'` are never loaded (preload loads nothing), so the
   player logs a texture error and bullets are invisible. Only the fallback
   `setTexture('phaser')` works, which is the giant ~240×135 Phaser logo.

4. **Script files not included** (`index.html`)
   Only `mainScene.js` is loaded. `Invader.js`, `EnemyBullet.js`, and
   `BulletBullet.js` are never loaded, so `new Invader(...)` would throw a
   `ReferenceError` the moment spawning is fixed.

### Logic bugs (will surface once the above are fixed)

5. **`Invader.health` and `isAlive` are never initialized** (`Invader.js`)
   `takeDamage()` does `this.health--` on `undefined` → `NaN`, so invaders can
   never die.

6. **`invader.attemptShoot(this.scene)` doesn't exist** (`mainScene.js` / `Invader.js`)
   The method is missing from `Invader.js` → `TypeError`. Also `this.scene` should
   be `this`.

7. **Vertical drop is a permanent velocity, not a one-time step** (`mainScene.js`)
   On edge hit it does `setVelocityY(vel.y + 30)`, and with zero gravity / no
   friction the formation then falls at 30 px/s *forever* after the first reversal.
   Should be a position offset (`y += VERTICAL_DROP`).

8. **Edge detection ignores scale/origin** (`mainScene.js`)
   Uses `i.x ± i.width` instead of `body.left` / `body.right`.

9. **No collisions or game rules at all**
   No bullet↔invader overlap, no enemy bullets group (the classes exist but are
   never used), no player damage, no score/lives/wave progression, no win/lose/restart.

## Fix plan

1. **`index.html`** — add `<script>` tags for `Invader.js`, `BulletBullet.js`, and
   `EnemyBullet.js` before `mainScene.js`.

2. **`mainScene.js` → `create()`**
   - Generate textures with `Phaser.Graphics` (player ship, invader block, bullet
     rects) so no external assets are needed.
   - Init `moveDirection = 1`, `waveCounter = 0`.
   - Spawn the first wave *once*.
   - Create `enemyBullets` group.
   - Add HUD text (score / lives / wave).
   - Store `spaceKey` once.

3. **Merge into a single `update()`**
   - Player movement.
   - Shooting via `JustDown(spaceKey)`.
   - Formation movement using `body.left` / `body.right` for edge checks.
   - One-time `y += VERTICAL_DROP` on reversal (+ optional speed-up per wave).
   - Enemy shooting calls.
   - Collisions:
     - player bullet ↔ invader → `takeDamage()`, destroy bullet, add score
     - enemy bullet ↔ player → lose a life (game over at 0)
     - invader reaches bottom → game over
     - all invaders dead → next wave (`waveCounter++`, respawn)

4. **`Invader.js`**
   - Initialize `health` / `isAlive` in the constructor.
   - Implement `attemptShoot(scene)` (random chance + cooldown, spawns an
     `EnemyBullet` into `scene.enemyBullets`).
   - Make death actually remove the invader from the group.

5. **`BulletBullet.js` / `EnemyBullet.js`**
   - Set texture and velocity in constructors.
   - Destroy when off-screen.

6. **Test** — serve via a local server (`python -m http.server`) since it's Phaser +
   file://, verify in browser: movement, shooting, invader march/reverse/drop, enemy
   fire, deaths, wave progression, game over/restart.

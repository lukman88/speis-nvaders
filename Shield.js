// Shield.js — one of the four classic destructible barriers.
//
// A grid of small cells (3px) drawn into a single Graphics object. There is
// deliberately NO physics body: bullets are small and few, so eroding the
// grid with a plain AABB test per frame is cheaper than 4×96 static bodies
// in the narrowphase, and it sidesteps this Phaser build's group quirks.
//
// erode() takes the bullet's world AABB, flips every overlapping live cell
// off, redraws once, and reports whether anything was destroyed (the caller
// then kills the bullet — contact stops it, classic behavior).
class Shield {
    constructor(scene, x, y) {
        this.scene = scene;
        this.x = x;
        this.y = y;
        this.cell = 3;
        this.cols = 16;
        this.rows = 10;

        // Classic barrier silhouette: solid block with an arch cut out of
        // the bottom-center 6×6 cells.
        this.grid = [];
        for (let r = 0; r < this.rows; r++) {
            const row = [];
            for (let c = 0; c < this.cols; c++) {
                row.push(!(r >= 7 && c >= 5 && c <= 10));
            }
            this.grid.push(row);
        }

        this.g = scene.add.graphics().setDepth(11); // above the player (10), below bullets (12/13)
        this.draw();
    }

    get width() { return this.cols * this.cell; }
    get height() { return this.rows * this.cell; }

    draw() {
        this.g.clear();
        this.g.fillStyle(0x44ff66, 1);
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (this.grid[r][c]) this.g.fillRect(this.x + c * this.cell, this.y + r * this.cell, this.cell, this.cell);
            }
        }
    }

    /**
     * Erode every live cell the AABB (bx, by, bw, bh — scene coords) covers.
     * @returns {boolean} true if at least one cell was destroyed.
     */
    erode(bx, by, bw, bh) {
        const c0 = Math.max(0, Math.floor((bx - this.x) / this.cell));
        const c1 = Math.min(this.cols - 1, Math.floor((bx + bw - this.x) / this.cell));
        const r0 = Math.max(0, Math.floor((by - this.y) / this.cell));
        const r1 = Math.min(this.rows - 1, Math.floor((by + bh - this.y) / this.cell));
        let hit = false;
        for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
                if (this.grid[r][c]) { this.grid[r][c] = false; hit = true; }
            }
        }
        if (hit) this.draw();
        return hit;
    }

    destroy() { this.g.destroy(); }
}

import { GAME_CONSTANTS } from './Constants.js';

export class Renderer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = engine;
    this.muzzleFlash = 0;

    if (!this.ctx) {
      
    }

    // Canvas dimensions (will be set by scene)
    this.width = canvas.width || 240;
    this.height = canvas.height || 320;

    // Reused array for enemy draw items
    this._enemyDrawList = [];

    
  }

  render(scene) {
    if (!scene) {
      return;
    }

    if (!this.ctx) {
      return;
    }

    // Set canvas dimensions from scene if available (only when changed)
    if (scene.width && scene.height) {
      if (this.width !== scene.width || this.height !== scene.height || this.canvas.width !== scene.width || this.canvas.height !== scene.height) {
        this.width = scene.width;
        this.height = scene.height;
        this.canvas.width = scene.width;
        this.canvas.height = scene.height;
      }
    }

    this.clearCanvas();
    this.renderBackground();
    this.renderScene(scene);
    this.renderMuzzleFlash();
    this.renderGameStateOverlays(scene);
    this.renderCrosshair();
  }

  clearCanvas() {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  renderBackground() {
    // Sky
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.width, this.height / 2);

    // Ground
    this.ctx.fillStyle = '#222';
    this.ctx.fillRect(0, this.height / 2, this.width, this.height / 2);
  }

  renderScene(scene) {
    // Get game data from scene
    const player = scene.player;
    const enemies = scene.enemies;
    const map = scene.map;
    const rayCount = scene.rayCount;
    const fov = scene.fov;
    const maxDepth = scene.maxDepth;

    if (!player || !map || !Array.isArray(map) || map.length === 0) {
      return;
    }

    // Dynamic ray count adjustment based on performance
    let effectiveRayCount = rayCount;
    if (this.engine && this.engine.fps < 30) {
      effectiveRayCount = Math.max(15, Math.floor(rayCount * 0.5)); // Reduce to 50% at low FPS
    } else if (this.engine && this.engine.fps < 45) {
      effectiveRayCount = Math.max(30, Math.floor(rayCount * 0.75)); // Reduce to 75% at medium FPS
    }

    // Render walls directly per column (no queue, no sort)
    for (let x = 0; x < effectiveRayCount; x++) {
      const rayAngle = player.angle - fov / 2 + (x / effectiveRayCount) * fov;
      const distance = this.castRay(player.x, player.y, rayAngle, map, maxDepth);
      this.renderWallColumn(x, distance, rayAngle, effectiveRayCount, maxDepth);
    }

    // Build enemy draw list with distance culling and LOS (reused array)
    const enemyDrawList = this._enemyDrawList;
    enemyDrawList.length = 0;
    if (enemies && Array.isArray(enemies)) {
      for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        const dx = enemy.x - player.x;
        const dy = enemy.y - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > maxDepth * 1.5) continue; // distance culling

        // Angle relative to player
        const angleToEnemy = Math.atan2(dy, dx);
        let normalizedAngle = angleToEnemy - player.angle;
        while (normalizedAngle > Math.PI) normalizedAngle -= 2 * Math.PI;
        while (normalizedAngle < -Math.PI) normalizedAngle += 2 * Math.PI;
        if (Math.abs(normalizedAngle) >= fov / 2) continue; // not in FOV

        // Line of sight
        const rayDistance = this.castRay(player.x, player.y, angleToEnemy, map, maxDepth);
        if (rayDistance < distance) continue; // blocked

        enemyDrawList.push({ enemy, distance, angle: normalizedAngle });
      }
    }

    // Sort enemies by distance (far to near) and render
    if (enemyDrawList.length > 1) {
      enemyDrawList.sort((a, b) => b.distance - a.distance);
    }
    for (let i = 0; i < enemyDrawList.length; i++) {
      const item = enemyDrawList[i];
      this.renderEnemySprite(item.enemy, item.distance, item.angle, fov);
    }
  }

  renderWallColumn(x, distance, rayAngle, rayCount, maxDepth) {
    const wallHeight = (this.height / 2) / distance;
    const wallTop = (this.height / 2) - wallHeight;
    const wallBottom = (this.height / 2) + wallHeight;
    const shade = 0.7 + 0.3 * (1 - distance / maxDepth);
    const color = Math.floor(255 * shade);

    this.ctx.fillStyle = `rgb(${color}, ${Math.floor(color * 0.8)}, ${Math.floor(color * 0.5)})`;
    this.ctx.fillRect(
      (x / rayCount) * this.width,
      wallTop,
      this.width / rayCount + 1,
      wallBottom - wallTop
    );
  }

  renderEnemySprite(enemy, distance, angle, fov) {
    if (!enemy || typeof enemy.health === 'undefined' || typeof enemy.state === 'undefined') return;

    // Calculate screen position
    const screenX = (angle / (fov / 2)) * (this.width / 2) + this.width / 2;
    const wallHeight = (this.height / 2) / distance;
    const enemyHeight = wallHeight * (enemy.size || 0.5);
    const enemyTop = (this.height / 2) - enemyHeight / 2;
    const enemyBottom = (this.height / 2) + enemyHeight / 2;

    // Draw enemy sprite
    const color = enemy.state === 'chasing' ? GAME_CONSTANTS.ENEMY_COLOR_CHASING : GAME_CONSTANTS.ENEMY_COLOR_IDLE;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(
      screenX - enemyHeight / 4,
      enemyTop,
      enemyHeight / 2,
      enemyHeight
    );

    // Draw health bar
    const barWidth = enemyHeight / 2;
    const barHeight = 4;
    const healthPercent = enemy.health / GAME_CONSTANTS.ENEMY_HEALTH;

    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(screenX - barWidth / 2, enemyTop - 8, barWidth, barHeight);

    this.ctx.fillStyle = healthPercent > 0.5 ? '#0f0' : healthPercent > 0.25 ? '#ff0' : '#f00';
    this.ctx.fillRect(screenX - barWidth / 2, enemyTop - 8, barWidth * healthPercent, barHeight);
  }

  castRay(originX, originY, angle, map, maxDepth) {
    if (this.engine && this.engine.physics && this.engine.physics.castRay) {
      return this.engine.physics.castRay(originX, originY, angle, maxDepth);
    }
    return maxDepth;
  }

  renderGameStateOverlays(scene) {
    if (scene.gameState === 'levelComplete') {
      this.renderLevelComplete(scene);
    } else if (scene.gameState === 'gameOver') {
      this.renderGameOver(scene);
    }
  }

  renderLevelComplete(scene) {
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.ctx.fillStyle = '#fff';
    this.ctx.font = '20px monospace';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('LEVEL COMPLETE!', this.width / 2, this.height / 2 - 20);
    this.ctx.fillText(`Level ${scene.currentLevel}`, this.width / 2, this.height / 2 + 20);
  }

  renderGameOver(scene) {
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.ctx.fillStyle = (scene.enemies && Array.isArray(scene.enemies) && scene.enemies.length === 0) ? '#0f0' : '#f00';
    this.ctx.font = '20px monospace';
    this.ctx.textAlign = 'center';
    const message = (scene.enemies && Array.isArray(scene.enemies) && scene.enemies.length === 0) ? 'GAME COMPLETED!' : 'GAME OVER';
    this.ctx.fillText(message, this.width / 2, this.height / 2);
  }

  renderCrosshair() {
    this.ctx.strokeStyle = GAME_CONSTANTS.CROSSHAIR_COLOR;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(this.width / 2 - 10, this.height / 2);
    this.ctx.lineTo(this.width / 2 + 10, this.height / 2);
    this.ctx.moveTo(this.width / 2, this.height / 2 - 10);
    this.ctx.lineTo(this.width / 2, this.height / 2 + 10);
    this.ctx.stroke();
  }

  renderMuzzleFlash() {
    if (this.muzzleFlash > 0) {
      // Render muzzle flash as a white overlay fading out
      this.ctx.fillStyle = `rgba(255, 255, 255, ${this.muzzleFlash})`;
      this.ctx.fillRect(0, 0, this.width, this.height);
      this.muzzleFlash -= 0.05; // Fade out over time
    }
  }

  triggerMuzzleFlash() {
    this.muzzleFlash = 0.5;
  }
}

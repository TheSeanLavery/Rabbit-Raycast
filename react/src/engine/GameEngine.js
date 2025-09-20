import { GAME_CONSTANTS } from './Constants.js';
import { Player } from './Player.js';
import { Enemy } from './Enemy.js';
import { LevelManager } from './Level.js';
import { Renderer } from './Renderer.js';
import { InputHandler } from './InputHandler.js';
import { GameState } from './GameState.js';

export class GameEngine {
  constructor(canvas, setGameStateCallback) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Initialize dimensions
    this.width = GAME_CONSTANTS.CANVAS_WIDTH;
    this.height = GAME_CONSTANTS.CANVAS_HEIGHT;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    // Game properties
    this.fov = GAME_CONSTANTS.FOV;
    this.rayCount = GAME_CONSTANTS.RAY_COUNT;
    this.maxDepth = GAME_CONSTANTS.MAX_DEPTH;
    this.frameInterval = 1000 / GAME_CONSTANTS.TARGET_FPS;

    // Game state
    this.currentLevel = 1;
    this.gameState = 'playing'; // 'menu', 'playing', 'levelComplete', 'gameOver'
    this.score = 0;

    // Initialize components
    this.levelManager = new LevelManager();
    this.gameStateManager = new GameState(setGameStateCallback);
    this.player = new Player(5, 5);
    this.renderer = new Renderer(canvas, this);
    this.inputHandler = new InputHandler(this);

    // Game objects
    this.enemies = [];
    this.bullets = [];

    // Load first level
    this.loadLevel(this.currentLevel);

    // Game loop
    this.lastTime = 0;
    this.running = false;
  }

  loadLevel(levelIndex) {
    const levelData = this.levelManager.getLevel(levelIndex - 1);
    this.map = levelData.map;
    this.mapWidth = this.map[0].length;
    this.mapHeight = this.map.length;

    // Spawn enemies
    this.enemies = [];
    for (let i = 0; i < levelData.enemySpawns.length; i++) {
      const spawn = levelData.enemySpawns[i];
      this.enemies.push(new Enemy(spawn.x, spawn.y, this));
    }

    this.gameStateManager.updateEnemies(this.enemies.length);
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    this.gameLoop(this.lastTime);
  }

  stop() {
    this.running = false;
    this.inputHandler.cleanup();
  }

  gameLoop(currentTime) {
    if (!this.running) return;

    const deltaTime = currentTime - this.lastTime;
    if (deltaTime >= this.frameInterval) {
      this.update(deltaTime);
      this.renderer.render();
      this.lastTime = currentTime;
    }
    requestAnimationFrame(time => this.gameLoop(time));
  }

  update(deltaTime) {
    if (this.gameState !== 'playing') return;

    // Update input
    this.inputHandler.update(deltaTime);

    // Update enemies
    for (let i = 0; i < this.enemies.length; i++) {
      this.enemies[i].update(deltaTime);
    }

    // Update game state
    this.gameStateManager.updateHealth(this.player.health);
    this.gameStateManager.updateAmmo(this.player.ammo);
    this.gameStateManager.updateScore(this.score);
  }

  castRay(angle) {
    if (this.physics && this.physics.castRay) {
      return this.physics.castRay(this.player.x, this.player.y, angle, this.maxDepth);
    }
    return this.maxDepth;
  }

  isValidPosition(x, y) {
    const mapX = Math.floor(x);
    const mapY = Math.floor(y);
    if (mapX < 0 || mapX >= this.mapWidth || mapY < 0 || mapY >= this.mapHeight) {
      return false;
    }
    return this.map[mapY][mapX] === 0;
  }

  shoot() {
    if (this.player.shoot() && this.gameState === 'playing') {
      this.renderer.triggerMuzzleFlash();

      // Check for enemy hits with proper line-of-sight
      const shootAngle = this.player.angle;
      const maxShootDistance = GAME_CONSTANTS.SHOOT_DISTANCE;

      // Find all enemies in shooting range and check line of sight
      const visibleEnemies = [];
      for (let i = 0; i < this.enemies.length; i++) {
        const enemy = this.enemies[i];
        const dx = enemy.x - this.player.x;
        const dy = enemy.y - this.player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > maxShootDistance) continue;
        const angleToEnemy = Math.atan2(dy, dx);
        const angleDiff = Math.abs(angleToEnemy - shootAngle);
        const normalizedAngleDiff = Math.min(angleDiff, 2 * Math.PI - angleDiff);
        if (normalizedAngleDiff > Math.PI / 6) continue;
        const rayDistance = this.castRay(angleToEnemy);
        if (rayDistance >= distance) visibleEnemies.push(enemy);
      }

      // Hit the closest visible enemy
      if (visibleEnemies.length > 0) {
        let closestEnemy = visibleEnemies[0];
        let closestDist = Math.sqrt(
          (closestEnemy.x - this.player.x) ** 2 + (closestEnemy.y - this.player.y) ** 2
        );
        for (let i = 1; i < visibleEnemies.length; i++) {
          const enemy = visibleEnemies[i];
          const distCurrent = Math.sqrt(
            (enemy.x - this.player.x) ** 2 + (enemy.y - this.player.y) ** 2
          );
          if (distCurrent < closestDist) {
            closestDist = distCurrent;
            closestEnemy = enemy;
          }
        }

        closestEnemy.takeDamage(GAME_CONSTANTS.SHOOT_DAMAGE);
      }
    }
  }

  nextLevel() {
    if (this.currentLevel < this.levelManager.getTotalLevels()) {
      this.currentLevel++;
      this.gameState = 'levelComplete';
      this.gameStateManager.updateLevel(this.currentLevel);

      setTimeout(() => {
        this.gameState = 'playing';
        this.loadLevel(this.currentLevel);
      }, 2000);
    } else {
      this.gameState = 'gameOver'; // Game completed
    }
  }

  handleOrientationChange() {
    const isLandscape = window.innerWidth > window.innerHeight;
    this.width = isLandscape ? GAME_CONSTANTS.LANDSCAPE_WIDTH : GAME_CONSTANTS.CANVAS_WIDTH;
    this.height = isLandscape ? GAME_CONSTANTS.LANDSCAPE_HEIGHT : GAME_CONSTANTS.CANVAS_HEIGHT;
    this.rayCount = isLandscape ? GAME_CONSTANTS.LANDSCAPE_RAY_COUNT : GAME_CONSTANTS.RAY_COUNT;

    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }
}

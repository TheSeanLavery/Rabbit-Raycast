/**
 * Physics System
 *
 * Handles collision detection, physics simulation, and spatial queries.
 * Supports raycasting, bounding box collision, and basic physics integration.
 */

export class PhysicsSystem {
  constructor(engine) {
    this.engine = engine;
    this.world = null;
    this.collisionLayers = new Map();
    this.raycastCache = new Map();
  }

  init(engine) {
    this.engine = engine;
    console.log('⚡ Physics System initialized');
  }

  update(deltaTime) {
    // Update physics simulation
    this.updateCollisions();
    this.updateRaycastCache();
  }

  /**
   * Set the physics world (map/level data)
   */
  setWorld(worldData) {
    this.world = worldData;
    this.collisionLayers.clear();
    this.raycastCache.clear();

    // Build a flattened 1D map and compute widthShift fast-path when width is power of two
    if (this.world && Array.isArray(this.world.map) && this.world.width && this.world.height) {
      const width = this.world.width;
      const height = this.world.height;
      const size = width * height;

      const map1D = new Uint8Array(size);
      for (let y = 0; y < height; y++) {
        const row = this.world.map[y];
        const offset = y * width;
        for (let x = 0; x < width; x++) {
          map1D[offset + x] = row[x] ? 1 : 0;
        }
      }

      // If width is power of two, use bit-shift for row offset
      const isPowerOfTwo = (width & (width - 1)) === 0;
      const widthShift = isPowerOfTwo ? (31 - Math.clz32(width)) : null;

      this.world.map1D = map1D;
      this.world.widthShift = widthShift;
    } else if (this.world) {
      this.world.map1D = null;
      this.world.widthShift = null;
    }
  }

  /**
   * Fast wall check at integer map coordinates with 1D map and shift fast-path.
   * Treats out-of-bounds as walls.
   */
  isWallAtMapCoord(mapX, mapY) {
    if (!this.world) return false;

    if (mapX < 0 || mapX >= this.world.width || mapY < 0 || mapY >= this.world.height) {
      return true;
    }

    if (this.world.map1D) {
      const idx = this.world.widthShift != null
        ? ((mapY << this.world.widthShift) + mapX)
        : (mapY * this.world.width + mapX);
      return this.world.map1D[idx] === 1;
    }

    // Fallback to 2D map
    return this.world.map[mapY][mapX] === 1;
  }

  /**
   * Check if a position is valid (not colliding with walls)
   */
  isValidPosition(x, y, radius = 0.3) {
    if (!this.world) return true;

    const mapX = Math.floor(x);
    const mapY = Math.floor(y);

    // Check bounds
    if (mapX < 0 || mapX >= this.world.width || mapY < 0 || mapY >= this.world.height) {
      return false;
    }

    // Check wall collision at center
    if (this.isWallAtMapCoord(mapX, mapY)) {
      return false;
    }

    // Check radius-based collision for smoother movement
    if (radius > 0) {
      // Use 8 directional checks plus center for better collision detection
      const checkPoints = [
        [x, y], // Center
        [x - radius, y], // Left
        [x + radius, y], // Right
        [x, y - radius], // Top
        [x, y + radius], // Bottom
        [x - radius * 0.7, y - radius * 0.7], // Top-left
        [x + radius * 0.7, y - radius * 0.7], // Top-right
        [x - radius * 0.7, y + radius * 0.7], // Bottom-left
        [x + radius * 0.7, y + radius * 0.7]  // Bottom-right
      ];

      for (const [cx, cy] of checkPoints) {
        const cMapX = Math.floor(cx);
        const cMapY = Math.floor(cy);

        if (this.isWallAtMapCoord(cMapX, cMapY)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Cast a ray and return the distance to the nearest wall
   */
  castRay(originX, originY, angle, maxDistance = 20) {
    // Round coordinates and angle for better caching
    const cacheKey = `${originX.toFixed(1)},${originY.toFixed(1)},${angle.toFixed(2)}`;

    // Check cache first
    if (this.raycastCache.has(cacheKey)) {
      return this.raycastCache.get(cacheKey);
    }

    if (!this.world) return maxDistance;

    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    let x = originX;
    let y = originY;

    for (let depth = 0; depth < maxDistance; depth += 0.05) {
      const testX = Math.floor(x);
      const testY = Math.floor(y);

      if (this.isWallAtMapCoord(testX, testY)) {
        const result = depth;
        this.raycastCache.set(cacheKey, result);
        return result;
      }

      x += cos * 0.05;
      y += sin * 0.05;
    }

    const result = maxDistance;
    this.raycastCache.set(cacheKey, result);
    return result;
  }

  /**
   * Check line of sight between two points
   */
  hasLineOfSight(fromX, fromY, toX, toY) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    const rayDistance = this.castRay(fromX, fromY, angle, distance + 1);
    return rayDistance >= distance;
  }

  /**
   * Perform sphere casting (ray with radius)
   */
  sphereCast(originX, originY, angle, radius, maxDistance = 20) {
    // Cast multiple rays in a cone to simulate sphere
    const rays = 5;
    const spread = radius * 0.1;

    let minDistance = maxDistance;

    for (let i = 0; i < rays; i++) {
      const rayAngle = angle + (spread * (i - rays / 2) / (rays / 2));
      const distance = this.castRay(originX, originY, rayAngle, maxDistance);
      minDistance = Math.min(minDistance, distance);
    }

    return minDistance;
  }

  /**
   * Check collision between two bounding boxes
   */
  checkBoundingBoxCollision(box1, box2) {
    return !(box1.x + box1.width < box2.x ||
             box2.x + box2.width < box1.x ||
             box1.y + box1.height < box2.y ||
             box2.y + box2.height < box1.y);
  }

  /**
   * Find nearest valid position to help player get unstuck
   */
  findNearestValidPosition(x, y, maxSearchDistance = 1.0, stepSize = 0.1) {
    if (this.isValidPosition(x, y)) {
      return { x, y };
    }

    // Search in expanding circles around the position
    for (let distance = stepSize; distance <= maxSearchDistance; distance += stepSize) {
      const steps = Math.ceil(distance / stepSize);
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const testX = x + Math.cos(angle) * distance;
        const testY = y + Math.sin(angle) * distance;

        if (this.isValidPosition(testX, testY)) {
          return { x: testX, y: testY };
        }
      }
    }

    // If no valid position found, return original position
    return { x, y };
  }

  /**
   * Update collision detection for all entities
   */
  updateCollisions() {
    // This would be expanded for entity-entity collisions
    // For now, it's mainly wall collisions handled in isValidPosition
  }

  /**
   * Clear raycast cache (call when world changes)
   */
  clearRaycastCache() {
    this.raycastCache.clear();
  }

  /**
   * Update raycast cache (remove old entries)
   */
  updateRaycastCache() {
    // More aggressive cache management for better performance
    if (this.raycastCache.size > 500) {
      // Clear 30% of the cache to maintain performance
      const entries = Array.from(this.raycastCache.entries());
      const toRemove = entries.slice(0, Math.floor(entries.length * 0.3));
      toRemove.forEach(([key]) => this.raycastCache.delete(key));
    }
  }

  /**
   * Get physics statistics
   */
  getStats() {
    return {
      worldLoaded: !!this.world,
      cacheSize: this.raycastCache.size,
      collisionLayers: this.collisionLayers.size
    };
  }
}

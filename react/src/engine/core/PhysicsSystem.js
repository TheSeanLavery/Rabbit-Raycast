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
    // Nested cache: Map<qx, Map<qy, Map<qa, distance>>>
    this.raycastCache = new Map();
    this.raycastCacheSize = 0;
    this.enableRaycastCache = true;
  }

  init(engine) {
    this.engine = engine;
    
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
    this.raycastCacheSize = 0;

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

    // Check radius-based collision for smoother movement (inline, no array alloc)
    if (radius > 0) {
      const r = radius;
      const r7 = r * 0.7;

      // Center
      if (this.isWallAtMapCoord(Math.floor(x), Math.floor(y))) return false;
      // Cardinal directions
      if (this.isWallAtMapCoord(Math.floor(x - r), Math.floor(y))) return false;
      if (this.isWallAtMapCoord(Math.floor(x + r), Math.floor(y))) return false;
      if (this.isWallAtMapCoord(Math.floor(x), Math.floor(y - r))) return false;
      if (this.isWallAtMapCoord(Math.floor(x), Math.floor(y + r))) return false;
      // Diagonals
      if (this.isWallAtMapCoord(Math.floor(x - r7), Math.floor(y - r7))) return false;
      if (this.isWallAtMapCoord(Math.floor(x + r7), Math.floor(y - r7))) return false;
      if (this.isWallAtMapCoord(Math.floor(x - r7), Math.floor(y + r7))) return false;
      if (this.isWallAtMapCoord(Math.floor(x + r7), Math.floor(y + r7))) return false;
    }

    return true;
  }

  /**
   * Cast a ray and return the distance to the nearest wall
   */
  castRay(originX, originY, angle, maxDistance = 20) {
    if (!this.world) return maxDistance;

    // Quantize inputs and check nested cache (optional)
    let qx, qy, qa, cachedY;
    if (this.enableRaycastCache) {
      const angleNorm = ((angle % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2);
      qx = (Math.round(originX * 10)) | 0; // 0.1 units
      qy = (Math.round(originY * 10)) | 0;
      qa = (Math.round(angleNorm * 100)) | 0; // ~0.01 rad

      cachedY = this.raycastCache.get(qx);
      if (cachedY) {
        const cachedA = cachedY.get(qy);
        if (cachedA && cachedA.has(qa)) {
          return cachedA.get(qa);
        }
      }
    }

    // DDA ray traversal
    const rayDirX = Math.cos(angle);
    const rayDirY = Math.sin(angle);

    let mapX = Math.floor(originX);
    let mapY = Math.floor(originY);

    const veryLarge = 1e30;
    const deltaDistX = rayDirX !== 0 ? Math.abs(1 / rayDirX) : veryLarge;
    const deltaDistY = rayDirY !== 0 ? Math.abs(1 / rayDirY) : veryLarge;

    let stepX, stepY;
    let sideDistX, sideDistY;

    if (rayDirX < 0) {
      stepX = -1;
      sideDistX = (originX - mapX) * deltaDistX;
    } else {
      stepX = 1;
      sideDistX = (mapX + 1 - originX) * deltaDistX;
    }

    if (rayDirY < 0) {
      stepY = -1;
      sideDistY = (originY - mapY) * deltaDistY;
    } else {
      stepY = 1;
      sideDistY = (mapY + 1 - originY) * deltaDistY;
    }

    let hit = false;
    let side = 0; // 0=x side, 1=y side
    let distance = 0;

    while (!hit) {
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
        side = 0;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
        side = 1;
      }

      if (this.isWallAtMapCoord(mapX, mapY)) {
        hit = true;
        if (side === 0) {
          distance = (mapX - originX + (1 - stepX) * 0.5) / (rayDirX !== 0 ? rayDirX : 1e-6);
        } else {
          distance = (mapY - originY + (1 - stepY) * 0.5) / (rayDirY !== 0 ? rayDirY : 1e-6);
        }
        distance = Math.abs(distance);
        if (!Number.isFinite(distance) || distance <= 0) {
          distance = 0;
        }
        if (distance > maxDistance) distance = maxDistance;
        break;
      }

      // Early-out if we marched beyond maxDistance along both axes
      const approxDist = Math.min(sideDistX, sideDistY);
      if (approxDist > maxDistance + 1) {
        distance = maxDistance;
        break;
      }
    }

    // Store in nested cache
    if (this.enableRaycastCache) {
      let byY = this.raycastCache.get(qx);
      if (!byY) {
        byY = new Map();
        this.raycastCache.set(qx, byY);
      }
      let byA = byY.get(qy);
      if (!byA) {
        byA = new Map();
        byY.set(qy, byA);
      }
      if (!byA.has(qa)) {
        this.raycastCacheSize++;
      }
      byA.set(qa, distance);
    }
    return distance;
  }

  /**
   * Fast raycast using precomputed direction vector. Optionally uses cache.
   */
  castRayFast(originX, originY, dirX, dirY, maxDistance = 20, useCache = false) {
    if (!this.world) return maxDistance;

    let qx, qy, qa, cachedY;
    if (useCache) {
      const angle = Math.atan2(dirY, dirX);
      const angleNorm = ((angle % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2);
      qx = (Math.round(originX * 10)) | 0;
      qy = (Math.round(originY * 10)) | 0;
      qa = (Math.round(angleNorm * 100)) | 0;
      cachedY = this.raycastCache.get(qx);
      if (cachedY) {
        const cachedA = cachedY.get(qy);
        if (cachedA && cachedA.has(qa)) {
          return cachedA.get(qa);
        }
      }
    }

    const rayDirX = dirX;
    const rayDirY = dirY;

    let mapX = Math.floor(originX);
    let mapY = Math.floor(originY);

    const veryLarge = 1e30;
    const deltaDistX = rayDirX !== 0 ? Math.abs(1 / rayDirX) : veryLarge;
    const deltaDistY = rayDirY !== 0 ? Math.abs(1 / rayDirY) : veryLarge;

    let stepX, stepY;
    let sideDistX, sideDistY;

    if (rayDirX < 0) {
      stepX = -1;
      sideDistX = (originX - mapX) * deltaDistX;
    } else {
      stepX = 1;
      sideDistX = (mapX + 1 - originX) * deltaDistX;
    }

    if (rayDirY < 0) {
      stepY = -1;
      sideDistY = (originY - mapY) * deltaDistY;
    } else {
      stepY = 1;
      sideDistY = (mapY + 1 - originY) * deltaDistY;
    }

    let hit = false;
    let side = 0;
    let distance = 0;

    while (!hit) {
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
        side = 0;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
        side = 1;
      }

      if (this.isWallAtMapCoord(mapX, mapY)) {
        hit = true;
        if (side === 0) {
          distance = (mapX - originX + (1 - stepX) * 0.5) / (rayDirX !== 0 ? rayDirX : 1e-6);
        } else {
          distance = (mapY - originY + (1 - stepY) * 0.5) / (rayDirY !== 0 ? rayDirY : 1e-6);
        }
        distance = Math.abs(distance);
        if (!Number.isFinite(distance) || distance <= 0) {
          distance = 0;
        }
        if (distance > maxDistance) distance = maxDistance;
        break;
      }

      const approxDist = Math.min(sideDistX, sideDistY);
      if (approxDist > maxDistance + 1) {
        distance = maxDistance;
        break;
      }
    }

    if (useCache) {
      let byY = this.raycastCache.get(qx);
      if (!byY) {
        byY = new Map();
        this.raycastCache.set(qx, byY);
      }
      let byA = byY.get(qy);
      if (!byA) {
        byA = new Map();
        byY.set(qy, byA);
      }
      if (!byA.has(qa)) {
        this.raycastCacheSize++;
      }
      byA.set(qa, distance);
    }

    return distance;
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
    // Cheap eviction: clear entirely when too large
    if (this.raycastCacheSize > 2000) {
      this.raycastCache.clear();
      this.raycastCacheSize = 0;
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

## Optimization backlog (highest impact first)

### Renderer (biggest wins)
- Eliminate per-frame wall render queue
  - Render wall columns directly during the ray loop (no queue objects, no sort).
  - Keep a small reused array only for visible enemies that need depth sort.
- Reuse arrays and avoid sort churn
  - Maintain a preallocated enemy draw list; clear length each frame; use for-loops, not forEach.
  - Only sort when list length > 1; prefer in-place sort.
- Avoid repeated trig/Math in hot paths
  - Compute `rayAngle` once; consider passing precomputed `sin/cos` into `castRay`.
- Reduce draw-state changes
  - Minimize `fillStyle` changes (optional: bucket wall shades).
- Debug micro-ops
  - Use `this.ctx` in debug paths; update debug text at 1 Hz.

### PhysicsSystem (raycasting and collisions)
- Switch raycasting to DDA grid traversal
  - Reduce ray steps from hundreds to O(grid intersections) per ray.
- Pack raycast cache keys as small integers
  - Quantize `(x, y, angle)` and pack to a single int or nested Maps to avoid string churn.
- Lightweight cache eviction
  - Use aging/LRU without `Array.from(...).slice(...)` allocations.
- Remove allocation in `isValidPosition`
  - Inline the 9 checks instead of building a `checkPoints` array.

### Demo/Gameplay logic
- Guard hot-path logs behind `engine.config.debug`
  - Remove logs in `onRender`, joystick updates, and per-frame loops.
- Replace angle math with dot-product checks
  - For FOV/aim checks use cosine threshold instead of `atan2` + normalize.
- Throttle expensive enemy work
  - Distance-based update cadence or cap enemies processed per frame.

### Engine loop
- Prebind requestAnimationFrame callback
  - `this._raf = (t) => this.gameLoop(t)` and reuse it.
- Limit debug overhead
  - Update metrics at 1 Hz; avoid per-frame allocations in debug.

### InputSystem (remaining)
- Avoid payload allocations in emits
  - Reuse small event payload objects for mouse/touch move.
  - Avoid `Array.from(...)` of touches each frame for consumers that can read the Map.

### ECS 2D sprite systems
- Stable keys and fewer arrays
  - Use `{texture, blendMode}` (not string concat) as Map key; or nested Maps.
  - Iterate Maps directly or reuse a working array instead of `Array.from`.
- Sort only when necessary
  - Track dirty flags for layer/sorting changes; avoid sorting every render.
- Preallocate and reuse batch containers
  - Keep batch objects and clear their contents each frame.

### ParticleSystem
- Micro-optimizations
  - Avoid unnecessary `save/restore` if state is known; reset `globalAlpha` manually.
  - Optional: group by color to reduce `fillStyle` changes when particle counts grow.

### Misc/quality
- Avoid template strings/object literals in per-frame logs and loops.
- Prefer for-loops over forEach/map/filter in hot paths.
- Consider typed arrays for per-column intermediates if profiling shows pressure.

## Recommended next steps (implement in order)
1) Renderer: remove wall queue + reuse enemy list; cut GC and CPU time in render.
2) Physics: DDA raycast + packed cache keys + cheap eviction; large CPU/GC win.
3) Demo: remove hot-path logs and replace angle math with dot-product checks.
4) Engine loop: prebind RAF callback.
5) ECS sprite systems: stabilize keys and reuse arrays/batches.



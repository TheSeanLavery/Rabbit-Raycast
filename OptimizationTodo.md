## Optimization backlog (highest impact first)

### Renderer (biggest wins)
- [x] Eliminate per-frame wall render queue
  - Render wall columns directly during the ray loop (no queue objects, no sort).
  - Keep a small reused array only for visible enemies that need depth sort.
- [x] Reuse arrays and avoid sort churn
  - Maintain a preallocated enemy draw list; clear length each frame; use for-loops, not forEach.
  - Only sort when list length > 1; prefer in-place sort.
  - Preallocate and reuse enemy draw item objects (implemented).
- Avoid repeated trig/Math in hot paths
  - Compute `rayAngle` once; consider passing precomputed `sin/cos` into `castRay`.
- Reduce draw-state changes
  - Minimize `fillStyle` changes (optional: bucket wall shades).
- Debug micro-ops
  - Use `this.ctx` in debug paths; update debug text at 1 Hz.

### PhysicsSystem (raycasting and collisions)
- [x] Switch raycasting to DDA grid traversal
  - Reduce ray steps from hundreds to O(grid intersections) per ray.
- [x] Pack raycast cache keys as small integers
  - Quantize `(x, y, angle)` and pack to a single int or nested Maps to avoid string churn.
- [x] Lightweight cache eviction
  - Use aging/LRU without `Array.from(...).slice(...)` allocations.
- [x] Remove allocation in `isValidPosition`
  - Inline the 9 checks instead of building a `checkPoints` array.

### Demo/Gameplay logic
- [x] Guard hot-path logs behind `engine.config.debug`
  - Remove logs in `onRender`, joystick updates, and per-frame loops.
- [x] Replace angle math with dot-product checks
  - For FOV/aim checks use cosine threshold instead of `atan2` + normalize.
- [x] Throttle expensive enemy work
  - Distance-based update cadence or cap enemies processed per frame (implemented: frame skipping + distance culling).

### Engine loop
- [x] Prebind requestAnimationFrame callback
  - `this._raf = (t) => this.gameLoop(t)` and reuse it.
- [x] Optional uncapped mode (disable vsync)
  - Configure `useVSync: false` and `targetFPS: 0` (or via `engine.setConfig`).

### InputSystem (remaining)
- Avoid payload allocations in emits
  - Reuse small event payload objects for mouse/touch move.
  - Avoid `Array.from(...)` of touches each frame for consumers that can read the Map.

### ECS 2D sprite systems
- [x] Stable keys and fewer arrays
  - Use `{texture, blendMode}` (not string concat) as Map key; or nested Maps.
  - Iterate Maps directly or reuse a working array instead of `Array.from`.
- Sort only when necessary
  - Track dirty flags for layer/sorting changes; avoid sorting every render.
- [x] Preallocate and reuse batch containers
  - Keep batch objects and clear their contents each frame (implemented via nested batch maps and length=0 clears).

### ParticleSystem
- Micro-optimizations
  - Avoid unnecessary `save/restore` if state is known; reset `globalAlpha` manually.
  - Optional: group by color to reduce `fillStyle` changes when particle counts grow.

### Misc/quality
- [x] Avoid template strings/object literals in per-frame logs and loops.
- [x] Prefer for-loops over forEach/map/filter in hot paths.
- Consider typed arrays for per-column intermediates if profiling shows pressure.

## Recommended next steps (implement in order)
1) ECS sprite systems: sort only when necessary; consider dirty flags.
2) Renderer: avoid repeated trig/Math in hot paths (precompute where feasible).
3) InputSystem: minimize payload allocations in emits.
4) ParticleSystem: optional grouping by color and fewer save/restore.
5) Physics: consider further micro-optimizations if profiling indicates.



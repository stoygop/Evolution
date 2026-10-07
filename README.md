# Evolution Sandbox

Experimental real-time 2D simulation of asexual foragers. Creatures look for food, spend energy to stay alive, and reproduce with small mutations. It is a V1 sandbox for watching selection, not a polished product.

## Run

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:47321](http://127.0.0.1:47321). The dev server binds to `0.0.0.0` on port **47321**.

```bash
npm run check   # typecheck and headless simulation checks
npm run build   # production bundle in dist/
```

Controls: Pause, 1× / 5× / 20× / 100×, Restart. Click a creature to inspect it. Space pauses when focus is not in a text field. Accelerated speeds run many simulation ticks per frame and draw once per frame.

## Layout

| Path | Role |
| --- | --- |
| `src/config.ts` | Every important constant. Edit this to retune the sim. |
| `src/sim/` | Engine. No DOM and no canvas. |
| `src/render/` | Canvas world view and the line charts. |
| `src/main.ts`, `src/style.css` | DOM overlay: controls, inspector, live stats. |
| `src/selfcheck.ts` | Headless checks. Not part of the app bundle. |

The engine keeps `id`, `parentId`, and `generation` on every creature so a lineage view can be added later. V1 does not implement predators, food types, seasons, terrain, sexual reproduction, species, or environmental events. The world type notes where those would attach. `foodSpawnPerSecond` lives on the world (copied from config) so a later season model can change spawn rate without rewriting the step.

## Traits

Each creature inherits three traits:

| Trait | Meaning | Limit |
| --- | --- | --- |
| `speed` | Top movement speed, world units per second | 16 – 130 |
| `vision` | Food detection distance, center to center | 24 – 260 |
| `size` | Drawn radius and energy capacity | 4.5 – 18 |

Founders are rolled inside a middle band (speed 32–88, vision 40–160, size 6–12), not at the maximum. Higher is not uniformly better.

## Equations

`Δt` is a fixed step of `1/30` second. Symbols below match `src/config.ts`.

### Energy capacity

```
maxEnergy = size * energy.capacityPerSize
```

`energy.capacityPerSize` is **14**. A size-10 creature stores 140 energy. Founders start at `energy.initialFraction` (**0.55**) of max.

### Metabolism

Creatures are always moving (chasing food or wandering), so movement cost is continuous.

```
movement = energy.moveCoeff
         * (speed / energy.refSpeed)^2
         * (size / energy.refSize)

metabolism = energy.base
           + energy.perVision * vision
           + energy.sizeCost * size
           + movement

energy <- energy - metabolism * Δt
```

| Constant | Value | Role |
| --- | --- | --- |
| `energy.base` | 0.32 | Cost paid by every creature, per second |
| `energy.perVision` | 0.0052 | Upkeep per unit of vision, per second |
| `energy.sizeCost` | 0.048 | Upkeep per unit of size, per second |
| `energy.moveCoeff` | 0.58 | Scales the movement term |
| `energy.refSpeed` | 50 | Speed at which the squared term is 1 |
| `energy.refSize` | 10 | Size at which the movement term is unscaled |

Movement cost grows with the square of speed and linearly with size. A fast, large, farsighted creature burns several times more energy than a modest one, so maximizing every trait is a losing strategy unless that creature actually wins food the others cannot reach.

A worked example, per second:

- Modest forager (speed 40, vision 60, size 7): movement `0.58 * (0.8)^2 * 0.7 ≈ 0.26`, metabolism `0.32 + 0.31 + 0.34 + 0.26 ≈ 1.23`
- Greedy forager (speed 130, vision 260, size 18): movement `0.58 * (2.6)^2 * 1.8 ≈ 7.05`, metabolism `0.32 + 1.35 + 0.86 + 7.05 ≈ 9.6`

### Food

The world starts with **90** pellets. More appear at **3.6 per second**, and the map never holds more than **110**. That trickle cannot feed the starting population, so creatures compete.

On contact (`distance <= size + food.radius`):

```
energy <- min(maxEnergy, energy + food.energy)
```

`food.energy` is **34**. `food.radius` is **2.6**. A creature only walks toward food inside its vision radius; otherwise it picks a new heading every 0.45–1.8 seconds and wanders. Walls bounce.

### Death

```
energy <= 0  ->  removed
```

### Reproduction

Asexual and continuous. The world does not pause, and creatures do not share a generation clock.

A living creature reproduces when all of these hold:

- `age >= reproduction.minAge` (**4** seconds)
- `reproduceCooldown <= 0` (set to **2.5** seconds after a birth)
- `population < population.max` (**450**, a performance cap)
- `energy >= reproduction.energyFraction * maxEnergy` (**0.66**)

Then:

```
cost = reproduction.costFraction * maxEnergy     # 0.40
energy <- energy - cost
childEnergy = min(childMaxEnergy, reproduction.offspringShare * cost)  # share is 0.72
```

The child is placed just outside the parent. It receives a new id, `parentId` of the parent, and `generation = parent.generation + 1`.

### Mutation

Each trait gets independent Gaussian noise, then is clamped to its limit:

```
speed'  = clamp(speed  + N(0, mutation.speedSigma),  speed min/max)    # sigma 5.5
vision' = clamp(vision + N(0, mutation.visionSigma), vision min/max)   # sigma 9
size'   = clamp(size   + N(0, mutation.sizeSigma),   size min/max)     # sigma 0.65
```

## What you see

- Creatures are circles. Diameter is the size trait. Color tracks speed.
- A tick mark shows heading.
- Food is a small dot.
- The selected creature gets a solid ring and a dashed vision circle.
- The inspector shows id, parent id, generation, age, energy / max energy, food eaten, offspring, speed, vision, and size.
- Live stats: population, food count, average generation, average speed, average vision, average size.
- Samples are stored every **0.5** simulated seconds (up to 2400) and drawn as four line charts. Trait charts use the legal min/max of that trait as the vertical scale.

## Retuning

Edit `src/config.ts`, then restart the dev server (Vite will reload). If the population crashes to zero, raise `food.spawnPerSecond` or `food.energy`, or lower metabolism. If nobody dies and every trait drifts upward, food is too abundant or the trait costs are too cheap.

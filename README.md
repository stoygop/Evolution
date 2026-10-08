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

Controls: Pause, 1× / 5× / 20× / 100×, Restart, and Download Run Data (CSV or JSON of the samples already stored for the charts). Click a creature to inspect it. Space pauses when focus is not in a text field. Accelerated speeds run many simulation ticks per frame and draw once per frame.

## Layout

| Path | Role |
| --- | --- |
| `src/config.ts` | Every important constant. Edit this to retune the sim. `experiment` only changes recording. |
| `src/sim/` | Engine. No DOM and no canvas. `environment.ts` is the list of live food controls. |
| `src/experiment/` | Full-run recorder. Observes the world and does not move creatures or change energy. |
| `src/render/` | Canvas world view, the rolling chart window, and the line charts. |
| `src/main.ts`, `src/style.css` | DOM overlay: controls, inspector, live stats. |
| `src/ui/export-run.ts` | CSV and JSON download. |
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
           + mateSense

energy <- energy - metabolism * Δt
```

`mateSense` is `0` in asexual mode. In sexual mode it is `energy.perMateDetection * mateDetection`.

| Constant | Value | Role |
| --- | --- | --- |
| `energy.base` | 0.32 | Cost paid by every creature, per second |
| `energy.perVision` | 0.0052 | Upkeep per unit of food vision, per second |
| `energy.perMateDetection` | 0.0026 | Sexual mode only. Upkeep per unit of mate detection, per second |
| `energy.sizeCost` | 0.048 | Upkeep per unit of size, per second |
| `energy.moveCoeff` | 0.58 | Scales the movement term |
| `energy.refSpeed` | 50 | Speed at which the squared term is 1 |
| `energy.refSize` | 10 | Size at which the movement term is unscaled |

Movement cost grows with the square of speed and linearly with size. A fast, large, farsighted creature burns several times more energy than a modest one, so maximizing every trait is a losing strategy unless that creature actually wins food the others cannot reach.

A worked example, per second, asexual (no mate-sense term):

- Modest forager (speed 40, vision 60, size 7): movement `0.58 * (0.8)^2 * 0.7 ≈ 0.26`, metabolism `0.32 + 0.31 + 0.34 + 0.26 ≈ 1.23`
- Greedy forager (speed 130, vision 260, size 18): movement `0.58 * (2.6)^2 * 1.8 ≈ 7.05`, metabolism `0.32 + 1.35 + 0.86 + 7.05 ≈ 9.6`

The same modest forager in sexual mode with mate detection 180 also pays `0.0026 * 180 = 0.468` per second.

### Food

The world starts with **90** pellets. More appear at **3.6 per second**, and the map never holds more than **110**. That trickle cannot feed the starting population, so creatures compete.

On contact (`distance <= size + food.radius`):

```
energy <- min(maxEnergy, energy + foodEnergy)
```

The V1 meal is **34** energy. `food.radius` is **2.6**. A creature walks toward food inside its vision radius; otherwise it picks a new heading every 0.45–1.8 seconds and wanders. In sexual mode, an eligible creature at or above the food-priority energy instead walks toward its paired mate. Walls bounce.

The Environment panel can change spawn rate and meal energy before a restart, or live during a run. A live change keeps the current creatures. Defaults stay **3.6/s** and **34**. Each population sample stores the active values. JSON also lists each change with simulation time, average generation, the parameter, and the old and new values. Reset to V1 Defaults puts those two numbers back.

### Death

```
energy <= 0  ->  removed
```

### Reproduction

Asexual and continuous. The world does not pause, and creatures do not share a generation clock.

A living creature reproduces when all of these hold:

- `age >= reproduction.minAge` (**4** seconds)
- `reproduceCooldown <= 0` (set to **2.5** seconds after a birth)
- `population < population safety cap` (default **450**; this is a computational cap, not a carrying capacity)
- `energy >= reproduction.energyFraction * maxEnergy` (**0.66**)

Then:

```
cost = reproduction.costFraction * maxEnergy     # 0.40
energy <- energy - cost
childEnergy = min(childMaxEnergy, reproduction.offspringShare * cost)  # share is 0.72
```

The child is placed just outside the parent. It receives a new id, `parentId` of the parent, `parentBId` null, and `generation = parent.generation + 1`.

### Sexual reproduction

The Reproduction control defaults to **asexual**. Sexual mode does not add sexes. Any eligible creature can mate with any other.

A creature is eligible when it meets the same age, cooldown, and energy-threshold rules as asexual reproduction. Mating still requires the centers to be within **mating radius** (default **90**). The creature never mates with itself.

Eligible creatures whose energy is at least `behavior.foodPriorityEnergyFraction` of max energy (default **0.66**, the same number as the reproduction threshold) look for a mate inside their own `mateDetection` radius. Below that fraction they seek food, even if a mate is nearby. `vision` is still only food detection.

Pairing is mutual and deterministic. Existing pairs are kept while both stay eligible, the distance stays inside the larger of their detection radii (or the mating radius), and the chase is younger than `behavior.matePairTimeout` (**8** seconds). Otherwise the lower id picks the nearest eligible creature inside its own detection radius, and both adopt that target. A creature already locked to someone else is skipped, so A cannot chase B while B chases C. Ties go to the lower id. A timed-out pair avoids each other for `behavior.mateRetryDelay` (**2** seconds). They walk toward the shared target. They do not mate at detection range.

Each parent's reproductive budget is still half of the asexual cost:

```
budgetA = 0.20 * maxEnergy(parentA)
budgetB = 0.20 * maxEnergy(parentB)
available = budgetA + budgetB
investment = (parentA.offspringInvestment + parentB.offspringInvestment) / 2
energyLitter = floor(available / investment)
litterSize = energy-limited ? energyLitter : min(litter cap, energyLitter)
```

The litter cap defaults to **8**. Energy-limited mode has no experimental litter ceiling. If the planned litter is above the computational allocation ceiling (**64**), the extra offspring are not born and a `litter-allocation` safety event is recorded. Parents still pay only for offspring that are born.

If `available < investment`, the mating does not happen. Otherwise each child is built independently: recombine every trait, then mutate, then

```
childEnergy = min(childMaxEnergy, investment)
```

The parents pay the sum of those child energies, split in proportion to `budgetA` and `budgetB`. Energy left inside the budget stays with the parents. Nothing is created. The 0.72 offspring share remains the asexual rule only.

Traits mix in this order, each with its own `alpha` from `rng.next()` in [0, 1): speed, vision, size, mateDetection, offspringInvestment.

```
childTrait = alpha * parentA.trait + (1 - alpha) * parentB.trait
```

Gaussian mutation then runs on that blend. Speed, vision, size, mate detection, and offspring investment are clamped to the active windows. The size window defaults to **4.5–18**. Asexual mutation does not draw the two new traits, so those births keep the historical random stream. Each child stores `parentId` as parent A and `parentBId` as parent B. Its generation is `max(parentA, parentB) + 1`.

An eligible seeker who ends the step with no mate inside `mateDetection` increments `mateFailures`. A creature already chasing is not a failure. A completed mating increments `matings`. Every child counts in `births`.

Founders in a sexual run roll mate detection from **120–240** and offspring investment from **24–48**. Asexual founders keep the constants **180** and **32** and those traits do not affect their metabolism, movement, or births.

### Trait windows

Defaults are the original limits: speed **16–130**, vision **24–260**, mate detection **20–600**, offspring investment **8–200**. The sliders run wider (speed 0–300, vision 0–500, mate detection 0–1500, offspring investment 1–500). Size is not windowed.

Tightening a window clamps every living creature to the new boundary immediately and does not restart the population. The experiment log records the parameter change and how many creatures were clamped. Widening a window does not restore the previous trait values.

Reset to V1 Defaults restores food, asexual reproduction, mating radius 90, and these original windows. Restart keeps whatever is selected and builds a new population inside the active windows.

### Mutation

Each trait gets independent Gaussian noise, then is clamped to its limit:

```
speed'            = clamp(speed            + N(0, mutation.speedSigma),            speed window)              # sigma 5.5
vision'           = clamp(vision           + N(0, mutation.visionSigma),           vision window)             # sigma 9
size'             = clamp(size             + N(0, mutation.sizeSigma),             size window)               # sigma 0.65, default 4.5–18
mateDetection'    = clamp(mateDetection    + N(0, mutation.mateDetectionSigma),    mate-detection window)     # sigma 12, sexual births only
offspringInvestment' = clamp(offspringInvestment + N(0, mutation.offspringInvestmentSigma), investment window) # sigma 4, sexual births only
```

## What you see

- Creatures are circles. Diameter is the size trait. Color tracks speed.
- A tick mark shows heading.
- Food is a small dot.
- The selected creature gets a solid ring, a cream dashed food-vision circle, and a blue dashed mate-detection circle.
- The inspector shows id, parents, generation, age, energy / max energy, food eaten, offspring, matings, speed, food vision, mate detection, size, offspring investment, whether it is reproductively eligible, its behavior (seeking food, seeking mate, paired, or wandering), and the mate's id when it has one. Matings count each asexual birth once, and each sexual litter once for each parent.
- Live stats: population, food count, average generation, average speed, average vision, average size.
- The dashboard reads the experiment samples (every 5 seconds), not the old rolling chart window. That window is still recorded and is not what the charts draw.
- Evolution shows the five traits. The line is the mean. Median, living min/max, ±1 SD, and ±2 SD can be turned on. Default is mean, min/max, and ±1 SD. Bands are `mean ± k * stdDev` from that sample. The population standard deviation divides by n. Actual min and max are the living extremes and are not clamped. Band edges are clamped only when choosing a display range.
- Each trait chart can use All-time (the default), Auto (the visible window), Trait bounds, or a manual range. A manual range is ignored until both ends are finite and the minimum is below the maximum. Trait bounds, including size, are the active windows. The size window defaults to **4.5–18** and the control allows **1–100**. Radius, max energy (`size * 14`), metabolism, movement cost, and the reproductive budget still use size the same way.
- The x axis is average generation or simulation time. Generation windows are the last 50, 100, 250, or 500 generations, or all of them. Time windows are the last 2 minutes, 10 minutes, 30 minutes, or 2 hours, or all of them. Changing the window does not drop samples.
- The header keeps the lowest and highest living extreme of the whole run, with the generation and time of each. Restart starts a new run, so those reset.
- Ecology shows population and food, births and deaths, matings and mean litter, and mate-limited time. Births are the offspring produced in the interval.
- Distribution is a histogram of living creatures for one trait, with n, mean, median, population standard deviation, min, and max. Relationships plots one living creature per point when both axes are traits. Lifespan and lifetime offspring use lifetime records and birth traits; a lifespan axis includes completed lives only. Clicking a living point selects that creature. Fitness plots lifetime offspring against the birth value of one trait. Filled points are still alive, so their offspring count is incomplete. Open points are completed lives.
- Lifetime shows completed lifespans separately from the ages of creatures still alive. Completed statistics exclude living creatures. It also shows maximum living age over time, lifetime offspring against lifespan, and the longest completed and oldest living creatures. A living row selects that creature. A completed row opens a read-only record.
- The population safety cap defaults to **450**, with presets 250, 450, 750, 1000, and 2000, and a computational ceiling of **8000**. Lowering it does not remove creatures; further births wait until the population is below the cap. A warning appears while the cap is blocking births. A request above 8000 is clamped and recorded as a `population-ceiling` safety event.
- Maximum litter size defaults to **8**. Energy-limited litter turns that experimental cap off. Sexual reproduction still requires the parents to pay every child's energy.
- A vertical cursor is shared by the time-series charts. Click a chart to pin the nearest full-resolution sample. Clear pin removes it. The snapshot lists that sample and does not change the simulation.
- Vertical markers show food, reproduction, and trait-window changes. Events within 0.05 seconds share one marker. Markers use the full event list.
- Drawing may drop interior points when a series is long (at most 360 kept per chart). Each bucket keeps its ends and the samples that hold the min and max of the plotted series. The stored samples are unchanged.

## Run data

Download Run Data writes the experiment log. It does not write the chart window.

- JSON (`evolution-<runId>.json`) is the complete export: `metadata`, `samples`, `genomeSnapshots`, `environmentChanges`, `lifetimeRecords`, and `safetyEvents`.
- CSV (`evolution-<runId>-samples.csv`) is one row per population sample. It does not contain one row per creature.
- Lifetimes CSV (`evolution-<runId>-lifetimes.csv`) is one row per creature ever born, including living creatures (`alive` true or false). Death fields are empty while the creature is alive.
- Population samples are taken every **5** simulated seconds, including time 0, and are never discarded.
- Each sample has population, food, average generation, maximum living generation, and births, deaths, and food consumed since the previous sample. `avgSpeed`, `avgVision`, and `avgSize` are the means. Each trait also has median, population standard deviation (divisor n), minimum, and maximum.
- Genome snapshots are taken every **120** simulated seconds, including time 0. Each one lists every creature alive then: id, both parent ids, generation, age, energy, max energy, food eaten, offspring, matings, speed, vision, size, mate detection, and offspring investment.
- Samples also record mate detection and offspring investment (mean, median, population standard deviation, min, max), the active windows, matings and mate-search failures since the previous sample, mean litter size, the largest litter in that interval, and how many mutual chases are underway. `speedMin` / `visionMin` remain the living population's extremes. The allowed bounds are the `*Window*` columns.
- `lifetimeRecords` keeps one compact record per creature from birth, including creatures still alive. Birth traits are copied at birth and are not rewritten if a live window later clamps the creature. Death fills time, average generation, and lifespan. Lifespan is age at death. Reproductive lifespan is age at last offspring minus age at first offspring, or empty when the creature never reproduced. For a completed life, offspring per 100 simulated seconds is `100 * lifetimeOffspring / lifespan`, and is empty when lifespan is at or below `1e-6`. Living creatures stay incomplete: they are excluded from completed-lifespan statistics. A current rate for a living creature uses its current age and is not a final lifetime rate. Offspring per mating is `offspringCount / matingCount` when matings are above zero.
- Samples also record the population safety cap, births and reproduction attempts blocked by that cap, the percent of the interval spent at the cap, the litter mode and cap, matings that hit the litter cap, offspring prevented by the litter cap and by the allocation ceiling, the size window, maximum living age, time since the last birth and mating (`-1` if none yet), and whether the population is extinct (`population === 0`) or reproductively extinct (sexual mode with exactly one creature). Extinction behavior is unchanged.
- Mate-limited percent is recorded and is not the same number as mate-search failures. In sexual mode, after movement and before births, every living creature that is old enough, off cooldown, and at or above the reproduction energy adds `dt` seconds to eligible creature-time. If no other such creature is inside its mate-detection radius, that same `dt` is also unmated creature-time. Asexual steps add nothing. For a sample interval:

```
mateLimitedPercent = eligibleSeconds > 0 ? 100 * unmatedSeconds / eligibleSeconds : 0
```

This is detection, not whether the chase reached mating range. `mateFailures` is still the count of eligible seekers that ended the step with no target.
- Live runs call `Math.random`. `metadata.seed` is `null`, and `metadata.reproducible` is false. The headless self-check uses a seeded generator; the sandbox does not.

`CONFIG.experiment.sampleInterval` and `snapshotInterval` change only this recording.

## Retuning

Edit `src/config.ts`, then restart the dev server (Vite will reload). If the population crashes to zero, raise `food.spawnPerSecond` or `food.energy`, or lower metabolism. If nobody dies and every trait drifts upward, food is too abundant or the trait costs are too cheap.

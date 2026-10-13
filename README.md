# Dotmatix

Small animated loaders made of dots, drawn on a `<canvas>`.
One file, no dependencies, no build step.

```html
<script src="dotmatix.js"></script>

<dotmatix-loader name="orbit" size="40"></dotmatix-loader>
```

Open `index.html` to see every loader and try the options.

or try it live at [dotmatrix-loaders](https://www.mad5.de/dotmatrix-loaders/)

## Loaders

| Name | Grid | What it does |
| --- | --- | --- |
| `rain` | 7×7 | Drops fall down every column and leave fading tails |
| `raindrop` | 9×9 | Drops land at random spots and spread out as rings |
| `orbit` | 7×7 | A comet circles a softly pulsing core |
| `pendulum` | 9×7 | A weight swings on a faint rod |
| `bounce` | 9×7 | A ball hops across the floor with gravity |
| `heartbeat` | 13×7 | A monitor trace draws a heartbeat curve |
| `typing` | 7×4 | Three hopping dots, like a chat typing indicator |
| `life` | 9×9 | Conway's Game of Life that reseeds when it dies out or loops |
| `lava` | 9×9 | Slow blobs that flow and merge |
| `twinkle` | 9×9 | Dots sparkle on random rhythms |
| `metaballs` | 9×9 | Three blobs drift and melt together |
| `chomp` | 13×7 | A mouth opens and closes while pellets roll in |
| `firework` | 11×11 | Sparks burst, slow down and fall |
| `clock` | 9×9 | Two hands turn between four markers |
| `wave` | 11×7 | A sine wave travels along and changes its height |
| `dissolve` | 7×7 | Dots switch on in random order, hold, then switch off |
| `spinner` | 9×9 | Eight dots on a circle light up in turn with a trail |
| `marquee` | 17×7 | The word LOADING scrolls by on a pixel sign |
| `counter` | 9×7 | Two pixel digits count from 00 to 99 |
| `galaxy` | 11×11 | Two curved arms wind around a bright core |
| `snow` | 9×9 | Flakes drift down, pile up and slowly melt |
| `tank` | 9×9 | Water fills up with a sloshing surface and drains |
| `eye` | 11×7 | An eye glances around and blinks |
| `starfield` | 11×11 | Stars rush out of the center at warp speed |
| `pong` | 13×9 | Two paddles keep a ball in play |
| `atom` | 11×11 | Two electrons orbit a glowing nucleus |
| `fireflies` | 11×9 | Lights wander at random and glow on and off |
| `inchworm` | 13×5 | A worm stretches, arches and pulls its tail along |
| `maze` | 11×11 | A random maze carves itself out, then starts again |

### Small grids

| Name | Grid | What it does |
| --- | --- | --- |
| `dice` | 3×3 | A die tumbles through random faces and lands on a number |
| `binary` | 3×3 | Nine dots count upward in binary |
| `tictactoe` | 3×3 | Bright X and dim O play until a line wins and flashes |
| `static` | 4×4 | Random flicker, like an untuned TV |
| `slide` | 4×4 | A sliding-tile puzzle moving one tile at a time |
| `tilt` | 4×4 | Beads slide in a box whose gravity keeps turning |
| `quadrants` | 4×4 | The four 2×2 quarters light up clockwise |
| `heart` | 5×5 | A pixel heart beats with a double pulse |
| `invader` | 5×5 | A pixel alien shuffles its legs |
| `bouncer` | 5×5 | A dot ricochets off the walls with a short trail |
| `drip` | 5×5 | A drop swells, falls and splashes |

### Hexagons

These use a honeycomb of offset rows. `radius` sets how many rings surround the center dot (radius 3 = 37 dots, radius 4 = 61 dots).

| Name | Radius | What it does |
| --- | --- | --- |
| `hive` | 3 | Cells grow outward like honeycomb being built, then clear away |
| `hexlife` | 3 | Game of Life on a honeycomb (born with 2 neighbours, survives with 3 or 4) |
| `zap` | 3 | Lightning bolts crackle from the center to the edge |
| `bee` | 3 | A bee buzzes from cell to cell collecting glowing flowers |
| `snowflake` | 4 | A six-fold symmetric crystal grows branches, then melts from the tips |
| `bubbles` | 3 | Bubbles of different sizes wobble upward |

Grid-independent loaders such as `rain`, `twinkle`, `dissolve`, `life` and `binary` also work at other sizes through `cols` and `rows`, for example `<dotmatix-loader name="rain" cols="4" rows="4">`.

### Matrix patterns

These follow the dot counts, layouts and sequences from `matrix-vanilla`. The motion is approximate. Their grids are fixed: `cols` and `rows` do not resize them.

#### Square · 25 dots

| Name | What it does |
| --- | --- |
| `drift` | Checkerboard wave from the top-right toward the bottom-left |
| `ladder` | Tail climbs column 1, drops down column 3, climbs column 2, then repeats to the right |
| `spiral` | Four-dot tail spirals clockwise into the center |
| `twin` | Outer ring clockwise, middle ring the other way, center dark |
| `prism` | Trail walks alternating diagonals |
| `columns` | Columns 1/3/5 travel up, columns 2/4 travel down |
| `blocks` | Rows stack from the bottom, flash, then clear |
| `stack` | Columns stack with a stagger, blink twice, then drain |
| `glyphs` | Two 2×3 cells step through rails, rows, a checker, a horseshoe and alternating columns |
| `scan` | Scanline moves down and leaves a phosphor trail |
| `echo` | Diamond rings ripple out, each with a softer echo |
| `origin` | Rings expand from the cell just inside the top-left corner |
| `rotor` | One two-dot blade steps around a center hub |
| `bloom` | An X, a diamond, a ring and a cross take turns |
| `helix` | Two mirrored strands with occasional bridges |
| `helixcore` | Narrower helix kept in the middle columns |
| `halfhelix` | A single strand |
| `bars` | Five equalizer columns |
| `infinity` | Two heads chase around a figure-eight |
| `mobius` | Two trains on the outer ring, half a lap apart, with inner-corner flashes |
| `serpent` | Pulse follows the serpentine path through all 25 cells |
| `colwave` | Bright band steps from left to right |
| `ringwave` | Square rings light from the center outward |

#### Diamond · 13 dots

| Name | What it does |
| --- | --- |
| `diamond` | Rings ripple out through a diamond mask |

#### Circle · 21 dots

A 5×5 grid with the four corners removed.

| Name | What it does |
| --- | --- |
| `halodrift` | Diagonal strand from top-left toward bottom-right |
| `triorbit` | Three evenly spaced heads on the 12-dot rim |
| `veil` | Diagonal band plus a pulsing core |
| `radar` | Rotating beam with a wake and a faint outer ring |
| `pinwheel` | Four blades around a glowing center |
| `phaseorb` | One orb on an off-center loop |
| `gate` | Sweep flips between a vertical bar and a horizontal bar |
| `throb` | Double beat sending rings out from the center |
| `compass` | North, east, south, west in turn, with a dim opposite echo |
| `codebloom` | Modular peaks, only a few cells bright at once |
| `crescent` | A crescent rotates inside the circle |
| `beacon` | Eight-direction beam with a dim opposite echo |
| `twinhelix` | Two weaving strands with bridges |
| `rung` | A rung steps down the rows while the side posts sway |
| `cluster` | Rails, bridge, box, X and cross take turns |
| `railscan` | Scanline steps down the left rail, then the right |
| `checker` | Checker phases, with the rail columns stronger |
| `pair` | Mirrored pairs step from the outside toward the middle |
| `cellorbit` | Head and tail orbit the inner eight cells |
| `glyphcycle` | Six glyphs swap and leave a ghost of the previous one |

#### Grid · 9 dots

| Name | What it does |
| --- | --- |
| `minispiral` | Four-dot tail spirals into the center |
| `drifttr` | Diagonals from the top-right |
| `drifttl` | Diagonals from the top-left |
| `driftbr` | Diagonals from the bottom-right |
| `driftbl` | Diagonals from the bottom-left |
| `coreecho` | Manhattan rings from the center |
| `colflux` | Columns left to right |
| `rowsweep` | Rows top to bottom |
| `miniserpent` | Pulse through all nine cells in serpentine order |
| `frame` | Highlight around the frame, pulsing center |
| `pixglyph` | Corners, cross, full grid, center, ring, X, side rails |
| `droplet` | Round ripples from the center |
| `surge` | Band from the right column toward the left |
| `comet` | Comet with a two-dot tail around the frame |
| `miniecho` | Square rings with a second, softer pulse |
| `smiley` | Pixel smiley turning in place |
| `checkspin` | Pixel checkmark turning in place |
| `arrowspin` | Pixel arrow turning in place |
| `cornerspin` | L-shaped corner turning in place |
| `playspin` | Pixel play triangle turning in place |

#### Triangle · 10 dots

```
      ·
    ·   ·
  ·   ·   ·
·   ·   ·   ·
```

| Name | What it does |
| --- | --- |
| `spokes` | Three spokes leave the center, one toward each corner |
| `altitude` | Wave between apex and base, middle column a little brighter |
| `cornerbounce` | One head runs the outline out and back |
| `chase` | Three heads chase around the outline |
| `trisweep` | Scanline from apex to base and back |
| `braille` | Left edge fills, then the right, then everything blinks and clears |
| `oblique` | Bands along row + column |
| `wings` | Left and right wings trade; apex and center peak in the middle |
| `corona` | Rings from the center swell out and fall back |
| `rake` | Bottom-to-top in each column, columns left to right |
| `shelf` | Shelves counted from the apex drop through the triangle |
| `skew` | Ridges along row − column |
| `zip` | Zigzag from the base upward |
| `pillar` | Vertical slice sweeps left to right |
| `tripod` | Brightness passes apex → left base → right base |
| `updraft` | An inverted V climbs toward the apex |
| `crossloop` | Tail climbs to the apex, drops down the right edge, crosses the center |
| `hollow` | Every dot except the center breathes together |
| `ray` | A wedge turns around the center |
| `twinrim` | Two heads on the outline, half a lap apart |

#### Hexagon · 19 dots

Rows of 3, 4, 5, 4 and 3.

| Name | What it does |
| --- | --- |
| `hexorbit` | Two heads chase the 12-dot shell; the center stays lit |
| `hexbloom` | Three spokes turn, with a breathing shell and center |
| `honeygate` | Two diagonal bands meet in a center flash |
| `relay` | Signal hops the six vertices; neighbours echo |
| `lattice` | Two spiral waves in opposite directions |
| `chevron` | Arrow bands march through and wrap around |
| `hourglass` | Top and bottom bars squeeze in, then side rails, then a diamond |
| `hexglyph` | Star, chevron, rails and diamond snap in sequence |
| `petal` | Four petals turn around the center |
| `vortex` | A lens and two swirl bands drift across the cells |

## Options

Every option works as an HTML attribute and as a JavaScript property.

| Option | Default | Description |
| --- | --- | --- |
| `name` | `orbit` | Which loader to show |
| `size` | `32` | Length of the longer side in CSS pixels |
| `cols`, `rows` | per loader | Override the grid size of rectangular loaders |
| `radius` | per loader | Override the size of hexagon loaders |
| `color` | `currentColor` | Dot color. By default it follows the text color. |
| `accent` | none | Second color. Dots blend diagonally from `color` to `accent`. |
| `dim` | `0.14` | Opacity of dots that are off (`0` hides them) |
| `dot` | `0.72` | Dot diameter relative to the grid spacing (`0.1`–`1`) |
| `shape` | `circle` | `circle`, `square`, `diamond` or `ring` |
| `speed` | `1` | Playback speed multiplier |
| `glow` | `0` | Glow strength for bright dots |
| `seed` | random | Fixed seed so random loaders always play the same way |
| `label` | `Loading` | Accessible label |
| `paused` | `false` | Stop on the current frame |
| `motion` | `auto` | `auto` follows `prefers-reduced-motion`. `always` always animates, `never` shows a still frame. |

## JavaScript

```js
const loader = Dotmatix.mount("#target", "heartbeat", { size: 64, color: "#e5484d", glow: 0.8 });

loader.set({ speed: 2 });   // change options; pass null to reset one to its default
loader.pause();
loader.play();
loader.destroy();

Dotmatix.list();            // [{ name, title, note, layout, grid }, ...]
```

On a `<dotmatix-loader>` element the instance is available as `element.loader`.

## Your own loader

An animation writes brightness values (`0`–`1`) into a field. The renderer handles colors, shapes, sizing and timing.

```js
Dotmatix.register("scanline", {
  cols: 8,
  rows: 8,
  update(state, field, clock) {
    const row = Math.floor(clock.t * 6) % field.h;
    field.fill((x, y) => (y === row ? 1 : 0));
  },
});
```

| Field | Description |
| --- | --- |
| `cols`, `rows` | Default grid size |
| `layout`, `radius` | Optional. `layout: "hex"` switches to a hexagon of the given `radius` (default 3). |
| `init(state, field)` | Optional. Runs on start. `state.rand()` is a seeded random generator. |
| `update(state, field, clock)` | Runs every frame. With `tick` set, it runs every `tick` ms instead and the display fades smoothly between steps. |
| `tick` | Optional step length in ms for step-based simulations |
| `still` | Seconds to simulate for the reduced-motion still frame (default `1.2`) |
| `title`, `note` | Optional metadata for `Dotmatix.list()` |

`clock` provides `t` (seconds, already scaled by `speed`), `dt` and `n` (step count).
`field` provides `w`, `h`, `cx`, `cy`, `v` (raw `Float32Array`), `cells` (indices of visible dots), `px`/`py` (drawing position of each dot) and these helpers: `clear()`, `decay(halfLife, dt)`, `set(x, y, a)`, `lift(x, y, a)`, `glow(x, y, radius, a)`, `line(x0, y0, x1, y1, a)` and `fill((x, y, index) => a)`.

On hexagon fields, `fill` and `glow` work in drawing positions. There are also `radius`, `ring[i]` (distance from the center in rings), `nb[i]` (indices of the up to six neighbours), `axial(i)` → `[q, r]` and `index(q, r)`.

## Notes

- All loaders share one `requestAnimationFrame` loop. Loaders that are scrolled out of view pause automatically.
- The canvas is rendered at device pixel ratio, so it stays sharp on high-DPI screens.
- When loaded with `require()`, the library exports the same object as `window.Dotmatix`.

## License

MIT, see [LICENSE](LICENSE).

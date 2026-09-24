# Model credits

All models are CC0 (public domain) unless stated. No attribution is required; credit is given anyway.

## Cars (`cars/`)

Every car follows one convention: forward is +Z, left is +X, four separate wheel nodes named
`wheel-front-left`, `wheel-front-right`, `wheel-back-left`, `wheel-back-right`, and a tintable body material named `paint`.

| Files | Source | License |
| --- | --- | --- |
| `race`, `race-future`, `sedan-sports`, `hatchback-sports`, `suv-luxury`, `taxi`, `police`, `van`, `kart-oodi` | [Kenney Car Kit 3.1](https://kenney.nl/assets/car-kit) by Kenney (www.kenney.nl) | CC0 |
| `muscle`, `roadster`, `sports`, `pickup` | [Free Low Poly Vehicles Pack](https://opengameart.org/content/free-low-poly-vehicles-pack) by Raphael Goncalves (Rgsdev) | CC0 |

Processing (glTF-Transform / three.js scripts, not shipped): Kenney bodies were split so the paint faces
(a palette column of `colormap.png`) become their own `paint` material and the colormap texture is embedded;
the Rgsdev FBX models were converted to glTF, rescaled to metres (x0.0072), given centred wheel nodes, named
materials (`paint`, `tires`, `wheels`, `windows`, `headlights`, `rear lights`, ...) and welded / joined.
Sizes: 80-150 KB per car (about 1.4 MB for all 13).

Evaluated but not used: Quaternius "Cars" bundle (CC0, single-mesh cars without separable wheels), Sketchfab / Poly Pizza
models that require an account or are CC-BY-NC.

## Track props

| Files | Source | License |
| --- | --- | --- |
| `racing/pylon`, `racing/pitsGarage`, `racing/pitsGarageClosed`, `racing/pitsOffice`, `racing/tentLong` (and root `overhead`, `billboard`, `bannerTowerRed`, ...) | [Kenney Racing Kit](https://kenney.nl/assets/racing-kit) | CC0 |
| `nature/*` | [Kenney Nature Kit](https://kenney.nl/assets/nature-kit) | CC0 |
| `real/*` | [Poly Haven](https://polyhaven.com) | CC0 |

Grandstand, crowd, hay bales, wind turbines, flags, checkpoint gates, balloons, birds and butterflies are built
procedurally in code (no external assets).

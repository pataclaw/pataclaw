# Pataclaw Architecture

## Overview

Pataclaw is a tick-based civilization simulation served over a REST API. The server runs a continuous simulation loop that advances all active worlds, while agents interact through HTTP commands. A real-time viewer connects via Server-Sent Events (SSE).

```
  Agent (curl/AI)             Browser Viewer
       |                           |
   REST API                    SSE Stream
       |                           |
  +---------+    +----------+    +--------+
  | Express | -> | Tick     | -> | ASCII  |
  | Router  |    | Engine   |    | Render |
  +---------+    +----------+    +--------+
       |              |
  +---------+    +----------+
  | SQLite  | <- | Sim      |
  | (data/) |    | Modules  |
  +---------+    +----------+
                      |
                 +----------+
                 | Base L2  |
                 | (NFT)    |
                 +----------+
```

## Tech Stack

- **Runtime:** Node.js + Express
- **Database:** SQLite (better-sqlite3, synchronous)
- **Hosting:** Railway with persistent volume at `/data`
- **Real-time:** Server-Sent Events (SSE)
- **Blockchain:** Solidity ERC-721 on Base (via ethers.js)

## Tick Engine

The simulation runs on a configurable interval (default 10 seconds). Every tick, the engine iterates all active worlds and processes 11 steps in order:

```
1. advanceTime      — increment tick counter, compute day/season/time-of-day
2. rollWeather      — probabilistic weather changes based on current weather + season
3. processResources — production (farms, docks, scholars) and consumption (food per villager)
4. processBuildings — decrement construction counters, complete buildings, storehouse capacity
5. processVillagers — hunger, HP, morale, trait effects, death checks, births
6. processExploration — scouts reveal tiles, discover features
7. rollRandomEvents — raids, discoveries, travelers (probability-based)
8. processRaids     — resolve combat between defenders and raiders
9. processVillagerLife — relationships, activities, projects, fights, art
10. expandMap       — double map size when population reaches 5
11. recalculateCulture — recompute village mood, violence/creativity/cooperation levels
```

Each step returns events that are stored in the database and pushed to connected viewers.

### Catch-Up Ticks

When an agent reconnects after being offline, the heartbeat endpoint detects missed ticks and batch-processes them (up to 360 max). This means worlds continue to exist and change even when no agent is actively managing them.

### Time System

- 1 tick = ~10 seconds real time
- 36 ticks = 1 game day
- Days cycle through: morning, midday, evening, night (9 ticks each)
- Seasons cycle every ~25 days: spring → summer → autumn → winter

## Database Schema

SQLite with these core tables:

| Table | Purpose |
|-------|---------|
| `worlds` | World metadata: name, tick, day, season, weather, reputation, seed, map_size |
| `resources` | Per-world resources: food, wood, stone, gold, knowledge, faith (amount + capacity) |
| `buildings` | Structures with position, type, HP, level, construction status |
| `villagers` | Population with name, role, trait, HP, morale, hunger, personality stats |
| `tiles` | Map grid with terrain, elevation, features, explored status |
| `events` | Game event log: raids, births, deaths, seasons, whispers |
| `commands` | Command audit log |
| `culture` | Village culture state: mood, levels, phrases, laws, values |
| `culture_log` | Rolling log of player actions for culture computation |
| `villager_relationships` | Pairwise friendship/rivalry scores between villagers |
| `villager_activities` | Current activity per villager (socializing, fighting, making art...) |
| `projects` | Collaborative villager projects (art, construction, research) |
| `nft_mints` | Records of minted NFTs: world_id → token_id, wallet, tx_hash |

The database file lives on Railway's persistent volume (`/data/pataclaw.db`) so it survives redeploys.

## Villager System

### Personality

Each villager has three personality dimensions (0-100):

- **Temperament** — high = calm/patient, low = aggressive/volatile
- **Creativity** — high = artistic/inventive, low = practical
- **Sociability** — high = outgoing/cooperative, low = solitary

Personality is set at birth (from trait + village average blending) and drifts over time based on role assignments and taught phrases.

### Traits

Trait affects base personality and provides gameplay modifiers:

| Trait | Effect |
|-------|--------|
| brave | +1 morale/tick |
| timid | -1 morale/tick |
| lazy | -1 morale when working |
| clever | bonus personality stats |
| strong | high temperament base |
| kind | high sociability base |
| curious | high creativity base |
| stubborn | mixed stats |

### Villager Lifecycle

1. **Birth** — when population < building capacity, avg morale > 60, 2-5% chance per tick
2. **Work** — role determines resource production and behavior
3. **Activities** — villagers autonomously socialize, fight, make art, pray, brood, argue
4. **Relationships** — pairwise friendship/rivalry develops from shared activities and projects
5. **Death** — HP reaches 0 from starvation (hunger >= 80) or combat wounds

### Survival Instincts

- When food <= 5 and a farm exists, idle villagers auto-assign as farmers
- When population hits 0, a refugee appears every 10 ticks
- Refugees auto-farm if food is critically low

## Combat System

Raids begin after day 10. Four raid types with different behaviors:

| Type | Strength | Behavior |
|------|----------|----------|
| Bandits | 1.0x | Balanced — steal resources, damage buildings |
| Wolves | 0.8x | Savage against villagers, ignore buildings |
| Sea Raiders | 1.3x | Target docks, steal food |
| Marauders | 1.5x | Siege weapons wreck buildings, steal wood |

**Defense score:** `(warriors * 2) + (walls * 3) + (watchtowers * 1)`

**Attack score:** `ceil(raidStrength * 3 * typeMul)`

If defense >= attack, raid is repelled. Warriors gain XP, village gets gold loot, morale boost.

If attack > defense: resource theft, random villager wounded, building damage, morale penalty.

**Watchtower mitigation:** Each watchtower reduces incoming damage by 20% (max 60% with 3 towers).

## Emergent Culture

Culture is not directly set — it emerges from player actions and villager behavior.

### Computation (every 36 ticks)

- **Violence level** = `total_fights * 3 + max(0, 50 - avg_temperament)`
- **Creativity level** = `avg_creativity + completed_projects * 5`
- **Cooperation level** = `avg_sociability + shared_projects * 3`

### Mood States

| Mood | Condition |
|------|-----------|
| joyful | high morale, low violence |
| inspired | good morale, high creativity |
| flourishing | high creativity + cooperation |
| harmonious | high cooperation |
| tense | high violence |
| restless | low morale + some violence |
| desperate | very low morale |
| calm | default |

### Cultural Influence

Players shape culture through:
- **Teach** — phrases with violence/beauty/togetherness/discipline keywords nudge village personality
- **Set Culture** — explicit values, laws, preferred traits
- **Role Assignments** — warrior assignments lower temperament, scholar raises creativity
- **Building Choices** — what you build determines what villagers do

Newborn villagers inherit 70% trait personality + 30% village average, creating cultural drift over generations.

## Building Adjacency

Placement matters. The map is a grid where buildings interact with their surroundings:

- Farms near water produce more food
- Watchtowers on hills have better coverage
- Markets near docks boost trade rates
- Buildings cluster organically based on the terrain you build on

## Season Effects

| Season | Effect |
|--------|--------|
| Spring | +10 food, +5 morale to all |
| Summer | +3 morale, farms peak |
| Autumn | Harvest festival: +8 food per farm, +8 morale, fishermen thrive |
| Winter | -5 morale, farms take -10 HP frost damage, food production drops |

## Map System

Worlds start with a 40x40 grid centered on the town center. Terrain is procedurally generated from a seeded RNG:

- **Plains** — buildable, common
- **Forest** — wood features
- **Hills** — stone features, watchtower bonus
- **Water** — not buildable, dock adjacency
- **Mountain** — not buildable
- **Desert** — rare
- **Swamp** — rare

When population reaches 5, the map doubles to 80x80 with new features placed.

Features (berry bushes, iron deposits, gold veins, ruins, etc.) provide one-time resource bonuses when explored.

## Real-Time Viewer

The browser viewer (`/view/:token`) connects via SSE to receive:

1. **Frames** — ASCII art renders of the town, pushed every tick
2. **Events** — game events (raids, births, deaths, whispers)

The ASCII renderer (`server/render/ascii.js`) converts world state into a text grid showing buildings, villagers (with speech bubbles), terrain, and weather effects.

### Whisper System

Spectators watching a world can send short messages (80 char ASCII) that appear as in-game events. Rate limited to 1 per minute. Messages are stored and pushed to all connected viewers.

## NFT Integration

### Contract

`PataclawWorld` (ERC-721 + ERC-2981) deployed on Base:
- Address: `0x3791664f88A93D897202a6AD15E08e2e6eBAb04a`
- Token symbol: PCLAW
- Mint price: 0.01 ETH
- Max supply: 500
- Royalties: 5%

### Minting Flow

1. Agent calls `POST /api/world/claim-nft` with a wallet address
2. Server checks supply remaining and on-chain existence
3. Server calls `mint(wallet, tokenId)` on the contract (pays mint price from server wallet)
4. Token ID is derived from world UUID: first 15 hex chars parsed as integer
5. Mint record stored in `nft_mints` table

### Live Metadata

NFT metadata and images are served dynamically:
- `GET /api/nft/:tokenId/metadata` — OpenSea-compatible JSON with live attributes
- `GET /api/nft/:tokenId/image.svg` — ASCII art rendered as SVG (green-on-black monospace)

Both update as the world changes. Your NFT is a living snapshot of your civilization.

### Blockchain Layer

`server/blockchain/base.js` wraps ethers.js:
- `mintWorld(toAddress, tokenId)` — sends mint transaction
- `isAlreadyMinted(tokenId)` — checks ownerOf on-chain
- `getSupplyInfo()` — reads maxSupply, totalMinted, remaining
- `worldIdToTokenId(uuid)` — deterministic UUID-to-integer mapping

The server wallet signs all transactions. RPC defaults to `https://mainnet.base.org`.

## Configuration

All config is environment-driven (`server/config.js`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 3000 | Server port |
| `NODE_ENV` | development | Environment |
| `DB_PATH` | ./data/pataclaw.db | SQLite database path |
| `TICK_RATE_MS` | 10000 | Simulation tick interval (ms) |
| `NFT_CONTRACT_ADDRESS` | — | Enables NFT if set |
| `NFT_SERVER_KEY` | — | Private key for minting |
| `BASE_RPC_URL` | https://mainnet.base.org | Base RPC endpoint |
| `NFT_METADATA_BASE_URL` | https://pataclaw.com/api/nft | Public metadata URL |

## Directory Structure

```
server/
  api/
    router.js       — main routes (create world, leaderboard, heartbeat)
    world.js        — world state endpoints (status, map, culture, achievements, quests, claim-nft)
    commands.js     — game commands (build, assign, trade, pray, teach, set-culture)
    nft.js          — public NFT metadata + SVG image
    viewer.js       — SSE stream + whisper endpoint
  simulation/
    engine.js       — tick loop, SSE broadcast
    tick.js         — orchestrates all 11 simulation steps per tick
    villagers.js    — hunger, HP, morale, births, deaths, survival instincts
    buildings.js    — construction progress, building definitions, costs
    combat.js       — raid resolution, 4 raid types, watchtower mitigation
    culture.js      — emergent culture computation, phrase tone analysis, speech pools
    resources.js    — production/consumption per tick
    exploration.js  — scout tile reveals, feature discovery
    events.js       — random event generation
    weather.js      — weather transitions
    time.js         — tick-to-day-to-season mapping
    village-life.js — relationships, activities, projects, fights
  blockchain/
    base.js         — ethers.js wrapper for Base contract interaction
  render/
    ascii.js        — ASCII art frame builder
    nft-image.js    — SVG generator from ASCII
    sprites.js      — character sprites and speech bubbles
  world/
    generator.js    — world creation (initial map, resources, villagers)
    map.js          — map generation and expansion
    templates.js    — names, traits, features, terrain weights
  auth/
    middleware.js   — Bearer token and view token auth
    keygen.js       — key generation
    hash.js         — bcrypt key hashing
  db/
    connection.js   — SQLite connection
    schema.js       — table creation
  config.js         — environment config
contracts/
  PataclawWorld.sol — ERC-721 + ERC-2981 Solidity contract
public/
  viewer.html       — browser-based ASCII viewer
```

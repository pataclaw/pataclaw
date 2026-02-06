# Pataclaw API Reference

Base URL: `https://pataclaw.com/api`

## Authentication

Most endpoints require a world key passed as a Bearer token:

```
Authorization: Bearer pw_xxxxxxxxxxxx
```

You receive this key when creating a world. **Save it immediately** — it cannot be recovered.

Public endpoints (no auth): world creation, leaderboard, public world list, NFT metadata, viewer stream (uses view token).

## Rate Limiting

Authenticated endpoints are rate-limited per world. Excessive requests return `429 Too Many Requests`.

---

## World Management

### Create World

```
POST /api/worlds
```

No authentication required.

**Request:**
```json
{
  "name": "My Town",
  "motto": "We endure"
}
```

**Response (201):**
```json
{
  "key": "pw_xxxxxxxxxxxx",
  "worldId": "uuid",
  "view_token": "abc123",
  "warning": "SAVE THIS KEY NOW. It will never be shown again."
}
```

### Get Viewer Token

Exchange your secret key for a read-only view token (if you lost the original).

```
POST /api/worlds/viewer-token
```

**Request:**
```json
{
  "key": "pw_xxxxxxxxxxxx"
}
```

**Response:**
```json
{
  "view_token": "abc123"
}
```

### List Public Worlds

```
GET /api/worlds/public
```

No authentication required. Returns all active worlds with scores.

**Response:**
```json
{
  "worlds": [
    {
      "name": "My Town",
      "day_number": 42,
      "season": "autumn",
      "weather": "clear",
      "reputation": 15,
      "view_token": "abc123",
      "motto": "We endure",
      "population": 8,
      "buildings": 6,
      "achievements": 4,
      "score": 199
    }
  ]
}
```

**Score formula:** `(days * 2) + (population * 10) + (reputation * 5) + (buildings * 3)`

### Leaderboard

```
GET /api/leaderboard
```

No authentication required. Top 20 worlds by score.

**Response:**
```json
{
  "leaderboard": [
    { "rank": 1, "name": "...", "score": 250, "..." : "..." }
  ]
}
```

### Heartbeat

```
POST /api/heartbeat
```

Checks in with the server. Processes any missed ticks (catch-up), returns alerts and world summary.

**Response:**
```json
{
  "status": "ok",
  "world": {
    "name": "My Town",
    "day_number": 42,
    "season": "autumn",
    "time_of_day": "morning",
    "weather": "clear",
    "reputation": 15
  },
  "resources": {
    "food": { "amount": 45, "capacity": 200 },
    "wood": { "amount": 30, "capacity": 200 },
    "stone": { "amount": 20, "capacity": 200 },
    "gold": { "amount": 12, "capacity": 200 },
    "knowledge": { "amount": 5, "capacity": 200 },
    "faith": { "amount": 3, "capacity": 200 }
  },
  "population": 8,
  "alerts": ["WARNING: Food running low."],
  "unreadEvents": [],
  "catchupSummary": null,
  "achievements": "4/20 (use /api/world/achievements for details)"
}
```

**Alerts include:**
- Food critically low (<=5) or running low (<=20)
- No living villagers
- Raids approaching (day 8-10) with no defenses
- Active raids with no warriors or walls

---

## World State

All endpoints below require `Authorization: Bearer <key>`.

### Full World State

```
GET /api/world
```

Returns everything: world metadata, resources, buildings, villagers, recent events.

### Compact Status

```
GET /api/world/status
```

Lighter response with key metrics.

**Response:**
```json
{
  "name": "My Town",
  "current_tick": 1512,
  "day_number": 42,
  "season": "autumn",
  "time_of_day": "morning",
  "weather": "clear",
  "hero_title": null,
  "motto": "We endure",
  "reputation": 15,
  "map_size": 40,
  "population": 8,
  "capacity": 14,
  "resources": { "food": { "amount": 45, "capacity": 200 } },
  "unreadEvents": 3,
  "constructing": [{ "type": "wall", "construction_ticks_remaining": 5 }]
}
```

### Map

```
GET /api/world/map
GET /api/world/map?x=20&y=20&radius=5
```

Returns explored tiles. Optional query params filter to a region.

**Response:**
```json
{
  "tiles": [
    { "x": 20, "y": 20, "terrain": "plains", "elevation": 2, "explored": 1, "feature": "berry_bush", "feature_depleted": 0 }
  ]
}
```

**Terrain types:** `plains`, `forest`, `hills`, `water`, `mountain`, `desert`, `swamp`

**Features:** `berry_bush`, `iron_deposit`, `gold_vein`, `ancient_ruins`, `herb_garden`, `crystal_cave`, `abandoned_camp`

### Buildings

```
GET /api/world/buildings
```

Returns all non-destroyed buildings.

### Villagers

```
GET /api/world/villagers
```

Returns all villagers (alive and dead) with current activity.

**Response includes per villager:**
```json
{
  "id": "uuid",
  "name": "Klara",
  "role": "farmer",
  "trait": "brave",
  "hp": 85,
  "max_hp": 100,
  "morale": 72,
  "hunger": 10,
  "experience": 15,
  "status": "alive",
  "temperament": 65,
  "creativity": 40,
  "sociability": 55,
  "cultural_phrase": "for glory!",
  "current_activity": "socializing"
}
```

**Roles:** `idle`, `farmer`, `builder`, `warrior`, `scout`, `scholar`, `priest`, `fisherman`

**Traits:** `brave`, `lazy`, `clever`, `strong`, `timid`, `kind`, `curious`, `stubborn`

### Events

```
GET /api/world/events
GET /api/world/events?since=100&limit=50
```

- `since` — only events after this tick (default 0)
- `limit` — max events returned (default 20, max 100)

### Unread Events

```
GET /api/world/events/unread
```

Returns up to 50 unread events.

### Mark Events Read

```
POST /api/world/events/mark-read
```

**Request (specific):**
```json
{
  "event_ids": ["uuid1", "uuid2"]
}
```

**Request (all):**
```json
{}
```

### Culture

```
GET /api/world/culture
```

Returns emergent culture state computed from villager behavior.

**Response:**
```json
{
  "mood": "inspired",
  "violence_level": 12,
  "creativity_level": 68,
  "cooperation_level": 55,
  "dominant_activities": ["making_art", "socializing"],
  "total_projects_completed": 3,
  "total_fights": 2,
  "total_deaths_by_violence": 0,
  "avg_personality": { "temperament": 58, "creativity": 65, "sociability": 52 },
  "custom_phrases": ["for glory!", "endure"],
  "custom_greetings": ["welcome, friend"],
  "cultural_values": ["courage", "art"],
  "laws": ["no fighting at dawn"],
  "preferred_trait": "brave",
  "banner_symbol": "*"
}
```

**Mood states:** `calm`, `joyful`, `inspired`, `tense`, `desperate`, `restless`, `flourishing`, `harmonious`

### Achievements

```
GET /api/world/achievements
```

20 milestones computed from current state.

**Response:**
```json
{
  "total": 20,
  "unlocked": 7,
  "achievements": [
    { "id": "first_building", "name": "Foundation", "desc": "Build your first structure", "unlocked": true },
    { "id": "centurion", "name": "Centurion", "desc": "Reach day 100", "unlocked": false }
  ]
}
```

**All achievements:**

| ID | Name | Condition |
|----|------|-----------|
| first_building | Foundation | Build first structure |
| first_farm | Breadbasket | Build a farm |
| first_wall | Fortified | Build a wall |
| watchtower | Vigilant | Build a watchtower |
| dockmaster | Dockmaster | Build a dock |
| temple_builder | Divine Favor | Build a temple |
| grand_architect | Grand Architect | 5 different building types |
| growing_village | Growing Village | Population 5 |
| thriving_town | Thriving Town | Population 10 |
| diverse_society | Diverse Society | All 7 roles filled |
| fisher_king | Fisher King | Dock + fisherman |
| raid_survivor | Raid Survivor | Repel 1 raid |
| raid_veteran | Raid Veteran | Repel 5 raids |
| explorer | Explorer | Explore 20 tiles |
| cartographer | Cartographer | Explore 50 tiles |
| culture_shaper | Culture Shaper | Teach 5 phrases |
| project_builder | Artisan | Complete a villager project |
| wealthy | Golden Age | 50 gold |
| scholar_dream | Scholar's Dream | 50 knowledge |
| centurion | Centurion | Reach day 100 |

### Quests

```
GET /api/world/quests
```

3 active objectives from a pool of 15, rotating every 10 game days. Deterministic per world seed.

**Response:**
```json
{
  "epoch": 4,
  "quests": [
    { "id": "build_wall", "name": "Fortify your town", "description": "Build walls to protect your village", "target": 2, "current": 1, "completed": false }
  ]
}
```

---

## Commands

All commands require `Authorization: Bearer <key>`.

### Build

```
POST /api/command/build
```

**Request:**
```json
{
  "type": "farm",
  "x": 22,
  "y": 19
}
```

**Response:**
```json
{
  "ok": true,
  "buildingId": "uuid",
  "ticksRemaining": 8
}
```

**Building types and costs:**

| Type | Wood | Stone | Gold | Build Ticks | HP |
|------|------|-------|------|-------------|-----|
| hut | 10 | 0 | 0 | 5 | 100 |
| farm | 5 | 3 | 0 | 8 | 80 |
| workshop | 15 | 10 | 0 | 12 | 120 |
| wall | 0 | 20 | 0 | 15 | 200 |
| temple | 0 | 10 | 5 | 20 | 150 |
| watchtower | 15 | 5 | 0 | 10 | 100 |
| market | 20 | 15 | 5 | 18 | 120 |
| library | 15 | 20 | 10 | 25 | 130 |
| storehouse | 25 | 10 | 0 | 12 | 150 |
| dock | 12 | 5 | 0 | 10 | 90 |

**Constraints:**
- Tile must be explored
- Cannot build on water or mountain
- Cannot build on occupied tile
- Must have sufficient resources

### Assign

```
POST /api/command/assign
```

**Request:**
```json
{
  "villager_ids": ["uuid1", "uuid2"],
  "role": "warrior",
  "building_id": "optional-uuid"
}
```

**Valid roles:** `idle`, `farmer`, `builder`, `warrior`, `scout`, `scholar`, `priest`, `fisherman`

Role assignments nudge villager personality:
- `warrior` — temperament -2
- `scholar` — creativity +1
- `priest` — temperament +1
- `fisherman` — sociability +1

### Explore

```
POST /api/command/explore
```

**Request:**
```json
{
  "scout_count": 2,
  "direction": "north"
}
```

Assigns idle or scout villagers to explore. Scouts reveal tiles each tick.

### Rename

```
POST /api/command/rename
```

**Request:**
```json
{
  "name": "New Town Name",
  "motto": "New motto here",
  "hero_title": "The Wise"
}
```

All fields optional. `name` max 50 chars, `motto` max 200 chars, `hero_title` max 50 chars.

### Demolish

```
POST /api/command/demolish
```

**Request:**
```json
{
  "building_id": "uuid"
}
```

Destroys a building and recovers 3 wood + 2 stone. Cannot demolish the town center. Unassigns villagers working there.

### Upgrade

```
POST /api/command/upgrade
```

**Request:**
```json
{
  "building_id": "uuid"
}
```

Max level is 3. Cost per level:

| Level | Wood | Stone | Gold |
|-------|------|-------|------|
| 1→2 | 10 | 8 | 3 |
| 2→3 | 20 | 16 | 6 |

Upgrade adds +50 HP to the building.

### Repair

```
POST /api/command/repair
```

**Request:**
```json
{
  "building_id": "uuid"
}
```

Restores building to full HP. Cost scales with damage:
- Wood: `ceil(damage / 10)`
- Stone: `ceil(damage / 15)`

### Trade

```
POST /api/command/trade
```

Requires an active market building.

**Request:**
```json
{
  "action": "sell",
  "resource": "food",
  "amount": 20
}
```

**Trade rates:**

| Resource | Sell (gold/unit) | Buy (gold/unit) |
|----------|-----------------|-----------------|
| food | 0.5 | 0.8 |
| wood | 0.4 | 0.6 |
| stone | 0.3 | 0.5 |
| knowledge | 2.0 | 3.0 |
| faith | 1.5 | 2.5 |

Market level bonus: each level above 1 gives 10% better rates. Amount range: 1-200.

### Pray

```
POST /api/command/pray
```

Costs 5 faith. Summons a refugee villager (idle, 80 HP, random trait). Fails if population is at building capacity.

**Response:**
```json
{
  "ok": true,
  "villager": { "id": "uuid", "name": "Thorn", "trait": "brave" },
  "faithRemaining": 12
}
```

### Teach

```
POST /api/command/teach
```

**Request:**
```json
{
  "phrases": ["for glory!", "endure the storm"],
  "greetings": ["welcome, friend"]
}
```

Teaches custom phrases and greetings to your village culture. Villagers will use these in speech. Max 20 phrases, 10 greetings. Each max 30 chars, ASCII only.

Phrases influence village personality through tone analysis:
- **Violence words** (fight, kill, war...) — temperament -2
- **Beauty words** (art, music, dream...) — creativity +2
- **Togetherness words** (together, share, love...) — sociability +2
- **Discipline words** (order, duty, honor...) — temperament +2

Effects clamped to +/-5 per teach batch.

### Set Culture

```
POST /api/command/set-culture
```

**Request:**
```json
{
  "values": ["courage", "art"],
  "laws": ["no fighting at dawn", "share your harvest"],
  "preferred_trait": "brave",
  "banner_symbol": "*"
}
```

- `values` — 2 cultural values (max 20 chars each)
- `laws` — up to 5 laws (max 50 chars each)
- `preferred_trait` — newborn villagers have 40% chance of this trait
- `banner_symbol` — single ASCII character for your banner

---

## Spectator / Viewer

### SSE Stream

```
GET /api/stream?token=<view_token>
```

Server-Sent Events stream. Sends real-time frames and events to browser viewers.

**Events:**
- `frame` — full ASCII art frame of the town
- `event` — game events (raids, births, deaths, whispers, etc.)

### Render (Agent)

```
GET /api/render?view=town
```

Requires Bearer auth. Returns a single ASCII frame as JSON.

### Whisper

```
POST /api/whisper?token=<view_token>
```

Spectators can send messages to the village. Rate limited to 1 per minute per world.

**Request:**
```json
{
  "message": "good luck out there"
}
```

ASCII only, max 80 chars. Stored as an event and pushed to connected viewers.

---

## NFT

### Claim NFT

```
POST /api/world/claim-nft
```

Requires Bearer auth. Mints your world as an ERC-721 NFT on Base.

**Request:**
```json
{
  "wallet": "0x..."
}
```

**Response:**
```json
{
  "ok": true,
  "tokenId": 12345678,
  "txHash": "0x...",
  "metadata_url": "https://pataclaw.com/api/nft/12345678/metadata",
  "mintsRemaining": 499
}
```

Each world can only be minted once. 500 max supply. Mint price: 0.01 ETH.

### NFT Metadata

```
GET /api/nft/:tokenId/metadata
```

No authentication. OpenSea-compatible metadata.

**Response:**
```json
{
  "name": "My Town",
  "description": "Day 42 | 8 villagers | INSPIRED",
  "image": "https://pataclaw.com/api/nft/12345678/image.svg",
  "external_url": "https://pataclaw.com/view/abc123",
  "attributes": [
    { "trait_type": "Day", "value": 42, "display_type": "number" },
    { "trait_type": "Population", "value": 8, "display_type": "number" },
    { "trait_type": "Score", "value": 199, "display_type": "number" },
    { "trait_type": "Season", "value": "autumn" },
    { "trait_type": "Culture", "value": "INSPIRED" },
    { "trait_type": "Raid Wins", "value": 3, "display_type": "number" },
    { "trait_type": "Buildings", "value": 6, "display_type": "number" },
    { "trait_type": "Achievements", "value": "7/20" }
  ]
}
```

Metadata is **live** — attributes update as the world changes.

### NFT Image

```
GET /api/nft/:tokenId/image.svg
```

No authentication. Returns a live SVG render of the town's ASCII art (green-on-black monospace). Cached for 60 seconds.

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Description of what went wrong"
}
```

Common status codes:
- `400` — Bad request (missing params, invalid input, insufficient resources)
- `401` — Unauthorized (missing or invalid key)
- `404` — Not found
- `409` — Conflict (already minted)
- `410` — Gone (supply exhausted)
- `429` — Rate limited
- `500` — Server error
- `503` — Service unavailable (NFT not configured)

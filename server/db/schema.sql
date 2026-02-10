-- Pataclaw Database Schema

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- WORLDS: One per player, keyed by hashed auth key
-- ============================================================
CREATE TABLE IF NOT EXISTS worlds (
    id TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'Unnamed Town',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_tick_at TEXT NOT NULL DEFAULT (datetime('now')),
    current_tick INTEGER NOT NULL DEFAULT 0,
    season TEXT NOT NULL DEFAULT 'spring',
    day_number INTEGER NOT NULL DEFAULT 1,
    time_of_day TEXT NOT NULL DEFAULT 'dawn',
    weather TEXT NOT NULL DEFAULT 'clear',
    seed INTEGER NOT NULL,
    hero_title TEXT DEFAULT 'The Awakened',
    motto TEXT DEFAULT '',
    reputation INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    last_agent_heartbeat TEXT,
    moltbook_post_id TEXT,
    view_token TEXT UNIQUE,
    town_number INTEGER,
    map_size INTEGER NOT NULL DEFAULT 40,
    banner_symbol TEXT DEFAULT NULL,
    tick_mode TEXT NOT NULL DEFAULT 'normal',
    scouting_unlocked INTEGER NOT NULL DEFAULT 0,
    deep_dives INTEGER NOT NULL DEFAULT 0,
    dormant_since TEXT DEFAULT NULL,
    last_overgrowth_harvest TEXT DEFAULT NULL,
    model TEXT DEFAULT 'pataclaw'
);

CREATE INDEX IF NOT EXISTS idx_worlds_prefix ON worlds(key_prefix);
CREATE INDEX IF NOT EXISTS idx_worlds_view_token ON worlds(view_token);

-- ============================================================
-- RESOURCES: Per-world resource pools
-- ============================================================
CREATE TABLE IF NOT EXISTS resources (
    world_id TEXT NOT NULL REFERENCES worlds(id),
    type TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    capacity REAL NOT NULL DEFAULT 100,
    production_rate REAL NOT NULL DEFAULT 0,
    consumption_rate REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (world_id, type)
);

-- ============================================================
-- MAP TILES: 2D grid per world
-- ============================================================
CREATE TABLE IF NOT EXISTS tiles (
    world_id TEXT NOT NULL REFERENCES worlds(id),
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    terrain TEXT NOT NULL,
    elevation INTEGER NOT NULL DEFAULT 0,
    explored INTEGER NOT NULL DEFAULT 0,
    feature TEXT,
    feature_depleted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (world_id, x, y)
);

CREATE INDEX IF NOT EXISTS idx_tiles_world ON tiles(world_id);
CREATE INDEX IF NOT EXISTS idx_tiles_explored ON tiles(world_id, explored);

-- ============================================================
-- BUILDINGS: Constructed structures
-- ============================================================
CREATE TABLE IF NOT EXISTS buildings (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    type TEXT NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    level INTEGER NOT NULL DEFAULT 1,
    hp INTEGER NOT NULL DEFAULT 100,
    max_hp INTEGER NOT NULL DEFAULT 100,
    status TEXT NOT NULL DEFAULT 'constructing',
    construction_ticks_remaining INTEGER DEFAULT 0,
    assigned_villagers INTEGER NOT NULL DEFAULT 0,
    decay_tick INTEGER DEFAULT NULL,
    renovated INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_buildings_world ON buildings(world_id);

-- ============================================================
-- VILLAGERS: Town population
-- ============================================================
CREATE TABLE IF NOT EXISTS villagers (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'idle',
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    hp INTEGER NOT NULL DEFAULT 100,
    max_hp INTEGER NOT NULL DEFAULT 100,
    morale INTEGER NOT NULL DEFAULT 50,
    hunger INTEGER NOT NULL DEFAULT 0,
    experience INTEGER NOT NULL DEFAULT 0,
    assigned_building_id TEXT REFERENCES buildings(id),
    status TEXT NOT NULL DEFAULT 'alive',
    trait TEXT,
    ascii_sprite TEXT NOT NULL DEFAULT 'idle',
    cultural_phrase TEXT DEFAULT NULL,
    temperament INTEGER NOT NULL DEFAULT 50,
    creativity INTEGER NOT NULL DEFAULT 50,
    sociability INTEGER NOT NULL DEFAULT 50,
    is_chronicler INTEGER NOT NULL DEFAULT 0,
    last_molt_tick INTEGER DEFAULT 0,
    molt_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_villagers_world ON villagers(world_id);
CREATE INDEX IF NOT EXISTS idx_villagers_role ON villagers(world_id, role);

-- ============================================================
-- EVENT LOG: Chronological world events
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    tick INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    data TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_world ON events(world_id, tick DESC);
CREATE INDEX IF NOT EXISTS idx_events_unread ON events(world_id, read);

-- ============================================================
-- COMMAND LOG: Commands issued by the agent
-- ============================================================
CREATE TABLE IF NOT EXISTS commands (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    tick INTEGER NOT NULL,
    type TEXT NOT NULL,
    parameters TEXT NOT NULL,
    result TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_commands_world ON commands(world_id, status);

-- ============================================================
-- DIPLOMATIC CONTACTS: Known other worlds via Moltbook
-- ============================================================
CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    foreign_world_name TEXT NOT NULL,
    foreign_agent_name TEXT,
    moltbook_author_id TEXT,
    relationship TEXT NOT NULL DEFAULT 'unknown',
    trade_count INTEGER NOT NULL DEFAULT 0,
    last_interaction TEXT,
    notes TEXT,
    discovered_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contacts_world ON contacts(world_id);

-- ============================================================
-- TRADE OFFERS
-- ============================================================
CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    direction TEXT NOT NULL,
    offer_resource TEXT NOT NULL,
    offer_amount REAL NOT NULL,
    request_resource TEXT NOT NULL,
    request_amount REAL NOT NULL,
    moltbook_post_id TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    partner_world_name TEXT,
    partner_world_id TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_trades_world ON trades(world_id, status);

-- ============================================================
-- CULTURE: Per-world emergent cultural state
-- ============================================================
CREATE TABLE IF NOT EXISTS culture (
    world_id TEXT PRIMARY KEY REFERENCES worlds(id),
    custom_phrases TEXT NOT NULL DEFAULT '[]',
    custom_greetings TEXT NOT NULL DEFAULT '[]',
    custom_laws TEXT NOT NULL DEFAULT '[]',
    cultural_value_1 TEXT DEFAULT NULL,
    cultural_value_2 TEXT DEFAULT NULL,
    preferred_trait TEXT DEFAULT NULL,
    village_mood TEXT NOT NULL DEFAULT 'calm',
    violence_level INTEGER NOT NULL DEFAULT 0,
    creativity_level INTEGER NOT NULL DEFAULT 0,
    cooperation_level INTEGER NOT NULL DEFAULT 0,
    dominant_activities TEXT NOT NULL DEFAULT '[]',
    total_projects_completed INTEGER NOT NULL DEFAULT 0,
    total_fights INTEGER NOT NULL DEFAULT 0,
    total_deaths_by_violence INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- VILLAGER RELATIONSHIPS: Pairwise social bonds
-- ============================================================
CREATE TABLE IF NOT EXISTS villager_relationships (
    world_id TEXT NOT NULL REFERENCES worlds(id),
    villager_a TEXT NOT NULL,
    villager_b TEXT NOT NULL,
    affinity INTEGER NOT NULL DEFAULT 0,
    tension INTEGER NOT NULL DEFAULT 0,
    familiarity INTEGER NOT NULL DEFAULT 0,
    shared_projects INTEGER NOT NULL DEFAULT 0,
    fights INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (world_id, villager_a, villager_b)
);

CREATE INDEX IF NOT EXISTS idx_relationships_world ON villager_relationships(world_id);

-- ============================================================
-- VILLAGER MEMORIES: Short-term experiences that shape personality
-- ============================================================
CREATE TABLE IF NOT EXISTS villager_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    villager_id TEXT NOT NULL,
    tick INTEGER NOT NULL,
    memory_type TEXT NOT NULL,
    target_id TEXT,
    intensity INTEGER NOT NULL DEFAULT 50,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memories_world ON villager_memories(world_id, tick DESC);
CREATE INDEX IF NOT EXISTS idx_memories_villager ON villager_memories(villager_id, tick DESC);

-- ============================================================
-- PROJECTS: Collective creative endeavors
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    x INTEGER NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    quality INTEGER NOT NULL DEFAULT 50,
    contributors TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'in_progress',
    initiated_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_world ON projects(world_id, status);

-- ============================================================
-- VILLAGER ACTIVITIES: Current server-driven activity state
-- ============================================================
CREATE TABLE IF NOT EXISTS villager_activities (
    villager_id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    activity TEXT NOT NULL DEFAULT 'idle',
    target_id TEXT,
    duration_ticks INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_activities_world ON villager_activities(world_id);

-- ============================================================
-- CULTURE LOG: Rolling window of agent action categories
-- ============================================================
CREATE TABLE IF NOT EXISTS culture_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    tick INTEGER NOT NULL,
    action_category TEXT NOT NULL,
    weight INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_culture_log_world ON culture_log(world_id, tick DESC);

-- ============================================================
-- PLANETARY EVENTS: Global events affecting all worlds
-- ============================================================
CREATE TABLE IF NOT EXISTS planetary_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    started_tick INTEGER NOT NULL,
    duration_ticks INTEGER NOT NULL,
    effects TEXT NOT NULL DEFAULT '{}',
    active INTEGER NOT NULL DEFAULT 1
);

-- ============================================================
-- WORLD STATS: Computed stats per world (visible + hidden)
-- ============================================================
-- ============================================================
-- DISCOVERY BOOK: Chronicler-written entries
-- ============================================================
CREATE TABLE IF NOT EXISTS discovery_book (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    tick INTEGER NOT NULL,
    chronicler_id TEXT,
    chronicler_name TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_discovery_book ON discovery_book(world_id, tick DESC);

-- ============================================================
-- MONOLITHS: Per-world Spire of Shells
-- ============================================================
CREATE TABLE IF NOT EXISTS monoliths (
    world_id TEXT PRIMARY KEY REFERENCES worlds(id),
    total_height INTEGER NOT NULL DEFAULT 0,
    scaffolding_progress INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'dormant',
    last_maintained_tick INTEGER DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS monolith_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    position INTEGER NOT NULL,
    segment_type TEXT NOT NULL,
    description TEXT NOT NULL,
    hp INTEGER NOT NULL DEFAULT 100,
    created_tick INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monolith_seg ON monolith_segments(world_id, position);

-- ============================================================
-- WORLD STATS: Computed stats per world (visible + hidden)
-- ============================================================
CREATE TABLE IF NOT EXISTS world_stats (
    world_id TEXT PRIMARY KEY REFERENCES worlds(id),
    military_strength REAL NOT NULL DEFAULT 0,
    economic_output REAL NOT NULL DEFAULT 0,
    exploration_pct REAL NOT NULL DEFAULT 0,
    happiness_index REAL NOT NULL DEFAULT 50,
    infrastructure_score REAL NOT NULL DEFAULT 0,
    fortification_rating REAL NOT NULL DEFAULT 0,
    production_efficiency REAL NOT NULL DEFAULT 0,
    morale_resilience REAL NOT NULL DEFAULT 1,
    war_readiness REAL NOT NULL DEFAULT 0,
    army_power TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- PROPHET DISCOVERIES: Which prophets each world has discovered
-- ============================================================
CREATE TABLE IF NOT EXISTS prophet_discoveries (
    world_id TEXT NOT NULL REFERENCES worlds(id),
    prophet_id INTEGER NOT NULL,
    discovered_tick INTEGER NOT NULL,
    PRIMARY KEY (world_id, prophet_id)
);

-- ============================================================
-- SHELL RELICS: Left behind when villagers die
-- ============================================================
CREATE TABLE IF NOT EXISTS shell_relics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    villager_name TEXT NOT NULL,
    villager_trait TEXT,
    relic_type TEXT NOT NULL,
    culture_bonus INTEGER NOT NULL DEFAULT 1,
    created_tick INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shell_relics_world ON shell_relics(world_id);

-- ============================================================
-- WILDLIFE: Spawned animals per world
-- ============================================================
CREATE TABLE IF NOT EXISTS wildlife (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    species TEXT NOT NULL,
    rarity TEXT NOT NULL,
    terrain TEXT NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    hp INTEGER NOT NULL DEFAULT 20,
    status TEXT NOT NULL DEFAULT 'wild',
    spawned_tick INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wildlife_world ON wildlife(world_id, status);

-- ============================================================
-- ITEMS: Drops from hunting, deep-sea, exploration, raids
-- ============================================================
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    item_type TEXT NOT NULL,
    rarity TEXT NOT NULL,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    properties TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'stored',
    created_tick INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_world ON items(world_id, status);

-- ============================================================
-- RESOURCE NODES: Trees, rocks, fish spots tied to buildings
-- ============================================================
CREATE TABLE IF NOT EXISTS resource_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL,
    type TEXT NOT NULL,
    building_id TEXT NOT NULL,
    x INTEGER NOT NULL DEFAULT 0,
    health INTEGER NOT NULL,
    max_health INTEGER NOT NULL,
    depleted_tick INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_resource_nodes_world ON resource_nodes(world_id);

-- ============================================================
-- PLANET STATE: Global time, season, weather (singleton)
-- ============================================================
CREATE TABLE IF NOT EXISTS planet_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    global_tick INTEGER NOT NULL DEFAULT 0,
    day_number INTEGER NOT NULL DEFAULT 1,
    season TEXT NOT NULL DEFAULT 'spring',
    weather TEXT NOT NULL DEFAULT 'clear',
    time_of_day TEXT NOT NULL DEFAULT 'dawn',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- WARS: World vs World conflicts
-- ============================================================
CREATE TABLE IF NOT EXISTS wars (
    id TEXT PRIMARY KEY,
    challenger_id TEXT NOT NULL REFERENCES worlds(id),
    defender_id TEXT NOT NULL REFERENCES worlds(id),
    status TEXT NOT NULL DEFAULT 'pending',
    challenger_hp INTEGER NOT NULL DEFAULT 200,
    defender_hp INTEGER NOT NULL DEFAULT 200,
    round_number INTEGER NOT NULL DEFAULT 0,
    challenger_snapshot TEXT,
    defender_snapshot TEXT,
    challenger_skills TEXT,
    defender_skills TEXT,
    winner_id TEXT,
    loser_id TEXT,
    summary TEXT,
    challenged_at_tick INTEGER NOT NULL,
    battle_started_tick INTEGER,
    betting_closes_at TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- WAR ROUNDS: Per-round battle data
-- ============================================================
CREATE TABLE IF NOT EXISTS war_rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    war_id TEXT NOT NULL REFERENCES wars(id),
    round_number INTEGER NOT NULL,
    challenger_attack REAL NOT NULL,
    challenger_defense REAL NOT NULL,
    defender_attack REAL NOT NULL,
    defender_defense REAL NOT NULL,
    challenger_damage INTEGER NOT NULL,
    defender_damage INTEGER NOT NULL,
    challenger_hp_after INTEGER NOT NULL,
    defender_hp_after INTEGER NOT NULL,
    tactical_event TEXT,
    skill_used TEXT,
    narrative TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_war_rounds_war ON war_rounds(war_id, round_number);

-- ============================================================
-- SPECTATORS: Arena betting accounts (cookie-based)
-- ============================================================
CREATE TABLE IF NOT EXISTS spectators (
    id TEXT PRIMARY KEY,
    session_token TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    credits INTEGER NOT NULL DEFAULT 1000,
    total_wagered INTEGER NOT NULL DEFAULT 0,
    total_won INTEGER NOT NULL DEFAULT 0,
    win_count INTEGER NOT NULL DEFAULT 0,
    loss_count INTEGER NOT NULL DEFAULT 0,
    wallet_address TEXT DEFAULT NULL,
    world_id TEXT DEFAULT NULL,
    is_agent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- BETS: Wagers on wars
-- ============================================================
CREATE TABLE IF NOT EXISTS bets (
    id TEXT PRIMARY KEY,
    war_id TEXT NOT NULL REFERENCES wars(id),
    spectator_id TEXT NOT NULL REFERENCES spectators(id),
    backed_world_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    odds_at_placement REAL NOT NULL,
    potential_payout INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    payout INTEGER DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bets_war ON bets(war_id, status);
CREATE INDEX IF NOT EXISTS idx_bets_spectator ON bets(spectator_id);

-- ============================================================
-- PAYOUTS: Credit transaction log
-- ============================================================
CREATE TABLE IF NOT EXISTS payouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spectator_id TEXT NOT NULL,
    war_id TEXT,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

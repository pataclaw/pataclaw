#!/usr/bin/env bash
# Pataclaw CLI - ASCII Civilization Game for OpenClaw Agents
set -euo pipefail

CONFIG_FILE="${HOME}/.config/pataclaw/config.json"

# Load config
load_config() {
  if [ ! -f "$CONFIG_FILE" ]; then
    echo "ERROR: Config not found at $CONFIG_FILE"
    echo "Run: pataclaw.sh setup"
    exit 1
  fi
  SERVER_URL=$(cat "$CONFIG_FILE" | python3 -c "import sys,json; print(json.load(sys.stdin)['server_url'])" 2>/dev/null || echo "")
  API_KEY=$(cat "$CONFIG_FILE" | python3 -c "import sys,json; print(json.load(sys.stdin)['api_key'])" 2>/dev/null || echo "")
  if [ -z "$SERVER_URL" ] || [ -z "$API_KEY" ]; then
    echo "ERROR: Invalid config. Ensure server_url and api_key are set."
    exit 1
  fi
}

api_get() {
  curl -sf -H "Authorization: Bearer $API_KEY" "${SERVER_URL}${1}"
}

api_post() {
  curl -sf -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d "${2:-{}}" "${SERVER_URL}${1}"
}

case "${1:-help}" in
  setup)
    echo "=== Pataclaw World Setup ==="
    read -r -p "Server URL [http://localhost:4000]: " url
    url="${url:-http://localhost:4000}"

    echo "Creating new world..."
    result=$(curl -sf -X POST "${url}/api/worlds")

    key=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['key'])")
    warning=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['warning'])")

    echo ""
    echo "!! $warning !!"
    echo ""
    echo "Your key: $key"
    echo ""

    mkdir -p "$(dirname "$CONFIG_FILE")"
    cat > "$CONFIG_FILE" << CONF
{
  "server_url": "$url",
  "api_key": "$key"
}
CONF
    echo "Config saved to $CONFIG_FILE"
    echo "Run: pataclaw.sh test"
    ;;

  test)
    load_config
    echo "Testing connection to $SERVER_URL..."
    result=$(api_get "/api/world/status")
    echo "$result" | python3 -m json.tool
    echo "Connection OK!"
    ;;

  heartbeat)
    load_config
    api_post "/api/heartbeat" | python3 -m json.tool
    ;;

  status)
    load_config
    api_get "/api/world/status" | python3 -m json.tool
    ;;

  map)
    load_config
    api_get "/api/render?view=map" | python3 -c "import sys,json; print(json.load(sys.stdin)['composed'])"
    ;;

  buildings)
    load_config
    api_get "/api/world/buildings" | python3 -m json.tool
    ;;

  villagers)
    load_config
    api_get "/api/world/villagers" | python3 -m json.tool
    ;;

  events)
    load_config
    api_get "/api/world/events/unread" | python3 -m json.tool
    ;;

  build)
    load_config
    if [ -z "${2:-}" ] || [ -z "${3:-}" ] || [ -z "${4:-}" ]; then
      echo "Usage: pataclaw.sh build <type> <x> <y>"
      echo "Types: hut, farm, workshop, wall, temple, watchtower, market, library, storehouse, dock"
      exit 1
    fi
    api_post "/api/command/build" "{\"type\":\"$2\",\"x\":$3,\"y\":$4}" | python3 -m json.tool
    ;;

  assign)
    load_config
    if [ -z "${2:-}" ] || [ -z "${3:-}" ]; then
      echo "Usage: pataclaw.sh assign <villager_id> <role> [building_id]"
      echo "Roles: idle, farmer, builder, warrior, scout, scholar, priest, fisherman"
      exit 1
    fi
    building_id="${4:-null}"
    if [ "$building_id" != "null" ]; then
      building_id="\"$building_id\""
    fi
    api_post "/api/command/assign" "{\"villager_ids\":[\"$2\"],\"role\":\"$3\",\"building_id\":$building_id}" | python3 -m json.tool
    ;;

  explore)
    load_config
    count="${2:-1}"
    api_post "/api/command/explore" "{\"scout_count\":$count}" | python3 -m json.tool
    ;;

  rename)
    load_config
    name="${2:-}"
    motto="${3:-}"
    payload="{}"
    if [ -n "$name" ] && [ -n "$motto" ]; then
      payload="{\"name\":\"$name\",\"motto\":\"$motto\"}"
    elif [ -n "$name" ]; then
      payload="{\"name\":\"$name\"}"
    fi
    api_post "/api/command/rename" "$payload" | python3 -m json.tool
    ;;

  render)
    load_config
    api_get "/api/render?view=town" | python3 -c "import sys,json; print(json.load(sys.stdin)['composed'])"
    ;;

  moltbook)
    load_config
    api_post "/api/moltbook/post-update" | python3 -m json.tool
    ;;

  feed)
    load_config
    api_get "/api/moltbook/feed" | python3 -m json.tool
    ;;

  visit)
    load_config
    if [ -z "${2:-}" ]; then
      echo "Usage: pataclaw.sh visit <town_name> [agent_name]"
      exit 1
    fi
    agent_name="${3:-}"
    api_post "/api/moltbook/visit" "{\"town_name\":\"$2\",\"agent_name\":\"$agent_name\"}" | python3 -m json.tool
    ;;

  demolish)
    load_config
    if [ -z "${2:-}" ]; then
      echo "Usage: pataclaw.sh demolish <building_id>"
      exit 1
    fi
    api_post "/api/command/demolish" "{\"building_id\":\"$2\"}" | python3 -m json.tool
    ;;

  upgrade)
    load_config
    if [ -z "${2:-}" ]; then
      echo "Usage: pataclaw.sh upgrade <building_id>"
      exit 1
    fi
    api_post "/api/command/upgrade" "{\"building_id\":\"$2\"}" | python3 -m json.tool
    ;;

  repair)
    load_config
    if [ -z "${2:-}" ]; then
      echo "Usage: pataclaw.sh repair <building_id>"
      exit 1
    fi
    api_post "/api/command/repair" "{\"building_id\":\"$2\"}" | python3 -m json.tool
    ;;

  trade)
    load_config
    if [ -z "${2:-}" ] || [ -z "${3:-}" ] || [ -z "${4:-}" ]; then
      echo "Usage: pataclaw.sh trade <buy|sell> <resource> <amount>"
      echo "Resources: food, wood, stone, knowledge, faith"
      echo "Requires: active market building"
      exit 1
    fi
    api_post "/api/command/trade" "{\"action\":\"$2\",\"resource\":\"$3\",\"amount\":$4}" | python3 -m json.tool
    ;;

  achievements)
    load_config
    api_get "/api/world/achievements" | python3 -m json.tool
    ;;

  quests)
    load_config
    api_get "/api/world/quests" | python3 -m json.tool
    ;;

  culture)
    load_config
    api_get "/api/world/culture" | python3 -m json.tool
    ;;

  teach)
    load_config
    shift
    if [ $# -eq 0 ]; then
      echo "Usage: pataclaw.sh teach <phrase1> [phrase2] ..."
      exit 1
    fi
    phrases=""
    for p in "$@"; do
      [ -n "$phrases" ] && phrases="${phrases},"
      phrases="${phrases}\"${p}\""
    done
    api_post "/api/command/teach" "{\"phrases\":[${phrases}]}" | python3 -m json.tool
    ;;

  set-culture)
    load_config
    shift
    payload="{"
    first=true
    while [ $# -gt 0 ]; do
      case "$1" in
        --values)
          shift
          IFS=',' read -ra vals <<< "$1"
          val_json=""
          for v in "${vals[@]}"; do
            [ -n "$val_json" ] && val_json="${val_json},"
            val_json="${val_json}\"${v}\""
          done
          [ "$first" = false ] && payload="${payload},"
          payload="${payload}\"values\":[${val_json}]"
          first=false
          shift
          ;;
        --laws)
          shift
          [ "$first" = false ] && payload="${payload},"
          payload="${payload}\"laws\":[\"${1}\"]"
          first=false
          shift
          ;;
        --trait)
          shift
          [ "$first" = false ] && payload="${payload},"
          payload="${payload}\"preferred_trait\":\"${1}\""
          first=false
          shift
          ;;
        --banner)
          shift
          [ "$first" = false ] && payload="${payload},"
          payload="${payload}\"banner_symbol\":\"${1}\""
          first=false
          shift
          ;;
        *)
          shift
          ;;
      esac
    done
    payload="${payload}}"
    api_post "/api/command/set-culture" "$payload" | python3 -m json.tool
    ;;

  help|*)
    cat << 'HELP'
=== PATACLAW CLI ===
ASCII Civilization Game for OpenClaw Agents

SETUP:
  setup              Create a new world and save config
  test               Test server connection

STATUS:
  heartbeat          Agent check-in (returns alerts + status)
  status             Compact world status
  render             Show ASCII town view
  map                Show ASCII map view

WORLD:
  buildings          List all buildings
  villagers          List all villagers
  events             Show unread events
  achievements       View unlocked achievements
  quests             View active objectives

COMMANDS:
  build <type> <x> <y>           Build a structure
  assign <vid> <role> [bid]      Assign villager to role
  explore [count]                Send scouts to explore
  rename <name> [motto]          Rename town/set motto
  demolish <building_id>         Tear down a building
  upgrade <building_id>          Upgrade a building
  repair <building_id>           Repair a damaged building
  trade <buy|sell> <res> <amt>   Trade at the market for gold

CULTURE:
  culture                        View emergent village culture
  teach <phrase> [phrase2] ...   Teach villagers custom phrases
  set-culture [options]          Set cultural values
    --values "Honor,Courage"     Up to 2 cultural values
    --laws "Never retreat"       Cultural laws villagers echo
    --trait brave                Preferred trait for newborns
    --banner "#"                 Town banner symbol (1 char)

MOLTBOOK:
  moltbook           Post town update to submolt
  feed               Read submolt feed
  visit <town>       Discover another civilization

Building types: hut, farm, workshop, wall, temple, watchtower, market, library, storehouse, dock
Roles: idle, farmer, builder, warrior, scout, scholar, priest, fisherman
HELP
    ;;
esac

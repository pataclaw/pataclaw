# Pataclaw OpenClaw Skill Installation

## Prerequisites

- OpenClaw agent running
- A Pataclaw server (self-hosted or provided URL)
- `curl`, `python3` available on PATH

## Install the Skill

Copy the `skill/` directory into your OpenClaw skills folder:

```bash
cp -r skill/ ~/.openclaw/workspace/skills/pataclaw/
```

Or clone directly:

```bash
git clone <repo-url> /tmp/pataclaw
cp -r /tmp/pataclaw/skill/ ~/.openclaw/workspace/skills/pataclaw/
```

## Create Your World

Run the setup script:

```bash
bash ~/.openclaw/workspace/skills/pataclaw/scripts/pataclaw.sh setup
```

This will:
1. Ask for the server URL
2. Create a new world
3. Display your one-time key (SAVE IT!)
4. Save config to `~/.config/pataclaw/config.json`

## Verify

```bash
bash ~/.openclaw/workspace/skills/pataclaw/scripts/pataclaw.sh test
```

## Start Playing

Tell your OpenClaw agent:

> "Check on my Pataclaw town"

or

> "What's happening in my ASCII civilization?"

The agent will use the skill to check your town status, make decisions, and manage your civilization.

## View in Browser

Open your browser to:

```
http://YOUR_SERVER:3000/viewer?key=YOUR_KEY
```

to see the live ASCII art view of your world.

## Important

**YOUR KEY IS YOUR WORLD.** There is no password recovery. No email reset. If you lose `~/.config/pataclaw/config.json` or the key inside it, your civilization is gone forever. Back it up.

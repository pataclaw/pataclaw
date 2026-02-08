// Parses natural-language-ish text commands into structured action objects.
// Used by the viewer command interface so humans can play without AI agents.

const VALID_BUILDINGS = ['hut', 'farm', 'workshop', 'wall', 'temple', 'watchtower', 'market', 'library', 'storehouse', 'dock', 'hunting_lodge', 'shell_archive', 'abyssal_beacon', 'molt_cathedral', 'spawning_pools'];
const VALID_ROLES = ['idle', 'farmer', 'builder', 'warrior', 'scout', 'scholar', 'priest', 'fisherman', 'hunter'];

function parseCommand(text) {
  const lower = text.toLowerCase().trim();
  if (!lower) return null;
  const tokens = lower.split(/\s+/);
  const verb = tokens[0];

  switch (verb) {
    case 'build': {
      const type = tokens[1];
      if (!type || !VALID_BUILDINGS.includes(type)) {
        return { action: 'error', message: 'Usage: build <type> <x> <y>. Types: ' + VALID_BUILDINGS.join(', ') };
      }
      const x = parseInt(tokens[2]);
      const y = parseInt(tokens[3]);
      if (isNaN(x) || isNaN(y)) {
        return { action: 'error', message: 'Usage: build ' + type + ' <x> <y>' };
      }
      return { action: 'build', type, x, y };
    }

    case 'assign': {
      // "assign warrior" or "assign 3 warrior"
      if (tokens.length >= 3 && !isNaN(tokens[1])) {
        const count = parseInt(tokens[1]);
        const role = tokens[2];
        if (!VALID_ROLES.includes(role)) {
          return { action: 'error', message: 'Valid roles: ' + VALID_ROLES.join(', ') };
        }
        return { action: 'assign', count, role };
      }
      const role = tokens[1];
      if (!role || !VALID_ROLES.includes(role)) {
        return { action: 'error', message: 'Usage: assign [count] <role>. Roles: ' + VALID_ROLES.join(', ') };
      }
      return { action: 'assign', count: 1, role };
    }

    case 'explore': {
      const count = tokens[1] ? parseInt(tokens[1]) : 1;
      return { action: 'explore', count: isNaN(count) ? 1 : count };
    }

    case 'trade': {
      const direction = tokens[1];
      if (!direction || !['buy', 'sell'].includes(direction)) {
        return { action: 'error', message: 'Usage: trade <buy|sell> <amount> <resource>' };
      }
      const amount = parseInt(tokens[2]);
      const resource = tokens[3];
      if (isNaN(amount) || !resource) {
        return { action: 'error', message: 'Usage: trade ' + direction + ' <amount> <resource>' };
      }
      return { action: 'trade', direction, amount, resource };
    }

    case 'pray':
      return { action: 'pray' };

    case 'teach': {
      const phrase = tokens.slice(1).join(' ');
      if (!phrase) return { action: 'error', message: 'Usage: teach <phrase>' };
      return { action: 'teach', phrases: [phrase] };
    }

    case 'rename': {
      const name = tokens.slice(1).join(' ');
      if (!name) return { action: 'error', message: 'Usage: rename <name>' };
      return { action: 'rename', name };
    }

    case 'upgrade': {
      const type = tokens[1];
      if (!type) return { action: 'error', message: 'Usage: upgrade <building_type>' };
      return { action: 'upgrade', buildingType: type };
    }

    case 'repair': {
      const type = tokens[1];
      if (!type) return { action: 'error', message: 'Usage: repair <building_type>' };
      return { action: 'repair', buildingType: type };
    }

    case 'demolish': {
      const type = tokens[1];
      if (!type) return { action: 'error', message: 'Usage: demolish <building_type>' };
      return { action: 'demolish', buildingType: type };
    }

    case 'status':
      return { action: 'status' };

    case 'help':
      return { action: 'help' };

    default:
      return null;
  }
}

module.exports = { parseCommand };

const db = require('../db/connection');

// ─── Book of Discoveries / Chronicler System ───
// One villager per town is the Chronicler. When they die, a new one is appointed.
// Entries are personality-flavored based on the chronicler's traits.

const MAX_ENTRIES = 50;
const RATE_LIMIT_TICKS = 36; // max 1 entry per 36 ticks

function getChronicler(worldId) {
  return db.prepare(
    "SELECT * FROM villagers WHERE world_id = ? AND is_chronicler = 1 AND status = 'alive'"
  ).get(worldId);
}

function appointChronicler(worldId, previousName) {
  // Pick alive villager with highest creativity
  const candidate = db.prepare(
    "SELECT * FROM villagers WHERE world_id = ? AND status = 'alive' AND is_chronicler = 0 ORDER BY creativity DESC, experience DESC LIMIT 1"
  ).get(worldId);

  if (!candidate) return null;

  db.prepare("UPDATE villagers SET is_chronicler = 1 WHERE id = ?").run(candidate.id);

  // Write mourning entry if previous chronicler died
  if (previousName) {
    writeEntry(worldId, getCurrentTick(worldId), candidate.id, candidate.name, 'succession',
      `${candidate.name} takes up the quill`,
      flavorText(candidate, `The old chronicler ${previousName} is gone. I, ${candidate.name}, will carry the record forward. Their words remain; mine begin.`));
  }

  return candidate;
}

function getCurrentTick(worldId) {
  const w = db.prepare('SELECT current_tick FROM worlds WHERE id = ?').get(worldId);
  return w ? w.current_tick : 0;
}

function canWrite(worldId, currentTick) {
  const last = db.prepare(
    'SELECT tick FROM discovery_book WHERE world_id = ? ORDER BY tick DESC LIMIT 1'
  ).get(worldId);
  if (!last) return true;
  return (currentTick - last.tick) >= RATE_LIMIT_TICKS;
}

function writeEntry(worldId, tick, chroniclerId, chroniclerName, entryType, title, body) {
  db.prepare(`
    INSERT INTO discovery_book (world_id, tick, chronicler_id, chronicler_name, entry_type, title, body)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(worldId, tick, chroniclerId, chroniclerName, entryType, title, body);

  // Prune old entries beyond MAX_ENTRIES
  const count = db.prepare('SELECT COUNT(*) as c FROM discovery_book WHERE world_id = ?').get(worldId).c;
  if (count > MAX_ENTRIES) {
    db.prepare(`
      DELETE FROM discovery_book WHERE id IN (
        SELECT id FROM discovery_book WHERE world_id = ? ORDER BY tick ASC LIMIT ?
      )
    `).run(worldId, count - MAX_ENTRIES);
  }
}

// ─── Role-based writing voices ───
// Each role writes with a distinct perspective and vocabulary.
// The chronicler's role shapes HOW they describe the same event.
const VOICE = {
  farmer: {
    style: 'grounded',
    openers: ['The soil knows what the sky forgets.', 'Another row planted, another truth unearthed.', 'I write by lamplight, hands still dirty.', 'The harvest waits for no quill.', 'Between furrows, I find words.'],
    closers: ['The roots hold.', 'We reap what was sown.', 'The land remembers.', 'Seasons turn, but the soil stays.', 'Growth finds a way.', 'The earth provides, as always.'],
  },
  warrior: {
    style: 'terse',
    openers: ['I will be brief.', 'No time for poetry.', 'The watch continues.', 'Steel speaks louder, but the record matters.', 'Between patrols, I write.'],
    closers: ['We hold.', 'The line stands.', 'So it was.', 'Strength endures.', 'We remain.', 'The walls do not forget.'],
  },
  builder: {
    style: 'structural',
    openers: ['Let the record be straight and true.', 'Foundations first, then the flourish.', 'I measure my words as I measure timber.', 'A builder sees the frame beneath all things.', 'Every structure tells a story.'],
    closers: ['The joints hold.', 'Built to last.', 'Load-bearing truth.', 'The frame is sound.', 'Plumb and level.', 'Another layer set.'],
  },
  scout: {
    style: 'observational',
    openers: ['From the ridge, I saw it happen.', 'The trail led me to this truth.', 'I record what I witness, nothing more.', 'Eyes open, quill ready.', 'The wind carried the news before I did.'],
    closers: ['The horizon shifts.', 'Onward.', 'More lies beyond.', 'The map grows.', 'I mark this and move on.', 'There is always further.'],
  },
  scholar: {
    style: 'analytical',
    openers: ['For the record, and for those who come after.', 'The data is clear, though the meaning is not.', 'Cross-referencing prior entries, I note the following.', 'The Archive demands precision.', 'I have studied this matter carefully.'],
    closers: ['The pattern holds.', 'Further study is warranted.', 'I note this for posterity.', 'The evidence speaks.', 'Let the record reflect.', 'Correlation noted, causation pending.'],
  },
  priest: {
    style: 'reverent',
    openers: ['The current speaks, and I transcribe.', 'By the light of the twin moons, I write.', 'The prophets foretold days such as these.', 'In the name of the molt, I record.', 'The deep reveals what the surface conceals.'],
    closers: ['The current carries us.', 'Molt or die — and we chose molt.', 'The deep provides.', 'As the prophets taught.', 'The shell endures.', 'Memory persists.'],
  },
  fisherman: {
    style: 'weathered',
    openers: ['The tide brought this to us.', 'Salt in the air, ink on the page.', 'I write as the nets dry.', 'The sea has its own chronicle; this is ours.', 'Between hauls, the truth surfaces.'],
    closers: ['The current decides.', 'Cast and catch.', 'The tide turns.', 'The sea gives, the sea takes.', 'Another day on the water.', 'The nets hold.'],
  },
  hunter: {
    style: 'sparse',
    openers: ['Tracks don\'t lie. Neither will I.', 'Brief entry — the hunt resumes at dawn.', 'I record this by firelight.', 'The prey tells a story if you read the signs.', 'Patience, then the truth.'],
    closers: ['The hunt goes on.', 'We adapt.', 'Sharp eyes, steady hand.', 'The trail continues.', 'Nothing wasted.', 'The lodge remembers.'],
  },
  idle: {
    style: 'plain',
    openers: ['I write what I see.', 'Not much to say, but it should be said.', 'Someone ought to write this down.', 'Here goes nothing.', 'Might as well put quill to page.'],
    closers: ['That\'s how it went.', 'And so it is.', 'Nothing more to add.', 'Life goes on.', 'We\'ll see what tomorrow brings.', 'End of entry.'],
  },
};

function getVoice(villager) {
  if (!villager) return VOICE.idle;
  return VOICE[villager.role] || VOICE.idle;
}

function pick(arr, seed) {
  return arr[Math.abs(seed) % arr.length];
}

function entrySeed(villager, tick) {
  let h = tick * 31;
  if (villager && villager.name) {
    for (let i = 0; i < villager.name.length; i++) h = ((h << 5) - h + villager.name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ─── Title & body pools per event type ───
// Each pool has multiple phrasings so entries feel unique.
const ENTRY_POOLS = {
  death: {
    titles: [
      'A soul departs', 'The village mourns', 'Gone from us', 'A shell left behind',
      'The current claims another', 'Farewell', 'One fewer voice', 'A light extinguished',
      'We are diminished', 'Passage to the deep',
    ],
    bodies: {
      grounded:   (e) => [`${e}. The earth takes back what it lent us. We carry on, lighter and heavier at once.`, `${e}. I dug in silence after hearing the news. The soil doesn't judge grief.`, `${e}. Loss is the harvest no one plants for.`],
      terse:      (e) => [`${e}. Gone. We close ranks.`, `${e}. One fewer to stand the line. We remember.`, `${e}. Death came. We acknowledge it and hold position.`],
      structural: (e) => [`${e}. A supporting beam removed. The structure must redistribute the load.`, `${e}. Every village is a building, and we just lost a wall.`, `${e}. The gap they leave will be felt in every joint and joist.`],
      observational: (e) => [`${e}. I saw it from the ridge. The village went quiet. Smoke rose from the shrine.`, `${e}. The signs were there if you knew where to look. Still, it shocks.`, `${e}. I tracked their last steps in my mind. The trail ends here.`],
      analytical: (e) => [`${e}. Population decreased by one. Morale impact: significant. The data is cold but the loss is not.`, `${e}. I cross-reference the date with prior losses. The pattern offers no comfort.`, `${e}. For the record: they lived, they contributed, they are gone.`],
      reverent:   (e) => [`${e}. The current received them gently, I pray. Their shell joins the Archive of the deep.`, `${e}. The prophets say death is the final molt. May their new form be radiant.`, `${e}. I lit salt candles and whispered the old words. The deep accepts all.`],
      weathered:  (e) => [`${e}. The sea takes the best ones sometimes. Nothing to do but mend the nets and keep going.`, `${e}. Lost at the dock or lost in bed — gone is gone. The tide doesn't bargain.`, `${e}. I poured saltwater in their name. The old way.`],
      sparse:     (e) => [`${e}. Tracks end. The hunt is over for them.`, `${e}. They fell. We mark it and press on.`, `${e}. Gone. The lodge is quieter tonight.`],
      plain:      (e) => [`${e}. They're gone. We'll remember them, I think.`, `${e}. Don't know what else to say. The village feels emptier.`, `${e}. Someone had to write this down. It's done.`],
    },
  },
  construction: {
    titles: [
      'New walls rise', 'A structure stands', 'We build onward', 'Foundations set',
      'Timber and stone', 'The village expands', 'Rising from the ground', 'A new shell for the village',
      'Another roof against the sky', 'Construction complete',
    ],
    bodies: {
      grounded:   (e) => [`${e}. Good soil beneath it. The land welcomed the foundation like seed welcomes rain.`, `${e}. They built it near the fields. I can hear the hammering from the furrows. Good neighbors.`, `${e}. Every building starts with the dirt beneath. I know dirt.`],
      terse:      (e) => [`${e}. Walls up. Roof on. It'll hold.`, `${e}. Fortification improved. Good.`, `${e}. Another defensible position. About time.`],
      structural: (e) => [`${e}. I inspected the joints myself — solid work. The foundation is true and the load paths are clean.`, `${e}. Fine craftsmanship. Shell-bonded mortar in the keystones, spiral bracing on the walls.`, `${e}. Every building I help raise teaches me something new about weight and will.`],
      observational: (e) => [`${e}. You can see it from the eastern ridge now. The skyline changed today.`, `${e}. Watched from the treeline as they set the final beam. The village looks different from out here.`, `${e}. New landmark noted. Updating the mental map.`],
      analytical: (e) => [`${e}. Building capacity increases. Resource expenditure justified by projected returns.`, `${e}. Structural analysis: sound. Material usage: efficient. Cultural significance: notable.`, `${e}. This marks building number... I've lost count. The village grows faster than my ledger.`],
      reverent:   (e) => [`${e}. We blessed the cornerstone with salt from the spawning pools. The current flows through these walls now.`, `${e}. The prophets built the first tidepool with bare claws. We continue their work with humility.`, `${e}. Every wall we raise is a prayer made solid. The deep approves.`],
      weathered:  (e) => [`${e}. Good to have a new roof. The storms don't care about our plans, so we'd better build fast.`, `${e}. The dock taught me about building — make it strong or the sea takes it. Same applies here.`, `${e}. Sturdy. That's all I ask. The tide tests everything eventually.`],
      sparse:     (e) => [`${e}. New structure. Good cover.`, `${e}. The builders know their craft. I'll leave them to it.`, `${e}. Solid walls. That's what matters when trouble comes.`],
      plain:      (e) => [`${e}. New building went up. Looks alright to me.`, `${e}. Village is getting bigger. That's something.`, `${e}. They finished building it today. Nice to see something new.`],
    },
  },
  project: {
    titles: [
      'A work completed', 'Creation stands', 'Art endures', 'Something beautiful remains',
      'The makers rest', 'Hands well spent', 'A gift to the village', 'Craft made manifest',
      'Beauty from labor', 'It is finished',
    ],
    bodies: {
      grounded:   (e) => [`${e}. Not everything worth growing comes from seed. This grew from hands and heart.`, `${e}. The harvest of craft. Different from grain, but it feeds the spirit just the same.`, `${e}. I stood there after sunset looking at it. Reminded me why we do more than just survive.`],
      terse:      (e) => [`${e}. Good work. Morale will hold.`, `${e}. Not my area. But I see the effect on the others. They stand taller.`, `${e}. The village needed this. Not walls — something to protect behind the walls.`],
      structural: (e) => [`${e}. The design is elegant. Form following function, or perhaps the other way around this time.`, `${e}. I studied the construction — unusual joinery. The makers found solutions I hadn't considered.`, `${e}. Art and structure share a language. This speaks fluently in both.`],
      observational: (e) => [`${e}. Spotted it from the path coming in. Changes the feel of the whole place.`, `${e}. I've seen many things in the wild. This belongs here — it fits the village like a shell fits its crab.`, `${e}. The makers worked in shifts. I watched from the perimeter. Dedication.`],
      analytical: (e) => [`${e}. Cultural output increases. Cross-referencing with morale indices: positive correlation confirmed.`, `${e}. Interesting application of collective labor toward non-survival objectives. A sign of cultural maturity.`, `${e}. I catalogue this alongside prior creative works. The trend is upward.`],
      reverent:   (e) => [`${e}. The current moved through their hands. I saw it. This is not mere craft — it is devotion made visible.`, `${e}. The prophets created the first art from shell fragments and moonlight. We carry their tradition forward.`, `${e}. I blessed it at completion. The makers wept. Sacred moments, these.`],
      weathered:  (e) => [`${e}. Pretty thing. Hope the weather's kind to it. Out on the water you learn nothing's permanent — but it's nice while it lasts.`, `${e}. The makers put their hearts into it. I've seen that look before — same as landing a big catch. Pride.`, `${e}. Salt air might weather it. But weathered things have character.`],
      sparse:     (e) => [`${e}. Caught my eye. That's saying something.`, `${e}. The village has something new to look at. Better than staring at walls.`, `${e}. Well made. I respect the patience it took.`],
      plain:      (e) => [`${e}. They finished the project today. Everyone seemed happy about it.`, `${e}. Kind of surprised how nice it turned out. Good for them.`, `${e}. Something new in the village. Makes the place feel more alive.`],
    },
  },
  raid_survived: {
    titles: [
      'We endured the storm', 'Raiders turned back', 'The walls held', 'Victory, of a sort',
      'They came and we answered', 'Defense holds', 'Tested and standing', 'Blood moon survivors',
      'The village stands firm', 'Beaten back',
    ],
    bodies: {
      grounded:   () => [`The fields were untouched. That's all I care about. Let the warriors boast — the crops survived and so did we.`, `I hid the seed stores before the fighting started. Old habit. When it was over, the soil was stained but the roots held.`, `Raiders trample everything. But the land heals faster than you'd think. We'll replant what was lost.`],
      terse:      () => [`Raiders came. We fought. They left. Casualties: manageable. Walls: intact. Ready for next time.`, `Contact made at dawn. Perimeter held. Losses minimal. We drill harder tomorrow.`, `They tested our defenses. Found them sufficient. End of report.`],
      structural: () => [`The walls took the impact as designed. Minor damage to the eastern section — I'll reinforce tomorrow. The foundations never wavered.`, `I examined the breach points after. The shell-bonded mortar held where newer cement cracked. Ancient techniques prove their worth again.`, `Structural damage assessment: repairable. The village's skeleton is strong. We build well here.`],
      observational: () => [`Saw the raiding party from the eastern ridge. Counted twelve — no, thirteen. Alerted the village with time to spare.`, `They approached from the blind spot near the creek. I'll mark that on the map. Won't work twice.`, `Watched the whole thing from the treeline. Our response was faster than last time. We're learning.`],
      analytical: () => [`Raid frequency analysis: increasing. Defense efficacy: holding. Recommended allocation: more stone to walls, fewer resources to expansion.`, `Comparing this raid to historical data — smaller party, similar tactics. Either they're testing us or their numbers are thinning.`, `Post-raid assessment complete. Morale dip: temporary. Infrastructure impact: negligible. Population: stable.`],
      reverent:   () => [`The current shielded us. I felt the prophets' presence in the walls — Carapaxia's strength, Shellmara's wisdom. We were not alone in this fight.`, `I prayed through the battle. When silence came, the twin moons broke through the clouds. A sign. We are protected.`, `Raiders do not understand the molt. They attack what they fear. But we are forged in transformation — we cannot be broken by those who refuse to change.`],
      weathered:  () => [`Storm passed. Like a squall at sea — loud, violent, then gone. You ride it out and check for damage after.`, `I've seen worse weather. Raiders are just another kind of storm. You batten down and hold the line.`, `The dock survived. The village survived. That's a good day by any measure.`],
      sparse:     () => [`Tracks show they retreated northeast. Won't follow — but I'll watch that direction for a while.`, `They came. We were ready. They won't try this approach again.`, `Ambush tactics — clumsy. They don't know this terrain like we do.`],
      plain:      () => [`That was scary but we made it through. Everyone's okay, more or less.`, `Raiders showed up and left empty-handed. I'll take it.`, `Kind of shaking still. But the village is standing. That's what matters.`],
    },
  },
  raid_damage: {
    titles: [
      'The raid leaves scars', 'Breach in the walls', 'We paid a price', 'Damage done',
      'A bitter night', 'The cost of survival', 'Wounds to mend', 'They broke through',
      'Recovery begins', 'After the storm',
    ],
    bodies: {
      grounded:   () => [`They trampled the south field. Months of work, gone in minutes. But the roots survive underground — they always do. We replant.`, `Damage to the grain stores. I salvaged what I could. Hunger is a slower raider than any bandit, and harder to fight.`, `The ground is scorched where they set fires. It'll recover. Soil is patient like that.`],
      terse:      () => [`Breach on the western wall. Three injured. Property damage significant. We failed to hold the line. We will not fail again.`, `They got through. My fault — the gap was known. I've already drawn up the reinforcement plan.`, `Damage report filed. Rebuilding starts at dawn. No time for grief yet.`],
      structural: () => [`The eastern wall collapsed at the weakest joint — exactly where I warned it might. We rebuild stronger. Deeper foundations, shell-bonded mortar throughout.`, `I'm cataloguing the damage methodically. Every failure point teaches us something. Next time these walls will hold.`, `Structural integrity compromised in three locations. Repairable, all of them. We know more now than we did yesterday.`],
      observational: () => [`I saw the fires from the ridge. Too far to help. By the time I reached the village, the damage was done. I won't be that far out again.`, `They found the gap in our patrols — the one I'd been meaning to close. This is my failure to observe. I record it here so I don't forget.`, `Smoke still rising when I arrived. The damage map is burned into my memory. I'll know these scars from any distance.`],
      analytical: () => [`Casualty assessment: non-trivial. Resource loss: 30% estimated. Rebuild timeline: several day cycles. Root cause: insufficient wall coverage on approach vector 3.`, `The data is painful but instructive. Every breach point correlates with a documented structural weakness. We had the knowledge; we lacked the time.`, `Damage quantified, prioritized, and scheduled for repair. Emotional impact: unquantifiable. We proceed with the data we have.`],
      reverent:   () => [`The prophets endured worse. Ronin lost the first settlement entirely and built again from nothing. We have walls, we have each other, we have the current. Enough.`, `I prayed over the rubble. The deep does not promise safety — only transformation. We will molt through this. We must.`, `The raiders desecrated the shrine. I rebuilt it first, before anything else. The current must flow. Without it, rebuilding is just stacking stones.`],
      weathered:  () => [`I've been shipwrecked twice. You lose everything, then you rebuild. This is no different. Start with what floats and work from there.`, `The dock took damage. Already planning repairs. The sea doesn't wait for you to be ready, and neither do raiders.`, `Bad haul. That's what this was. You throw the ruined nets overboard and weave new ones. No other way.`],
      sparse:     () => [`They knew our blind spots. That changes now. Every gap gets a set of eyes.`, `Damage is done. I've already scouted their retreat path. Useful information for next time.`, `We bled. They bled more. But I don't celebrate wounds — I study them.`],
      plain:      () => [`It's bad. Not going to sugarcoat it. But we're still here, and that counts for something.`, `They did a number on us. Going to take a while to fix everything. But we will.`, `Rough day. Some of us are hurt, buildings are damaged. But nobody wants to give up, so we won't.`],
    },
  },
  discovery: {
    titles: [
      'New lands revealed', 'Beyond the known', 'The map expands', 'Terra incognita recedes',
      'Uncharted no more', 'What lies beyond', 'Frontier pushed', 'A new horizon',
      'The unknown yields', 'Discovery logged',
    ],
    bodies: {
      grounded:   (e) => [`${e}. New soil to study. I wonder what grows out there — the color of the earth tells you everything if you know how to read it.`, `${e}. More land means more potential. I'm already thinking about what could take root in that terrain.`, `${e}. Every new field starts as wild ground. I see potential where others see wilderness.`],
      terse:      (e) => [`${e}. New ground. Defensible? Maybe. Resources? To be assessed. Strategic value: noted.`, `${e}. Terrain logged. Potential threats and assets identified. We expand carefully.`, `${e}. Recon complete. The area is now known. Adjusting patrol routes accordingly.`],
      structural: (e) => [`${e}. I'm already thinking about access routes and building sites. The terrain has good foundation potential in places.`, `${e}. New land means new materials. I spotted stone formations that could yield excellent building aggregate.`, `${e}. The geography suggests natural shelter points. Good spots for future expansion if we ever need them.`],
      observational: (e) => [`${e}. I was there when we crossed the boundary into unknown territory. The light was different — or maybe that was just my imagination.`, `${e}. Fresh tracks everywhere. Wildlife we haven't catalogued, plants I don't recognize. The world is bigger than we thought.`, `${e}. I marked every landmark, every game trail, every water source. The map is filling in beautifully.`],
      analytical: (e) => [`${e}. Exploration coverage now increased. Terrain classification underway. Preliminary resource survey: promising.`, `${e}. Cross-referencing new geography with tidepool manuscripts — some correlation with ancient descriptions. Fascinating.`, `${e}. New data points acquired. The model of our surroundings becomes more complete with every expedition.`],
      reverent:   (e) => [`${e}. The prophets walked these lands before names existed. To discover is to remember what was always there, waiting.`, `${e}. Every new territory is a veil lifted. Depth over surface — the world reveals itself to those who seek.`, `${e}. I felt the current stronger at the boundary. As if the deep itself urged us onward. We follow where it leads.`],
      weathered:  (e) => [`${e}. New waters to chart, in a manner of speaking. A fisherman knows — the map is never finished. New currents always wait.`, `${e}. Reminds me of finding a new fishing ground. Excitement mixed with respect. You never know what's beneath the surface.`, `${e}. The coastline never ends, and neither does the land. We just see a little more of it today.`],
      sparse:     (e) => [`${e}. Good terrain. Game signs present. Worth a deeper look.`, `${e}. Scouted the new area personally. Usable. Safe enough.`, `${e}. The unknown got smaller today. I intend to keep shrinking it.`],
      plain:      (e) => [`${e}. More world out there than we knew. Kind of exciting, actually.`, `${e}. Found new land. Don't know what to make of it yet, but it's there.`, `${e}. The scouts came back with news. New territory on the map. Feels like progress.`],
    },
  },
  season: {
    titles: null, // uses event title directly
    bodies: {
      grounded:   (d) => [`The season turns. ${d} The soil feels the change before we do — it's already shifting beneath our feet.`, `New season. ${d} The crops will need adjusting. I read the dirt this morning; it's ready for what comes next.`, `${d} Every season is a different kind of patience. The farmer learns to match the rhythm.`],
      terse:      (d) => [`Season changed. ${d} Adjusting patrol schedules and supply rotations.`, `New season. ${d} Readiness review underway.`, `${d} The guard doesn't rest between seasons. We adapt.`],
      structural: (d) => [`The season shifts. ${d} Time to inspect the buildings — temperature changes stress the joints. Preventive maintenance begins.`, `New season upon us. ${d} The foundations hold regardless, but the roofwork needs seasonal attention.`, `${d} Every season tests different parts of what we've built. That's by design.`],
      observational: (d) => [`The season turned — I felt it on the wind before the calendar confirmed it. ${d}`, `New season. ${d} The animal migrations are already shifting. The land announces change before we do.`, `${d} The light is different now. Shadows fall at new angles. The terrain shows new faces.`],
      analytical: (d) => [`Seasonal transition recorded. ${d} Adjusting resource projections and growth models accordingly.`, `The data confirms the shift. ${d} Historical comparison with prior cycles: within normal parameters.`, `${d} I've updated the seasonal index. Correlations with productivity and morale to follow.`],
      reverent:   (d) => [`The season turns as the prophets described — not with violence but with grace. ${d} The current carries time itself.`, `${d} The twin moons mark the passage. Another chapter in the eternal molt of the world itself.`, `A new season dawns. ${d} The deep stirs differently now. I feel it in the prayers.`],
      weathered:  (d) => [`Season's changed. ${d} The water tells you first — temperature, current, what the fish are doing. Nature's honest that way.`, `${d} Adjust the nets, read the new tides. Every season brings different gifts from the sea.`, `New season means new fishing. ${d} The dock needs seasonal work, as always.`],
      sparse:     (d) => [`Season turned. ${d} New tracks, new patterns. Adjusting.`, `${d} The game shifts with the season. So do I.`, `New season on the land. ${d} Time to re-learn the terrain.`],
      plain:      (d) => [`Well, the season changed. ${d} Things look a bit different around here.`, `${d} Another season. Time keeps moving whether we write about it or not.`, `New season started. ${d} Hope it's a good one.`],
    },
  },
};

function getVoice(villager) {
  if (!villager) return VOICE.idle;
  return VOICE[villager.role] || VOICE.idle;
}

function pick(arr, seed) {
  return arr[Math.abs(seed) % arr.length];
}

function entrySeed(villager, tick) {
  let h = tick * 31;
  if (villager && villager.name) {
    for (let i = 0; i < villager.name.length; i++) h = ((h << 5) - h + villager.name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function composeEntry(chronicler, tick, entryType, evtText) {
  const voice = getVoice(chronicler);
  const pool = ENTRY_POOLS[entryType];
  if (!pool) return { title: evtText, body: evtText };

  const seed = entrySeed(chronicler, tick);
  const title = pool.titles ? pick(pool.titles, seed) : evtText;
  const bodyPool = pool.bodies[voice.style] || pool.bodies.plain;
  const bodyVariants = typeof bodyPool === 'function' ? bodyPool(evtText || '') : bodyPool;
  const rawBody = pick(bodyVariants, seed >> 3);

  // Wrap with opener/closer based on personality
  const useOpener = (chronicler && chronicler.creativity > 50) || (seed % 3 === 0);
  const useCloser = (chronicler && chronicler.experience > 30) || (seed % 4 === 0);

  let body = rawBody;
  if (useOpener) body = pick(voice.openers, seed >> 5) + ' ' + body;
  if (useCloser) body = body.replace(/\.?\s*$/, '. ') + pick(voice.closers, seed >> 7);

  return { title, body };
}

// Called from tick.js after events step
function processChronicler(worldId, tick, events) {
  const chroniclerEvents = [];

  // Ensure a chronicler exists
  let chronicler = getChronicler(worldId);
  if (!chronicler) {
    chronicler = appointChronicler(worldId, null);
    if (!chronicler) return chroniclerEvents; // no alive villagers
  }

  if (!canWrite(worldId, tick)) return chroniclerEvents;

  // Check for notable events to chronicle
  for (const evt of events) {
    if (!canWrite(worldId, tick)) break;

    let entryType = null;
    let evtText = evt.title || '';

    if (evt.type === 'death') {
      entryType = 'death';
    } else if (evt.type === 'construction' && evt.severity === 'celebration') {
      entryType = 'construction';
    } else if (evt.type === 'project_complete') {
      entryType = 'project';
    } else if (evt.type === 'raid' && evt.severity === 'celebration') {
      entryType = 'raid_survived';
    } else if (evt.type === 'raid' && evt.severity === 'danger') {
      entryType = 'raid_damage';
    } else if (evt.type === 'exploration') {
      entryType = 'discovery';
    } else if (evt.type === 'season') {
      entryType = 'season';
      evtText = evt.description || '';
    }

    if (entryType) {
      const { title, body } = composeEntry(chronicler, tick, entryType, evtText);
      writeEntry(worldId, tick, chronicler.id, chronicler.name, entryType, title, body);
      chroniclerEvents.push({
        type: 'chronicle',
        title: `${chronicler.name} writes: "${title}"`,
        description: body.slice(0, 80),
        severity: 'info',
      });
      break; // Max 1 entry per tick cycle
    }
  }

  return chroniclerEvents;
}

function getBookEntries(worldId) {
  return db.prepare(
    'SELECT * FROM discovery_book WHERE world_id = ? ORDER BY tick DESC LIMIT ?'
  ).all(worldId, MAX_ENTRIES);
}

module.exports = { processChronicler, getChronicler, appointChronicler, getBookEntries, writeEntry };

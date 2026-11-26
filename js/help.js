// ══════════════════════════════════════════════════════════════════════════
//  Help — the "❓ Help" page (profile menu, More sheet on phones).
//
//  Short topics in the community modal, each with a button that opens the
//  screen it talks about when that screen exists. Keep the numbers in step
//  with the server: upkeep (famine.js), careers (career_math), trust
//  (npc_trade), outposts (outposts_config), tavern pay (tavern_pay).
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const link = (fn, ...args) => `KWHelp.go('${fn}'${args.map(a => `,'${a}'`).join('')})`;   // a button's onclick
  const TOPICS = [
    { id: 'start', icon: '🌱', title: 'Getting started', body: `
      <p>Your settlement grows on its own while you're away. Every hour it gathers food, timber, stone, iron and wealth — the numbers along the top, with the hourly rate beside each.</p>
      <ul><li><b>Build</b> from the Settlement panel. Each building adds production or opens something new.</li>
      <li><b>Give citizens jobs</b> in the Citizens tab. A worker at the right building makes far more than an idle one.</li>
      <li><b>Explore</b> the map: scout nearby tiles, found outposts, meet the villages around you.</li></ul>
      <p>Click any number in the top bar to see exactly where it comes from.</p>`,
      open: [['📊 Where my food comes from', link('openResourceModal', 'food')]] },
    { id: 'food', icon: '🍽', title: 'Food and starvation', body: `
      <p>Every adult citizen eats about <b>1 food an hour</b> (children and elders less; more in winter), and each outpost eats 1 an hour per level.</p>
      <p>When the stores start running low a banner appears over the map: <b>Stores dwindling</b>, then <b>Food critical</b>. If they run out — <b>Famine</b> — citizens go hungry, then start to starve and lose health.</p>
      <p>Fix it with farmers and fishers, a bigger Farm or Granary, outposts on plains, or by buying food at the Market.</p>`,
      open: [['🍞 Food breakdown', link('openResourceModal', 'food')]] },
    { id: 'careers', icon: '👥', title: 'Citizens and careers', body: `
      <p>Each job is a career with its own levels, from 1 to 20. Citizens gain experience by working, and each level makes them better at it.</p>
      <p>At <b>level 10</b> they choose a specialisation — a fork in their skill tree. Some talents only show themselves once a citizen has worked a while.</p>
      <p>Open a citizen and look at their Career tab to see their tree and what's next.</p>` },
    { id: 'families', icon: '👪', title: 'Families and the turning years', body: `
      <p>A year passes every <b>28 hours</b>. Children (0–6) play; <b>youths</b> (7–11) learn a trade, faster with a mentor of that trade, and help a little with the work. At <b>12</b> they come of age in their trade. <b>Elders</b> (60+) still work, at part strength, and cheer their household.</p>
      <p>Couples have children while there is a <b>free bed in town</b>: build Willow Huts (each holds 4). Partners must not be close kin, both must be 14–55, and a couple has at most four children, two years apart.</p>
      <p>From 70 each birthday brings a chance of a peaceful death. Their gear becomes <b>heirlooms</b>, which work a little better in the family, and an heir takes up their things: choose one, or the eldest grown child inherits after a day. The oldest adult heads each family.</p>
      <p>When beds are free, a <b>settler</b> arrives every week, sooner if your town is short of working hands, and starts a new family. The <b>Families</b> window (👪 in the Citizens list) shows each line, its tree and its chronicle.</p>` },
    { id: 'tiers', icon: '🏘', title: 'Buildings and settlement tiers', body: `
      <p>Your settlement grows from <b>Camp</b> to <b>Village</b>, <b>Town</b> and <b>City</b>. Each step needs resources, citizens and buildings, and opens new buildings, higher building levels, more housing and more outposts.</p>
      <p>Higher building levels also need metals — bronze, steel or silver — so the Smelter matters later on.</p>`,
      open: [['🏘 Next tier', link('openTierUpgradeModal')]] },
    { id: 'research', icon: '📚', title: 'Research', body: `
      <p>Build a <b>Library</b> and seat Scholars there. They earn research points every hour, which go into the project you're studying.</p>
      <p>Queue several projects and they run one after another. Distant projects show as <b>??</b> until your scholars study what leads to them.</p>
      <p>Research makes more ore, cheaper buildings, faster crafting — and unlocks new metals.</p>`,
      open: [['📚 Open the Library', link('openLibrary')]] },
    { id: 'crafting', icon: '⚒', title: 'Crafting and the Smelter', body: `
      <p>The <b>Smithy</b>, <b>Workshop</b> and <b>Jeweller</b> turn materials into tools, weapons, armour and trinkets. Better craftsmen make better-quality pieces.</p>
      <p>The <b>Smelter</b> turns ores into metals: copper and tin into bronze, iron and coal into steel (once your Library learns how).</p>
      <p>Open a workshop from its building in the Settlement panel. Gear your citizens wear helps them in quests and battles.</p>` },
    { id: 'market', icon: '⚖', title: 'The Market and village trade', body: `
      <p>With a <b>Market</b> you can sell to and buy from other players, post Wanted orders, and trade with villages you're on good terms with.</p>
      <p>Villages trade once you're <b>Familiar</b> (trust 21+); better trust means bigger orders and better prices. Now and then a village posts a special request that pays well and earns extra trust — you'll get a 📣 notice.</p>
      <p>Porters carry goods there and back, so trades take a little time.</p>`,
      open: [['⚖ Open the Market', link('openMarket')]] },
    { id: 'outposts', icon: '⛺', title: 'Outposts and exploring', body: `
      <p>Found an <b>outpost</b> on a nearby tile to gather what that land offers: food on plains, timber in forests, stone and ores in hills, iron and rare finds in mountains.</p>
      <p>Your tier decides how many outposts you can run and how far away. Outposts can be upgraded to level 3 for more yield — each level eats a little more food.</p>
      <p>Post a <b>worker</b> at an outpost for +25% yield — +50% if their trade suits the land (a Miner in the hills, a Woodcutter in the forest). While posted they don't work in town. If the stores can't feed your outposts, they work at <b>half pace</b> until there is food again. Dismantling one gives back about half of what it cost, and its crew carry its store home.</p>
      <p>An outpost sends most of what it makes <b>home by itself</b>: a carter brings 60% (80% along a track, all of it on a paved road), so an outpost you never visit still pays its way. The rest waits in the outpost's <b>own store</b> — 300 of each resource per level. To collect that, <b>Send a porter</b> for one trip. A trip takes about 10 minutes per tile each way; a porter carries 20 weight (more with a Market, and with Porter perks). Raiders who strike an outpost loot its store.</p>
      <p>The <b>⛺ Outposts</b> tab beside Citizens shows every outpost, its store and who is on the road. <b>🏕️ Manage</b> opens the outpost's own window.</p>
      <p><b>Buildings:</b> an outpost has building plots — two at level 1, one more per level. A Bunkhouse (one more worker) or Watchfire (+8 defence) suit any land; each land has its own too, such as a Sawpit in the forest or a Smokehouse on the river. They're paid from the town's stores and take an hour or two to go up.</p>
      <p>Workers and guards <b>walk</b> out to a new post and only start once they arrive; brought home, they walk back. You can watch them on the map.</p>
      <p><b>Roads:</b> lay a <b>Track</b> to an outpost (trips 25% faster), then pave it (50%). Cost and time go by the distance. Roads show on the map.</p>
      <p><b>Happenings:</b> now and then something turns up at an outpost — a rich vein, a trader, wolves, a lost traveller, a storm. Choose what to do within 12 hours, or the crew decide for themselves.</p>
      <p><b>Clans:</b> on your clan's land an outpost's store is a quarter bigger, and you can raise a <b>Signal Tower</b> that shares its defence with clanmates further off. Tap a clanmate's outpost to send a porter to <b>help carry</b> its goods home to them. Clans can buy the <b>Outpost Network</b> boon (carters bring 10% more home), and some weekly goals ask members to carry goods home (what carters bring counts too).</p>
      <p>Scouting reveals the map around you; long expeditions sometimes bring back ore samples.</p>` },
    { id: 'expeditions', icon: '🗺', title: 'Scouts and expeditions', body: `
      <p>Build a <b>Scout Post</b> and give a citizen the <b>Scout</b> job. Then tap a tile under the fog and <b>Dispatch Scout</b>: they walk there and reveal the land around it when they arrive. Fog is slower to cross than land you know; a bigger Scout Post and a skilled scout are faster.</p>
      <p>Long trips sometimes bring back an <b>ore sample</b> or a <b>schematic</b>.</p>
      <p>Changed your mind? Open <b>🧭 Journeys</b> (or tap the "scouts out" badge) and <b>Recall</b>: the scout turns round and walks home as long as they have been out — nothing new is revealed.</p>`,
      open: [['🧭 Journeys', link('KWJourneys.open')]] },
    { id: 'travel', icon: '🧭', title: 'Journeys and travel', body: `
      <p>Everyone who leaves town walks the map: scouts, envoys, porters and merchants, quest parties and clan quests. Their paths show on the map (🐾 Paths to hide them).</p>
      <p><b>🧭 Journeys</b> (settlement panel, or More on a phone) lists everyone away with the time left and <b>Show on map</b>, who is posted at your outposts, and what nearby villages are asking for.</p>`,
      open: [['🧭 Journeys', link('KWJourneys.open')]] },
    { id: 'stores', icon: '⛏', title: 'Stores: ores, rare finds and alloys', body: `
      <p>Food, timber, stone, iron and wealth sit in the top bar. Everything else — copper, tin, coal, silver, gems, bronze, steel… — is in <b>⛏ Stores</b> once you have found it.</p>
      <p>Undiscovered resources show as <b>??</b>. Mines, hill and mountain outposts and scouts turn up ores; the rarer ones need research first. The Smelter turns ores into alloys.</p>
      <p>Tap any resource for where it comes from and where it goes.</p>` },
    { id: 'wonders', icon: '🏛', title: 'Festivals, Wonders and upkeep', body: `
      <p>Any town can hold a <b>festival</b>: it costs wealth and food, and for 24 hours brings +10 happiness and +10% production. After one, the town needs 72 hours (from the start) before the next.</p>
      <p>A <b>City</b> whose scholars have learned how to raise great works can build <b>Wonders</b> — five great works, each built in three stages, needing metals and rare materials (the last stage an Ancient Blueprint). A finished wonder gives a permanent bonus.</p>
      <p>Grandeur costs upkeep: each finished wonder, and each City building level above 3, takes wealth every hour. If the treasury runs dry, wonders lie dormant and happiness drops until wealth returns.</p>`,
      open: [['🎉 Festivals', link('KWTown.open', 'festival')], ['🏛 Wonders', link('KWTown.open', 'wonders')]] },
    { id: 'clans', icon: '🛡', title: 'Clans', body: `
      <p>Build a <b>Guild Hall</b> (a Town building) to found or join a clan. Clans share a hall, a forum and chat, take on clan quests together and earn prestige for the clan rankings.</p>
      <p>Members can give wealth to the clan <b>treasury</b> (up to 2,000 a day, earning prestige). Officers and above spend it on week-long <b>boons</b> for everyone: more food, faster crafting, quicker research, lower Market fees, or an Iron Wall against raids. Clan land pays the treasury every day, and members' outposts on it work harder and are harder to raid.</p>
      <p>Each week brings three clan <b>goals</b> — quests, battles, crafting, gifts, raids repelled. Meeting one pays prestige and treasury; a clan also earns <b>honors</b> for goals, land, levels and Wonders, shown on its profile.</p>`,
      open: [['🛡 Clan', link('openClanPanel')]] },
    { id: 'quests', icon: '📜', title: 'Quests and the Watchtower', body: `
      <p>The tavern's <b>notice board</b> shows a fresh set of quests every day (it turns over at midnight UTC). Some quests only appear at night or under a full moon — take them while you can.</p>
      <p>A solo quest can be <b>abandoned</b> while it's under way, as long as no battle has started; the citizen comes home empty-handed.</p>
      <p>A <b>Watchtower</b> (Village) gives Guards and Archers a post: each one on watch cheers the town (+1 happiness, up to +5) and adds to its defence.</p>`,
      open: [['📜 Notice board', link('openNoticeboard')]] },
    { id: 'battles', icon: '⚔', title: 'Battles', body: `
      <p>Quests can lead to a fight. The creatures you meet belong to the land — marsh things in the marsh, ogres in the hills — and some only come out at night. Many have tricks: poison, stuns, shrieks that weaken, healers that patch up their kin.</p>
      <p>A fight is played on a small <b>board</b>: each of your citizens walks, then acts, then chooses which way to face. A blow from the side lands harder and one from behind harder still, and high ground helps. Win and what the foes carried goes straight into your stores, and your fighters gain experience in their class.</p>
      <p>Each citizen fights with the <b>abilities</b> of their class, grouped in a school: <b>Arms</b> for a Guard, <b>Archery</b>, <b>Wild magic</b> for a Wizard, <b>Hearth magic</b> for a Hearthkeeper. They learn more as their class level rises and bring <b>all of it</b> to a battle; anyone else fights as a villager. A citizen who has <b>changed career</b> also brings up to five abilities from the old one, their <b>second school</b>, at three-quarters strength: choose them on the citizen's <b>Abilities</b> tab. An ability a citizen has used about 25 times in battle is <b>mastered</b> (✦): a fifth stronger in their hands, for good. What they <b>carry</b> matters too: a longbow reaches further, a hammer hits harder and slows its wielder, a polearm strikes two tiles away, a dagger doubles a blow from behind, a staff strengthens magic, a shield strengthens a block. The Abilities tab lists what each kind does. You can also leave a quest's fight to be decided for you when you send the party.</p>`,
      open: [['⚔ Battles', link('openBattlesModal')]] },
    { id: 'dungeons', icon: '💀', title: 'Dungeons', body: `
      <p>Dungeons open on the land around every town: a 💀 on the map, ringed in the colour of its <b>skull</b>. Green is for villagers, yellow for novices, orange and red for trained fighters, purple for veterans. Your town's news tells you when word of one arrives, and <b>The Land → Dungeons</b> lists the ones you know.</p>
      <p>Click the skull's tile and send a <b>party of up to four</b> (a dungeon is written for four, so fewer is harder). They <b>walk there</b>, half a minute a tile, and you can call them back on the road. Inside, they walk a path of rooms: fights on the board, a fire to rest by, treasure, and a boss at the end. Wounds carry from one fight to the next, and what they find is carried, not kept, until they come out.</p>
      <p>A run ends one of four ways. <b>Clear it</b> and everything comes home. <b>Turn back</b> between fights and they keep what they have found. <b>Flee</b> a fight and they drop half. <b>Lose</b> a fight and it is all lost. Anyone who went down may come home injured. The party then <b>walks home</b>, and what it carries reaches your stores when it arrives.</p>
      <p>Each dungeon stays for <b>three days</b> and your town goes in <b>once</b>, however it ends. Every town nearby sees the same dungeon. The <b>first town to clear it</b> takes a trophy from its boss home (and a little wealth): it hangs in your <b>trophy hall</b>, at the foot of The Land → Dungeons. There is one trophy for each boss at each skull. Other towns see how many you have, and <b>Rankings → Dungeon Trophies</b> lists who has the most.</p>`,
      open: [['💀 Dungeons', link('KWDungeon.listOpen')]] },
    { id: 'raids', icon: '🔥', title: 'Villages, trust and raids', body: `
      <p>Trust with a village fades if you never write: after a week without a gift, trade, envoy, quest or tribute it drops a point a day — but never below the band under the best you reached (an old ally can cool to Friendly, no further). The village panel warns you first.</p>
      <p>An <b>Allied</b> village sends a small daily tribute, teaches fighting cards, and its militia helps guard your outposts within 4 tiles.</p>
      <p>The <b>Withered</b> sometimes raid towns whose outposts come within 6 tiles of their land — never Camps or brand-new players, and never twice within two days. A red <b>countdown</b> appears in the top bar and a red trail on the map shows where they'll strike; tap the timer for your defences.</p>
      <p><b>Defend</b> with <b>Walls</b> around your town and a <b>fort</b> at each outpost (Palisade, Stockade, Stone Tower — research in the Building path unlocks them), manned by Guards and Archers. Allied militia, clan boons and clanmates' forts on shared clan land add to it.</p>
      <p>An undefended spot loses <b>15% of each resource</b> (at most 2,000 of each), and an outpost sits idle for 12 hours. The closer your defence comes to their strength, the less they take; strong enough, and they take nothing. Anyone at a raided spot is hurt and sent home.</p>
      <p>Raids set out from <b>Withered camps</b> near their villages (⛺💀 on the map). Burn one with a party of up to four and every town within 6 tiles gets 3 days of peace. When raiders are coming you can also <b>sally out</b> to meet them in battle — win and the raid is broken; lose and they come on angrier. Clanmates can answer a <b>call to arms</b> and send Guards and Archers to hold a spot on clan land.</p>
      <p>You can also pay the Withered <b>tribute</b> for 24 hours of peace — it costs more each time you pay within three days, and double to turn back raiders already on their way.</p>` },
    { id: 'tavern', icon: '🍺', title: 'Tavern games', body: `
      <p>Play <b>Briarwood Court</b> or <b>Squirrel's Stash</b> at the tavern, alone against AI courtiers or with other players.</p>
      <p>A win pays <b>4 wealth</b>, for up to 10 wins a day. Every win counts on the rankings.</p>`,
      open: [['🍺 Visit the tavern', link('visitTavern')]] },
    { id: 'safety', icon: '⚑', title: 'Letters, chat and reporting', body: `
      <p>Send letters from <b>Messages</b>, or from another player's profile. Chat lives in the realm channels and your clan hall.</p>
      <p>If someone is abusive, <b>report</b> it: open the letter and press ⚑ Report, or use Report on a chat message. Moderators see a copy and can remove it and mute the sender. Reports are private.</p>
      <p>You can also <b>block</b> a player so they can't send you letters.</p>
      <p>Found a bug? Tell us with <b>Feedback</b>.</p>`,
      open: [['✉ Letters', link('KWMail.open')], ['🐞 Feedback', link('openFeedback')]] },
  ];

  function html() {
    const available = fnName => typeof resolve(fnName) === 'function';
    return `<div class="help-page">
      <p class="help-intro">New to Kindlewood, or wondering how something works? Pick a topic.</p>
      ${global.KWGuide ? `<p class="help-tour"><button type="button" class="help-open" onclick="KWHelp.replayTour()">🌿 Take the tour again</button> <span class="help-tour-note">${global.KWGuide.view && global.KWGuide.view.elder ? global.KWGuide.view.elder.name : 'Your elder'} walks you through a first day. Nothing is given twice.</span></p>` : ''}
      ${TOPICS.map(t => `<details class="help-topic" id="help-${t.id}">
        <summary><span class="help-icon" aria-hidden="true">${t.icon}</span> ${t.title}</summary>
        <div class="help-body">${t.body}
          ${(t.open || []).filter(([, js]) => available(/KWHelp\.go\('([^']+)'/.exec(js)[1])).map(([label, js]) => `<button type="button" class="help-open" onclick="${js}">${label}</button>`).join('')}
        </div></details>`).join('')}
    </div>`;
  }

  function resolve(name) {
    return String(name).split('.').reduce((o, k) => (o ? o[k] : undefined), global);
  }
  // Close Help, then open the screen a topic points to.
  function go(name, ...args) {
    const fn = resolve(name);
    if (typeof fn !== 'function') return;
    if (typeof global.closeCommunity === 'function') global.closeCommunity();
    const owner = name.includes('.') ? resolve(name.split('.').slice(0, -1).join('.')) : global;
    fn.apply(owner, args);
  }

  function open(topic) {
    const title = document.getElementById('community-title');
    const body = document.getElementById('community-body');
    const modal = document.getElementById('community-modal');
    if (!body || !modal) return;
    if (title) title.textContent = '❓ Help';
    body.innerHTML = html();
    modal.classList.add('open');
    if (topic) modal.classList.add('kw-help-top'); else if (modal.classList.remove) modal.classList.remove('kw-help-top');   // over whatever screen asked
    if (topic) { const d = document.getElementById('help-' + topic); if (d) { d.open = true; try { d.scrollIntoView({ block: 'start' }); } catch (_) { /* old browser */ } } }
  }

  // The guide's tour again (js/guide.js): Help closes, Home opens, and the elder starts over.
  function replayTour() {
    if (typeof global.closeCommunity === 'function') global.closeCommunity();
    if (global.KWPlaces && global.KWPlaces.go) global.KWPlaces.go('home');
    if (global.KWGuide && global.KWGuide.replay) global.KWGuide.replay();
  }

  global.KWHelp = { open, go, replayTour, TOPICS, html };
})(typeof window !== 'undefined' ? window : this);

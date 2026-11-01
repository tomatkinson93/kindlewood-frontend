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
      <p>Post a <b>worker</b> at an outpost for +25% yield — +50% if their trade suits the land (a Miner in the hills, a Woodcutter in the forest). While posted they don't work in town. If the stores can't feed your outposts, they work at <b>half pace</b> until there is food again. Dismantling one gives back about half of what it cost.</p>
      <p>Scouting reveals the map around you; long expeditions sometimes bring back ore samples.</p>` },
    { id: 'wonders', icon: '🏛', title: 'Festivals, Wonders and upkeep', body: `
      <p>Any town can hold a <b>festival</b>: it costs wealth and food, and for 24 hours brings +10 happiness and +10% production. After one, the town needs 72 hours (from the start) before the next.</p>
      <p>A <b>City</b> whose scholars have learned how to raise great works can build <b>Wonders</b> — five great works, each built in three stages, needing metals and rare materials (the last stage an Ancient Blueprint). A finished wonder gives a permanent bonus.</p>
      <p>Grandeur costs upkeep: each finished wonder, and each City building level above 3, takes wealth every hour. If the treasury runs dry, wonders lie dormant and happiness drops until wealth returns.</p>`,
      open: [['🏛 Your town', link('KWTown.open', 'festival')]] },
    { id: 'clans', icon: '🛡', title: 'Clans', body: `
      <p>Build a <b>Guild Hall</b> (a Town building) to found or join a clan. Clans share a hall, a forum and chat, take on clan quests together and earn prestige for the clan rankings.</p>`,
      open: [['🛡 Clan', link('openClanPanel')]] },
    { id: 'quests', icon: '📜', title: 'Quests and the Watchtower', body: `
      <p>The tavern's <b>notice board</b> shows a fresh set of quests every day (it turns over at midnight UTC). Some quests only appear at night or under a full moon — take them while you can.</p>
      <p>A solo quest can be <b>abandoned</b> while it's under way, as long as no battle has started; the citizen comes home empty-handed.</p>
      <p>A <b>Watchtower</b> (Village) gives Guards and Archers a post: each one on watch cheers the town (+1 happiness, up to +5) and adds to its defence.</p>`,
      open: [['📜 Notice board', link('openNoticeboard')]] },
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
    if (topic) { const d = document.getElementById('help-' + topic); if (d) d.open = true; }
  }

  global.KWHelp = { open, go, TOPICS, html };
})(typeof window !== 'undefined' ? window : this);

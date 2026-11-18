import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { JsonStore } = await import('../src/store.js');
const { createAccess } = await import('../src/access.js');
const { createRanking } = await import('../src/ranking.js');

// A tiny fake Roblox: one ODST group.
const ODST = '547482530';
const roles = [
  { displayName: 'Guest', rank: 0, path: 'r0' },
  { displayName: 'Orbital Drop Shock Trooper', rank: 10, path: 'r10' },
  { displayName: 'ODST Lance Corporal', rank: 20, path: 'r20' },
  { displayName: 'ODST Fireteam Leader', rank: 30, path: 'r30' },
  { displayName: 'ODST Executive Officer', rank: 200, path: 'r200' },
  { displayName: 'ODST Commanding Officer', rank: 220, path: 'r220' },
  { displayName: 'Artificial Intelligence', rank: 254, path: 'r254' }
];
const members = new Map([['1', 'r220'], ['2', 'r200'], ['3', 'r10']]);
const fake = {
  async listRoles() { return roles; },
  async getRoles(groupId, userId) {
    if (groupId !== ODST || !members.has(userId)) return [];
    const role = roles.find((r) => r.path === members.get(userId));
    return [{ name: role.displayName, rank: role.rank, path: role.path }];
  },
  async getRank(groupId, userId) { return (await this.getRoles(groupId, userId))[0]?.name || null; },
  async setRank(groupId, userId, name) {
    const before = await this.getRank(groupId, userId);
    members.set(userId, roles.find((r) => r.displayName === name).path);
    return { before, rank: name, changed: true };
  },
  async resolveUser(name) { return { id: name === 'trooper' ? '3' : name === 'xo' ? '2' : '1', name }; },
  async listMembers() { return new Map([...members].map(([id, p]) => [id, roles.find((r) => r.path === p).displayName])); },
  async usernames(ids) { return new Map(ids.map((id) => [id, `user${id}`])); }
};
const sent = [];
const client = { channels: { fetch: async () => ({ send: async (msg) => { sent.push(msg); return msg; } }) } };

function setup() {
  const store = new JsonStore(fs.mkdtempSync(path.join(os.tmpdir(), 'bot-')));
  store.link('d1', { id: '1', name: 'co' });
  store.link('d2', { id: '2', name: 'xo' });
  const access = createAccess({ roblox: fake, store });
  return { store, access, ranking: createRanking({ client, store, roblox: fake, access }) };
}

function interaction(userId, options) {
  const replies = [];
  return {
    user: { id: userId }, replies,
    options: { getString: (name) => options[name] ?? null },
    deferReply: async () => {}, editReply: async (r) => replies.push(r)
  };
}

test('an XO only gets ranks below their own', async () => {
  const { access } = setup();
  const managed = await access.managedGroups('d2');
  assert.deepEqual(managed.map((m) => m.group.key), ['odst']);
  const ranks = await access.assignableRanks(managed[0].group, managed[0].role);
  assert.deepEqual(ranks.map((r) => r.name), ['ODST Fireteam Leader', 'ODST Lance Corporal', 'Orbital Drop Shock Trooper']);
});

test('an XO cannot rank someone at their level, and cannot hand out XO', async () => {
  const { ranking } = setup();
  await assert.rejects(ranking.rankCommand(interaction('d2', { group: 'odst', roblox_user: 'co', new_rank: 'ODST Lance Corporal' })), /not below your rank/);
  await assert.rejects(ranking.rankCommand(interaction('d2', { group: 'odst', roblox_user: 'trooper', new_rank: 'ODST Executive Officer' })), /not a rank you can give/);
});

test('a rank picked from the list carries its group', async () => {
  const { ranking } = setup();
  members.set('3', 'r10');
  const reply = interaction('d2', { roblox_user: 'trooper', new_rank: 'odst::ODST Lance Corporal' });
  await ranking.rankCommand(reply);
  assert.equal(members.get('3'), 'r20');
});

test('unlinked users manage nothing', async () => {
  const { ranking } = setup();
  await assert.rejects(ranking.rankCommand(interaction('nobody', { group: 'odst', roblox_user: 'trooper', new_rank: 'ODST Lance Corporal' })), /Link and verify/);
});

test('merit moves one step per 200, the approval rank waits for a commander', async () => {
  const { ranking, store } = setup();
  members.set('3', 'r10');
  store.data.ladders.odst = { ranks: ['Orbital Drop Shock Trooper', 'ODST Lance Corporal', 'ODST Fireteam Leader'], approval: 'ODST Fireteam Leader' };
  const account = { id: '3', name: 'trooper' };
  assert.equal((await ranking.checkPromotions(account, 50)).length, 0); // sets the starting point
  assert.equal((await ranking.checkPromotions(account, 200)).length, 0); // 150 since then
  const first = await ranking.checkPromotions(account, 250);
  assert.equal(first[0].to, 'ODST Lance Corporal');
  assert.equal(first[0].pending, false);
  const second = await ranking.checkPromotions(account, 460);
  assert.equal(second[0].to, 'ODST Fireteam Leader');
  assert.equal(second[0].pending, true);
  assert.equal(members.get('3'), 'r20'); // still Lance Corporal until approved
  assert.ok(Object.values(store.data.promotionRequests).some((r) => r.open && r.to === 'ODST Fireteam Leader'));
});

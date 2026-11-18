import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CHANNEL_EVENT_LOGS = 'logs';
process.env.ROBLOX_API_KEY = 'key';
process.env.ROBLOX_UNIVERSE_ID = '1';
const { JsonStore } = await import('../src/store.js');
const { createEvents } = await import('../src/events.js');
const { createGameEvents } = await import('../src/gameEvents.js');

function fakeInteraction(customId, userId, sink) {
  return {
    customId, user: { id: userId }, member: null,
    isButton: () => true, inGuild: () => false,
    async deferReply() {}, async editReply(payload) { sink.replies.push(payload); },
    async update(payload) { sink.updates.push(payload); }, async reply(payload) { sink.replies.push(payload); }
  };
}

test('an in-game event report goes to the host, and pays only after Confirm', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-'));
  const store = new JsonStore(dir);
  store.link('host-discord', { id: '10', name: 'HostGuy' });
  const now = Math.floor(Date.now() / 1000);
  const report = {
    Id: 'abc123', Type: 'planetary_patrol', TypeName: 'Planetary Patrol', HostId: 10, HostName: 'HostGuy',
    Started: now - 1800, Ended: now, Minutes: 30, EndedBy: 'HostGuy',
    Attendees: [{ Id: 10, Name: 'HostGuy', Minutes: 30, Died: false }, { Id: 11, Name: 'Alpha', Minutes: 29, Died: true }, { Id: 12, Name: 'Bravo', Minutes: 25, Died: false }],
    LeftEarly: [{ Id: 13, Name: 'Charlie', Minutes: 4 }]
  };
  const awards = [];
  const accounts = { hostguy: { id: '10', name: 'HostGuy' }, alpha: { id: '11', name: 'Alpha' }, bravo: { id: '12', name: 'Bravo' } };
  const roblox = {
    getEntry: async (key, storeName) => { assert.equal(storeName, 'TrebuchetEvents'); return { value: { [report.Id]: report } }; },
    resolveUsernames: async (names) => names.map((name) => ({ ...accounts[name.toLowerCase()], asked: name })),
    sendAward: async (id, award) => { awards.push({ id, ...award }); },
    getEconomy: async () => ({ merit: 0, pendingMerit: 0 })
  };
  const sent = [];
  const logs = [];
  const client = {
    users: { fetch: async () => ({ send: async (payload) => { sent.push(payload); return { channelId: 'dm', id: 'm1' }; } }) },
    channels: { fetch: async (id) => (id === 'logs' ? { send: async (payload) => logs.push(payload) } : { messages: { fetch: async () => ({ edit: async (payload) => sent.push(payload) }) } }) }
  };
  const ranking = { checkPromotions: async () => [] };
  const events = createEvents({ client, store, roblox, ranking });
  const game = createGameEvents({ client, store, roblox, events });
  events.hooks.reported = game.reported;

  // Poll twice: the report is handled once.
  for (let i = 0; i < 2; i += 1) await game.poll();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].components[0].components.length, 3);
  assert.equal(awards.length, 0, 'nothing is paid before the host confirms');

  // Someone else cannot use the host's buttons.
  const sink = { replies: [], updates: [] };
  await game.button(fakeInteraction('gev:yes:abc123', 'stranger', sink));
  assert.match(sink.replies[0].content, /Only the host/);

  // Host: objective completed -> preview with Confirm.
  await game.button(fakeInteraction('gev:yes:abc123', 'host-discord', sink));
  const previewPayload = sink.replies.at(-1);
  const confirmId = previewPayload.components[0].components[0].data.custom_id;
  assert.match(confirmId, /^event:confirm:/);
  assert.match(previewPayload.embeds[0].data.description, /Alpha/);
  assert.equal(awards.length, 0);

  await events.button(fakeInteraction(confirmId, 'host-discord', sink));
  const attendeeAwards = awards.filter((award) => award.key === 'gevent:abc123');
  assert.equal(attendeeAwards.length, 3);
  assert.equal(store.data.gameReports.abc123.status, 'paid');
  assert.ok(logs.length === 1);
  // Alpha died: no survival bonus, so less cR than Bravo.
  const pay = Object.fromEntries(attendeeAwards.map((award) => [award.id, award.credits]));
  assert.ok(pay['11'] < pay['12']);

  // Pressing again after paying does not pay twice.
  await game.button(fakeInteraction('gev:no:abc123', 'host-discord', sink));
  assert.equal(awards.filter((award) => award.key === 'gevent:abc123').length, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

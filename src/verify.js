// Proving a Roblox account is yours: the bot gives a short phrase of plain words, you put it in your Roblox
// profile's About section, and the bot reads the profile to check it is there. Plain words get through Roblox's
// text filter, where numbers are often hidden.
import crypto from 'node:crypto';

const WORDS = [
  'alpha', 'bravo', 'charlie', 'delta', 'echo', 'falcon', 'pelican', 'warthog', 'scorpion', 'hornet',
  'marine', 'orbital', 'shield', 'armor', 'helmet', 'visor', 'beacon', 'signal', 'relay', 'harbor',
  'river', 'stone', 'forest', 'summit', 'canyon', 'glacier', 'meadow', 'thunder', 'ember', 'comet',
  'anchor', 'compass', 'lantern', 'harvest', 'silver', 'copper', 'crimson', 'amber', 'cobalt', 'jade',
  'tiger', 'eagle', 'wolf', 'raven', 'badger', 'otter', 'heron', 'lynx', 'bison', 'mantis'
];

export function makePhrase(count = 5) {
  const picked = [];
  while (picked.length < count) {
    const word = WORDS[crypto.randomInt(WORDS.length)];
    if (!picked.includes(word)) picked.push(word);
  }
  return `UNSC ${picked.join(' ')}`;
}

const normalize = (text) => String(text || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();

// Pure: true when the profile text holds the phrase (case, spacing and punctuation do not matter).
export function profileHasPhrase(description, phrase) {
  return ` ${normalize(description)} `.includes(` ${normalize(phrase)} `);
}

export async function readDescription(robloxUserId) {
  const response = await fetch(`https://users.roblox.com/v1/users/${robloxUserId}`);
  if (!response.ok) throw new Error(`Could not read the Roblox profile (${response.status}).`);
  const body = await response.json();
  return String(body?.description || '');
}

// Checks the profile, a few times in case Roblox has not shown the new About text yet.
export async function checkPhrase(robloxUserId, phrase, { attempts = 3, waitMs = 4000 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (profileHasPhrase(await readDescription(robloxUserId), phrase)) return true;
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return false;
}

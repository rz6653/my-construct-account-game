import { getStore } from '@netlify/blobs';
import { getUser } from '@netlify/identity';
import { createHandler } from '../../lib/player-data.mjs';

export default createHandler({
  getUser,
  openStore: () => getStore({ name: 'account-game-data', consistency: 'strong' }),
});

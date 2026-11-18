import {
  login, signup, logout, getUser, handleAuthCallback, acceptInvite,
  requestPasswordRecovery, updateUser, onAuthChange, oauthLogin,
} from '@netlify/identity';

const $ = id => document.getElementById(id);
const say = message => { $('status').textContent = message; };
let inviteToken = null;
let resetting = false;
let busy = false;
let activeAccount = null;
const isPlay = Boolean($('game-host'));

async function api(action) {
  const fields = { action, game: $('game')?.value || 'my-game' };
  if (action === 'save' || action === 'submit') {
    for (const key of ['score', 'level', 'coins']) fields[key] = $(key).value;
  }
  const response = await fetch('/.netlify/functions/data', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    body: new URLSearchParams(fields),
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error('Expected JSON. Check the deployment and function URL.'); }
  if (!response.ok || data.ok !== 1) {
    if (response.status === 401) await showSession();
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function showSession() {
  const user = await getUser();
  if (isPlay) {
    if (activeAccount !== (user?.id || null)) $('game-host').replaceChildren();
    activeAccount = user?.id || null;
    if (!user) {
      $('game-host').replaceChildren();
      say('Sign in on the account page, then return here.');
    } else if (!$('game-host').firstChild) {
      const frame = document.createElement('iframe');
      frame.src = '/game/index.html'; frame.title = 'My Construct game';
      frame.allow = 'fullscreen; autoplay; gamepad';
      $('game-host').append(frame);
      say('Signed in. Save before leaving the game.');
    }
    return;
  }
  $('google-signin').hidden = Boolean(user) || Boolean(inviteToken) || resetting;
  $('credentials').hidden = Boolean(user) || Boolean(inviteToken) || resetting;
  $('set-password').hidden = !inviteToken && !resetting;
  $('signed-in').hidden = !user || resetting;
  if (user && !resetting) {
    // The server, not a typed name, determines the display alias.
    const response = await fetch('/.netlify/functions/data', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      body: new URLSearchParams({ action: 'me', game: 'my-game' }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Session check failed. Sign in again.');
    $('alias').textContent = data.player;
  } else {
    $('scores').replaceChildren(); $('result').textContent = 'Responses appear here.';
    $('score').value = 120; $('level').value = 3; $('coins').value = 8;
  }
}

async function run(task) {
  if (busy) return;
  busy = true;
  const controls = [...document.querySelectorAll('button')];
  controls.forEach(button => { button.disabled = true; });
  try { await task(); }
  catch (error) { say(error.message || 'Request failed.'); }
  finally {
    busy = false;
    controls.forEach(button => { button.disabled = false; });
  }
}

if (!isPlay) {
  $('google').addEventListener('click', () => run(async () => {
    oauthLogin('google');
  }));
  $('credentials').addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
      await login($('email').value.trim(), $('password').value);
      $('password').value = '';
      await showSession(); say('Signed in.');
    });
  });
  $('signup').addEventListener('click', () => run(async () => {
    if (!$('credentials').reportValidity()) return;
    await signup($('email').value.trim(), $('password').value);
    $('password').value = '';
    await showSession(); say('Account requested. Check your email for confirmation before signing in.');
  }));
  $('recover').addEventListener('click', () => run(async () => {
    if (!$('email').reportValidity() || !$('email').value) return;
    await requestPasswordRecovery($('email').value.trim());
    say('If recovery is available for that address, check its inbox.');
  }));
  $('set-password').addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
      const password = $('new-password').value;
      if (inviteToken) await acceptInvite(inviteToken, password);
      else await updateUser({ password });
      inviteToken = null; resetting = false; $('new-password').value = '';
      await showSession(); say('Password set. You are signed in.');
    });
  });
  $('logout').addEventListener('click', () => run(async () => {
    await logout(); await showSession(); say('Signed out.');
  }));
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => run(async () => {
    const action = button.dataset.action;
    say(`Sending ${action}…`);
    const data = await api(action);
    $('result').textContent = JSON.stringify(data, null, 2);
    if (action === 'load' && data.found === 1) {
      for (const key of ['score', 'level', 'coins']) $(key).value = data.data[key];
    }
    if (action === 'leaderboard') {
      $('scores').replaceChildren();
      for (const entry of data.scores) {
        const row = document.createElement('tr');
        for (const value of [entry.player, entry.score, entry.updatedAt]) {
          const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
        }
        $('scores').append(row);
      }
    }
    say(action === 'save' ? 'Progress saved. Leaderboard unchanged; submit separately.' :
      action === 'submit' ? 'Score submitted. Refresh the leaderboard to display it.' :
      action === 'load' && data.found === 0 ? 'No save for this account and Game ID.' : `${action} completed.`);
  })));
}

try {
  // Email/invite/recovery links must land on the root account page.
  if (!isPlay) {
    const callback = await handleAuthCallback();
    inviteToken = callback?.type === 'invite' ? callback.token : null;
    resetting = callback?.type === 'recovery';
  }
  await showSession();
  if (!isPlay) say(inviteToken ? 'Choose a password to accept the invitation.' :
    resetting ? 'Choose a new password.' : 'Ready. Sign in or use the data lab.');
  onAuthChange(() => { showSession().catch(error => say(error.message)); });
} catch (error) { say(`Account setup: ${error.message}`); }

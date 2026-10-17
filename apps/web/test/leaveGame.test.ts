import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeaveConfirmation } from '../src/story/confirmLeaveGame';
import { LeaveGameDialog } from '../src/components/LeaveGameDialog';

test('no leave action runs before confirmation, and Keep playing cancels it', async () => {
  for (const confirmed of [false, true]) {
    const confirmation = createLeaveConfirmation();
    let leaves = 0;
    const action = confirmation.request().then(answer => { if (answer) leaves++; });
    await Promise.resolve();
    assert.equal(leaves, 0); assert.equal(confirmation.snapshot(), true);
    confirmation.resolve(confirmed); await action;
    assert.equal(leaves, confirmed ? 1 : 0); assert.equal(confirmation.snapshot(), false);
  }
});

test('repeated leave requests cannot queue duplicate exits behind one popup', async () => {
  const confirmation = createLeaveConfirmation();
  let leaves = 0;
  const first = confirmation.request().then(answer => { if (answer) leaves++; });
  const second = confirmation.request().then(answer => { if (answer) leaves++; });
  confirmation.resolve(true); confirmation.resolve(true);
  await Promise.all([first, second]); assert.equal(leaves, 1);
});

test('a screen change cancels a pending leave so it cannot carry into a different room', async () => {
  const confirmation = createLeaveConfirmation();
  const old = confirmation.request();
  confirmation.resolve(false);
  assert.equal(await old, false);
  const nextRoom = confirmation.request();
  let settled = false; void nextRoom.then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false);
  confirmation.resolve(true); assert.equal(await nextRoom, true);
});

test('the in-game dialog names its question and provides visible themed stay, leave and close controls', () => {
  const html = renderToStaticMarkup(createElement(LeaveGameDialog, { scope: 'test-room' }));
  assert.match(html, /<dialog[^>]*aria-labelledby="leave-dialog-title"[^>]*aria-describedby="leave-dialog-question"/);
  assert.match(html, /Are you sure you want to leave the game\?/);
  assert.match(html, /class="quest-button"[^>]*>Keep playing/);
  assert.match(html, /class="secondary-button leave-game-button"[^>]*>Leave game/);
  assert.match(html, /Cancel leaving and close dialog/);
  assert.match(html, /A note from Moss/);
});

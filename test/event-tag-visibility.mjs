import assert from 'node:assert/strict';
import {
  getEventTags,
  getEventTagGroups,
  loadEventTags,
  loadEventTagGroups,
  moveEventTagToGroup,
  setEventTagHidden,
} from '../src/event-tags.js';

loadEventTags({
  eventTags: [
    { id: 'evt-one', name: '事件一' },
    { id: 'evt-two', name: '事件二', hidden: true },
  ],
});
loadEventTagGroups({
  eventTagGroups: [
    { id: 'grp-a', name: '分组 A', tagIds: ['evt-one'] },
    { id: 'grp-b', name: '分组 B', tagIds: [] },
  ],
});

assert.equal(getEventTags().find(tag => tag.id === 'evt-two')?.hidden, true);
assert.equal(setEventTagHidden('evt-one', true), true);
assert.equal(getEventTags().find(tag => tag.id === 'evt-one')?.hidden, true);
assert.equal(setEventTagHidden('evt-one', false), true);
assert.equal('hidden' in getEventTags().find(tag => tag.id === 'evt-one'), false);

assert.equal(moveEventTagToGroup('evt-one', 'grp-b'), true);
assert.deepEqual(getEventTagGroups().find(group => group.id === 'grp-a')?.tagIds, []);
assert.deepEqual(getEventTagGroups().find(group => group.id === 'grp-b')?.tagIds, ['evt-one']);
assert.equal(moveEventTagToGroup('evt-one', ''), true);
assert.deepEqual(getEventTagGroups().find(group => group.id === 'grp-b')?.tagIds, []);

console.log('event tag visibility tests passed');

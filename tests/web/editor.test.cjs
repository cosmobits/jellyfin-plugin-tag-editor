const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = readFileSync(path.join(__dirname, '../../src/Jellyfin.Plugin.TagEditor/Web/tag-editor.js'), 'utf8');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
    for (let count = 0; count < 80; count++) {
        if (predicate()) return;
        await delay(15);
    }
    assert.fail('Timed out waiting for the editor');
}

function setup(t, admin = true) {
    const dom = new JSDOM('<!doctype html><body><div class="itemDetailPage page"><div class="itemTags">Tags: Original</div></div></body>', {
        url: 'http://localhost/jellyfin/web/index.html#/details?id=11111111111111111111111111111111',
        runScripts: 'outside-only', pretendToBeVisual: true
    });
    const { window } = dom;
    const state = { admin, user: 'first-user', tags: ['Original'], calls: [], fail: null };
    window.ApiClient = {
        getCurrentUserId: () => state.user,
        getCurrentUser: async () => ({ Policy: { IsAdministrator: state.admin } }),
        getUrl: route => {
            if (!route) throw new Error('Url name cannot be empty');
            return `http://localhost/jellyfin/${route}`;
        },
        getJSON: async () => ({ Tags: ['Drama', '<b>unsafe</b>'] }),
        ajax: async options => {
            state.calls.push(options);
            if (state.fail) throw state.fail;
            if (options.type === 'PUT') state.tags = JSON.parse(options.data).Tags;
            return { Id: '11111111111111111111111111111111', Name: '<img src=x onerror=alert(1)>', Tags: state.tags };
        }
    };
    window.eval(source);
    t.after(() => { window.JellyfinTagEditor.destroy(); window.close(); });
    const launcher = () => window.document.querySelector('.jfte-tag-editor__button');
    const dialog = () => window.document.querySelector('[role="dialog"]');
    const open = async () => {
        await until(launcher);
        launcher().focus();
        launcher().click();
        await until(dialog);
        return dialog();
    };
    return { window, state, launcher, dialog, open };
}

test('administrator can cancel and reopen repeatedly, with safe item names', async t => {
    const { window, dialog, open, launcher } = setup(t);
    const first = await open();
    assert.match(first.querySelector('h2').textContent, /<img/);
    assert.equal(first.querySelector('img'), null);
    first.querySelector('[data-cancel]').click();
    assert.equal(dialog(), null);
    assert.equal(window.document.activeElement, launcher());
    await open();
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(dialog(), null);
    await open();
});

test('save includes pending input and writes only tags through the plugin endpoint', async t => {
    const { window, state, open } = setup(t);
    const modal = await open();
    const input = modal.querySelector('input');
    input.value = '<svg onload=alert(1)>';
    modal.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => !modal.isConnected);
    const save = state.calls.find(call => call.type === 'PUT');
    assert.match(save.url, /\/jellyfin\/TagEditor\/Items\/.+\/Tags$/);
    const payload = JSON.parse(save.data);
    assert.deepEqual(Object.keys(payload).sort(), ['OriginalTags', 'Tags']);
    assert.deepEqual(payload.Tags, ['Original', '<svg onload=alert(1)>']);
    assert.deepEqual(payload.OriginalTags, ['Original']);
    assert.equal(window.document.querySelector('svg'), null);
    assert.equal(window.document.querySelector('.itemTags').textContent, 'Tags: Original, <svg onload=alert(1)>');
});

test('non-administrators never receive a launcher', async t => {
    const { state, launcher } = setup(t, false);
    await delay(180);
    assert.equal(launcher(), null);
    assert.equal(state.calls.length, 0);
});

test('switching to a non-admin account removes controls and closes dialogs', async t => {
    const { window, state, open, launcher, dialog } = setup(t);
    await open();
    state.user = 'second-user';
    state.admin = false;
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    await until(() => !launcher() && !dialog());
});

test('navigation removes controls and detached controls are restored', async t => {
    const { window, launcher } = setup(t);
    await until(launcher);
    launcher().parentElement.remove();
    await until(launcher);
    window.location.hash = '#/movies';
    await until(() => !launcher());
});

test('stale-editor failures keep edits open and show a useful error', async t => {
    const { window, state, open } = setup(t);
    const modal = await open();
    state.fail = { status: 409 };
    modal.querySelector('input').value = 'Pending';
    modal.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => !modal.querySelector('[role="alert"]').hidden);
    assert.match(modal.querySelector('[role="alert"]').textContent, /changed while/);
    assert.equal(modal.isConnected, true);
    assert.equal(modal.querySelector('button[type="submit"]').disabled, false);
    assert.match(modal.textContent, /Pending/);
});

test('keyboard focus stays in the dialog and Escape restores the launcher', async t => {
    const { window, open, launcher } = setup(t);
    const modal = await open();
    const buttons = modal.querySelectorAll('button');
    buttons[buttons.length - 1].focus();
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(window.document.activeElement, modal.querySelector('button'));
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(window.document.activeElement, launcher());
});

test('destroy during an in-flight request cannot insert controls later', async t => {
    const { window, launcher } = setup(t);
    let resolve;
    window.ApiClient.ajax = () => new Promise(done => { resolve = done; });
    await until(() => resolve);
    window.JellyfinTagEditor.destroy();
    resolve({ Id: '11111111111111111111111111111111', Tags: [] });
    await delay(100);
    assert.equal(launcher(), null);
});

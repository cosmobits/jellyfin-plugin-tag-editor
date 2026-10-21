/*
 * Paste or inject this file into a Jellyfin web client page while testing.
 * It requires the web client's global ApiClient and is intentionally standalone.
 */
(function jellyfinTagEditor() {
    'use strict';

    const SCRIPT_VERSION = '2026-07-27.12';
    if (window.JellyfinTagEditor && window.JellyfinTagEditor.version === SCRIPT_VERSION) {
        window.JellyfinTagEditor.refresh();
        return;
    }
    if (window.JellyfinTagEditor && typeof window.JellyfinTagEditor.destroy === 'function') {
        window.JellyfinTagEditor.destroy();
    }
    document.querySelectorAll('.jfte-tag-editor, .jfte-tag-editor__dialog').forEach((element) => element.remove());
    document.getElementById('jfte-styles')?.remove();

    const SUPPORTED_ITEM_TYPES = new Set(['Movie', 'Series', 'Episode', 'MusicAlbum']);
    const ROOT_CLASS = 'jfte-tag-editor';
    let cachedPermission;
    let renderObserver;
    let retryTimer;

    function debug(...values) {
        if (window.JellyfinTagEditor && window.JellyfinTagEditor.debug) {
            console.log('[JellyfinTagEditor]', ...values);
        }
    }

    const styles = `
        .${ROOT_CLASS} { display: inline-flex !important; align-items: center; margin: .35rem 0 0 .35rem; pointer-events: auto !important; vertical-align: middle; }
        .${ROOT_CLASS}__button { position: relative; z-index: 1; display: inline-flex !important; align-items: center; justify-content: center; width: 2rem; height: 2rem; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; padding: 0; font: inherit; pointer-events: auto !important; }
        .${ROOT_CLASS}__button:hover, .${ROOT_CLASS}__button:focus-visible { background: rgba(255, 255, 255, .15); color: var(--theme-primary-color, #00a4dc); outline: 2px solid currentColor; outline-offset: 2px; }
        .${ROOT_CLASS}__button .material-icons { font-size: 1.25em; vertical-align: middle; }
        .${ROOT_CLASS}__dialog { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 1rem; background: rgba(0, 0, 0, .7); }
        .${ROOT_CLASS}__panel { width: min(32rem, 100%); background: var(--theme-background, #202020); color: inherit; padding: 1.25rem; border-radius: .25rem; box-sizing: border-box; }
        .${ROOT_CLASS}__tag-editor { position: relative; display: flex; flex-wrap: wrap; gap: .4rem; min-height: 3.25rem; margin: .75rem 0 1rem; padding: .5rem; border: 1px solid currentColor; border-radius: .2rem; }
        .${ROOT_CLASS}__pill { display: inline-flex; align-items: center; gap: .25rem; max-width: 100%; padding: .3rem .45rem; border-radius: 1rem; background: var(--theme-primary-color, #00a4dc); color: #fff; }
        .${ROOT_CLASS}__remove { display: inline-flex; align-items: center; justify-content: center; width: 1.25rem; height: 1.25rem; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; padding: 0; font-size: 1.1rem; line-height: 1; }
        .${ROOT_CLASS}__tag-input { flex: 1 1 9rem; min-width: 8rem; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; }
        .${ROOT_CLASS}__suggestions { position: absolute; z-index: 1; top: calc(100% + .25rem); left: 0; right: 0; max-height: 12rem; overflow-y: auto; background: var(--theme-background, #202020); border: 1px solid currentColor; border-radius: .2rem; box-shadow: 0 4px 12px rgba(0, 0, 0, .35); }
        .${ROOT_CLASS}__suggestion { display: block; width: 100%; border: 0; background: transparent; color: inherit; cursor: pointer; padding: .65rem .75rem; text-align: left; font: inherit; }
        .${ROOT_CLASS}__suggestion:hover, .${ROOT_CLASS}__suggestion:focus-visible { background: rgba(255, 255, 255, .12); outline: 0; }
        .${ROOT_CLASS}__actions { display: flex; justify-content: flex-end; gap: .75rem; }
        .${ROOT_CLASS}__actions button { min-height: 2.5rem; padding: .5rem 1rem; border: 0; border-radius: .2rem; cursor: pointer; font: inherit; }
        .${ROOT_CLASS}__save { background: var(--theme-primary-color, #00a4dc); color: #fff; }
        .${ROOT_CLASS}__save:disabled { opacity: .6; cursor: wait; }
        @media (max-width: 32rem) { .${ROOT_CLASS}__panel { padding: 1rem; } }
    `;

    function addStyles() {
        if (document.getElementById('jfte-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'jfte-styles';
        style.textContent = styles;
        document.head.append(style);
    }

    function getItemId(view) {
        const hashQuery = window.location.hash.split('?')[1] || '';
        const fromRoute = new URLSearchParams(hashQuery).get('id');
        if (fromRoute) {
            return fromRoute;
        }

        const element = view.querySelector('[data-itemid], [data-item-id]');
        return element && (element.dataset.itemid || element.dataset.itemId);
    }

    async function canEditTags() {
        if (cachedPermission !== undefined) {
            return cachedPermission;
        }

        const user = await window.ApiClient.getCurrentUser();
        const policy = user.Policy || {};
        cachedPermission = Boolean(
            policy.IsAdministrator ||
            policy.EnableMediaManagement ||
            policy.EnableMetadataEditing ||
            policy.EnableContentManagement
        );
        debug('Permission check completed.', { userId: user.Id, cachedPermission, policy });
        return cachedPermission;
    }

    function tagsFromItem(item) {
        if (Array.isArray(item.Tags)) {
            return item.Tags;
        }
        if (Array.isArray(item.TagItems)) {
            return item.TagItems.map((tag) => tag.Name).filter(Boolean);
        }
        return [];
    }

    function notify(message) {
        if (window.Dashboard && typeof window.Dashboard.alert === 'function') {
            window.Dashboard.alert(message);
            return;
        }
        window.alert(message);
    }

    function positionLauncher(control) {
        const tagsContainer = document.querySelector('.itemTags');
        if (tagsContainer) {
            tagsContainer.insertAdjacentElement('afterend', control);
            debug('Edit control inserted after the itemTags container.');
            return;
        }

        control.style.position = 'fixed';
        control.style.right = '1rem';
        control.style.top = '1rem';
        debug('itemTags container not found; using the top-right fallback launcher.');
    }

    function stopPropagation(event) {
        event.stopImmediatePropagation();
    }

    function blockNavigation(event) {
        event.preventDefault();
        stopPropagation(event);
    }

    async function availableTags(item) {
        try {
            const filters = await window.ApiClient.getJSON(window.ApiClient.getUrl('Items/Filters', {
                UserId: window.ApiClient.getCurrentUserId(),
                ParentId: item.ParentId || item.Id,
                Recursive: true
            }));
            return (filters.Tags || []).map((tag) => typeof tag === 'string' ? tag : tag.Name).filter(Boolean);
        } catch (error) {
            debug('Could not load existing tag suggestions.', error);
            return [];
        }
    }

    async function openEditor(item, onSaved) {
        debug('Opening tag editor.', { id: item.Id, name: item.Name, tags: tagsFromItem(item) });
        const dialog = document.createElement('div');
        dialog.className = `${ROOT_CLASS}__dialog`;
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'jfte-dialog-title');
        dialog.innerHTML = `
            <form class="${ROOT_CLASS}__panel">
                <h2 id="jfte-dialog-title">Edit tags</h2>
                <label for="jfte-tags-input">Tags</label>
                <div class="${ROOT_CLASS}__tag-editor">
                    <input id="jfte-tags-input" class="${ROOT_CLASS}__tag-input" type="text" autocomplete="off" placeholder="Add a tag">
                    <div class="${ROOT_CLASS}__suggestions" hidden></div>
                </div>
                <div class="${ROOT_CLASS}__actions">
                    <button type="button" data-jfte-cancel>Cancel</button>
                    <button type="submit" class="${ROOT_CLASS}__save" data-jfte-save>Save</button>
                </div>
            </form>`;

        const form = dialog.querySelector('form');
        const input = dialog.querySelector('input');
        const saveButton = dialog.querySelector('[data-jfte-save]');
        const editor = dialog.querySelector(`.${ROOT_CLASS}__tag-editor`);
        const suggestions = dialog.querySelector(`.${ROOT_CLASS}__suggestions`);
        let tags = [...new Set(tagsFromItem(item))];
        const knownTags = await availableTags(item);

        function addTag(value) {
            const tag = value.trim();
            if (tag && !tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
                tags.push(tag);
            }
            input.value = '';
            render();
        }

        function renderSuggestions() {
            const query = input.value.trim().toLowerCase();
            const matches = query ? knownTags.filter((tag) =>
                tag.toLowerCase().includes(query) && !tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())
            ).slice(0, 8) : [];
            suggestions.replaceChildren(...matches.map((tag) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = `${ROOT_CLASS}__suggestion`;
                button.textContent = tag;
                button.addEventListener('click', () => addTag(tag));
                return button;
            }));
            suggestions.hidden = matches.length === 0;
        }

        function render() {
            editor.querySelectorAll(`.${ROOT_CLASS}__pill`).forEach((pill) => pill.remove());
            tags.forEach((tag) => {
                const pill = document.createElement('span');
                pill.className = `${ROOT_CLASS}__pill`;
                pill.append(document.createTextNode(tag));
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = `${ROOT_CLASS}__remove`;
                remove.setAttribute('aria-label', `Remove ${tag}`);
                remove.textContent = 'x';
                remove.addEventListener('click', () => {
                    tags = tags.filter((existing) => existing !== tag);
                    render();
                });
                pill.append(remove);
                editor.insertBefore(pill, input);
            });
            renderSuggestions();
        }

        input.addEventListener('input', renderSuggestions);
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault();
                addTag(input.value);
            }
            if (event.key === 'Backspace' && !input.value && tags.length) {
                tags.pop();
                render();
            }
        });
        render();

        const close = () => dialog.remove();
        dialog.querySelector('[data-jfte-cancel]').addEventListener('click', close);
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) {
                close();
            }
        });
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            saveButton.disabled = true;

            try {
                const updatedItem = await window.ApiClient.getItem(window.ApiClient.getCurrentUserId(), item.Id);
                updatedItem.Tags = tags;
                await window.ApiClient.updateItem(updatedItem);
                onSaved(updatedItem.Tags);
                close();
            } catch (error) {
                const forbidden = error && (error.status === 403 || error.statusCode === 403);
                notify(forbidden ? 'You do not have permission to edit tags.' : 'Unable to save tags. Please try again.');
                saveButton.disabled = false;
            }
        });

        document.body.append(dialog);
        input.focus();
        debug('Tag editor modal appended to the page.', { visible: dialog.getClientRects().length > 0 });
    }

    async function inject(view) {
        if (!window.JellyfinTagEditor.enabled || !window.ApiClient) {
            debug('Injection skipped.', {
                enabled: window.JellyfinTagEditor.enabled,
                hasApiClient: Boolean(window.ApiClient)
            });
            return;
        }

        const itemId = getItemId(view);
        debug('Attempting injection.', { itemId, hash: window.location.hash });
        if (!itemId) {
            debug('Injection skipped: no item id found.');
            return;
        }
        if (!(await canEditTags())) {
            debug('Injection skipped: current user lacks an eligible media or metadata editing permission.');
            return;
        }

        const item = await window.ApiClient.getItem(window.ApiClient.getCurrentUserId(), itemId);
        debug('Loaded detail item.', { id: item.Id, type: item.Type, name: item.Name, tags: tagsFromItem(item) });
        if (!SUPPORTED_ITEM_TYPES.has(item.Type)) {
            debug('Injection skipped: item type is not supported.', item.Type);
            return;
        }

        const existingControl = document.querySelector(`.${ROOT_CLASS}`);
        if (existingControl) {
            if (existingControl.dataset.itemId === item.Id) {
                positionLauncher(existingControl, tagsFromItem(item));
                return;
            }
            existingControl.remove();
        }

        const control = document.createElement('span');
        control.className = ROOT_CLASS;
        control.dataset.itemId = item.Id;
        control.innerHTML = `<button class="${ROOT_CLASS}__button" type="button" title="Edit Tags" aria-label="Edit Tags"><span class="material-icons" aria-hidden="true">edit</span></button>`;
        const editButton = control.querySelector('button');

        let editorOpened = false;
        const openFromInteraction = async (event) => {
            if (editorOpened) {
                blockNavigation(event);
                return;
            }

            editorOpened = true;
            blockNavigation(event);
            debug('Edit Tags button activated.', { eventType: event.type });
            try {
                await openEditor(item, () => {
                    editorOpened = false;
                    scheduleInjection();
                });
            } catch (error) {
                editorOpened = false;
                console.error('[JellyfinTagEditor] Unable to open the tag editor.', error);
                notify('Unable to open the tag editor. Check the browser console for details.');
            }
        };

        editButton.addEventListener('click', openFromInteraction);

        positionLauncher(control);
    }

    function scheduleInjection(event) {
        const view = event && event.target && event.target.querySelector ? event.target : document;
        debug('Injection scheduled.', { eventType: event && event.type, view: view === document ? 'document' : view.className });
        window.setTimeout(() => inject(view).catch((error) => {
            console.error('[JellyfinTagEditor] Injection failed.', error);
        }), 0);
    }

    window.JellyfinTagEditor = {
        version: SCRIPT_VERSION,
        enabled: true,
        debug: true,
        destroy: () => {
            renderObserver?.disconnect();
            window.clearTimeout(retryTimer);
        },
        refresh: () => scheduleInjection(),
        open: async () => {
            const itemId = getItemId(document);
            if (!window.ApiClient || !itemId) {
                throw new Error('ApiClient or the current item id is unavailable.');
            }
            const item = await window.ApiClient.getItem(window.ApiClient.getCurrentUserId(), itemId);
            debug('Opening editor through the diagnostic entry point.', { id: item.Id, name: item.Name });
            await openEditor(item, () => scheduleInjection());
        },
        inspect: () => {
            const control = document.querySelector(`.${ROOT_CLASS}`);
            if (!control) {
                console.warn('[JellyfinTagEditor] No edit control exists in the document.');
                return null;
            }
            const style = window.getComputedStyle(control);
            const rect = control.getBoundingClientRect();
            const centerX = rect.left + (rect.width / 2);
            const centerY = rect.top + (rect.height / 2);
            const report = {
                rect: {
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height
                },
                viewport: { width: window.innerWidth, height: window.innerHeight },
                coveringElements: document.elementsFromPoint(centerX, centerY).slice(0, 5).map((element) => ({
                    tag: element.tagName,
                    id: element.id,
                    className: element.className
                })),
                display: style.display,
                position: style.position,
                visibility: style.visibility,
                opacity: style.opacity,
                pointerEvents: style.pointerEvents,
                zIndex: style.zIndex,
                html: control.outerHTML
            };
            console.info('[JellyfinTagEditor] Control inspection:', report);
            console.info('[JellyfinTagEditor] Control inspection JSON:', JSON.stringify(report));
            return report;
        },
        status: () => {
            const report = {
                enabled: window.JellyfinTagEditor.enabled,
                hasApiClient: Boolean(window.ApiClient),
                hash: window.location.hash,
                itemId: getItemId(document),
                controls: document.querySelectorAll(`.${ROOT_CLASS}`).length
            };
            console.info('[JellyfinTagEditor] Status:', report);
            return report;
        }
    };
    addStyles();
    document.addEventListener('viewshow', scheduleInjection);
    window.addEventListener('hashchange', () => scheduleInjection());
    renderObserver = new MutationObserver(() => {
        if (!window.location.hash.startsWith('#/details') || document.querySelector(`.${ROOT_CLASS}`)) {
            return;
        }
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(() => scheduleInjection(), 50);
    });
    renderObserver.observe(document.body, { childList: true, subtree: true });
    scheduleInjection();
}());
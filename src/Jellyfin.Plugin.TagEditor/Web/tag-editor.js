/* Loaded automatically by the Tag Toolkit server plugin. No credentials are stored here. */
(function tagEditor() {
    'use strict';

    window.JellyfinTagEditor?.destroy();

    const ROOT = 'jfte-tag-editor';
    const listeners = new AbortController();
    let destroyed = false;
    let timer;
    let revision = 0;
    let activeKey = '';
    let activeEligible = false;
    let permissionKey = '';
    let permission;
    let dialogState;
    let opening = false;
    let homeKey = '';
    let homePendingKey = '';
    let homeLoadedKey = '';
    let homeTags = null;

    function route() {
        const current = window.location.hash.slice(1) || window.location.pathname;
        const [path, query = window.location.search.slice(1)] = current.split('?');
        return { path, query };
    }

    function session() {
        const api = window.ApiClient;
        const userId = api?.getCurrentUserId();
        if (!api || !userId) return null;
        const key = `${api.getUrl('TagEditor')}:${userId}`;
        return { api, userId, session: key };
    }

    function context() {
        const { path, query } = route();
        if (!/(^|\/)details\/?$/i.test(path)) return null;
        const id = new URLSearchParams(query).get('id');
        const current = session();
        if (!id || !current) return null;
        return { ...current, id, key: `${current.session}:${id}` };
    }

    function homeContext() {
        const { path } = route();
        if (!/(^|\/)(home|home\.html)\/?$/i.test(path)) return null;
        return session();
    }

    function visiblePage() {
        return document.querySelector('.itemDetailPage:not(.hide)')
            || document.querySelector('.page:not(.hide)') || document.body;
    }

    function request(ctx, method, data) {
        return ctx.api.ajax({
            url: ctx.api.getUrl(`TagEditor/Items/${encodeURIComponent(ctx.id)}/Tags`),
            type: method,
            dataType: 'json',
            contentType: 'application/json',
            ...(data ? { data: JSON.stringify(data) } : {})
        }).then(item => ({
            id: item.Id ?? item.id,
            name: item.Name ?? item.name,
            tags: [...(item.Tags ?? item.tags ?? [])]
        }));
    }

    function removeLauncher() {
        document.querySelectorAll(`.${ROOT}`).forEach(element => element.remove());
    }

    function placeLauncher(control) {
        const page = visiblePage();
        const tags = page.querySelector('.itemTags');
        const anchor = tags || page.querySelector('.detailPagePrimaryContainer, .nameContainer');
        if (anchor) {
            // Avoid mutations when already placed; our own observer must not loop.
            if (anchor.nextElementSibling !== control) anchor.after(control);
            control.classList.remove(`${ROOT}__button--fallback`);
        } else {
            if (!control.isConnected) page.append(control);
            control.classList.add(`${ROOT}__button--fallback`);
        }
    }

    async function refresh() {
        if (destroyed) return;
        const ctx = context();
        if (!ctx) {
            ++revision;
            activeKey = '';
            removeLauncher();
            dialogState?.close(true);
            return;
        }
        const existing = document.querySelector(`.${ROOT}`);
        if (ctx.key === activeKey && existing) {
            placeLauncher(existing);
            return;
        }
        if (ctx.key === activeKey && !activeEligible) return;

        const run = ++revision;
        activeKey = ctx.key;
        activeEligible = false;
        removeLauncher();
        dialogState?.close(true);
        try {
            if (permissionKey !== ctx.session) {
                permissionKey = ctx.session;
                permission = ctx.api.getCurrentUser().then(user => Boolean(user.Policy?.IsAdministrator));
            }
            if (!await permission || run !== revision || destroyed) return;
            await request(ctx, 'GET');
            if (destroyed || run !== revision || context()?.key !== ctx.key) return;

            activeEligible = true;

            const control = document.createElement('span');
            control.className = ROOT;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `${ROOT}__button`;
            button.title = 'Edit tags';
            button.setAttribute('aria-label', 'Edit tags');
            button.innerHTML = '<span class="material-icons" aria-hidden="true">edit</span>';
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                open(ctx, button);
            });
            control.append(button);
            placeLauncher(control);
        } catch (error) {
            if (destroyed || run !== revision || context()?.key !== ctx.key) return;
            // Unsupported item types and expired/non-admin sessions do not get a launcher.
            const status = error?.status || error?.statusCode;
            if (![400, 401, 403, 404].includes(status)) {
                activeKey = ''; // Retry a transient failure on the next page event.
                permissionKey = '';
                console.debug('[Tag Editor] Could not load the item.', error);
            }
        }
    }

    function schedule() {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
            refresh();
            refreshPopularTags();
        }, 80);
    }

    function removePopularTags() {
        document.querySelectorAll(`.${ROOT}__popular`).forEach(element => element.remove());
    }

    function renderPopularTags(ctx, tags) {
        const page = document.querySelector('.homePage:not(.hide)');
        const container = page?.querySelector('.homeSectionsContainer, .sections');
        if (!container) return false;

        const section = document.createElement('section');
        section.className = `${ROOT}__popular verticalSection`;
        section.setAttribute('aria-label', 'Popular tags');
        const title = document.createElement('h2');
        title.className = 'sectionTitle';
        title.textContent = 'Popular tags';
        const row = document.createElement('div');
        row.className = `${ROOT}__popular-row`;

        tags.forEach(tag => {
            const name = tag.Name ?? tag.name;
            if (!name) return;
            const link = document.createElement('a');
            const query = new URLSearchParams({
                type: 'tag',
                tag: name,
                serverId: ctx.api.serverId() || ''
            });
            link.href = `#/list?${query}`;
            link.className = `${ROOT}__popular-tag`;
            link.textContent = name;
            const count = Number(tag.Count ?? tag.count);
            if (Number.isFinite(count) && count > 0) {
                const badge = document.createElement('span');
                badge.className = `${ROOT}__popular-count`;
                badge.textContent = count.toLocaleString();
                link.append(badge);
            }
            row.append(link);
        });

        if (!row.childElementCount) return true;
        section.append(title, row);
        container.prepend(section);
        return true;
    }

    async function refreshPopularTags() {
        if (destroyed) return;
        const ctx = homeContext();
        if (!ctx) {
            homeKey = '';
            homePendingKey = '';
            homeLoadedKey = '';
            homeTags = null;
            removePopularTags();
            return;
        }

        if (homeLoadedKey === ctx.session) {
            if (homeTags?.length && !document.querySelector(`.${ROOT}__popular`)) {
                renderPopularTags(ctx, homeTags);
            }
            return;
        }
        if (homePendingKey === ctx.session) return;
        if (homeKey !== ctx.session) {
            homeKey = ctx.session;
            homeLoadedKey = '';
            homeTags = null;
            removePopularTags();
        }

        homePendingKey = ctx.session;
        try {
            const settings = await ctx.api.getJSON(ctx.api.getUrl('TagEditor/Settings'));
            if (destroyed || homeContext()?.session !== ctx.session) return;
            if (!(settings.ShowPopularTags ?? settings.showPopularTags)) {
                homeTags = null;
                homeLoadedKey = ctx.session;
                removePopularTags();
                return;
            }

            const tags = await ctx.api.getJSON(ctx.api.getUrl('TagEditor/PopularTags'));
            if (destroyed || homeContext()?.session !== ctx.session) return;
            homeTags = Array.isArray(tags) ? tags : [];
            homeLoadedKey = ctx.session;
            renderPopularTags(ctx, homeTags);
        } catch (error) {
            if (!destroyed && homeContext()?.session === ctx.session) {
                console.debug('[Tag Editor] Could not load popular tags.', error);
            }
        } finally {
            if (homePendingKey === ctx.session) homePendingKey = '';
        }
    }

    async function suggestions(ctx) {
        try {
            const filters = await ctx.api.getJSON(ctx.api.getUrl('Items/Filters', {
                UserId: ctx.api.getCurrentUserId(), Recursive: true
            }));
            return (filters.Tags || []).map(tag => typeof tag === 'string' ? tag : tag.Name).filter(Boolean);
        } catch {
            return []; // Suggestions are optional; editing still works when unavailable.
        }
    }

    async function open(ctx, launcher) {
        if (opening || dialogState || destroyed) return;
        opening = true;
        launcher.disabled = true;
        try {
            const item = await request(ctx, 'GET');
            if (destroyed || context()?.key !== ctx.key) return;
            showDialog(ctx, item, launcher);
        } catch {
            if (!destroyed) window.alert('Unable to load tags. Check your connection and administrator permissions.');
        } finally {
            opening = false;
            launcher.disabled = false;
        }
    }

    function showDialog(ctx, item, launcher) {
        const dialogListeners = new AbortController();
        const dialog = document.createElement('div');
        dialog.className = `${ROOT}__dialog`;
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'jfte-title');
        dialog.innerHTML = `
            <form class="${ROOT}__panel">
                <h2 id="jfte-title" class="${ROOT}__title"></h2>
                <label for="jfte-input">Tags</label>
                <div class="${ROOT}__tag-editor">
                    <input id="jfte-input" class="${ROOT}__tag-input" maxlength="256" autocomplete="off" placeholder="Add a tag">
                    <div class="${ROOT}__suggestions" hidden></div>
                </div>
                <p class="${ROOT}__error" role="alert" hidden></p>
                <div class="${ROOT}__actions">
                    <button type="button" data-cancel>Cancel</button>
                    <button type="submit" class="${ROOT}__save">Save</button>
                </div>
            </form>`;
        dialog.querySelector('h2').textContent = `Edit tags — ${item.name}`;
        const form = dialog.querySelector('form');
        const input = dialog.querySelector('input');
        const editor = dialog.querySelector(`.${ROOT}__tag-editor`);
        const list = dialog.querySelector(`.${ROOT}__suggestions`);
        const error = dialog.querySelector('[role="alert"]');
        let tags = [...item.tags];
        let knownTags = [];
        let busy = false;

        function close(force = false) {
            if (busy && !force) return;
            dialogListeners.abort();
            dialog.remove();
            dialogState = undefined;
            if (launcher.isConnected && !destroyed) launcher.focus();
        }

        function add(value) {
            const tag = value.trim();
            if (tag && !tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) tags.push(tag);
            input.value = '';
            render();
        }

        function renderSuggestions() {
            const query = input.value.trim().toLowerCase();
            const matches = !busy && query ? knownTags.filter(tag =>
                tag.toLowerCase().includes(query)
                && !tags.some(existing => existing.toLowerCase() === tag.toLowerCase())
            ).slice(0, 8) : [];
            list.replaceChildren(...matches.map(tag => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = `${ROOT}__suggestion`;
                button.textContent = tag;
                button.addEventListener('click', () => { add(tag); input.focus(); });
                return button;
            }));
            list.hidden = !matches.length;
        }

        function render() {
            editor.querySelectorAll(`.${ROOT}__pill`).forEach(pill => pill.remove());
            tags.forEach((tag, index) => {
                const pill = document.createElement('span');
                pill.className = `${ROOT}__pill`;
                pill.append(document.createTextNode(tag));
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = `${ROOT}__remove`;
                remove.setAttribute('aria-label', `Remove ${tag}`);
                remove.textContent = '×';
                remove.addEventListener('click', () => { tags.splice(index, 1); render(); input.focus(); });
                pill.append(remove);
                editor.insertBefore(pill, input);
            });
            renderSuggestions();
        }

        input.addEventListener('input', renderSuggestions);
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault();
                add(input.value);
            } else if (event.key === 'Backspace' && !input.value && tags.length) {
                tags.pop();
                render();
            }
        });
        dialog.querySelector('[data-cancel]').addEventListener('click', () => close());
        dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                close();
            } else if (event.key === 'Tab') {
                const focusable = [...form.elements]
                    .filter(element => !element.disabled && !element.closest('[hidden]'));
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (!first) { event.preventDefault(); return; }
                if (!dialog.contains(document.activeElement)) {
                    event.preventDefault(); first.focus();
                } else if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault(); last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault(); first.focus();
                }
            }
        }, { capture: true, signal: dialogListeners.signal });
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (busy) return;
            add(input.value); // Save also commits a tag that has not yet been followed by Enter.
            error.hidden = true;
            busy = true;
            form.querySelectorAll('button, input').forEach(element => { element.disabled = true; });
            list.hidden = true;
            try {
                const saved = await request(ctx, 'PUT', { Tags: tags, OriginalTags: item.tags });
                if (destroyed || !dialog.isConnected) return;
                renderSavedTags(saved.tags);
                close(true);
            } catch (failure) {
                if (!dialog.isConnected) return;
                const status = failure?.status || failure?.statusCode;
                error.textContent = status === 409
                    ? 'Tags changed while this editor was open. Copy your changes, then close and reopen the editor.'
                    : status === 401 || status === 403
                        ? 'Administrator permissions are required. Your session may have expired.'
                        : 'Unable to save tags. Check your connection and try again (maximum 100 tags, 256 characters each).';
                error.hidden = false;
            } finally {
                busy = false;
                form.querySelectorAll('button, input').forEach(element => { element.disabled = false; });
            }
        });
        dialogState = { close };
        render();
        document.body.append(dialog);
        input.focus();
        suggestions(ctx).then(result => {
            if (!dialog.isConnected) return;
            knownTags = result;
            renderSuggestions();
        });
    }

    function renderSavedTags(tags) {
        const container = visiblePage().querySelector('.itemTags');
        if (!container) return;
        const template = container.querySelector('a');
        const prefix = template && container.firstChild?.nodeType === Node.TEXT_NODE
            ? container.firstChild.textContent : 'Tags: ';
        const children = [document.createTextNode(prefix)];
        tags.forEach((tag, index) => {
            if (index) children.push(document.createTextNode(', '));
            if (template && template.hash.includes('?')) {
                const link = template.cloneNode(false);
                const [path, query] = template.hash.split('?');
                const parameters = new URLSearchParams(query);
                parameters.set('tag', tag);
                link.hash = `${path}?${parameters}`;
                link.textContent = tag;
                children.push(link);
            } else {
                children.push(document.createTextNode(tag));
            }
        });
        container.replaceChildren(...children);
        container.classList.toggle('hide', !tags.length);
    }

    document.addEventListener('viewshow', schedule, { signal: listeners.signal });
    window.addEventListener('hashchange', schedule, { signal: listeners.signal });
    const observer = new MutationObserver(() => {
        if (!dialogState) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // ApiClient is initialized asynchronously and may change when switching accounts/servers.
    const sessionWatcher = window.setInterval(() => {
        const current = context();
        const home = homeContext();
        if ((current?.key || '') !== activeKey || (home?.session || '') !== homeKey) schedule();
    }, 1000);

    window.JellyfinTagEditor = {
        refresh: () => { activeKey = ''; schedule(); },
        destroy: () => {
            destroyed = true;
            ++revision;
            listeners.abort();
            observer.disconnect();
            window.clearTimeout(timer);
            window.clearInterval(sessionWatcher);
            dialogState?.close(true);
            removeLauncher();
            removePopularTags();
        }
    };
    schedule();
}());

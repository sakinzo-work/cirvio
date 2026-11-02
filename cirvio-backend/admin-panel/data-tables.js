/* Keep full data available for search/export; only mount the current page. */
const AdminTables = (() => {
    const tables = new Map();
    const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const searchable = value => {
        if (Array.isArray(value)) return value.map(searchable).join(' ');
        if (value && typeof value === 'object') return Object.entries(value)
            .filter(([key]) => !['images', 'img', 'photo', 'password', '__v'].includes(key))
            .map(([, item]) => searchable(item)).join(' ');
        return String(value ?? '').toLowerCase();
    };

    function matching(state) {
        const terms = state.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
        return state.rows.filter(row => (!state.predicate || state.predicate(row.item)) && terms.every(term => row.search.includes(term)));
    }

    function draw(state) {
        const rows = matching(state);
        const pages = Math.max(1, Math.ceil(rows.length / state.size));
        state.page = Math.min(state.page, pages);
        const start = (state.page - 1) * state.size;
        const count = state.table.tHead.rows[0].cells.length;
        state.table.tBodies[0].innerHTML = rows.length
            ? rows.slice(start, start + state.size).map(row => state.render(row.item)).join('')
            : `<tr class="empty-row"><td colspan="${count}" class="empty-state">${escape(state.query ? 'No results match your search. Try another search term.' : state.empty)}</td></tr>`;
        state.footer.querySelector('[data-page-summary]').textContent = rows.length
            ? `${start + 1}–${Math.min(start + state.size, rows.length)} of ${rows.length}${state.query || state.predicate ? ` matching (${state.rows.length} total)` : ''}`
            : `0 of ${state.rows.length} results`;
        state.footer.querySelector('[data-page-number]').textContent = `Page ${state.page} of ${pages}`;
        state.footer.querySelector('[data-page-prev]').disabled = state.page === 1;
        state.footer.querySelector('[data-page-next]').disabled = state.page === pages;
    }

    function set(id, items, render, empty) {
        const table = document.getElementById(id);
        if (!table) return;
        let state = tables.get(id);
        if (!state) {
            const footer = document.createElement('div');
            footer.className = 'data-pagination';
            footer.innerHTML = `<span data-page-summary role="status" aria-live="polite"></span>
                <label>Rows <select aria-label="Rows per page"><option>10</option><option selected>25</option><option>50</option></select></label>
                <div class="data-page-controls"><button type="button" class="soft-btn" data-page-prev>Previous</button><span data-page-number></span><button type="button" class="soft-btn" data-page-next>Next</button></div>`;
            table.closest('.table-wrap').after(footer);
            state = { table, footer, page: 1, size: 25, query: '' };
            const toolbarSize = table.closest('.data-card')?.querySelector('.table-toolbar select');
            if (toolbarSize) {
                toolbarSize.value = '25';
                toolbarSize.setAttribute('aria-label', 'Rows per page');
                toolbarSize.addEventListener('change', () => {
                    state.size = Number(toolbarSize.value);
                    state.page = 1;
                    footer.querySelector('select').value = toolbarSize.value;
                    draw(state);
                });
            }
            footer.querySelector('[data-page-prev]').addEventListener('click', () => { state.page--; draw(state); });
            footer.querySelector('[data-page-next]').addEventListener('click', () => { state.page++; draw(state); });
            footer.querySelector('select').addEventListener('change', event => { state.size = Number(event.target.value); state.page = 1; if (toolbarSize) toolbarSize.value = event.target.value; draw(state); });
            tables.set(id, state);
        }
        state.rows = items.map(item => ({ item, search: searchable(item) }));
        state.render = render;
        state.empty = empty;
        draw(state);
    }

    return {
        set,
        where(id, predicate) {
            const state = tables.get(id);
            if (!state) return;
            state.predicate = predicate;
            state.page = 1;
            draw(state);
        },
        filter(id, query) {
            const state = tables.get(id);
            if (!state) return false;
            if (state.query !== query) { state.query = query; state.page = 1; }
            draw(state);
            return true;
        },
        exportRows(id) {
            const state = tables.get(id);
            if (!state) return null;
            const body = document.createElement('tbody');
            body.innerHTML = matching(state).map(row => state.render(row.item)).join('');
            return [state.table.tHead.rows[0], ...body.rows];
        }
    };
})();

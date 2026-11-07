/* Staff-only profile details, fetched on demand rather than copied from stale table rows. */
(() => {
    const dialog = document.getElementById('userProfileDialog');
    const content = document.getElementById('userProfileContent');
    const status = document.getElementById('userProfileStatus');
    const retry = document.getElementById('retryUserProfile');
    let userId = '';
    let controller;

    async function load() {
        controller?.abort();
        const current = controller = new AbortController();
        content.innerHTML = '';
        content.setAttribute('aria-busy', 'true');
        status.textContent = 'Loading user profile...';
        retry.hidden = true;
        try {
            const { user } = await api('/api/admin/users/' + encodeURIComponent(userId), { signal: current.signal });
            if (current.signal.aborted || !dialog.open) return;
            if (!user?._id) throw new Error('The profile could not be loaded. Please retry.');
            const detail = (label, value) => `<div><dt>${label}</dt><dd>${esc(value || 'Not provided')}</dd></div>`;
            const joined = user.createdAt && Number.isFinite(Date.parse(user.createdAt)) ? new Date(user.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
            content.innerHTML = `
                <div class="admin-profile-heading">
                    <div class="admin-profile-avatar"><span aria-hidden="true">${esc((user.name || 'U').trim().charAt(0).toUpperCase())}</span></div>
                    <div><h3>${esc(user.name || 'User')}</h3><p>${esc(user.role || 'User')} · ${esc(user.status || 'Status unavailable')}</p></div>
                </div>
                <dl class="admin-profile-details">
                    ${detail('User ID', user._id)}${detail('Full name', user.name)}${detail('Phone number', user.phone)}${detail('Email', user.email)}
                    ${detail('College', user.college)}${detail('Course', user.course)}${detail('City', user.city)}${detail('Joined', joined)}
                </dl>
                ${String(user._id) !== String(CURRENT_USER?._id || CURRENT_USER?.id) ? `<button type="button" class="row-btn btn-approve admin-profile-message" data-message-user="${esc(user._id)}">Message user</button>` : ''}
            `;
            if (/^(https?:\/\/|data:image\/(?:png|jpe?g|webp);base64,)/i.test(user.photo || '')) {
                const image = document.createElement('img');
                image.alt = (user.name || 'User') + ' profile picture';
                image.addEventListener('error', () => image.remove(), { once: true });
                image.src = user.photo;
                content.querySelector('.admin-profile-avatar').appendChild(image);
            }
            status.textContent = '';
        } catch (error) {
            if (current.signal.aborted || !dialog.open) return;
            status.textContent = error.message || 'Could not load this profile.';
            retry.hidden = false;
        } finally {
            if (controller === current) content.setAttribute('aria-busy', 'false');
        }
    }

    function open(id) {
        userId = String(id || '');
        if (!userId) return;
        if (!dialog.open) dialog.showModal();
        load();
    }
    function close() { if (dialog.open) dialog.close(); }
    dialog.addEventListener('close', () => controller?.abort());
    document.getElementById('closeUserProfile').addEventListener('click', close);
    retry.addEventListener('click', load);
    document.addEventListener('click', event => {
        const trigger = event.target.closest('[data-view-user]');
        if (trigger && !trigger.disabled) open(trigger.dataset.viewUser);
    });
    window.CirvioAdminProfiles = { open, close, showError: message => { if (dialog.open) status.textContent = message; } };
})();

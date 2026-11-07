/* Start private user/staff conversations from the inbox, users or listing review. */
const recipientDialog = document.getElementById('newMessageDialog');
const recipientSearch = document.getElementById('messageRecipientSearch');
const recipientList = document.getElementById('messageRecipientList');
const recipientStatus = document.getElementById('messageRecipientStatus');
const recipientRetry = document.getElementById('retryMessageRecipients');
const recipientClose = document.getElementById('closeNewMessage');
let recipientSearchController;
let recipientSearchTimer;
let startingConversation = false;

async function searchMessageRecipients() {
    recipientSearchController?.abort();
    const controller = new AbortController();
    recipientSearchController = controller;
    recipientList.innerHTML = '';
    recipientList.setAttribute('aria-busy', 'true');
    recipientStatus.textContent = 'Loading users...';
    recipientRetry.hidden = true;
    try {
        const { users } = await api('/api/admin/message-recipients?q=' + encodeURIComponent(recipientSearch.value.trim()), { signal: controller.signal });
        if (controller.signal.aborted || !recipientDialog.open) return;
        recipientList.innerHTML = users.map(user => `
            <button type="button" class="message-recipient" data-message-user="${esc(user._id)}">
              <span class="mini-avatar">${iconSvg('user')}</span>
              <span><strong>${esc(user.name || 'User')}</strong><small>${esc(user.email || user.phone || 'No contact details')}</small><small>${esc([user.college, user.city, user.status === 'suspended' ? 'Suspended account' : ''].filter(Boolean).join(' · '))}</small></span>
              <span class="recipient-action">Chat</span>
            </button>`).join('');
        recipientStatus.textContent = users.length ? (users.length === 30 ? 'Showing the first 30 users. Search to narrow the results.' : `${users.length} user${users.length === 1 ? '' : 's'} found`) : 'No users found. Try another name, email or phone.';
    } catch (error) {
        if (controller.signal.aborted || !recipientDialog.open) return;
        recipientStatus.textContent = error.message;
        recipientRetry.hidden = false;
    } finally {
        if (recipientSearchController === controller) recipientList.setAttribute('aria-busy', 'false');
    }
}

document.getElementById('newMessageBtn').addEventListener('click', () => {
    recipientSearch.value = '';
    recipientDialog.showModal();
    recipientSearch.focus();
    searchMessageRecipients();
});
recipientClose.addEventListener('click', () => { if (!startingConversation) recipientDialog.close(); });
recipientDialog.addEventListener('cancel', event => { if (startingConversation) event.preventDefault(); });
recipientDialog.addEventListener('close', () => {
    clearTimeout(recipientSearchTimer);
    recipientSearchController?.abort();
});
recipientSearch.addEventListener('input', () => {
    clearTimeout(recipientSearchTimer);
    recipientSearchController?.abort();
    recipientList.innerHTML = '';
    recipientStatus.textContent = 'Searching users...';
    recipientSearchTimer = setTimeout(searchMessageRecipients, 220);
});
recipientRetry.addEventListener('click', searchMessageRecipients);

async function openAdminConversation(context, trigger) {
    if (startingConversation) return;
    startingConversation = true;
    clearTimeout(recipientSearchTimer);
    recipientSearchController?.abort();
    const originalContent = trigger.innerHTML;
    trigger.disabled = true;
    trigger.textContent = 'Opening...';
    recipientClose.disabled = true;
    recipientSearch.disabled = true;
    recipientRetry.disabled = true;
    recipientList.querySelectorAll('button').forEach(button => { button.disabled = true; });
    if (recipientDialog.open) recipientStatus.textContent = 'Opening conversation...';
    try {
        const { message } = await api('/api/admin/messages/conversations', { method: 'POST', body: JSON.stringify(context) });
        if (!message?._id) throw new Error('The server did not open the conversation. Please try again.');
        messageRevision++;
        adminLoads.get('messages')?.controller.abort();
        ADMIN_MESSAGES.set(String(message._id), message);
        document.getElementById('messageInboxList').dataset.signature = '';
        if (recipientDialog.open) recipientDialog.close();
        window.CirvioAdminProfiles?.close();
        closeListingImages();
        // Release the listing modal's inert state before moving to the conversation.
        syncModalAccess();
        activateTab('messages', { load: false });
        document.getElementById('messagesSearchInput').value = '';
        document.getElementById('globalSearchInput').value = '';
        activeMessageFilter = 'all';
        document.querySelectorAll('[data-message-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.messageFilter === 'all')));
        renderAdminMessages();
        handleMessageRowClick(null, String(message._id));
        if (!mobileLayout.matches) document.getElementById('sideReplyText')?.focus();
    } catch (error) {
        window.CirvioAdminProfiles?.showError(error.message);
        if (recipientDialog.open) recipientStatus.textContent = error.message;
        else showAdminNotice(error.message);
    } finally {
        startingConversation = false;
        trigger.disabled = false;
        trigger.innerHTML = originalContent;
        recipientClose.disabled = false;
        recipientSearch.disabled = false;
        recipientRetry.disabled = false;
        recipientList.querySelectorAll('button').forEach(button => { button.disabled = false; });
    }
}

document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-message-user], [data-message-listing]');
    if (!trigger || trigger.disabled) return;
    const context = trigger.dataset.messageListing ? { productId: trigger.dataset.messageListing } : { userId: trigger.dataset.messageUser };
    openAdminConversation(context, trigger);
});

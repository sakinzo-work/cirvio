/* Shared by the website and admin app. Permission is requested only from the enable button. */
window.createCirvioPushClient = function ({ api, token, app, worker, scope, button, status }) {
    let subscription = null;
    let busy = false;
    const supported = window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
    const say = message => { status.textContent = message; };
    const label = () => { button.textContent = subscription ? 'Disable notifications' : 'Enable notifications'; };
    function publicKeyBytes(value) {
        const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
        return Uint8Array.from(raw, character => character.charCodeAt(0));
    }
    async function registration() {
        const registered = await navigator.serviceWorker.register(worker, { scope, updateViaCache: 'none' });
        if (registered.active) return registered;
        const controller = registered.installing || registered.waiting;
        if (!controller) throw new Error('Please reload the app and try again.');
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => { controller.removeEventListener('statechange', changed); reject(new Error('App setup took too long. Please retry.')); }, 15000);
            function changed() {
                if (controller.state === 'activated') { clearTimeout(timer); controller.removeEventListener('statechange', changed); resolve(); }
                if (controller.state === 'redundant') { clearTimeout(timer); controller.removeEventListener('statechange', changed); reject(new Error('Please update the app and try again.')); }
            }
            controller.addEventListener('statechange', changed); changed();
        });
        return registered;
    }
    async function disconnect() {
        if (!supported) return;
        const auth = token();
        const registered = await navigator.serviceWorker.getRegistration(new URL(scope, location.href).href);
        const current = subscription || await registered?.pushManager.getSubscription();
        if (!current) return;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        try {
            if (auth) await api('/api/notifications/subscriptions', { method: 'DELETE', signal: controller.signal, headers: { Authorization: `Bearer ${auth}` }, body: JSON.stringify({ endpoint: current.endpoint }) });
        } catch { /* Unsubscribing also prevents delivery when the server is offline. */ }
        finally { clearTimeout(timer); await current.unsubscribe(); subscription = null; label(); }
    }
    if (!supported) {
        button.disabled = true;
        say('Phone alerts need a supported HTTPS browser. On iPhone, install this app on your Home Screen first. In-app messages still work.');
    } else {
        navigator.serviceWorker.getRegistration(new URL(scope, location.href).href).then(async registered => {
            subscription = await registered?.pushManager.getSubscription() || null;
            label();
            if (subscription && token() && Notification.permission === 'granted') {
                await api('/api/notifications/subscriptions', { method: 'POST', body: JSON.stringify({ app, subscription: subscription.toJSON() }) });
                say('Message notifications are enabled on this device.');
            }
        }).catch(() => say('Could not check notification settings. Use Enable notifications to retry.'));
    }
    button.addEventListener('click', async () => {
        if (busy || !supported) return;
        if (!token()) { say('Sign in to enable message notifications.'); return; }
        busy = true; button.disabled = true;
        try {
            if (subscription) { await disconnect(); say('Phone notifications are off. Your in-app messages are still available.'); return; }
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') { say('Notifications are blocked. Allow them in your browser settings to receive phone alerts.'); return; }
            say('Enabling message notifications...');
            const { publicKey } = await api('/api/notifications/push-key');
            const registered = await registration();
            subscription = await registered.pushManager.getSubscription() || await registered.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyBytes(publicKey) });
            try { await api('/api/notifications/subscriptions', { method: 'POST', body: JSON.stringify({ app, subscription: subscription.toJSON() }) }); }
            catch (error) { await subscription.unsubscribe(); subscription = null; throw error; }
            say(registered.waiting ? 'Alerts enabled. Apply the available app update to finish setup.' : 'Message notifications are enabled on this device.');
        } catch (error) { say(error.message || 'Notifications could not be enabled. Please retry.'); }
        finally { busy = false; button.disabled = false; label(); }
    });
    return { disconnect };
};

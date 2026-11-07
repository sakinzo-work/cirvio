/* Shared by the website and admin app. Permission is requested only from the enable button. */
window.createCirvioPushClient = function ({ api, token, app, worker, scope, button, status, onChange = () => {} }) {
    let subscription = null;
    let busy = false;
    let checking = true;
    let enabled = false;
    let message = '';
    const supported = window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
    const state = () => ({ supported, enabled, busy: busy || checking, permission: supported ? Notification.permission : 'unsupported', message });
    function render() {
        if (button) {
            button.disabled = !supported || busy || checking;
            button.textContent = busy ? 'Please wait...' : (enabled ? 'Disable notifications' : 'Enable notifications');
            button.setAttribute('aria-pressed', String(enabled));
        }
        if (status) status.textContent = message;
        onChange(state());
    }
    const say = value => { message = value; render(); };
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
        if (!current) { enabled = false; render(); return; }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        try {
            if (auth) await api('/api/notifications/subscriptions', { method: 'DELETE', signal: controller.signal, headers: { Authorization: `Bearer ${auth}` }, body: JSON.stringify({ endpoint: current.endpoint }) });
        } catch { /* Unsubscribing also prevents delivery when the server is offline. */ }
        finally {
            clearTimeout(timer);
            if (!await current.unsubscribe()) throw new Error('Could not turn off notifications. Please retry.');
            subscription = null; enabled = false; render();
        }
    }
    render();
    const ready = (async () => {
        if (!supported) {
            say('Phone alerts need a supported HTTPS browser. On iPhone, install CIRVIO on your Home Screen first. In-app notifications still work.');
        } else {
            try {
                const registered = await navigator.serviceWorker.getRegistration(new URL(scope, location.href).href);
                subscription = await registered?.pushManager.getSubscription() || null;
                if (subscription && token() && Notification.permission === 'granted') {
                    await api('/api/notifications/subscriptions', { method: 'POST', body: JSON.stringify({ app, subscription: subscription.toJSON() }) });
                    enabled = true;
                    say('Notifications are enabled on this device.');
                } else if (Notification.permission === 'denied') say('Notifications are blocked. Allow them in your browser site settings, then enable them here.');
                else say('Enable phone alerts for new messages' + (app === 'site' ? ' and listing updates.' : '.'));
            } catch { say('Could not check notification settings. Use Enable notifications to retry.'); }
        }
        checking = false; render();
    })();
    async function enable() {
        if (busy || checking || !supported || enabled) return;
        if (!token()) { say('Sign in to enable notifications.'); return; }
        busy = true; render();
        try {
            const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
            if (permission !== 'granted') {
                say(permission === 'denied' ? 'Notifications are blocked. Allow them in your browser site settings, then enable them here.' : 'Permission was not granted. You can enable notifications later in Settings.');
                return;
            }
            say('Enabling notifications...');
            const { publicKey } = await api('/api/notifications/push-key');
            const registered = await registration();
            subscription = await registered.pushManager.getSubscription() || await registered.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyBytes(publicKey) });
            try { await api('/api/notifications/subscriptions', { method: 'POST', body: JSON.stringify({ app, subscription: subscription.toJSON() }) }); }
            catch (error) { await subscription.unsubscribe(); subscription = null; throw error; }
            enabled = true;
            say(registered.waiting ? 'Alerts enabled. Apply the available app update to finish setup.' : 'Notifications are enabled on this device.');
        } catch (error) { say(error.message || 'Notifications could not be enabled. Please retry.'); }
        finally { busy = false; render(); }
    }
    async function toggle() {
        if (busy || checking || !supported) return;
        if (!enabled) return enable();
        busy = true; render();
        try { await disconnect(); say('Phone notifications are off. Your in-app notifications are still available.'); }
        catch (error) { say(error.message || 'Could not turn off notifications. Please retry.'); }
        finally { busy = false; render(); }
    }
    button?.addEventListener('click', toggle);
    return { disconnect, enable, toggle, ready, state };
};

/* Installation and connectivity are available on both the login and staff screens. */
(() => {
    let installPrompt = null;
    let registration = null;
    let applyingUpdate = false;
    const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    let installed = standalone();

    function updateInstallButtons() {
        document.querySelectorAll('[data-install-admin]').forEach(button => { button.hidden = installed || standalone(); });
    }

    function showInstallHelp() {
        let dialog = document.getElementById('adminInstallHelp');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'adminInstallHelp';
            dialog.className = 'install-help';
            dialog.setAttribute('aria-labelledby', 'installHelpTitle');
            dialog.innerHTML = `<h2 id="installHelpTitle">Install CIRVIO Admin</h2>
                <p>Add the dashboard to your home screen for quick access in its own app window.</p>
                <div id="installHelpSteps"></div>
                <p class="sub">An internet connection is needed for staff data and messages.</p>
                <form method="dialog"><button class="soft-btn" type="submit">Got it</button></form>`;
            document.body.appendChild(dialog);
            dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
        }
        const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const steps = document.getElementById('installHelpSteps');
        if (!window.isSecureContext) {
            steps.textContent = 'Open this dashboard using its HTTPS address, then choose Install or Add to Home Screen from your browser menu.';
        } else if (ios) {
            steps.textContent = 'In Safari, tap Share, choose Add to Home Screen, then tap Add. If you opened a link inside another app, open it in Safari first.';
        } else {
            steps.textContent = 'Open your browser menu and choose Install app or Add to Home Screen. If the option is unavailable, open the dashboard in Chrome or Edge and try again.';
        }
        dialog.showModal();
    }

    document.querySelectorAll('[data-install-admin]').forEach(button => button.addEventListener('click', async () => {
        if (!installPrompt) { showInstallHelp(); return; }
        const prompt = installPrompt;
        installPrompt = null;
        try { await prompt.prompt(); await prompt.userChoice; }
        catch { showInstallHelp(); }
        updateInstallButtons();
    }));

    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        installPrompt = event;
        updateInstallButtons();
    });
    window.addEventListener('appinstalled', () => { installed = true; installPrompt = null; updateInstallButtons(); });
    window.matchMedia('(display-mode: standalone)').addEventListener('change', updateInstallButtons);
    updateInstallButtons();

    function updateConnection() {
        const offline = navigator.onLine === false;
        document.body.classList.toggle('is-offline', offline);
        const banner = document.getElementById('adminConnectionStatus');
        if (banner) banner.hidden = !offline;
        const send = document.getElementById('sideReplySend');
        if (send) send.disabled = offline || send.dataset.sending === 'true';
    }
    window.addEventListener('offline', updateConnection);
    window.addEventListener('online', () => {
        updateConnection();
        window.dispatchEvent(new CustomEvent('admin:online'));
    });
    updateConnection();

    function updateViewport() {
        document.documentElement.style.setProperty('--app-height', `${Math.round(window.visualViewport?.height || window.innerHeight)}px`);
    }
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.addEventListener('resize', updateViewport);
    updateViewport();

    document.getElementById('updateAdminAppBtn').addEventListener('click', () => {
        if (!registration?.waiting) return;
        applyingUpdate = true;
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    });

    if ('serviceWorker' in navigator && window.isSecureContext) {
        navigator.serviceWorker.addEventListener('controllerchange', () => { if (applyingUpdate) location.reload(); });
        window.addEventListener('load', async () => {
            try {
                registration = await navigator.serviceWorker.register('./admin-sw.js', { scope: './', updateViaCache: 'none' });
                const showUpdate = () => {
                    if (registration.waiting && navigator.serviceWorker.controller) document.getElementById('adminUpdateNotice').hidden = false;
                };
                showUpdate();
                registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', showUpdate));
            } catch (error) {
                console.warn('Admin app installation is unavailable:', error.message);
            }
        });
    }
})();

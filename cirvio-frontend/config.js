const CIRVIO_PRODUCTION_API_BASE = 'https://cirvio.onrender.com';
const CIRVIO_LOCAL_API_BASE = 'http://localhost:5000';

function getDefaultCirvioApiBase() {
    const host = window.location.hostname;
    const isLocalFrontend = !host
        || host === 'localhost'
        || host === '127.0.0.1'
        || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)
        || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
    return isLocalFrontend ? CIRVIO_LOCAL_API_BASE : CIRVIO_PRODUCTION_API_BASE;
}

window.CIRVIO_API_BASE = window.CIRVIO_API_BASE || getDefaultCirvioApiBase();
window.CIRVIO_GOOGLE_CLIENT_ID = window.CIRVIO_GOOGLE_CLIENT_ID || '';

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
window.CIRVIO_FIREBASE_CONFIG = window.CIRVIO_FIREBASE_CONFIG || {
    apiKey: 'AIzaSyBOLdnTN3R6Fr4kxyoC62iTKaOTQbqdnqc',
    authDomain: 'cirvio.firebaseapp.com',
    projectId: 'cirvio',
    storageBucket: 'cirvio.firebasestorage.app',
    messagingSenderId: '764981688415',
    appId: '1:764981688415:web:74ac1d7c2b084fe40543ea',
    measurementId: 'G-J0908VD7BN'
};

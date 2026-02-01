import { TelegramClient, Api, sessions } from 'https://esm.sh/telegram@2.19.7?bundle';
const { StringSession } = sessions;

// --- VARIABLES ---
let client;
let API_ID, API_HASH;
let historyStack = [];

// --- UI HELPERS ---
const log = (msg) => {
    console.log(msg);
    const el = document.getElementById('status');
    if(el) el.textContent = msg;
};

const showScreen = (id) => {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'hidden'));
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const t = document.getElementById(id);
    if(t) {
        t.classList.remove('hidden');
        t.classList.add('active');
        setTimeout(() => {
            const f = t.querySelector('[tabindex="0"]');
            if(f) f.focus();
        }, 100);
    }
};

const goBack = () => {
    if(historyStack.length === 0) return;
    const v = document.getElementById('main-player');
    if(v) { v.pause(); v.src=""; }
    showScreen(historyStack.pop());
};

const navigateTo = (id) => {
    const curr = document.querySelector('.screen.active');
    if(curr) historyStack.push(curr.id);
    showScreen(id);
};

// --- LOGIQUE TELEGRAM ---

const startApp = async () => {
    const sId = localStorage.getItem('teletv_id');
    const sHash = localStorage.getItem('teletv_hash');
    const session = localStorage.getItem('teletv_session') || "";

    if(!sId || !sHash) {
        showScreen('config-screen');
        return;
    }

    API_ID = parseInt(sId);
    API_HASH = sHash;
    log("Initialisation Telegram...");

    try {
        client = new TelegramClient(new StringSession(session), API_ID, API_HASH, {
            connectionRetries: 5,
            useWSS: true, // Important pour le web
        });

        await client.connect();
        
        if (await client.checkAuthorization()) {
            log("Session valide !");
            loadChannels();
        } else {
            startQRLogin();
        }
    } catch (e) {
        log("Erreur Init: " + e.message);
        console.error(e);
        if(e.message.includes("API_ID")) {
            alert("API ID invalide");
            localStorage.clear();
            location.reload();
        }
    }
};

const startQRLogin = async () => {
    showScreen('auth-screen');
    const qrStatus = document.getElementById('qr-status');
    const qrDiv = document.getElementById('qrcode');
    qrDiv.innerHTML = "";

    try {
        log("Génération QR Code...");
        
        await client.signInUserWithQrCode({
            apiId: API_ID,
            apiHash: API_HASH,
            qrCode: (code) => {
                log("Nouveau QR Code reçu");
                qrStatus.textContent = "Scannez ce code avec Telegram (Réglages > Appareils)";
                qrDiv.innerHTML = "";
                new QRCode(qrDiv, {
                    text: `tg://login?token=${code.token.toString('base64url')}`,
                    width: 256,
                    height: 256
                });
            },
            onError: (err) => {
                log("Erreur QR: " + err.message);
                qrStatus.textContent = "Erreur: " + err.message;
                setTimeout(startQRLogin, 2000);
            }
        });

        log("Login succès !");
        localStorage.setItem('teletv_session', client.session.save());
        loadChannels();

    } catch (e) {
        log("Session expirée ou erreur: " + e.message);
        setTimeout(startQRLogin, 2000);
    }
};

const loadChannels = async () => {
    log("Chargement canaux...");
    navigateTo('channels-screen');
    const grid = document.getElementById('channels-grid');
    grid.innerHTML = "Chargement...";

    const dialogs = await client.getDialogs({ limit: 40 });
    grid.innerHTML = "";
    
    dialogs.forEach(d => {
        if(d.isChannel || d.isGroup) {
            const el = document.createElement('div');
            el.className = 'card';
            el.textContent = d.title;
            el.tabIndex = 0;
            el.onclick = () => loadVideos(d.entity);
            el.onkeydown = (e) => e.key === 'Enter' && loadVideos(d.entity);
            grid.appendChild(el);
        }
    });
    
    if(grid.firstChild) grid.firstChild.focus();
};

const loadVideos = async (entity) => {
    log("Recherche vidéos...");
    navigateTo('videos-screen');
    const grid = document.getElementById('videos-grid');
    grid.innerHTML = "Recherche...";

    const msgs = await client.getMessages(entity, {
        limit: 20,
        filter: new Api.InputMessagesFilterVideo()
    });

    grid.innerHTML = "";
    if(msgs.length === 0) grid.innerHTML = "Aucune vidéo trouvée";

    msgs.forEach(m => {
        const el = document.createElement('div');
        el.className = 'card';
        
        let dur = "";
        const attr = m.media?.document?.attributes?.find(a => a.duration);
        if(attr) dur = ` (${Math.floor(attr.duration/60)}:${attr.duration%60})`;
        
        el.textContent = `Video ${dur}`;
        el.tabIndex = 0;
        
        const play = () => playVideo(m);
        el.onclick = play;
        el.onkeydown = (e) => e.key === 'Enter' && play();
        
        grid.appendChild(el);
    });
    if(grid.firstChild) grid.firstChild.focus();
};

const playVideo = async (msg) => {
    log("Téléchargement du buffer...");
    try {
        const buffer = await client.downloadMedia(msg.media, { workers: 1 });
        const blob = new Blob([buffer], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        
        navigateTo('player-screen');
        const v = document.getElementById('main-player');
        v.src = url;
        v.play();
        v.focus();
    } catch(e) {
        log("Erreur lecture: " + e.message);
    }
};

// --- EVENTS ---
document.getElementById('save-config-btn').onclick = () => {
    const i = document.getElementById('api-id').value;
    const h = document.getElementById('api-hash').value;
    if(i && h) {
        localStorage.setItem('teletv_id', i);
        localStorage.setItem('teletv_hash', h);
        location.reload();
    }
};

document.getElementById('reset-config-btn').onclick = () => {
    localStorage.clear();
    location.reload();
};

document.onkeydown = (e) => {
    if(e.key === 'Backspace' || e.key === 'Escape') goBack();
};

// START
startApp();

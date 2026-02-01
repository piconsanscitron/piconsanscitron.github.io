import { TelegramClient, Api, sessions } from 'https://esm.sh/telegram@2.19.7?bundle';
const { StringSession } = sessions;

// --- VARIABLES ---
let client;
let API_ID, API_HASH;
let historyStack = [];
let wakeLock = null;

// --- UI HELPERS ---
const log = (msg) => {
    console.log(msg);
    const el = document.getElementById('status');
    if(el) {
        el.textContent = msg;
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 4000);
    }
};

// --- FIX SCROLL FIRE TV (SILK) ---
const focusElement = (el) => {
    if(!el) return;

    // 1. Force le focus navigateur
    el.focus({ preventScroll: true }); // On gère le scroll nous-mêmes

    // 2. Calcul de position
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    
    // Marge de sécurité (les barres d'outils Silk prennent de la place en haut/bas)
    const margin = 100; 

    // Est-ce que l'élément est hors champ ?
    const isAbove = rect.top < margin;
    const isBelow = rect.bottom > (viewportHeight - margin);

    if (isAbove || isBelow) {
        // Calcul du scroll nécessaire pour centrer l'élément
        const elementCenter = rect.top + (rect.height / 2);
        const screenCenter = viewportHeight / 2;
        const offset = elementCenter - screenCenter;

        window.scrollBy({
            top: offset,
            behavior: 'smooth'
        });
    }
};

// --- ANTI-VEILLE ---
const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
        try { wakeLock = await navigator.wakeLock.request('screen'); } 
        catch (err) { console.log("WakeLock Fail", err); }
    }
};
const releaseWakeLock = () => {
    if (wakeLock) { wakeLock.release(); wakeLock = null; }
};

// --- NAVIGATION ---
const showScreen = (id) => {
    // Cache tous les écrans
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    
    // Affiche le bon
    const t = document.getElementById(id);
    if(t) {
        t.classList.remove('hidden');
        t.classList.add('active');
        
        // Push State pour le bouton Back physique
        history.pushState({ screen: id }, null, "");
        
        // Scroll en haut lors du changement d'écran
        window.scrollTo(0, 0);

        // Focus intelligent avec délai pour Silk
        setTimeout(() => {
            if(id === 'channels-screen') {
                // Focus sur la recherche par défaut pour reset la position
                focusElement(document.getElementById('btn-search-nav'));
            } else if (id === 'player-screen') {
                focusElement(document.getElementById('main-player'));
            } else {
                // Premier élément focusable trouvé
                const f = t.querySelector('[tabindex="0"]');
                focusElement(f);
            }
        }, 300); // Délai augmenté pour Fire TV
    }
};

const goBack = () => {
    // Si on est à la racine, on ne fait rien
    if(document.getElementById('channels-screen').classList.contains('active')) return;

    if(historyStack.length > 0) {
        const prev = historyStack.pop();
        
        // Reset Player
        const v = document.getElementById('main-player');
        if(v) { v.pause(); v.removeAttribute('src'); v.load(); }
        
        document.getElementById('video-loader').classList.add('hidden');
        releaseWakeLock();
        
        showScreen(prev);
    } else {
        showScreen('channels-screen');
    }
};

const navigateTo = (id) => {
    const curr = document.querySelector('.screen.active');
    if(curr) historyStack.push(curr.id);
    showScreen(id);
};

// Interception Bouton Back Télécommande
window.onpopstate = (e) => {
    e.preventDefault();
    goBack();
    // On repousse un state pour ne jamais sortir de l'app par erreur
    history.pushState(null, null, window.location.href);
};

// --- CACHE OPFS ---
const clearVideoCache = async () => {
    if (!navigator.storage?.getDirectory) { alert("Non supporté"); return; }
    try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry('temp_video.mp4');
        alert("Cache vidé.");
    } catch (e) { alert("Déjà vide."); }
};

const checkDiskUsage = async () => {
    if (navigator.storage?.estimate) {
        const { usage } = await navigator.storage.estimate();
        const el = document.getElementById('disk-usage');
        if(el) el.textContent = `Cache: ${(usage/1024/1024).toFixed(0)} MB`;
    }
};

// --- TELEGRAM ---
const startApp = async () => {
    const sId = localStorage.getItem('teletv_id');
    const sHash = localStorage.getItem('teletv_hash');
    const session = localStorage.getItem('teletv_session') || "";

    // Hack historique
    history.replaceState({ screen: 'init' }, null, "");
    history.pushState({ screen: 'init' }, null, "");

    if(!sId || !sHash) { showScreen('config-screen'); return; }

    API_ID = parseInt(sId, 10);
    API_HASH = sHash;
    log("Connexion...");

    try {
        client = new TelegramClient(new StringSession(session), API_ID, API_HASH, {
            connectionRetries: 5, useWSS: true,
        });
        await client.connect();
        
        if (await client.checkAuthorization()) loadChannels();
        else startQRLogin();
    } catch (e) {
        log("Erreur: " + e.message);
        if(e.message.includes("API_ID")) {
            if(confirm("Config HS. Reset?")) { localStorage.clear(); location.reload(); }
        }
    }
};

const startQRLogin = async () => {
    showScreen('auth-screen');
    const qrDiv = document.getElementById('qrcode');
    qrDiv.innerHTML = "";

    try {
        const res = await client.invoke(new Api.auth.ExportLoginToken({ apiId: API_ID, apiHash: API_HASH, exceptIds: [] }));
        if (res instanceof Api.auth.LoginTokenSuccess) { loadChannels(); return; }

        const token = res.token.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        new QRCode(qrDiv, { text: `tg://login?token=${token}`, width: 256, height: 256 });

        const check = async () => {
            try {
                const r = await client.invoke(new Api.auth.ExportLoginToken({ apiId: API_ID, apiHash: API_HASH, exceptIds: [] }));
                if (r instanceof Api.auth.LoginTokenSuccess) {
                    localStorage.setItem('teletv_session', client.session.save());
                    loadChannels();
                } else setTimeout(check, 2000);
            } catch (e) { setTimeout(check, 3000); }
        };
        setTimeout(check, 2000);
    } catch (e) { log("Erreur QR: " + e.message); setTimeout(startQRLogin, 5000); }
};

const loadChannels = async () => {
    checkDiskUsage();
    navigateTo('channels-screen');
    const grid = document.getElementById('channels-grid');
    grid.innerHTML = "Chargement...";

    try {
        const dialogs = await client.getDialogs({ limit: 80 });
        grid.innerHTML = "";
        
        const filtered = dialogs.filter(d => (d.isChannel || d.isGroup) && !d.archived);
        filtered.sort((a, b) => (a.pinned === b.pinned) ? 0 : a.pinned ? -1 : 1);

        if(filtered.length === 0) { grid.innerHTML = "Aucun canal."; return; }

        filtered.forEach(d => {
            const el = document.createElement('div');
            el.className = 'card';
            el.innerHTML = `<div>${d.pinned ? '📌 ' : ''}${d.title}</div>`;
            el.tabIndex = 0;
            // FIX SCROLL: Listener explicite
            el.addEventListener('focus', () => focusElement(el));
            
            el.onclick = () => loadVideos(d.entity);
            el.onkeydown = (e) => e.key === 'Enter' && loadVideos(d.entity);
            grid.appendChild(el);
        });
        setTimeout(() => focusElement(grid.firstChild || document.getElementById('btn-search-nav')), 300);

    } catch (e) { log("Erreur: " + e.message); }
};

const loadVideos = async (entity) => {
    navigateTo('videos-screen');
    const grid = document.getElementById('videos-grid');
    grid.innerHTML = "Recherche...";
    document.getElementById('channel-title').textContent = entity.title || "Vidéos";

    try {
        const msgs = await client.getMessages(entity, { limit: 30, filter: new Api.InputMessagesFilterVideo() });
        grid.innerHTML = "";
        if(!msgs || msgs.length === 0) { grid.innerHTML = "Vide"; return; }

        for (const m of msgs) {
            const el = document.createElement('div');
            el.className = 'card video-card';
            let dur = "";
            const attr = m.media?.document?.attributes?.find(a => a.duration);
            if(attr) dur = `${Math.floor(attr.duration/60)}:${(attr.duration%60).toString().padStart(2,'0')}`;

            el.innerHTML = `
                <div class="thumb-placeholder" style="height:120px; background:#222; display:flex; align-items:center; justify-content:center;">...</div>
                <div class="meta" style="padding:10px;">
                    <div style="font-weight:bold; font-size:0.9rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${m.message || "Vidéo"}</div>
                    <div style="font-size:0.7rem; color:#aaa;">⏱ ${dur} | ${(m.media.document.size/1024/1024).toFixed(0)} MB</div>
                </div>
            `;
            el.tabIndex = 0;
            el.addEventListener('focus', () => focusElement(el));

            const play = () => playVideoStreaming(m);
            el.onclick = play;
            el.onkeydown = (e) => e.key === 'Enter' && play();
            grid.appendChild(el);

            if(m.media.document.thumbs) {
                const thumb = m.media.document.thumbs.find(t => t.className === 'PhotoSize');
                if(thumb) {
                    client.downloadMedia(m.media, { thumb }).then(buf => {
                        el.querySelector('.thumb-placeholder').innerHTML = `<img src="${URL.createObjectURL(new Blob([buf]))}" style="width:100%; height:100%; object-fit:cover;">`;
                    }).catch(()=>{});
                }
            }
        }
        setTimeout(() => focusElement(grid.firstChild), 300);
    } catch (e) { log("Erreur: " + e.message); }
};

const playVideoStreaming = async (msg) => {
    navigateTo('player-screen');
    const v = document.getElementById('main-player');
    const loader = document.getElementById('video-loader');
    const bar = document.getElementById('loader-bar');
    const txt = document.getElementById('loader-text');
    const btnCancel = document.getElementById('btn-cancel-load');
    
    v.src = "";
    loader.classList.remove('hidden');
    bar.style.width = '0%';
    txt.textContent = "Init...";
    requestWakeLock();
    
    let isCancelled = false;
    btnCancel.onclick = () => { isCancelled = true; goBack(); };
    setTimeout(() => btnCancel.focus(), 200);

    if (!navigator.storage?.getDirectory) { alert("Stockage HS"); return; }

    try {
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle('temp_video.mp4', { create: true });
        const writable = await fileHandle.createWritable();
        
        const size = msg.media.document.size;
        let downloaded = 0;
        
        for await (const chunk of client.iterDownload({ file: msg.media, requestSize: 1024 * 1024 })) {
            if(isCancelled) { await writable.close(); return; }
            await writable.write(chunk);
            downloaded += chunk.length;
            const pct = Math.round((downloaded / size) * 100);
            bar.style.width = `${pct}%`;
            txt.textContent = `DL: ${pct}%`;
        }
        await writable.close();
        if(isCancelled) return;
        
        loader.classList.add('hidden');
        v.src = URL.createObjectURL(await fileHandle.getFile());
        v.play();
        v.focus();
    } catch(e) {
        txt.textContent = "Err: " + e.message;
        if(e.name === 'QuotaExceededError') { if(confirm("Disque plein. Vider?")) clearVideoCache(); }
    }
};

const btnSave = document.getElementById('save-config-btn');
if(btnSave) btnSave.onclick = () => {
    localStorage.setItem('teletv_id', document.getElementById('api-id').value);
    localStorage.setItem('teletv_hash', document.getElementById('api-hash').value);
    location.reload();
};

document.getElementById('btn-search-nav').onclick = () => navigateTo('search-screen');
document.getElementById('btn-clear-cache').onclick = clearVideoCache;
document.getElementById('btn-reload').onclick = () => location.reload();
document.getElementById('btn-logout').onclick = () => { if(confirm("Déco?")) { localStorage.clear(); clearVideoCache(); location.reload(); }};
document.getElementById('btn-do-search').onclick = async () => {
    const q = document.getElementById('search-input').value;
    const resGrid = document.getElementById('search-results');
    resGrid.innerHTML = "Cherche...";
    try {
        const res = await client.invoke(new Api.contacts.Search({ q, limit: 10 }));
        resGrid.innerHTML = "";
        [...res.chats, ...res.users].filter(c => c.title || c.firstName).forEach(c => {
            const el = document.createElement('div');
            el.className = 'card';
            el.textContent = c.title || c.firstName;
            el.tabIndex = 0;
            el.addEventListener('focus', () => focusElement(el));
            el.onclick = () => loadVideos(c);
            el.onkeydown = (e) => e.key === 'Enter' && loadVideos(c);
            resGrid.appendChild(el);
        });
        setTimeout(() => focusElement(resGrid.firstChild), 200);
    } catch(e) { log("Erreur: " + e.message); }
};

document.onkeydown = (e) => { if(e.key === 'Backspace' || e.key === 'Escape') goBack(); };

startApp();

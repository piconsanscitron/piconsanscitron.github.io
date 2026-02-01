import { TelegramClient, Api, sessions } from 'https://esm.sh/telegram@2.19.7?bundle';
const { StringSession } = sessions;

// --- VARIABLES ---
let client;
let API_ID, API_HASH;
let historyStack = [];
let wakeLock = null; // Pour empêcher la veille

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

// --- FIX NAVIGATION TV (SCROLL AGRESSIF) ---
const focusElement = (el) => {
    if(el) {
        el.focus();
        // Méthode 1: Standard
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Méthode 2: Fallback manuel pour vieilles TV
        const rect = el.getBoundingClientRect();
        const isInView = (rect.top >= 0) && (rect.bottom <= window.innerHeight);
        if (!isInView) {
            window.scrollTo({
                top: window.scrollY + rect.top - (window.innerHeight / 2),
                behavior: 'smooth'
            });
        }
    }
};

// --- ANTI-VEILLE ---
const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake Lock actif');
        } catch (err) {
            console.error(`Wake Lock erreur: ${err.name}, ${err.message}`);
        }
    }
};
const releaseWakeLock = () => {
    if (wakeLock !== null) {
        wakeLock.release().then(() => { wakeLock = null; });
    }
};

// --- NAVIGATION ---
const showScreen = (id) => {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'hidden'));
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const t = document.getElementById(id);
    if(t) {
        t.classList.remove('hidden');
        t.classList.add('active');
        
        // Hack pour mapper le bouton Back du navigateur
        history.pushState({ screen: id }, null, "");
        
        setTimeout(() => {
            if(id === 'channels-screen') {
                focusElement(document.getElementById('btn-search-nav'));
            } else if (id === 'player-screen') {
                focusElement(document.getElementById('main-player'));
            } else {
                const f = t.querySelector('[tabindex="0"]');
                focusElement(f);
            }
        }, 150);
    }
};

const goBack = () => {
    // Si on est déjà à la racine, on ne fait rien (ou on laisse le navigateur quitter)
    if(document.getElementById('channels-screen').classList.contains('active')) return;

    if(historyStack.length > 0) {
        const prev = historyStack.pop();
        
        // Nettoyage Player
        const v = document.getElementById('main-player');
        if(v) { 
            v.pause(); 
            v.removeAttribute('src'); 
            v.load();
        }
        document.getElementById('video-loader').classList.add('hidden');
        releaseWakeLock(); // On relâche la veille
        
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

// Gestionnaire bouton Back navigateur (et télécommande)
window.onpopstate = (event) => {
    // Si l'utilisateur appuie sur Back, on intercepte
    // On empêche le retour arrière réel du navigateur et on utilise notre logique
    history.pushState(null, null, window.location.href);
    goBack();
};

// --- CACHE ---
const clearVideoCache = async () => {
    if (!navigator.storage || !navigator.storage.getDirectory) {
        alert("Non supporté."); return;
    }
    try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry('temp_video.mp4');
        alert("Cache vidé.");
    } catch (e) { alert("Déjà vide."); }
};

const checkDiskUsage = async () => {
    if (navigator.storage && navigator.storage.estimate) {
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

    // Hack initial pour l'historique
    history.replaceState({ screen: 'init' }, null, "");

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
            if(confirm("Reset Config?")) { localStorage.clear(); location.reload(); }
        }
    }
};

const startQRLogin = async () => {
    showScreen('auth-screen');
    const qrDiv = document.getElementById('qrcode');
    qrDiv.innerHTML = "";

    try {
        const result = await client.invoke(
            new Api.auth.ExportLoginToken({ apiId: API_ID, apiHash: API_HASH, exceptIds: [] })
        );
        if (result instanceof Api.auth.LoginTokenSuccess) { loadChannels(); return; }

        const base64 = result.token.toString('base64');
        const tokenString = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        new QRCode(qrDiv, { text: `tg://login?token=${tokenString}`, width: 256, height: 256 });

        const checkToken = async () => {
            try {
                const r = await client.invoke(new Api.auth.ExportLoginToken({ apiId: API_ID, apiHash: API_HASH, exceptIds: [] }));
                if (r instanceof Api.auth.LoginTokenSuccess) {
                    localStorage.setItem('teletv_session', client.session.save());
                    loadChannels();
                } else setTimeout(checkToken, 2000); 
            } catch (err) { setTimeout(checkToken, 3000); }
        };
        setTimeout(checkToken, 2000);
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
            // FIX SCROLL
            el.onfocus = () => focusElement(el);
            
            const open = () => loadVideos(d.entity);
            el.onclick = open;
            el.onkeydown = (e) => e.key === 'Enter' && open();
            grid.appendChild(el);
        });
        setTimeout(() => focusElement(grid.firstChild || document.getElementById('btn-search-nav')), 200);

    } catch (e) { log("Erreur: " + e.message); }
};

const loadVideos = async (entity) => {
    navigateTo('videos-screen');
    const grid = document.getElementById('videos-grid');
    grid.innerHTML = "Recherche...";
    document.getElementById('channel-title').textContent = entity.title || "Vidéos";

    try {
        const msgs = await client.getMessages(entity, {
            limit: 20, filter: new Api.InputMessagesFilterVideo()
        });

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
                    <div style="font-weight:bold; font-size:0.9rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                        ${m.message || "Vidéo"}
                    </div>
                    <div style="font-size:0.7rem; color:#aaa;">⏱ ${dur} | ${(m.media.document.size/1024/1024).toFixed(0)} MB</div>
                </div>
            `;
            el.tabIndex = 0;
            el.onfocus = () => focusElement(el);

            const play = () => playVideoStreaming(m);
            el.onclick = play;
            el.onkeydown = (e) => e.key === 'Enter' && play();
            
            grid.appendChild(el);

            if(m.media.document.thumbs) {
                const thumb = m.media.document.thumbs.find(t => t.className === 'PhotoSize');
                if(thumb) {
                    client.downloadMedia(m.media, { thumb: thumb }).then(buffer => {
                        const url = URL.createObjectURL(new Blob([buffer]));
                        el.querySelector('.thumb-placeholder').innerHTML = `<img src="${url}" style="width:100%; height:100%; object-fit:cover;">`;
                    }).catch(() => {});
                }
            }
        }
        setTimeout(() => focusElement(grid.firstChild), 200);

    } catch (e) { log("Erreur: " + e.message); }
};

// --- STREAMING AVANCÉ AVEC LOADER ---
const playVideoStreaming = async (msg) => {
    navigateTo('player-screen');
    const v = document.getElementById('main-player');
    const loader = document.getElementById('video-loader');
    const bar = document.getElementById('loader-bar');
    const txt = document.getElementById('loader-text');
    const btnCancel = document.getElementById('btn-cancel-load');
    
    // Reset UI
    v.src = "";
    loader.classList.remove('hidden');
    bar.style.width = '0%';
    txt.textContent = "Initialisation...";
    
    // Activer Anti-Veille
    requestWakeLock();
    
    // Gestion Annulation
    let isCancelled = false;
    btnCancel.onclick = () => { isCancelled = true; goBack(); };
    btnCancel.focus();

    if (!navigator.storage || !navigator.storage.getDirectory) {
        alert("Stockage non dispo. Impossible de lire."); return;
    }

    try {
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle('temp_video.mp4', { create: true });
        const writable = await fileHandle.createWritable();
        
        const size = msg.media.document.size;
        let downloaded = 0;
        
        txt.textContent = "Téléchargement (0%)...";

        for await (const chunk of client.iterDownload({
            file: msg.media,
            requestSize: 1024 * 1024,
        })) {
            if(isCancelled) { await writable.close(); return; }
            
            await writable.write(chunk);
            downloaded += chunk.length;
            
            // Mise à jour Barre
            const pct = Math.round((downloaded / size) * 100);
            bar.style.width = `${pct}%`;
            txt.textContent = `Téléchargement (${pct}%)...`;
        }
        
        await writable.close();
        
        if(isCancelled) return;
        
        // Lancement
        txt.textContent = "Prêt !";
        loader.classList.add('hidden'); // Cache le loader
        
        const file = await fileHandle.getFile();
        v.src = URL.createObjectURL(file);
        v.play();
        v.focus();

    } catch(e) {
        txt.textContent = "Erreur: " + e.message;
        if(e.name === 'QuotaExceededError') {
            if(confirm("Disque plein. Vider ?")) clearVideoCache();
        }
    }
};

// --- CONFIG ---
const btnSave = document.getElementById('save-config-btn');
if(btnSave) btnSave.onclick = () => {
    localStorage.setItem('teletv_id', document.getElementById('api-id').value);
    localStorage.setItem('teletv_hash', document.getElementById('api-hash').value);
    location.reload();
};

document.getElementById('btn-search-nav').onclick = () => navigateTo('search-screen');
document.getElementById('btn-clear-cache').onclick = clearVideoCache;
document.getElementById('btn-reload').onclick = () => location.reload();
document.getElementById('btn-logout').onclick = () => {
    if(confirm("Déco ?")) { localStorage.clear(); clearVideoCache(); location.reload(); }
};
document.getElementById('btn-do-search').onclick = async () => {
    const q = document.getElementById('search-input').value;
    const resGrid = document.getElementById('search-results');
    resGrid.innerHTML = "Cherche...";
    try {
        const res = await client.invoke(new Api.contacts.Search({ q: q, limit: 10 }));
        resGrid.innerHTML = "";
        const all = [...res.chats, ...res.users].filter(c => c.title || c.firstName);
        all.forEach(c => {
            const el = document.createElement('div');
            el.className = 'card';
            el.textContent = c.title || c.firstName;
            el.tabIndex = 0;
            el.onfocus = () => focusElement(el);
            el.onclick = () => loadVideos(c);
            el.onkeydown = (e) => e.key === 'Enter' && loadVideos(c);
            resGrid.appendChild(el);
        });
        setTimeout(() => focusElement(resGrid.firstChild), 100);
    } catch(e) { log("Erreur: " + e.message); }
};

document.onkeydown = (e) => {
    if(e.key === 'Backspace' || e.key === 'Escape') goBack();
};

startApp();

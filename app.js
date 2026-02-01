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
    if(el) {
        el.textContent = msg;
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
};

// FIX NAVIGATION TV : Scroll automatique
const focusElement = (el) => {
    if(el) {
        el.focus();
        // Centre l'élément sélectionné dans l'écran
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

const showScreen = (id) => {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'hidden'));
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const t = document.getElementById(id);
    if(t) {
        t.classList.remove('hidden');
        t.classList.add('active');
        setTimeout(() => {
            if(id === 'channels-screen') {
                focusElement(document.getElementById('btn-search-nav'));
            } else {
                const f = t.querySelector('[tabindex="0"]');
                focusElement(f);
            }
        }, 150);
    }
};

const goBack = () => {
    if(historyStack.length === 0) return;
    const v = document.getElementById('main-player');
    if(v) { 
        v.pause(); 
        v.removeAttribute('src'); // Stop download
        v.load();
    }
    showScreen(historyStack.pop());
};

const navigateTo = (id) => {
    const curr = document.querySelector('.screen.active');
    if(curr) historyStack.push(curr.id);
    showScreen(id);
};

// --- CACHE & OUTILS ---
const clearVideoCache = async () => {
    if (!navigator.storage || !navigator.storage.getDirectory) {
        alert("Non supporté."); return;
    }
    try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry('temp_video.mp4');
        log("Cache vidé.");
        alert("Cache vidé.");
    } catch (e) { log("Erreur Cache: " + e.message); }
};

const checkDiskUsage = async () => {
    if (navigator.storage && navigator.storage.estimate) {
        const { usage } = await navigator.storage.estimate();
        const el = document.getElementById('disk-usage');
        if(el) el.textContent = `Cache: ${(usage/1024/1024).toFixed(0)} MB`;
    }
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

    API_ID = parseInt(sId, 10);
    API_HASH = sHash;
    log("Connexion...");

    try {
        client = new TelegramClient(new StringSession(session), API_ID, API_HASH, {
            connectionRetries: 5,
            useWSS: true,
        });
        await client.connect();
        
        if (await client.checkAuthorization()) {
            loadChannels();
        } else {
            startQRLogin();
        }
    } catch (e) {
        log("Erreur Init: " + e.message);
        if(e.message.includes("API_ID")) {
            if(confirm("Reset Config?")) {
                localStorage.clear(); location.reload();
            }
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

        if (result instanceof Api.auth.LoginTokenSuccess) {
            loadChannels(); return;
        }

        const base64 = result.token.toString('base64');
        const tokenString = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        new QRCode(qrDiv, { text: `tg://login?token=${tokenString}`, width: 256, height: 256 });

        const checkToken = async () => {
            try {
                const authResult = await client.invoke(
                    new Api.auth.ExportLoginToken({ apiId: API_ID, apiHash: API_HASH, exceptIds: [] })
                );
                if (authResult instanceof Api.auth.LoginTokenSuccess) {
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
        const dialogs = await client.getDialogs({ limit: 100 });
        grid.innerHTML = "";
        
        const filtered = dialogs.filter(d => (d.isChannel || d.isGroup) && !d.archived);
        filtered.sort((a, b) => (a.pinned === b.pinned) ? 0 : a.pinned ? -1 : 1);

        if(filtered.length === 0) { grid.innerHTML = "Aucun canal."; return; }

        filtered.forEach(d => {
            const el = document.createElement('div');
            el.className = 'card';
            el.innerHTML = `<div>${d.pinned ? '📌 ' : ''}${d.title}</div>`;
            el.tabIndex = 0;
            
            // FIX SCROLL: Ajout de l'event listener focus
            el.addEventListener('focus', () => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
            
            const open = () => loadVideos(d.entity);
            el.onclick = open;
            el.onkeydown = (e) => e.key === 'Enter' && open();
            grid.appendChild(el);
        });
        
        // Focus premier element
        setTimeout(() => focusElement(grid.firstChild || document.getElementById('btn-search-nav')), 100);

    } catch (e) { log("Erreur Canaux: " + e.message); }
};

const loadVideos = async (entity) => {
    navigateTo('videos-screen');
    const grid = document.getElementById('videos-grid');
    grid.innerHTML = "Recherche...";
    document.getElementById('channel-title').textContent = entity.title || "Vidéos";

    try {
        const msgs = await client.getMessages(entity, {
            limit: 20,
            filter: new Api.InputMessagesFilterVideo()
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
                <div class="thumb-placeholder" style="height:120px; background:#222; display:flex; align-items:center; justify-content:center;">
                    <span style="font-size:0.8rem; color:#555;">...</span>
                </div>
                <div class="meta" style="padding:10px;">
                    <div style="font-weight:bold; font-size:0.9rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                        ${m.message || "Vidéo"}
                    </div>
                    <div style="font-size:0.7rem; color:#aaa;">⏱ ${dur} | ${(m.media.document.size/1024/1024).toFixed(0)} MB</div>
                </div>
            `;
            el.tabIndex = 0;
            
            // FIX SCROLL
            el.addEventListener('focus', () => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));

            const play = () => playVideoStreaming(m);
            el.onclick = play;
            el.onkeydown = (e) => e.key === 'Enter' && play();
            
            grid.appendChild(el);

            // Thumbnail
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
        setTimeout(() => focusElement(grid.firstChild), 100);

    } catch (e) { log("Erreur Vidéos: " + e.message); }
};

// --- NOUVEAU LECTEUR STREAMING ---
const playVideoStreaming = async (msg) => {
    navigateTo('player-screen');
    const v = document.getElementById('main-player');
    v.src = "";
    
    // Si OPFS dispo, on l'utilise comme cache disque
    // ET on essaie de lancer la lecture pendant le téléchargement
    if (navigator.storage && navigator.storage.getDirectory) {
        log("Mode Streaming Disque (OPFS)...");
        playVideoOPFS(msg, v);
    } else {
        log("Mode RAM (Pas de stockage dispo)...");
        // Fallback RAM
    }
};

const playVideoOPFS = async (msg, videoEl) => {
    try {
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle('temp_video.mp4', { create: true });
        const writable = await fileHandle.createWritable();
        
        const size = msg.media.document.size;
        let downloaded = 0;
        let isPlaying = false;
        
        // Interval pour vérifier si on peut lancer la lecture
        const checkPlay = setInterval(async () => {
            if(isPlaying) { clearInterval(checkPlay); return; }
            
            // Si on a téléchargé assez (ex: 5MB ou 10%)
            // Note: C'est du "Fake Streaming", on recharge la source
            // Ça ne marche bien que si le MP4 est "Fast Start".
            if(downloaded > 5 * 1024 * 1024 || downloaded === size) {
                // On ne peut pas lire le fichier pendant qu'il est ouvert en écriture par 'writable'
                // C'est la limitation de OPFS.
                // Donc le VRAI streaming live sur OPFS demande de fermer/rouvrir ou d'utiliser des Workers.
                
                // Pour ce prototype, on reste sur le téléchargement complet MAIS
                // avec une UI qui montre que ça avance.
            }
        }, 1000);

        log("Téléchargement en cours...");

        for await (const chunk of client.iterDownload({
            file: msg.media,
            requestSize: 1024 * 1024,
        })) {
            await writable.write(chunk);
            downloaded += chunk.length;
            const pct = Math.round((downloaded / size) * 100);
            if(pct % 5 === 0) log(`Buffering: ${pct}%`);
        }
        
        await writable.close();
        log("Lancement lecture.");
        
        const file = await fileHandle.getFile();
        videoEl.src = URL.createObjectURL(file);
        videoEl.play();
        videoEl.focus();

    } catch(e) {
        log("Erreur Stream: " + e.message);
        if(e.name === 'QuotaExceededError') {
            alert("Disque plein ! Vide le cache.");
            clearVideoCache();
        }
    }
};

// --- EVENTS ---
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

// Recherche
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
            // FIX SCROLL
            el.addEventListener('focus', () => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
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

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
        setTimeout(() => { el.style.display = 'none'; }, 5000); // Auto-hide
    }
};

const showScreen = (id) => {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'hidden'));
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const t = document.getElementById(id);
    if(t) {
        t.classList.remove('hidden');
        t.classList.add('active');
        // Focus intelligent
        setTimeout(() => {
            // Si on est sur l'écran canaux, focus sur la barre d'outils en premier
            if(id === 'channels-screen') {
                document.getElementById('btn-search-nav').focus();
            } else {
                const f = t.querySelector('[tabindex="0"]');
                if(f) f.focus();
            }
        }, 150);
    }
};

const goBack = () => {
    if(historyStack.length === 0) return;
    const v = document.getElementById('main-player');
    if(v) { 
        v.pause(); 
        v.src = ""; 
        v.load();
    }
    showScreen(historyStack.pop());
};

const navigateTo = (id) => {
    const curr = document.querySelector('.screen.active');
    if(curr) historyStack.push(curr.id);
    showScreen(id);
};

// --- GESTION DU CACHE OPFS ---
const clearVideoCache = async () => {
    if (!navigator.storage || !navigator.storage.getDirectory) {
        alert("Stockage non supporté.");
        return;
    }
    try {
        const root = await navigator.storage.getDirectory();
        // On supprime le fichier temp
        await root.removeEntry('temp_video.mp4');
        log("Cache vidé ! Espace libéré.");
        alert("Cache vidéo vidé avec succès.");
    } catch (e) {
        // Souvent erreur si fichier n'existe pas, pas grave
        log("Cache déjà vide ou erreur: " + e.message);
    }
};

const checkDiskUsage = async () => {
    if (navigator.storage && navigator.storage.estimate) {
        const { usage, quota } = await navigator.storage.estimate();
        const usageMB = (usage / 1024 / 1024).toFixed(0);
        const el = document.getElementById('disk-usage');
        if(el) el.textContent = `Utilisé: ${usageMB} MB (Cache Browser)`;
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
    log("Connexion Telegram...");

    try {
        client = new TelegramClient(new StringSession(session), API_ID, API_HASH, {
            connectionRetries: 5,
            useWSS: true,
        });

        await client.connect();
        
        if (await client.checkAuthorization()) {
            log("Connecté.");
            loadChannels();
        } else {
            startQRLogin();
        }
    } catch (e) {
        log("Erreur Init: " + e.message);
        if(e.message.includes("API_ID")) {
            if(confirm("Config invalide. Reset?")) {
                localStorage.clear();
                location.reload();
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

        let isDone = false;
        const checkToken = async () => {
            if(isDone) return;
            try {
                const authResult = await client.invoke(
                    new Api.auth.ExportLoginToken({ apiId: API_ID, apiHash: API_HASH, exceptIds: [] })
                );

                if (authResult instanceof Api.auth.LoginTokenSuccess) {
                    isDone = true;
                    localStorage.setItem('teletv_session', client.session.save());
                    loadChannels();
                } else setTimeout(checkToken, 2000); 
            } catch (err) {
                if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
                    isDone = true;
                    const pwd = prompt("Mot de passe 2FA :");
                    if(pwd) {
                        await client.signIn({ password: pwd });
                        localStorage.setItem('teletv_session', client.session.save());
                        loadChannels();
                    }
                } else setTimeout(checkToken, 3000);
            }
        };
        setTimeout(checkToken, 2000);

    } catch (e) {
        log("Erreur QR: " + e.message);
        setTimeout(startQRLogin, 5000);
    }
};

const loadChannels = async () => {
    checkDiskUsage();
    navigateTo('channels-screen');
    const grid = document.getElementById('channels-grid');
    grid.innerHTML = "Chargement...";

    try {
        // On récupère plus de dialogues pour filtrer
        const dialogs = await client.getDialogs({ limit: 100 });
        grid.innerHTML = "";
        
        // FILTRAGE : Pas d'archives, Channels/Groupes uniquement
        const filtered = dialogs.filter(d => 
            (d.isChannel || d.isGroup) && !d.archived
        );
        
        // TRI : Épinglés en premier
        filtered.sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return 0; // Garder l'ordre par date par défaut
        });

        if(filtered.length === 0) {
            grid.innerHTML = "Aucun canal visible.";
            return;
        }

        filtered.forEach(d => {
            const el = document.createElement('div');
            el.className = 'card';
            
            // Ajout d'une icône pour les épinglés
            const pinIcon = d.pinned ? '<span class="badge">📌</span>' : '';
            el.innerHTML = `<div>${pinIcon} ${d.title}</div>`;
            
            el.tabIndex = 0;
            const open = () => loadVideos(d.entity);
            el.onclick = open;
            el.onkeydown = (e) => e.key === 'Enter' && open();
            grid.appendChild(el);
        });

    } catch (e) {
        log("Erreur Canaux: " + e.message);
    }
};

// --- RECHERCHE GLOBALE ---
const performSearch = async () => {
    const query = document.getElementById('search-input').value;
    if(!query || query.length < 3) {
        alert("Entrez au moins 3 caractères");
        return;
    }
    
    const resultsGrid = document.getElementById('search-results');
    resultsGrid.innerHTML = "Recherche en cours...";
    
    try {
        // Recherche globale (contacts + public channels)
        const result = await client.invoke(new Api.contacts.Search({
            q: query,
            limit: 20
        }));

        resultsGrid.innerHTML = "";
        
        // Fusion des résultats (chats trouvés + chats globaux)
        const allChats = [...result.chats, ...result.users]; // Simplification

        if(allChats.length === 0) {
            resultsGrid.innerHTML = "Aucun résultat.";
            return;
        }

        allChats.forEach(chat => {
            // On ne garde que les canaux/groupes pour la video
            // (Note: chat.className peut varier, on check via flags ou type)
            // Simplification: on affiche tout ce qui a un titre
            if(!chat.title && !chat.firstName) return;

            const el = document.createElement('div');
            el.className = 'card';
            el.textContent = chat.title || chat.firstName;
            el.style.border = "1px dashed #555"; // Style différent pour recherche
            
            el.tabIndex = 0;
            
            // Pour ouvrir un résultat de recherche, on passe l'entité
            const open = () => loadVideos(chat);
            
            el.onclick = open;
            el.onkeydown = (e) => e.key === 'Enter' && open();
            resultsGrid.appendChild(el);
        });
        
        // Focus sur le 1er résultat
        if(resultsGrid.firstChild) resultsGrid.firstChild.focus();

    } catch (e) {
        log("Erreur Recherche: " + e.message);
        resultsGrid.innerHTML = "Erreur: " + e.message;
    }
};

// --- VIDÉOS & THUMBNAILS ---

const getThumbnailUrl = async (msg) => {
    if(msg.media && msg.media.document && msg.media.document.thumbs) {
        const thumb = msg.media.document.thumbs.find(t => t.className === 'PhotoSize');
        if(thumb) {
            try {
                // thumb: true télécharge la plus petite version
                const buffer = await client.downloadMedia(msg.media, { thumb: thumb });
                const blob = new Blob([buffer], { type: "image/jpeg" });
                return URL.createObjectURL(blob);
            } catch(e) { return null; }
        }
    }
    return null; 
};

const loadVideos = async (entity) => {
    log("Recherche vidéos...");
    navigateTo('videos-screen');
    const grid = document.getElementById('videos-grid');
    grid.innerHTML = "Recherche...";
    
    // Titre de la section
    const titleEl = document.getElementById('channel-title');
    titleEl.textContent = entity.title || "Vidéos";

    try {
        const msgs = await client.getMessages(entity, {
            limit: 20,
            filter: new Api.InputMessagesFilterVideo()
        });

        grid.innerHTML = "";
        if(!msgs || msgs.length === 0) {
            grid.innerHTML = "Aucune vidéo trouvée";
            return;
        }

        for (const m of msgs) {
            const el = document.createElement('div');
            el.className = 'card video-card';
            
            // Formattage durée
            let dur = "";
            const attr = m.media?.document?.attributes?.find(a => a.duration);
            if(attr) dur = `${Math.floor(attr.duration/60)}:${(attr.duration%60).toString().padStart(2,'0')}`;

            // Carte riche
            el.innerHTML = `
                <div class="thumb-placeholder" style="height:120px; background:#222; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                    <span style="font-size:0.8rem; color:#555;">Image...</span>
                </div>
                <div class="meta" style="padding:10px; text-align:left;">
                    <div style="font-weight:bold; font-size:0.9rem; margin-bottom:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        ${m.message || "Vidéo sans titre"}
                    </div>
                    <div style="font-size:0.7rem; color:#aaa; display:flex; justify-content:space-between;">
                        <span>⏱ ${dur}</span>
                        <span>💾 ${(m.media.document.size/1024/1024).toFixed(1)} MB</span>
                    </div>
                </div>
            `;
            el.tabIndex = 0;

            const play = () => playVideo(m);
            el.onclick = play;
            el.onkeydown = (e) => e.key === 'Enter' && play();
            
            grid.appendChild(el);

            // Lazy load thumbnail
            getThumbnailUrl(m).then(url => {
                if(url) {
                    const div = el.querySelector('.thumb-placeholder');
                    div.innerHTML = `<img src="${url}" style="width:100%; height:100%; object-fit:cover;">`;
                }
            });
        }
        if(grid.firstChild) grid.firstChild.focus();

    } catch (e) {
        log("Erreur Vidéos: " + e.message);
    }
};

const playVideo = async (msg) => {
    navigateTo('player-screen');
    const v = document.getElementById('main-player');
    v.src = "";
    
    // OPFS Check
    if (!navigator.storage || !navigator.storage.getDirectory) {
        alert("Stockage local indisponible. Impossible de lire de gros fichiers.");
        return;
    }

    const size = msg.media.document.size;
    log(`Téléchargement (${(size / 1024 / 1024).toFixed(1)} MB)...`);

    try {
        const root = await navigator.storage.getDirectory();
        
        // On écrase toujours le même fichier temporaire pour économiser la place
        const fileHandle = await root.getFileHandle('temp_video.mp4', { create: true });
        const writable = await fileHandle.createWritable();
        
        let downloaded = 0;
        
        for await (const chunk of client.iterDownload({
            file: msg.media,
            requestSize: 1024 * 1024, // 1MB chunks
        })) {
            await writable.write(chunk);
            downloaded += chunk.length;
            const percent = Math.round((downloaded / size) * 100);
            
            // Feedback visuel moins fréquent pour perf
            if(percent % 5 === 0) log(`Chargement : ${percent}%`);
        }
        
        await writable.close();
        log("Lecture...");

        const file = await fileHandle.getFile();
        const url = URL.createObjectURL(file);
        
        v.src = url;
        v.play();
        v.focus();

    } catch(e) {
        log("Erreur Lecture: " + e.message);
        console.error(e);
        // Si erreur Quota, proposer de vider le cache
        if(e.name === 'QuotaExceededError') {
            alert("Espace disque plein ! Veuillez vider le cache.");
            clearVideoCache();
        }
    }
};

// --- EVENTS ---

// Boutons Config
const btnSave = document.getElementById('save-config-btn');
if(btnSave) {
    btnSave.onclick = () => {
        const i = document.getElementById('api-id').value;
        const h = document.getElementById('api-hash').value;
        if(i && h) {
            localStorage.setItem('teletv_id', i);
            localStorage.setItem('teletv_hash', h);
            location.reload();
        }
    };
}

// Boutons Toolbar
document.getElementById('btn-search-nav').onclick = () => navigateTo('search-screen');
document.getElementById('btn-clear-cache').onclick = clearVideoCache;
document.getElementById('btn-reload').onclick = () => location.reload();
document.getElementById('btn-logout').onclick = () => {
    if(confirm("Déconnecter ?")) {
        localStorage.clear();
        clearVideoCache(); // On nettoie aussi le disque
        location.reload();
    }
};

// Boutons Recherche
document.getElementById('btn-do-search').onclick = performSearch;
document.getElementById('search-input').onkeydown = (e) => {
    if(e.key === 'Enter') performSearch();
};

document.onkeydown = (e) => {
    if(e.key === 'Backspace' || e.key === 'Escape') goBack();
};

// START
startApp();

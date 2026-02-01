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
            const f = t.querySelector('[tabindex="0"]');
            if(f) f.focus();
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
    log("Initialisation...");

    try {
        client = new TelegramClient(new StringSession(session), API_ID, API_HASH, {
            connectionRetries: 5,
            useWSS: true,
        });

        await client.connect();
        
        if (await client.checkAuthorization()) {
            log("Prêt.");
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
    const qrStatus = document.getElementById('qr-status');
    const qrDiv = document.getElementById('qrcode');
    qrDiv.innerHTML = "";
    qrStatus.textContent = "Génération du token...";

    try {
        const result = await client.invoke(
            new Api.auth.ExportLoginToken({
                apiId: API_ID,
                apiHash: API_HASH,
                exceptIds: [], 
            })
        );

        if (result instanceof Api.auth.LoginTokenSuccess) {
            log("Déjà connecté !");
            loadChannels();
            return;
        }

        const base64 = result.token.toString('base64');
        const tokenString = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        
        qrStatus.textContent = "Scannez avec Telegram > Réglages > Appareils";
        qrDiv.innerHTML = "";
        new QRCode(qrDiv, { text: `tg://login?token=${tokenString}`, width: 256, height: 256 });

        let isDone = false;
        const checkToken = async () => {
            if(isDone) return;
            try {
                const authResult = await client.invoke(
                    new Api.auth.ExportLoginToken({
                        apiId: API_ID,
                        apiHash: API_HASH,
                        exceptIds: [],
                    })
                );

                if (authResult instanceof Api.auth.LoginTokenSuccess) {
                    isDone = true;
                    localStorage.setItem('teletv_session', client.session.save());
                    loadChannels();
                } else {
                    setTimeout(checkToken, 2000); 
                }
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
        qrStatus.textContent = "Erreur: " + e.message;
        setTimeout(startQRLogin, 5000);
    }
};

const loadChannels = async () => {
    log("Chargement canaux...");
    navigateTo('channels-screen');
    const grid = document.getElementById('channels-grid');
    grid.innerHTML = "Chargement...";

    try {
        const dialogs = await client.getDialogs({ limit: 40 });
        grid.innerHTML = "";
        
        dialogs.forEach(d => {
            if(d.isChannel || d.isGroup) {
                const el = document.createElement('div');
                el.className = 'card';
                el.textContent = d.title || "Sans titre";
                el.tabIndex = 0;
                
                const open = () => loadVideos(d.entity);
                el.onclick = open;
                el.onkeydown = (e) => e.key === 'Enter' && open();
                
                grid.appendChild(el);
            }
        });
        
        if(grid.firstChild) grid.firstChild.focus();
    } catch (e) {
        log("Erreur Canaux: " + e.message);
    }
};

const getThumbnailUrl = async (msg) => {
    if(msg.media && msg.media.document && msg.media.document.thumbs) {
        const thumb = msg.media.document.thumbs.find(t => t.className === 'PhotoSize');
        if(thumb) {
            try {
                const buffer = await client.downloadMedia(msg.media, { thumb: thumb });
                const blob = new Blob([buffer], { type: "image/jpeg" });
                return URL.createObjectURL(blob);
            } catch(e) { console.error("Thumb error", e); }
        }
    }
    return null; 
};

const loadVideos = async (entity) => {
    log("Recherche vidéos...");
    navigateTo('videos-screen');
    const grid = document.getElementById('videos-grid');
    grid.innerHTML = "Recherche...";

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
            
            el.innerHTML = `
                <div class="thumb-placeholder" style="height:120px; background:#333; display:flex; align-items:center; justify-content:center;">
                    <span>Chargement...</span>
                </div>
                <div class="meta" style="padding:10px;">
                    <div style="font-weight:bold; margin-bottom:5px;">Vidéo</div>
                    <div style="font-size:0.8rem; color:#aaa; max-height:40px; overflow:hidden;">
                        ${m.message || "..."}
                    </div>
                </div>
            `;
            el.tabIndex = 0;

            const play = () => playVideo(m);
            el.onclick = play;
            el.onkeydown = (e) => e.key === 'Enter' && play();
            
            grid.appendChild(el);

            getThumbnailUrl(m).then(url => {
                if(url) {
                    const imgContainer = el.querySelector('.thumb-placeholder');
                    imgContainer.innerHTML = `<img src="${url}" style="width:100%; height:100%; object-fit:cover;">`;
                } else {
                    el.querySelector('.thumb-placeholder span').textContent = "Pas d'image";
                }
            });
        }
        
        if(grid.firstChild) grid.firstChild.focus();
    } catch (e) {
        log("Erreur Vidéos: " + e.message);
    }
};

// --- NOUVEAU SYSTÈME DE LECTURE (OPFS / Disque) ---
const playVideo = async (msg) => {
    navigateTo('player-screen');
    const v = document.getElementById('main-player');
    v.src = "";
    
    // Vérification du support OPFS
    if (!navigator.storage || !navigator.storage.getDirectory) {
        alert("Votre navigateur ne supporte pas OPFS (stockage fichier). Mise en RAM...");
        // Fallback RAM (code précédent)
        return playVideoRam(msg); 
    }

    const size = msg.media.document.size;
    log(`Préparation stockage disque (${(size / 1024 / 1024).toFixed(1)} MB)...`);

    try {
        // 1. Accès au disque virtuel privé
        const root = await navigator.storage.getDirectory();
        
        // 2. Création/Reset du fichier temporaire
        const fileHandle = await root.getFileHandle('temp_video.mp4', { create: true });
        
        // 3. Création du flux d'écriture
        const writable = await fileHandle.createWritable();
        
        let downloaded = 0;
        
        // 4. Téléchargement et écriture chunk par chunk
        for await (const chunk of client.iterDownload({
            file: msg.media,
            requestSize: 1024 * 1024, // 1MB
        })) {
            // Écriture directe sur disque (pas de RAM !)
            await writable.write(chunk);
            
            downloaded += chunk.length;
            const percent = Math.round((downloaded / size) * 100);
            log(`Téléchargement sur disque : ${percent}%`);
        }
        
        // 5. Clôture du fichier
        await writable.close();
        log("Téléchargement terminé. Lecture depuis le disque.");

        // 6. Lecture depuis le disque
        const file = await fileHandle.getFile();
        const url = URL.createObjectURL(file);
        
        v.src = url;
        v.play();
        v.focus();

    } catch(e) {
        log("Erreur OPFS: " + e.message);
        console.error(e);
    }
};

// Fallback pour vieux navigateurs
const playVideoRam = async (msg) => {
    // ... (code précédent buffer Blob) ...
    // Je l'omets ici pour la clarté, mais l'idée est là.
};

// --- EVENTS ---
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

const btnReset = document.getElementById('reset-config-btn');
if(btnReset) {
    btnReset.onclick = () => {
        if(confirm("Réinitialiser l'application ?")) {
            localStorage.clear();
            location.reload();
        }
    };
}

document.onkeydown = (e) => {
    if(e.key === 'Backspace' || e.key === 'Escape') goBack();
};

// START
startApp();

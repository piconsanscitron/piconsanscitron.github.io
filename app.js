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
    log("Initialisation Telegram...");

    try {
        client = new TelegramClient(new StringSession(session), API_ID, API_HASH, {
            connectionRetries: 5,
            useWSS: true,
        });

        await client.connect();
        
        // Vérification de l'authentification
        const isAuth = await client.checkAuthorization();
        if (isAuth) {
            log("Session valide !");
            loadChannels();
        } else {
            // Pas connecté ? On lance le login QR Code manuel
            startQRLogin();
        }
    } catch (e) {
        log("Erreur Init: " + e.message);
        console.error(e);
        if(e.message.includes("API_ID")) {
            if(confirm("API ID invalide. Réinitialiser ?")) {
                localStorage.clear();
                location.reload();
            }
        }
    }
};

// Fonction de login QR Code MANUELLE (Plus robuste)
const startQRLogin = async () => {
    showScreen('auth-screen');
    const qrStatus = document.getElementById('qr-status');
    const qrDiv = document.getElementById('qrcode');
    qrDiv.innerHTML = "";
    qrStatus.textContent = "Génération du token...";

    try {
        // ÉTAPE 1: Demander un token d'exportation
        // Le paramètre exceptIds: [] est OBLIGATOIRE pour éviter le CastError
        const result = await client.invoke(
            new Api.auth.ExportLoginToken({
                apiId: API_ID,
                apiHash: API_HASH,
                exceptIds: [], 
            })
        );

        if (!(result instanceof Api.auth.LoginToken)) {
            // Cas rare: LoginTokenMigrateTo (mauvais DC) ou LoginTokenSuccess (déjà loggé)
            if (result instanceof Api.auth.LoginTokenSuccess) {
                log("Déjà connecté !");
                loadChannels();
                return;
            }
            throw new Error("Type de token inattendu: " + result.className);
        }

        // ÉTAPE 2: Afficher le QR Code
        log("Token généré, affichage QR...");
        qrStatus.textContent = "Scannez ce code avec Telegram (Réglages > Appareils)";
        
        // Nettoyage et création QR
        qrDiv.innerHTML = "";
        new QRCode(qrDiv, {
            text: `tg://login?token=${result.token.toString('base64url')}`,
            width: 256,
            height: 256
        });

        // ÉTAPE 3: Boucle de vérification (Polling)
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
                    log("Authentification réussie !");
                    localStorage.setItem('teletv_session', client.session.save());
                    loadChannels();
                } else if (authResult instanceof Api.auth.LoginToken) {
                    // Toujours en attente, on continue de boucler
                    setTimeout(checkToken, 2000); // Check toutes les 2s
                }
            } catch (err) {
                if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
                    isDone = true;
                    const pwd = prompt("Mot de passe 2FA requis :");
                    if(pwd) {
                        await client.signIn({ password: pwd });
                        localStorage.setItem('teletv_session', client.session.save());
                        loadChannels();
                    }
                } else {
                    console.error("Erreur polling:", err);
                    // On continue quand même sauf erreur fatale
                    setTimeout(checkToken, 3000);
                }
            }
        };

        // Lancer la boucle
        setTimeout(checkToken, 2000);

    } catch (e) {
        console.error("Erreur Flux QR:", e);
        qrStatus.textContent = "Erreur: " + e.message;
        // Retry auto après 5s
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
        
        let count = 0;
        dialogs.forEach(d => {
            if(d.isChannel || d.isGroup) {
                count++;
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
        
        if(count === 0) grid.innerHTML = "Aucun canal trouvé.";
        else if(grid.firstChild) grid.firstChild.focus();

    } catch (e) {
        log("Erreur Canaux: " + e.message);
    }
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

        msgs.forEach(m => {
            const el = document.createElement('div');
            el.className = 'card';
            
            let dur = "";
            const attr = m.media?.document?.attributes?.find(a => a.duration);
            if(attr) dur = ` (${Math.floor(attr.duration/60)}:${(attr.duration%60).toString().padStart(2,'0')})`;
            
            el.textContent = `Video ${dur}`;
            el.tabIndex = 0;
            
            const play = () => playVideo(m);
            el.onclick = play;
            el.onkeydown = (e) => e.key === 'Enter' && play();
            
            grid.appendChild(el);
        });
        
        if(grid.firstChild) grid.firstChild.focus();
    } catch (e) {
        log("Erreur Vidéos: " + e.message);
    }
};

const playVideo = async (msg) => {
    log("Téléchargement (Buffering)...");
    try {
        // Attention: gros fichiers = crash possible sur TV (RAM limitée)
        const buffer = await client.downloadMedia(msg.media, { workers: 1 });
        if(!buffer) throw new Error("Téléchargement vide");

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

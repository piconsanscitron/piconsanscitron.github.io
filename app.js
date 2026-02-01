// --- IMPORTS (Modules ES via esm.sh) ---
// On importe le paquet complet + sessions pour éviter les erreurs de types/instanceof
import { TelegramClient, Api, sessions } from 'https://esm.sh/telegram@2.19.7?bundle';

// On extrait la classe StringSession du module sessions
const { StringSession } = sessions;

// --- VARIABLES D'ÉTAT ---
let client;
let API_ID = null;
let API_HASH = null;
let sessionString = localStorage.getItem('telesession') || "";
let historyStack = [];

// --- FONCTIONS UTILITAIRES (UI) ---

const updateStatus = (text) => {
    const el = document.getElementById('status');
    if (el) {
        el.textContent = text;
        // On rend visible le statut s'il y a un message
        el.style.display = 'block';
    }
    console.log('[STATUS]', text);
};

const showScreen = (screenId) => {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'hidden'));
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    
    const target = document.getElementById(screenId);
    if(target) {
        target.classList.remove('hidden');
        target.classList.add('active');
        
        // Focus automatique (UX TV)
        setTimeout(() => {
            const focusable = target.querySelector('[tabindex="0"]');
            if (focusable) focusable.focus();
        }, 150);
    }
};

const navigateTo = (screenId) => {
    const current = document.querySelector('.screen.active');
    if(current) historyStack.push(current.id);
    showScreen(screenId);
};

const goBack = () => {
    if (historyStack.length === 0) return;
    
    // Arrêt propre du player
    const video = document.getElementById('main-player');
    if (video && !video.paused) {
        video.pause();
        video.src = "";
        video.load();
    }
    
    const prev = historyStack.pop();
    showScreen(prev);
};


// --- LOGIQUE TELEGRAM (CORE) ---

const initTelegram = async () => {
    if (!API_ID || !API_HASH) {
        showScreen('config-screen');
        return;
    }

    updateStatus("Initialisation du client (WSS)...");

    try {
        console.log("Config Session:", sessionString ? "Session trouvée" : "Nouvelle session");

        // Configuration renforcée pour navigateur
        client = new TelegramClient(new StringSession(sessionString), API_ID, API_HASH, {
            connectionRetries: 5,
            useWSS: true,          // Indispensable pour éviter blocage navigateur
            testServers: false,    // Prod uniquement
            deviceModel: "TeleTV Web App",
            systemVersion: navigator.userAgent, 
            appVersion: "1.0.0"
        });

        // Connexion
        console.log("Connexion en cours...");
        await client.connect();
        console.log("Client connecté au serveur !");

        // Vérification Auth
        const isAuth = await client.checkAuthorization();
        console.log("Statut Auth:", isAuth);

        if (isAuth) {
            updateStatus("Authentifié.");
            loadChannels();
        } else {
            navigateTo('auth-screen');
            updateStatus("En attente de connexion...");
        }

    } catch (e) {
        console.error("Erreur Init:", e);
        updateStatus("Erreur Init: " + e.message);
        
        // Auto-reset si config corrompue
        if(e.message.includes("API_ID") || e.message.includes("PERSISTENT_STORAGE")) {
            if(confirm("Configuration API invalide ou corrompue. Réinitialiser ?")) {
                localStorage.clear();
                location.reload();
            }
        }
    }
};

const loadChannels = async () => {
    updateStatus("Chargement des canaux...");
    navigateTo('channels-screen');
    const grid = document.getElementById('channels-grid');
    grid.innerHTML = '<p>Récupération de la liste...</p>';

    try {
        // On récupère les 30 derniers dialogues
        const dialogs = await client.getDialogs({ limit: 30 });
        grid.innerHTML = '';

        let count = 0;
        dialogs.forEach(dialog => {
            if (dialog.isChannel || dialog.isGroup) {
                count++;
                const card = document.createElement('div');
                card.className = 'card';
                card.tabIndex = 0;
                card.textContent = dialog.title || "Sans nom";
                
                const openThis = () => loadVideos(dialog.entity);
                card.addEventListener('click', openThis);
                card.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') openThis();
                });

                grid.appendChild(card);
            }
        });

        if(count === 0) grid.innerHTML = '<p>Aucun canal trouvé.</p>';
        else {
            // Focus sur le 1er élément
            const first = grid.querySelector('.card');
            if(first) first.focus();
        }

    } catch (e) {
        updateStatus("Erreur Canaux: " + e.message);
        console.error(e);
    }
};

const loadVideos = async (entity) => {
    navigateTo('videos-screen');
    const grid = document.getElementById('videos-grid');
    grid.innerHTML = '<p>Recherche de vidéos (patientez)...</p>';

    try {
        // Filtre message vidéo
        const messages = await client.getMessages(entity, {
            limit: 20,
            filter: new Api.InputMessagesFilterVideo()
        });

        grid.innerHTML = '';
        if (!messages || messages.length === 0) {
            grid.innerHTML = '<p>Pas de vidéos récentes.</p>';
            return;
        }

        for (const msg of messages) {
            const card = document.createElement('div');
            card.className = 'card';
            card.tabIndex = 0;
            
            // Formatage durée
            let durationStr = "";
            const attr = msg.media?.document?.attributes?.find(a => a.duration);
            if(attr) {
                const m = Math.floor(attr.duration / 60);
                const s = (attr.duration % 60).toString().padStart(2, '0');
                durationStr = ` (${m}:${s})`;
            }

            card.textContent = `Vidéo ${msg.id} ${durationStr}`;
            
            const playThis = () => playVideo(msg);
            card.addEventListener('click', playThis);
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') playThis();
            });

            grid.appendChild(card);
        }
        
        const first = grid.querySelector('.card');
        if(first) first.focus();

    } catch (e) {
        updateStatus("Erreur Vidéos: " + e.message);
        console.error(e);
    }
};

const playVideo = async (msg) => {
    updateStatus("Téléchargement en mémoire (Buffering)...");
    try {
        // Téléchargement (Attention RAM)
        const buffer = await client.downloadMedia(msg.media, {
            workers: 1, // 1 worker pour ménager le CPU TV
        });
        
        if(!buffer || buffer.length === 0) throw new Error("Tampon vide");

        const blob = new Blob([buffer], { type: 'video/mp4' }); // Hypothèse MP4 standard
        const url = URL.createObjectURL(blob);
        
        navigateTo('player-screen');
        const player = document.getElementById('main-player');
        player.src = url;
        player.play().catch(e => console.log("Autoplay bloqué par navigateur:", e));
        player.focus();

    } catch (e) {
        updateStatus("Erreur Lecture: " + e.message);
        console.error(e);
    }
};


// --- GESTIONNAIRES D'ÉVÉNEMENTS (Listeners) ---

// 1. Sauvegarde API Config
const btnSave = document.getElementById('save-config-btn');
if(btnSave) {
    btnSave.addEventListener('click', () => {
        const idInput = document.getElementById('api-id').value.trim();
        const hashInput = document.getElementById('api-hash').value.trim();

        if (idInput && hashInput) {
            localStorage.setItem('teletv_api_id', idInput);
            localStorage.setItem('teletv_api_hash', hashInput);
            location.reload();
        } else {
            alert("Merci de remplir les deux champs.");
        }
    });
}

// 2. Envoi Code (Auth Step 1)
const btnSend = document.getElementById('send-code-btn');
if(btnSend) {
    btnSend.addEventListener('click', async () => {
        const phone = document.getElementById('phone').value.trim();
        if(!phone) return alert("Numéro requis (+33...)");
        
        updateStatus(`Envoi code à ${phone}...`);
        
        try {
            // Note: sendCode renvoie un objet contenant le phoneCodeHash
            const res = await client.sendCode({ 
                apiId: API_ID, 
                apiHash: API_HASH 
            }, phone);
            
            console.log("Code envoyé, hash:", res.phoneCodeHash);
            
            document.getElementById('code-group').classList.remove('hidden');
            document.getElementById('send-code-btn').classList.add('hidden');
            
            // Focus user friendly
            setTimeout(() => document.getElementById('code').focus(), 100);
            updateStatus("SMS envoyé ! Vérifiez Telegram.");
            
        } catch (e) {
            console.error("Erreur SendCode:", e);
            updateStatus("Erreur Envoi: " + (e.errorMessage || e.message));
            
            if(e.message.includes("PHONE_NUMBER_INVALID")) {
                alert("Numéro invalide. Format: +33612345678");
            }
        }
    });
}

// 3. Login Final (Auth Step 2)
const btnLogin = document.getElementById('login-btn');
if(btnLogin) {
    btnLogin.addEventListener('click', async () => {
        const phone = document.getElementById('phone').value.trim();
        const code = document.getElementById('code').value.trim();
        const password = document.getElementById('password').value.trim(); // 2FA

        if(!code) return alert("Code requis");

        updateStatus("Vérification...");
        try {
            await client.signIn({
                phoneNumber: phone,
                phoneCode: code,
                password: password,
                onError: (err) => {
                    console.error("Erreur SignIn:", err);
                    updateStatus("Erreur: " + err.message);
                },
            });
            
            // Sauvegarde persistante
            const session = client.session.save();
            localStorage.setItem('telesession', session);
            console.log("Session sauvegardée:", session.length, "chars");
            
            updateStatus("Connecté !");
            loadChannels();
            
        } catch (e) {
            console.error("Erreur Login Final:", e);
            updateStatus("Échec: " + (e.errorMessage || e.message));
        }
    });
}

// 4. Reset
const btnReset = document.getElementById('reset-config-btn');
if(btnReset) {
    btnReset.addEventListener('click', () => {
        if(confirm("Effacer toute la configuration ?")) {
            localStorage.clear();
            location.reload();
        }
    });
}

// 5. Navigation Clavier (Back)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' || e.key === 'Escape') {
        goBack();
    }
});


// --- INITIALISATION AU CHARGEMENT ---

const startApp = () => {
    const storedId = localStorage.getItem('teletv_api_id');
    const storedHash = localStorage.getItem('teletv_api_hash');

    if (storedId && storedHash) {
        API_ID = parseInt(storedId, 10); // Base 10 importante
        API_HASH = storedHash;
        
        if(isNaN(API_ID)) {
            console.error("API ID invalide en stockage");
            localStorage.removeItem('teletv_api_id');
            location.reload();
            return;
        }
        
        initTelegram();
    } else {
        console.log("App en mode configuration");
        showScreen('config-screen');
    }
};

// Démarrage
startApp();

// --- IMPORTS CORRIGÉS ---
// On importe TOUT depuis le point d'entrée principal pour éviter les conflits de types (instanceof)
import { TelegramClient, Api, sessions } from 'https://esm.sh/telegram@2.19.7?bundle';

// On extrait StringSession de l'objet sessions exporté
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
    if (el) el.textContent = text;
    console.log('[STATUS]', text);
};

const showScreen = (screenId) => {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'hidden'));
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    
    const target = document.getElementById(screenId);
    if(target) {
        target.classList.remove('hidden');
        target.classList.add('active');
        setTimeout(() => {
            const focusable = target.querySelector('[tabindex="0"]');
            if (focusable) focusable.focus();
        }, 100);
    }
};

const navigateTo = (screenId) => {
    const current = document.querySelector('.screen.active');
    if(current) historyStack.push(current.id);
    showScreen(screenId);
};

const goBack = () => {
    if (historyStack.length === 0) return;
    const video = document.getElementById('main-player');
    if (!video.paused) {
        video.pause();
        video.src = "";
    }
    const prev = historyStack.pop();
    showScreen(prev);
};

// --- LOGIQUE TELEGRAM ---

const initTelegram = async () => {
    if (!API_ID || !API_HASH) {
        showScreen('config-screen');
        return;
    }

    updateStatus("Initialisation du client Telegram...");

    try {
        console.log("Session actuelle:", sessionString ? "Existante" : "Vide");
        
        // Création du client avec les imports unifiés
        client = new TelegramClient(new StringSession(sessionString), API_ID, API_HASH, {
            connectionRetries: 5,
            useWSS: true, // Force WebSockets sécurisés (important pour browser)
        });

        await client.connect();

        if (await client.checkAuthorization()) {
            loadChannels();
        } else {
            navigateTo('auth-screen');
            updateStatus("Veuillez vous connecter.");
        }
    } catch (e) {
        console.error(e);
        updateStatus("Erreur Init: " + e.message);
        // Si erreur critique de session, on propose un reset
        if(e.message.includes("API_ID") || e.message.includes("session")) {
            if(confirm("Erreur de configuration détectée. Réinitialiser ?")) {
                localStorage.clear();
                location.reload();
            }
        }
    }
};

const loadChannels = async () => {
    updateStatus("Récupération des canaux...");
    navigateTo('channels-screen');
    const grid = document.getElementById('channels-grid');
    grid.innerHTML = '<p>Chargement...</p>';

    try {
        const dialogs = await client.getDialogs({ limit: 30 });
        grid.innerHTML = '';

        dialogs.forEach(dialog => {
            if (dialog.isChannel || dialog.isGroup) {
                const card = document.createElement('div');
                card.className = 'card';
                card.tabIndex = 0;
                card.textContent = dialog.title || "Sans titre";
                
                const openChannel = () => loadVideos(dialog.entity);
                card.addEventListener('click', openChannel);
                card.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') openChannel();
                });

                grid.appendChild(card);
            }
        });
        
        // Focus premier élément
        const first = grid.querySelector('.card');
        if(first) first.focus();

    } catch (e) {
        updateStatus("Erreur Canaux: " + e.message);
        console.error(e);
    }
};

const loadVideos = async (entity) => {
    navigateTo('videos-screen');
    const grid = document.getElementById('videos-grid');
    grid.innerHTML = '<p>Recherche de vidéos...</p>';

    try {
        const messages = await client.getMessages(entity, {
            limit: 20,
            filter: new Api.InputMessagesFilterVideo()
        });

        grid.innerHTML = '';
        if (messages.length === 0) {
            grid.innerHTML = '<p>Aucune vidéo trouvée.</p>';
            return;
        }

        for (const msg of messages) {
            const card = document.createElement('div');
            card.className = 'card';
            card.tabIndex = 0;
            
            let durationInfo = "";
            const attr = msg.media?.document?.attributes?.find(a => a.duration);
            if(attr) {
                const min = Math.floor(attr.duration / 60);
                const sec = (attr.duration % 60).toString().padStart(2, '0');
                durationInfo = ` (${min}:${sec})`;
            }

            card.textContent = `Vidéo ${msg.id} ${durationInfo}`;
            
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
    }
};

const playVideo = async (msg) => {
    updateStatus("Téléchargement en cours (RAM)...");
    try {
        // Attention: gros fichiers = crash possible sur TV
        const buffer = await client.downloadMedia(msg.media, {
            workers: 1,
        });
        
        const blob = new Blob([buffer], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        
        navigateTo('player-screen');
        const player = document.getElementById('main-player');
        player.src = url;
        player.play();
        player.focus();

    } catch (e) {
        updateStatus("Erreur Lecture: " + e.message);
    }
};

// --- EVENTS ---

document.getElementById('save-config-btn').addEventListener('click', () => {
    const idInput = document.getElementById('api-id').value;
    const hashInput = document.getElementById('api-hash').value;

    if (idInput && hashInput) {
        localStorage.setItem('teletv_api_id', idInput);
        localStorage.setItem('teletv_api_hash', hashInput);
        location.reload();
    } else {
        alert("Champs manquants");
    }
});

document.getElementById('send-code-btn').addEventListener('click', async () => {
    const phone = document.getElementById('phone').value;
    if(!phone) return alert("Numéro requis");
    
    updateStatus("Envoi du SMS...");
    try {
        await client.sendCode({ apiId: API_ID, apiHash: API_HASH }, phone);
        document.getElementById('code-group').classList.remove('hidden');
        document.getElementById('send-code-btn').classList.add('hidden');
        document.getElementById('code').focus();
        updateStatus("SMS envoyé !");
    } catch (e) {
        updateStatus("Erreur SMS: " + e.message);
        console.error(e);
    }
});

document.getElementById('login-btn').addEventListener('click', async () => {
    const phone = document.getElementById('phone').value;
    const code = document.getElementById('code').value;
    const password = document.getElementById('password').value;

    updateStatus("Authentification...");
    try {
        await client.signIn({
            phoneNumber: phone,
            phoneCode: code,
            password: password,
            onError: (err) => updateStatus(err.message),
        });
        
        localStorage.setItem('telesession', client.session.save());
        updateStatus("Connecté !");
        loadChannels();
    } catch (e) {
        updateStatus("Échec Login: " + e.message);
        console.error(e);
    }
});

document.getElementById('reset-config-btn').addEventListener('click', () => {
    if(confirm("Tout effacer ?")) {
        localStorage.clear();
        location.reload();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' || e.key === 'Escape') {
        goBack();
    }
});

// --- MAIN START ---
const startApp = () => {
    const storedId = localStorage.getItem('teletv_api_id');
    const storedHash = localStorage.getItem('teletv_api_hash');

    if (storedId && storedHash) {
        API_ID = parseInt(storedId);
        API_HASH = storedHash;
        initTelegram();
    } else {
        console.log("En attente de configuration");
    }
};

startApp();

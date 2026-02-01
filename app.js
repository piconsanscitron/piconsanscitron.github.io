// --- IMPORTS (Modules ES) ---
// On utilise esm.sh avec l'option bundle pour inclure les polyfills Node.js nécessaires
import { TelegramClient, Api } from 'https://esm.sh/telegram@2.19.7?bundle';
import { StringSession } from 'https://esm.sh/telegram@2.19.7/sessions?bundle';

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
        // Focus automatique pour la télécommande
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
    
    // Si on quitte le player, on coupe la vidéo
    const video = document.getElementById('main-player');
    if (!video.paused) {
        video.pause();
        video.src = ""; // Libérer la mémoire
    }
    
    const prev = historyStack.pop();
    showScreen(prev);
};

// --- LOGIQUE METIER TELEGRAM ---

const initTelegram = async () => {
    if (!API_ID || !API_HASH) {
        showScreen('config-screen');
        return;
    }

    updateStatus("Initialisation du client Telegram...");

    try {
        client = new TelegramClient(new StringSession(sessionString), API_ID, API_HASH, {
            connectionRetries: 5,
        });

        // Connexion
        await client.connect();

        // Vérification Auth
        if (await client.checkAuthorization()) {
            loadChannels();
        } else {
            navigateTo('auth-screen');
            updateStatus("Veuillez vous connecter.");
        }
    } catch (e) {
        console.error(e);
        updateStatus("Erreur Init: " + e.message);
        if(e.message.includes("API_ID")) {
            alert("API ID invalide ? Reset...");
            localStorage.clear();
            location.reload();
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
                
                // Gestionnaire d'événement direct (pas de HTML onclick)
                const openChannel = () => loadVideos(dialog.entity);
                
                card.addEventListener('click', openChannel);
                card.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') openChannel();
                });

                grid.appendChild(card);
            }
        });
        
        // Focus sur le premier élément
        const first = grid.querySelector('.card');
        if(first) first.focus();

    } catch (e) {
        updateStatus("Erreur Canaux: " + e.message);
    }
};

const loadVideos = async (entity) => {
    navigateTo('videos-screen');
    const grid = document.getElementById('videos-grid');
    grid.innerHTML = '<p>Recherche de vidéos...</p>';

    try {
        // Filtre pour vidéos uniquement
        const messages = await client.getMessages(entity, {
            limit: 20,
            filter: new Api.InputMessagesFilterVideo()
        });

        grid.innerHTML = '';
        if (messages.length === 0) {
            grid.innerHTML = '<p>Aucune vidéo trouvée récemment.</p>';
            return;
        }

        for (const msg of messages) {
            const card = document.createElement('div');
            card.className = 'card';
            card.tabIndex = 0;
            
            // Tentative d'afficher la durée
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
    updateStatus("Téléchargement du flux (patientez)...");
    
    try {
        // Stream direct (peut être lent selon connexion)
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


// --- GESTIONNAIRES D'ÉVÉNEMENTS (Event Listeners) ---

// 1. Sauvegarde Config
document.getElementById('save-config-btn').addEventListener('click', () => {
    const idInput = document.getElementById('api-id').value;
    const hashInput = document.getElementById('api-hash').value;

    if (idInput && hashInput) {
        localStorage.setItem('teletv_api_id', idInput);
        localStorage.setItem('teletv_api_hash', hashInput);
        location.reload(); // On recharge pour appliquer proprement
    } else {
        alert("Champs manquants");
    }
});

// 2. Envoi Code (Login étape 1)
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
    }
});

// 3. Login (Login étape 2)
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
        
        // Sauvegarde session
        localStorage.setItem('telesession', client.session.save());
        updateStatus("Connecté !");
        loadChannels();
    } catch (e) {
        updateStatus("Échec Login: " + e.message);
    }
});

// 4. Reset Config
document.getElementById('reset-config-btn').addEventListener('click', () => {
    if(confirm("Tout effacer ?")) {
        localStorage.clear();
        location.reload();
    }
});

// 5. Navigation Clavier Global (Retour Arrière)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' || e.key === 'Escape') {
        // Empêcher le retour navigateur par défaut si possible
        goBack();
    }
});


// --- POINT D'ENTRÉE MAIN ---

const startApp = () => {
    // Vérification Config LocalStorage
    const storedId = localStorage.getItem('teletv_api_id');
    const storedHash = localStorage.getItem('teletv_api_hash');

    if (storedId && storedHash) {
        API_ID = parseInt(storedId);
        API_HASH = storedHash;
        initTelegram();
    } else {
        // On reste sur l'écran de config
        console.log("App needs config");
    }
};

// Lancement
startApp();

const { TelegramClient, Api } = telegram;
const { StringSession } = telegram.sessions;

// --- CONFIGURATION ---
const API_ID = 123456; // REMPLACEZ PAR VOTRE ID
const API_HASH = 'VOTRE_HASH_ICI'; // REMPLACEZ PAR VOTRE HASH
let client;
let stringSession = new StringSession(localStorage.getItem('telesession') || "");

// --- NAVIGATION MANAGER (TV LOGIC) ---
document.addEventListener('keydown', (e) => {
    // Gestion basique du focus spatial si nécessaire, 
    // mais le navigateur TV gère souvent TAB/Arrows nativement.
    // Ici on gère surtout le retour arrière.
    if (e.key === 'Backspace' || e.key === 'Escape') {
        goBack();
    }
});

function focusFirstElement(containerId) {
    const container = document.getElementById(containerId);
    const focusable = container.querySelector('[tabindex="0"]');
    if (focusable) focusable.focus();
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'hidden'));
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    
    const target = document.getElementById(screenId);
    target.classList.remove('hidden');
    target.classList.add('active');
    
    // Petit délai pour laisser le DOM s'afficher avant le focus
    setTimeout(() => focusFirstElement(screenId), 100);
}

let historyStack = [];
function navigateTo(screenId) {
    const current = document.querySelector('.screen.active').id;
    historyStack.push(current);
    showScreen(screenId);
}

function goBack() {
    if (historyStack.length === 0) return;
    const prev = historyStack.pop();
    
    // Si on quitte le player, on arrête la vidéo
    const video = document.getElementById('main-player');
    if (!video.paused) video.pause();
    
    showScreen(prev);
}

// --- TELEGRAM LOGIC ---

async function init() {
    client = new TelegramClient(stringSession, API_ID, API_HASH, {
        connectionRetries: 5,
    });
    
    updateStatus("Connexion au serveur Telegram...");
    await client.connect();

    // Vérifier si déjà connecté
    if (await client.checkAuthorization()) {
        loadChannels();
    } else {
        updateStatus("Veuillez vous connecter.");
    }
}

// Gestion Login UI
document.getElementById('send-code-btn').onclick = async () => {
    const phone = document.getElementById('phone').value;
    updateStatus("Envoi du code...");
    try {
        await client.sendCode({ apiId: API_ID, apiHash: API_HASH }, phone);
        document.getElementById('code-group').classList.remove('hidden');
        document.getElementById('send-code-btn').classList.add('hidden');
        document.getElementById('code').focus();
        updateStatus("Code envoyé !");
    } catch (e) {
        updateStatus("Erreur: " + e.message);
    }
};

document.getElementById('login-btn').onclick = async () => {
    const phone = document.getElementById('phone').value;
    const code = document.getElementById('code').value;
    const password = document.getElementById('password').value;

    try {
        await client.signIn({
            phoneNumber: phone,
            phoneCode: code,
            password: password,
            onError: (err) => updateStatus(err.message),
        });
        localStorage.setItem('telesession', client.session.save());
        loadChannels();
    } catch (e) {
        updateStatus("Erreur Login: " + e.message);
    }
};

// Récupération des canaux
async function loadChannels() {
    updateStatus("Chargement des canaux...");
    navigateTo('channels-screen');
    
    const grid = document.getElementById('channels-grid');
    grid.innerHTML = '<p>Chargement...</p>';

    // Récupérer les dialogues (chats/canaux)
    const dialogs = await client.getDialogs({ limit: 20 });
    grid.innerHTML = '';

    dialogs.forEach(dialog => {
        if (dialog.isChannel || dialog.isGroup) {
            const card = document.createElement('div');
            card.className = 'card';
            card.tabIndex = 0;
            card.textContent = dialog.title || "Sans titre";
            card.onclick = () => loadVideos(dialog.entity);
            
            // Gérer "Enter" sur la télécommande
            card.onkeydown = (e) => { if(e.key === 'Enter') loadVideos(dialog.entity); };
            
            grid.appendChild(card);
        }
    });
    focusFirstElement('channels-grid');
}

// Récupération des vidéos
async function loadVideos(entity) {
    navigateTo('videos-screen');
    const grid = document.getElementById('videos-grid');
    grid.innerHTML = 'Chargement des vidéos...';
    
    // Filtre pour ne récupérer que les messages avec vidéo
    const messages = await client.getMessages(entity, {
        limit: 20,
        filter: new telegram.Api.InputMessagesFilterVideo()
    });

    grid.innerHTML = '';
    
    if (messages.length === 0) {
        grid.innerHTML = "<p>Aucune vidéo récente.</p>";
        return;
    }

    for (const msg of messages) {
        const card = document.createElement('div');
        card.className = 'card';
        card.tabIndex = 0;
        
        // Calculer durée ou taille
        const attr = msg.media.document.attributes.find(a => a.duration);
        const duration = attr ? `${Math.floor(attr.duration / 60)}:${attr.duration % 60}` : '';
        
        card.textContent = `Vidéo (${duration})`;
        
        // Vignette (optimisation : on pourrait charger la vraie thumbnail, 
        // mais pour l'exemple on reste simple texte)
        
        card.onclick = () => playVideo(msg);
        card.onkeydown = (e) => { if(e.key === 'Enter') playVideo(msg); };
        
        grid.appendChild(card);
    }
    focusFirstElement('videos-grid');
}

// Lecture Vidéo
async function playVideo(msg) {
    updateStatus("Téléchargement du buffer vidéo (patientez)...");
    
    // ATTENTION : Sur TV, ceci est le point critique.
    // downloadMedia charge tout en RAM.
    const buffer = await client.downloadMedia(msg.media, {
        workers: 1, // Réduire les workers pour éviter de surcharger le CPU TV
    });
    
    const blob = new Blob([buffer], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    
    navigateTo('player-screen');
    const player = document.getElementById('main-player');
    player.src = url;
    player.play();
    player.focus(); // Focus sur le player pour les contrôles natifs (pause/play)
}

function updateStatus(text) {
    const el = document.getElementById('status');
    if(el) el.textContent = text;
    console.log(text);
}

// Lancement
window.onload = init;

import { TelegramClient, Api, sessions } from 'https://esm.sh/telegram@2.19.7?bundle';
const { StringSession } = sessions;

let client, API_ID, API_HASH;
let historyStack = [];
let wakeLock = null;

// UI LOG
const log = (msg) => {
    console.log(msg);
    const el = document.getElementById('status');
    if(el) { el.textContent = msg; el.style.display = 'block'; setTimeout(()=>el.style.display='none', 4000); }
};

// --- NAVIGATION ---
const focusElement = (el) => {
    if(el) {
        el.focus({ preventScroll: false });
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

const showScreen = (id) => {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.classList.add('hidden');
    });
    
    const t = document.getElementById(id);
    if(t) {
        t.classList.remove('hidden');
        t.classList.add('active');
        window.scrollTo(0, 0);
        
        // PUSH STATE POUR LE BOUTON RETOUR PHYSIQUE
        history.pushState({ screen: id }, null, "");

        setTimeout(() => {
            let f;
            if (id === 'channels-screen') f = document.getElementById('btn-search-nav');
            else if (id === 'player-screen') f = document.getElementById('main-player');
            else f = t.querySelector('[tabindex="0"]');
            focusElement(f);
        }, 200);
    }
};

const goBack = () => {
    // Si on est à la racine, on ne fait rien
    if(document.getElementById('channels-screen').classList.contains('active')) return;

    if(historyStack.length > 0) {
        const prev = historyStack.pop();
        
        // Arrêt propre Vidéo
        const v = document.getElementById('main-player');
        if(v) { v.pause(); v.removeAttribute('src'); v.load(); }
        
        // Arrêt Loader
        document.getElementById('video-loader').classList.add('hidden');
        if(wakeLock) wakeLock.release();
        
        showScreen(prev);
    } else {
        showScreen('channels-screen');
    }
};

const navigateTo = (id) => {
    const curr = document.querySelector('.screen.active');
    if(curr && curr.id !== id) historyStack.push(curr.id);
    showScreen(id);
};

// --- ECOUTEUR BOUTON RETOUR PHYSIQUE ---
window.onpopstate = (event) => {
    // Empêche le navigateur de revenir en arrière dans l'historique URL réel
    // Et lance notre fonction interne
    history.pushState(null, null, window.location.href);
    goBack();
};


// --- TELEGRAM ---
const startApp = async () => {
    const sId = localStorage.getItem('teletv_id');
    const sHash = localStorage.getItem('teletv_hash');
    const session = localStorage.getItem('teletv_session') || "";

    // Hack historique initial
    history.replaceState({ screen: 'init' }, null, "");
    history.pushState({ screen: 'init' }, null, "");

    if(!sId || !sHash) { 
        document.getElementById('config-screen').classList.add('active'); // Force display sans anim
        return; 
    }
    
    // Si config ok, on cache config
    document.getElementById('config-screen').classList.remove('active');
    document.getElementById('config-screen').classList.add('hidden');
    
    API_ID = parseInt(sId); API_HASH = sHash;
    log("Connexion...");

    try {
        client = new TelegramClient(new StringSession(session), API_ID, API_HASH, { connectionRetries: 5, useWSS: true });
        await client.connect();
        if (await client.checkAuthorization()) loadChannels(); else startQRLogin();
    } catch (e) { log("Err: " + e.message); if(e.message.includes("API_ID")) localStorage.clear(); }
};

const startQRLogin = async () => {
    showScreen('auth-screen');
    const qrDiv = document.getElementById('qrcode'); qrDiv.innerHTML = "";
    try {
        const res = await client.invoke(new Api.auth.ExportLoginToken({ apiId: API_ID, apiHash: API_HASH, exceptIds: [] }));
        if (res instanceof Api.auth.LoginTokenSuccess) { loadChannels(); return; }
        const token = res.token.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        new QRCode(qrDiv, { text: `tg://login?token=${token}`, width: 256, height: 256 });
        const check = async () => {
            try {
                const r = await client.invoke(new Api.auth.ExportLoginToken({ apiId: API_ID, apiHash: API_HASH, exceptIds: [] }));
                if (r instanceof Api.auth.LoginTokenSuccess) { localStorage.setItem('teletv_session', client.session.save()); loadChannels(); }
                else setTimeout(check, 2000);
            } catch (e) { setTimeout(check, 3000); }
        };
        setTimeout(check, 2000);
    } catch (e) { log("Err QR: " + e.message); setTimeout(startQRLogin, 5000); }
};

const loadChannels = async () => {
    navigateTo('channels-screen');
    const grid = document.getElementById('channels-grid');
    grid.innerHTML = "Chargement...";
    try {
        const dialogs = await client.getDialogs({ limit: 100 });
        grid.innerHTML = "";
        const filtered = dialogs.filter(d => (d.isChannel || d.isGroup) && !d.archived).sort((a,b) => b.pinned - a.pinned);
        
        filtered.forEach(d => {
            const el = document.createElement('div');
            el.className = 'card';
            el.innerHTML = `<div style="text-align:center; font-weight:bold;">${d.pinned ? '📌 ' : ''}${d.title}</div>`;
            el.tabIndex = 0;
            el.onfocus = () => focusElement(el);
            el.onclick = () => loadVideos(d.entity);
            el.onkeydown = (e) => e.key === 'Enter' && loadVideos(d.entity);
            grid.appendChild(el);
        });
        setTimeout(() => focusElement(grid.firstChild || document.getElementById('btn-search-nav')), 200);
    } catch (e) { log("Err: " + e.message); }
};

const loadVideos = async (entity) => {
    navigateTo('videos-screen');
    const grid = document.getElementById('videos-grid');
    grid.innerHTML = "Chargement...";
    document.getElementById('channel-title').textContent = entity.title;

    try {
        const msgs = await client.getMessages(entity, { limit: 40, filter: new Api.InputMessagesFilterVideo() });
        grid.innerHTML = "";
        if(!msgs || msgs.length === 0) { grid.innerHTML = "Vide"; return; }

        for (const m of msgs) {
            const el = document.createElement('div');
            el.className = 'card video-card';
            let dur = "";
            const attr = m.media?.document?.attributes?.find(a => a.duration);
            if(attr) dur = `${Math.floor(attr.duration/60)}:${(attr.duration%60).toString().padStart(2,'0')}`;
            
            el.innerHTML = `
                <div class="thumb-placeholder">...</div>
                <div class="meta">
                    <div style="font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${m.message || "Vidéo"}</div>
                    <div style="font-size:0.75rem; color:#aaa; margin-top:5px;">⏱ ${dur} | ${(m.media.document.size/1024/1024).toFixed(0)} MB</div>
                </div>`;
            el.tabIndex = 0;
            el.onfocus = () => focusElement(el);
            
            const play = () => playStream(m);
            el.onclick = play;
            el.onkeydown = (e) => e.key === 'Enter' && play();
            grid.appendChild(el);

            if(m.media.document.thumbs) {
                const thumb = m.media.document.thumbs.find(t => t.className === 'PhotoSize');
                if(thumb) client.downloadMedia(m.media, { thumb }).then(b => {
                    el.querySelector('.thumb-placeholder').innerHTML = `<img src="${URL.createObjectURL(new Blob([b]))}" style="width:100%; height:100%; object-fit:cover;">`;
                }).catch(()=>{});
            }
        }
        setTimeout(() => focusElement(grid.firstChild), 200);
    } catch (e) { log("Err: " + e.message); }
};

const playStream = async (msg) => {
    navigateTo('player-screen');
    const v = document.getElementById('main-player');
    const loader = document.getElementById('video-loader');
    const bar = document.getElementById('loader-bar');
    const txt = document.getElementById('loader-text');
    const btnCancel = document.getElementById('btn-cancel-load');
    
    v.src = ""; loader.classList.remove('hidden'); bar.style.width = "0%"; txt.textContent = "Init...";
    if('wakeLock' in navigator) try { wakeLock = await navigator.wakeLock.request('screen'); } catch(e){}
    
    let cancelled = false;
    btnCancel.onclick = () => { cancelled = true; goBack(); };
    setTimeout(() => btnCancel.focus(), 200);

    if(!navigator.storage?.getDirectory) { alert("Stockage HS"); return; }

    try {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle('temp_video.mp4', { create: true });
        const writable = await handle.createWritable();
        const size = msg.media.document.size;
        let dl = 0;

        for await (const chunk of client.iterDownload({ file: msg.media, requestSize: 1024*1024 })) {
            if(cancelled) { await writable.close(); return; }
            await writable.write(chunk);
            dl += chunk.length;
            const pct = Math.round((dl/size)*100);
            bar.style.width = `${pct}%`;
            txt.textContent = `DL: ${pct}%`;
        }
        await writable.close();
        if(cancelled) return;
        
        loader.classList.add('hidden');
        v.src = URL.createObjectURL(await handle.getFile());
        v.play(); v.focus();
    } catch (e) { 
        txt.textContent = "Err: " + e.message; 
        if(e.name === 'QuotaExceededError') { if(confirm("Vider Cache?")) clearCache(); }
    }
};

const clearCache = async () => { try { const r = await navigator.storage.getDirectory(); await r.removeEntry('temp_video.mp4'); alert("Vidé."); } catch(e){alert("Déjà vide");} };

document.getElementById('save-config-btn').onclick = () => { localStorage.setItem('teletv_id', document.getElementById('api-id').value); localStorage.setItem('teletv_hash', document.getElementById('api-hash').value); location.reload(); };
document.getElementById('btn-search-nav').onclick = () => navigateTo('search-screen');
document.getElementById('btn-clear-cache').onclick = clearCache;
document.getElementById('btn-reload').onclick = () => location.reload();
document.getElementById('btn-logout').onclick = () => { if(confirm("Déco?")) { localStorage.clear(); clearCache(); location.reload(); }};
document.onkeydown = (e) => { if(e.key === 'Backspace' || e.key === 'Escape') goBack(); };

startApp();

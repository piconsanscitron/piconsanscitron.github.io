import { TelegramClient, Api, sessions } from 'https://esm.sh/telegram@2.19.7?bundle';
const { StringSession } = sessions;

let client, API_ID, API_HASH;
let historyStack = [];
let wakeLock = null;

const log = (msg) => {
    console.log(msg);
    const el = document.getElementById('status');
    if(el) { el.textContent = msg; el.style.display='block'; setTimeout(()=>el.style.display='none', 4000); }
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
        t.classList.add('active'); // CSS Flex s'applique ici pour config/auth
        window.scrollTo(0, 0);
        
        history.pushState({ screen: id }, null, "");

        setTimeout(() => {
            let f;
            if (id === 'channels-screen') f = document.getElementById('btn-search-nav');
            else if (id === 'player-screen') f = document.getElementById('main-player');
            else if (id === 'search-screen') f = document.getElementById('search-input');
            else f = t.querySelector('[tabindex="0"]');
            focusElement(f);
        }, 200);
    }
};

const goBack = () => {
    if(document.getElementById('channels-screen').classList.contains('active')) return;

    if(historyStack.length > 0) {
        const prev = historyStack.pop();
        const v = document.getElementById('main-player');
        if(v) { v.pause(); v.removeAttribute('src'); v.load(); }
        document.getElementById('video-loader').classList.add('hidden');
        if(wakeLock) wakeLock.release();
        showScreen(prev);
    } else showScreen('channels-screen');
};

const navigateTo = (id) => {
    const curr = document.querySelector('.screen.active');
    if(curr && curr.id !== id) historyStack.push(curr.id);
    showScreen(id);
};

window.onpopstate = (e) => {
    history.pushState(null, null, window.location.href);
    goBack();
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

    history.replaceState({ screen: 'init' }, null, "");
    history.pushState({ screen: 'init' }, null, "");

    if(!sId || !sHash) { 
        document.getElementById('config-screen').classList.add('active'); 
        document.getElementById('config-screen').classList.remove('hidden');
        return; 
    }
    
    document.getElementById('config-screen').classList.remove('active');
    document.getElementById('config-screen').classList.add('hidden');
    
    API_ID = parseInt(sId); API_HASH = sHash;
    log("Connexion...");

    try {
        client = new TelegramClient(new StringSession(session), API_ID, API_HASH, { connectionRetries: 5, useWSS: true });
        await client.connect();
        if (await client.checkAuthorization()) loadChannels(); else startQRLogin();
    } catch (e) { 
        log("Err: " + e.message); 
        if(e.message.includes("API_ID")) { localStorage.clear(); location.reload(); }
        else {
            document.getElementById('config-screen').classList.add('active'); 
            document.getElementById('config-screen').classList.remove('hidden');
        }
    }
};

const startQRLogin = async () => {
    showScreen('auth-screen');
    const qrDiv = document.getElementById('qrcode'); qrDiv.innerHTML = "";
    document.getElementById('qr-status').textContent = "Génération...";

    try {
        const res = await client.invoke(new Api.auth.ExportLoginToken({ apiId: API_ID, apiHash: API_HASH, exceptIds: [] }));
        if (res instanceof Api.auth.LoginTokenSuccess) { loadChannels(); return; }

        const token = res.token.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        new QRCode(qrDiv, { text: `tg://login?token=${token}`, width: 256, height: 256 });
        document.getElementById('qr-status').textContent = "Scannez avec Telegram";

        const check = async () => {
            try {
                const r = await client.invoke(new Api.auth.ExportLoginToken({ apiId: API_ID, apiHash: API_HASH, exceptIds: [] }));
                if (r instanceof Api.auth.LoginTokenSuccess) { 
                    localStorage.setItem('teletv_session', client.session.save()); 
                    loadChannels(); 
                } else setTimeout(check, 2000);
            } catch (e) { setTimeout(check, 3000); }
        };
        setTimeout(check, 2000);
    } catch (e) { log("Err QR: " + e.message); setTimeout(startQRLogin, 5000); }
};

const loadChannels = async () => {
    checkDiskUsage();
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
            el.innerHTML = `<div style="font-weight:bold;">${d.pinned ? '📌 ' : ''}${d.title}</div>`;
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
    document.getElementById('channel-title').textContent = entity.title || "Vidéos";

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
            
            const title = m.message || "Vidéo sans titre";
            const size = (m.media.document.size/1024/1024).toFixed(0);

            el.innerHTML = `
                <div class="thumb-placeholder"><span style="font-size:0.8rem; color:#666;">...</span></div>
                <div class="meta">
                    <div class="video-title">${title}</div>
                    <div style="font-size:0.75rem; color:#aaa; margin-top:4px;">⏱ ${dur} | ${size} MB</div>
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

// --- RECHERCHE ---
const performSearch = async () => {
    const q = document.getElementById('search-input').value;
    if(!q || q.length < 3) { log("3 chars min"); return; }
    
    const resGrid = document.getElementById('search-results');
    resGrid.innerHTML = "Cherche...";
    
    try {
        const res = await client.invoke(new Api.contacts.Search({ q: q, limit: 20 }));
        resGrid.innerHTML = "";
        
        const all = [...res.chats, ...res.users].filter(c => c.title || c.firstName);
        
        if(all.length === 0) { resGrid.innerHTML = "Aucun résultat"; return; }

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
        setTimeout(() => focusElement(resGrid.firstChild), 200);
    } catch(e) { log("Err: " + e.message); }
};

// --- STREAMING ---
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

// Events
document.getElementById('save-config-btn').onclick = () => { localStorage.setItem('teletv_id', document.getElementById('api-id').value); localStorage.setItem('teletv_hash', document.getElementById('api-hash').value); location.reload(); };
document.getElementById('btn-search-nav').onclick = () => navigateTo('search-screen');
document.getElementById('btn-clear-cache').onclick = clearCache;
document.getElementById('btn-reload').onclick = () => location.reload();
document.getElementById('btn-logout').onclick = () => { if(confirm("Déco?")) { localStorage.clear(); clearCache(); location.reload(); }};
document.getElementById('btn-do-search').onclick = performSearch;

document.getElementById('search-input').onkeydown = (e) => {
    if(e.key === 'Enter') performSearch();
};
document.onkeydown = (e) => { if(e.key === 'Backspace' || e.key === 'Escape') goBack(); };

startApp();

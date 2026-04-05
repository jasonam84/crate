// ═══════════ STATE ═══════════
const STORAGE_KEYS = {
  collection:'crate_v3',
  wishlist:'crate_wish',
  barcodeHistory:'crate_barcodes'
};

let collection = JSON.parse(localStorage.getItem(STORAGE_KEYS.collection)||'[]');
let wishlist   = JSON.parse(localStorage.getItem(STORAGE_KEYS.wishlist)||'[]');
let barcodeHistory = JSON.parse(localStorage.getItem(STORAGE_KEYS.barcodeHistory)||'{}');
const discogsToken = 'nQzwdQndLRdGpdttKIHVukGDCJYNstSqBNxtSAfY';
let current = null;
let spinning = false;
let camStream = null;
let crateFilter = 'all';
let gridFilterVal = 'all';
let sortMode = 'manual';
let toastTimer = null;
let dragItemId = null;
let discRotation = {x:10,y:-22};
let discDragState = null;
let suppressSpinToggle = false;
let isSharedView = false;
let pendingInstallPrompt = null;

const CONDITION_SCALE = [
  {value:'', label:'Unrated', score:0, wear:'Unknown'},
  {value:'P', label:'Poor', score:1, wear:'Heavy wear'},
  {value:'G', label:'Good', score:2, wear:'Well used'},
  {value:'VG', label:'VG', score:3, wear:'Visible wear'},
  {value:'VG+', label:'VG+', score:4, wear:'Light wear'},
  {value:'NM', label:'NM', score:5, wear:'Nearly flawless'}
];

// ═══════════ PERSIST ═══════════
function save(){
  if(isSharedView) return;
  localStorage.setItem(STORAGE_KEYS.collection, JSON.stringify(collection));
  localStorage.setItem(STORAGE_KEYS.wishlist, JSON.stringify(wishlist));
  localStorage.setItem(STORAGE_KEYS.barcodeHistory, JSON.stringify(barcodeHistory));
}

function getAppState(){
  return {
    collection,
    wishlist,
    savedAt: new Date().toISOString()
  };
}

function applyAppState(data){
  collection = Array.isArray(data?.collection) ? data.collection : [];
  wishlist = Array.isArray(data?.wishlist) ? data.wishlist : [];
}

function hasAnyLocalData(){
  return collection.length || wishlist.length;
}

function refreshUI(){
  document.body.classList.toggle('shared-view', isSharedView);
  renderCrate();
  renderGrid();
  renderWishlist();
  updatePills();
  const sortEl=document.getElementById('crate-sort');
  if(sortEl) sortEl.value=sortMode;
  if(document.getElementById('page-stats').classList.contains('active')) renderStats();
}

function getMaxManualOrder(){
  return collection.reduce((max,item)=>Math.max(max, item.manualOrder ?? 0), 0);
}

function normalizeCollectionOrder(){
  collection = collection.map((item,index)=>normalizeRecord({
    ...item,
    manualOrder: item.manualOrder ?? index + 1
  }));
  wishlist = wishlist.map(normalizeWishlistItem);
  if(!barcodeHistory || typeof barcodeHistory !== 'object' || Array.isArray(barcodeHistory)) barcodeHistory = {};
}

function getConditionMeta(grade){
  return CONDITION_SCALE.find(entry=>entry.value===grade) || CONDITION_SCALE[0];
}

function getConditionScore(item){
  if(item.conditionGrade) return getConditionMeta(item.conditionGrade).score;
  return item.conditionRating || 0;
}

function ratingToGrade(rating){
  if(rating >= 5) return 'NM';
  if(rating >= 4) return 'VG+';
  if(rating >= 3) return 'VG';
  if(rating >= 2) return 'G';
  if(rating >= 1) return 'P';
  return '';
}

function normalizeRecord(item){
  const conditionGrade=item.conditionGrade || ratingToGrade(item.conditionRating || 0);
  return {
    ...item,
    conditionGrade,
    conditionRating:getConditionMeta(conditionGrade).score,
    barcode:item.barcode || '',
    notes:item.notes || '',
    tracklist:Array.isArray(item.tracklist) ? item.tracklist : []
  };
}

function normalizeWishlistItem(item){
  return {
    ...item,
    thumb:normalizeImageUrl(item.thumb) || null,
    cover:normalizeImageUrl(item.cover) || null,
    alertTarget:item.alertTarget === '' || item.alertTarget === null || item.alertTarget === undefined ? '' : Number(item.alertTarget),
    lowestPrice:typeof item.lowestPrice === 'number' ? item.lowestPrice : null,
    numForSale:item.numForSale || 0,
    lastPriceCheck:item.lastPriceCheck || 0,
    currency:item.currency || 'USD',
    notes:item.notes || ''
  };
}

function formatPrice(value, currency='USD'){
  if(typeof value !== 'number' || Number.isNaN(value)) return 'No market price yet';
  try{
    return new Intl.NumberFormat(undefined,{style:'currency',currency,maximumFractionDigits:2}).format(value);
  }catch(e){
    return `$${value.toFixed(2)}`;
  }
}

function renderWearMeter(grade){
  const meta=getConditionMeta(grade);
  return `<div class="wear-meter" aria-label="${meta.wear}">
    ${[1,2,3,4,5].map(step=>`<span class="wear-seg${meta.score>=step?' on':''}"></span>`).join('')}
  </div>`;
}

function setThemeColor(r,g,b){
  const root=document.documentElement;
  root.style.setProperty('--theme-rgb', `${r}, ${g}, ${b}`);
  root.style.setProperty('--theme-soft-rgb', `${Math.min(255, r + 28)}, ${Math.min(255, g + 28)}, ${Math.min(255, b + 28)}`);
  root.style.setProperty('--theme-deep-rgb', `${Math.max(0, r - 38)}, ${Math.max(0, g - 38)}, ${Math.max(0, b - 38)}`);
}

function resetThemeColor(){
  setThemeColor(199,154,71);
}

function applyDiscRotation(){
  const wrap=document.getElementById('disc-wrap');
  if(!wrap) return;
  wrap.style.setProperty('--disc-rotate-x', `${discRotation.x}deg`);
  wrap.style.setProperty('--disc-rotate-y', `${discRotation.y}deg`);
}

function resetDiscRotation(isCD=false){
  discRotation = isCD ? {x:7,y:-14} : {x:10,y:-22};
  applyDiscRotation();
}

function applyHeroArt(coverUrl){
  const coverBg=document.getElementById('hero-cover-bg');
  if(coverUrl){
    coverBg.style.backgroundImage=`url("${coverUrl}")`;
    coverBg.style.opacity='0.52';
  }else{
    coverBg.style.backgroundImage='none';
    coverBg.style.opacity='0';
  }
}

function setDiscMode(isCD){
  const wrap=document.getElementById('disc-wrap');
  const face=document.getElementById('face-vinyl');
  const grooves=face.querySelector('.grooves');
  const lbl=document.getElementById('disc-label');
  wrap.classList.toggle('mode-cd', isCD);
  if(isCD){
    face.style.background='radial-gradient(circle at 35% 30%,#fcfcfc,#d9d9d9 32%,#bababa 55%,#8b8b8b 74%,#dcdcdc 88%,#666)';
    grooves.style.opacity='0.06';
    lbl.style.background='rgba(245,245,245,0.9)';
    lbl.style.border='2px solid rgba(210,210,210,0.95)';
  }else{
    face.style.background='radial-gradient(circle at 32% 28%,#2e2e2e,#080808)';
    grooves.style.opacity='1';
    lbl.style.background='#0a0a0a';
    lbl.style.border='2px solid #111';
  }
  resetDiscRotation(isCD);
}

function applyArtworkTheme(imageUrl){
  applyHeroArt(imageUrl);
  if(!imageUrl){
    document.getElementById('hero-color-bg').style.opacity='0';
    resetThemeColor();
    return;
  }
  const tmpImg=new Image();
  tmpImg.crossOrigin='anonymous';
  tmpImg.onload=()=>{
    try{
      const c=document.createElement('canvas');
      c.width=c.height=12;
      const ctx=c.getContext('2d');
      ctx.drawImage(tmpImg,0,0,12,12);
      const data=ctx.getImageData(0,0,12,12).data;
      let r=0,g=0,b=0,pixels=0;
      for(let i=0;i<data.length;i+=4){
        r+=data[i];
        g+=data[i+1];
        b+=data[i+2];
        pixels++;
      }
      r=Math.round(r/pixels);
      g=Math.round(g/pixels);
      b=Math.round(b/pixels);
      setThemeColor(r,g,b);
      const bg=document.getElementById('hero-color-bg');
      bg.style.background=`radial-gradient(circle at 30% 30%, rgba(${r},${g},${b},0.34), transparent 62%), linear-gradient(135deg, rgba(${r},${g},${b},0.22), rgba(${Math.max(0,r-40)},${Math.max(0,g-40)},${Math.max(0,b-40)},0.08))`;
      bg.style.opacity='1';
    }catch(e){
      resetThemeColor();
    }
  };
  tmpImg.onerror=()=>resetThemeColor();
  tmpImg.src=imageUrl;
}

function applyArtworkWithFallback(primaryUrl, fallbackUrl, onApply, onClear){
  const primary = normalizeImageUrl(primaryUrl);
  const fallback = normalizeImageUrl(fallbackUrl);
  if(primary){
    onApply(primary, ()=>{
      if(fallback && fallback !== primary) onApply(fallback, onClear);
      else onClear();
    });
    return;
  }
  if(fallback){
    onApply(fallback, onClear);
    return;
  }
  onClear();
}

function applyDiscArtwork(primaryUrl, fallbackUrl, fallbackText='CRATE'){
  const wrap=document.getElementById('disc-wrap');
  const img=document.getElementById('disc-cover-img');
  const lbl=document.getElementById('disc-label');
  applyArtworkWithFallback(primaryUrl, fallbackUrl, (url, onError)=>{
    img.onload=()=>{wrap.classList.add('has-art');};
    img.onerror=()=>{
      img.removeAttribute('src');
      wrap.classList.remove('has-art');
      onError();
    };
    img.src=url;
  }, ()=>{
    img.removeAttribute('src');
    wrap.classList.remove('has-art');
  });
  lbl.innerHTML=`<div class="label-placeholder">${fallbackText.substring(0,12).toUpperCase()}</div>`;
}

function applyHeroArtwork(primaryUrl, fallbackUrl){
  applyArtworkWithFallback(primaryUrl, fallbackUrl, (url, onError)=>{
    const tmpImg=new Image();
    tmpImg.crossOrigin='anonymous';
    tmpImg.onload=()=>{
      applyHeroArt(url);
      try{
        const c=document.createElement('canvas');
        c.width=c.height=12;
        const ctx=c.getContext('2d');
        ctx.drawImage(tmpImg,0,0,12,12);
        const data=ctx.getImageData(0,0,12,12).data;
        let r=0,g=0,b=0,pixels=0;
        for(let i=0;i<data.length;i+=4){
          r+=data[i];
          g+=data[i+1];
          b+=data[i+2];
          pixels++;
        }
        r=Math.round(r/pixels);
        g=Math.round(g/pixels);
        b=Math.round(b/pixels);
        setThemeColor(r,g,b);
        const bg=document.getElementById('hero-color-bg');
        bg.style.background=`radial-gradient(circle at 30% 30%, rgba(${r},${g},${b},0.34), transparent 62%), linear-gradient(135deg, rgba(${r},${g},${b},0.22), rgba(${Math.max(0,r-40)},${Math.max(0,g-40)},${Math.max(0,b-40)},0.08))`;
        bg.style.opacity='1';
      }catch(e){
        resetThemeColor();
      }
    };
    tmpImg.onerror=onError;
    tmpImg.src=url;
  }, ()=>{
    applyHeroArt(null);
    document.getElementById('hero-color-bg').style.opacity='0';
    resetThemeColor();
  });
}

// ═══════════ NAV ═══════════
function showPage(pg){
  document.querySelectorAll('.nav-tab').forEach(b=>b.classList.toggle('active', b.dataset.page===pg));
  document.querySelectorAll('.page').forEach(p=>{p.classList.remove('active');p.style.display='none';});
  const el = document.getElementById('page-'+pg);
  if(!el) return;
  if(pg==='scan') el.style.display='grid'; else el.style.display='block';
  el.classList.add('active');
  if(pg==='collection') renderGrid();
  if(pg==='stats') renderStats();
  if(pg==='wishlist') renderWishlist();
}

document.querySelectorAll('.nav-tab').forEach(btn=>{
  btn.addEventListener('click',()=>showPage(btn.dataset.page));
});

document.getElementById('home-link')?.addEventListener('click',event=>{
  event.preventDefault();
  showPage('scan');
});

// ═══════════ STATUS ═══════════
function setStatus(msg, state='idle'){
  document.getElementById('stext').textContent = msg;
  const d = document.getElementById('sdot');
  d.className = 'sdot'+(state==='active'?' active':state==='ok'?' ok':state==='err'?' err':'');
}

// ═══════════ TOAST ═══════════
function toast(msg){
  clearTimeout(toastTimer);
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  toastTimer=setTimeout(()=>t.classList.remove('show'),2600);
}

function discogsUrl(path, params={}){
  const url = new URL(`https://api.discogs.com/${path}`);
  Object.entries(params).forEach(([key,val])=>{
    if(val !== undefined && val !== null && val !== '') url.searchParams.set(key, val);
  });
  if(discogsToken) url.searchParams.set('token', discogsToken);
  return url.toString();
}

function normalizeImageUrl(url){
  if(!url) return null;
  return String(url).replace(/^http:\/\//i, 'https://');
}

function ensureEditable(){
  if(!isSharedView) return true;
  toast('Read-only share view');
  return false;
}

function encodeShareState(payload){
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function decodeShareState(value){
  const normalized=value.replace(/-/g,'+').replace(/_/g,'/');
  const padded=normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return JSON.parse(decodeURIComponent(escape(atob(padded))));
}

function getShareableCollection(){
  return collection.map(item=>({
    id:item.id,
    title:item.title,
    artist:item.artist,
    album:item.album,
    year:item.year,
    format:item.format,
    cover:item.cover || null,
    thumb:item.thumb || null,
    country:item.country || '',
    genre:item.genre || '',
    label:item.label || '',
    conditionRating:item.conditionRating || 0,
    notes:item.notes || '',
    loaned:!!item.loaned,
    loanedTo:item.loanedTo || '',
    addedAt:item.addedAt || 0,
    manualOrder:item.manualOrder || 0
  }));
}

function buildShareLink(){
  const payload={
    v:1,
    crate:getShareableCollection(),
    sharedAt:new Date().toISOString()
  };
  return `${location.origin}${location.pathname}#share=${encodeShareState(payload)}`;
}

async function copyShareLink(){
  if(!collection.length){toast('Add records first');return;}
  const link=buildShareLink();
  try{
    await navigator.clipboard.writeText(link);
    toast('Share link copied');
  }catch(e){
    prompt('Copy this share link:', link);
  }
}

function loadSharedViewFromHash(){
  const match=location.hash.match(/^#share=(.+)$/);
  if(!match) return false;
  try{
    const payload=decodeShareState(match[1]);
    if(!Array.isArray(payload.crate)) return false;
    collection = payload.crate;
    wishlist = [];
    normalizeCollectionOrder();
    isSharedView = true;
    sortMode='manual';
    return true;
  }catch(e){
    console.error('Invalid share payload', e);
    return false;
  }
}

function exitSharedView(){
  if(!isSharedView) return;
  location.hash='';
  isSharedView=false;
  collection = JSON.parse(localStorage.getItem(STORAGE_KEYS.collection)||'[]');
  wishlist = JSON.parse(localStorage.getItem(STORAGE_KEYS.wishlist)||'[]');
  barcodeHistory = JSON.parse(localStorage.getItem(STORAGE_KEYS.barcodeHistory)||'{}');
  normalizeCollectionOrder();
  refreshUI();
  toast('Returned to your crate');
}

// ═══════════ SEARCH ═══════════
async function doSearch(){
  const val = document.getElementById('search-input').value.trim();
  if(!val){setStatus('enter something to search','err');return;}
  if(/^\d{7,14}$/.test(val)) await lookupBarcode(val);
  else await searchTitle(val, true);
}

async function lookupBarcode(code){
  const known = barcodeHistory[code];
  if(known?.recordId){
    const existing=collection.find(item=>item.id===known.recordId);
    if(existing){
      loadItemById(existing.id);
      setStatus('barcode already in your crate','ok');
      toast(`Already scanned: ${existing.album}`);
      return;
    }
  }
  setStatus('looking up '+code+'...','active');
  try{
    const r = await fetch(discogsUrl('database/search',{barcode:code,per_page:8}));
    const d = await r.json();
    if(d.results&&d.results.length>0){
      const prepared=d.results.map(result=>({...result,_scannedBarcode:code}));
      if(prepared.length===1) loadResult(prepared[0]);
      else showResultsDrop(prepared);
    } else { setStatus('no results for '+code,'err'); toast('Not found'); }
  }catch(e){setStatus('lookup failed','err');}
}

async function searchTitle(q, showDrop=false){
  current = current ? {...current, barcode:''} : current;
  setStatus('searching for "'+q+'"...','active');
  try{
    const r = await fetch(discogsUrl('database/search',{q,type:'release',per_page:8}));
    const d = await r.json();
    if(d.results&&d.results.length>0){
      if(showDrop && d.results.length>1) showResultsDrop(d.results);
      else loadResult(d.results[0]);
    } else { setStatus('no results','err'); toast('Nothing found'); }
  }catch(e){setStatus('search failed','err');}
}

function showResultsDrop(results){
  const drop = document.getElementById('results-drop');
  drop.innerHTML = results.map((r,i)=>{
    const parts=(r.title||'').split(' - ');
    const artist=parts[0]||'Unknown';
    const album=parts[1]||parts[0]||'Unknown';
    const fmt=r.format?r.format[0]:'';
    const thumb=normalizeImageUrl(r.thumb);
    return `<div class="result-item" onclick="pickResult(${i})">
      ${thumb?`<img class="result-thumb" src="${thumb}" alt="" />`:`<div class="result-thumb" style="border-radius:50%;background:radial-gradient(circle,#1e1e1e,#080808)"></div>`}
      <div class="result-info">
        <div class="result-title">${album}</div>
        <div class="result-sub">${artist} · ${r.year||'?'} · ${fmt}</div>
      </div>
    </div>`;
  }).join('');
  drop.style.display='block';
  window._dropResults = results;
  setStatus(results.length+' results found — pick one','ok');
}

function pickResult(i){
  document.getElementById('results-drop').style.display='none';
  loadResult(window._dropResults[i]);
}

document.addEventListener('click', e=>{
  if(!e.target.closest('#scan-wrap')) document.getElementById('results-drop').style.display='none';
});

// ═══════════ LOAD ALBUM ═══════════
function loadResult(item){
  const parts=(item.title||'Unknown').split(' - ');
  const artist=parts[0]||'Unknown';
  const album=parts[1]||parts[0]||'Unknown';
  const fmt=item.format?item.format[0]:'Vinyl';
  current = normalizeRecord({
    id:item.id||Date.now(),
    title:item.title||'Unknown',
    artist, album,
    year:item.year||'',
    format:fmt,
    cover:normalizeImageUrl(item.cover_image)||null,
    thumb:normalizeImageUrl(item.thumb)||null,
    country:item.country||'',
    genre:item.genre?item.genre[0]:'',
    label:item.label?item.label[0]:'',
    condition:'',
    conditionGrade:item.conditionGrade || '',
    notes:item.notes || '',
    loaned:!!item.loaned,
    loanedTo:item.loanedTo || '',
    barcode:item._scannedBarcode || item.barcode || '',
    addedAt: item.addedAt || Date.now(),
    manualOrder:item.manualOrder || getMaxManualOrder()+1,
    tracklist:Array.isArray(item.tracklist) ? item.tracklist : [],
  });

  // update disc
  applyDiscArtwork(current.cover, current.thumb, album);

  const isCD = fmt.toLowerCase().includes('cd');
  setDiscMode(isCD);
  applyHeroArtwork(current.cover, current.thumb);

  // title animate
  const titleEl=document.getElementById('big-title');
  titleEl.style.opacity='0';titleEl.style.transform='translateY(12px)';
  setTimeout(()=>{
    titleEl.textContent=album.toUpperCase();
    titleEl.classList.add('loaded');
    titleEl.style.opacity='1';titleEl.style.transform='translateY(0)';
    titleEl.style.transition='opacity 0.4s,transform 0.4s';
  },50);
  const artEl=document.getElementById('big-artist');
  artEl.textContent=artist; artEl.classList.add('loaded');

  // chips
  const chips=document.getElementById('meta-row');
  chips.innerHTML='';
  const addChip=(txt,cls)=>{if(txt){const s=document.createElement('span');s.className='chip '+cls;s.textContent=txt;chips.appendChild(s);}};
  addChip(current.year,'chip-dim');
  addChip(isCD?'CD':'VINYL', isCD?'chip-teal':'chip-gold');
  addChip(current.genre,'chip-dim');
  addChip(current.country,'chip-dim');
  addChip(current.label,'chip-dim');

  document.getElementById('now-tag').innerHTML='<span class="blink"></span>FOUND ON DISCOGS';
  document.getElementById('add-btn').disabled=false;
  document.getElementById('add-btn').textContent='+ ADD TO CRATE';

  // fetch tracklist
  fetchTracklist(item.id);
  setStatus('found: '+current.title,'ok');
  toast('Loaded: '+album);

  // reset spin
  spinning=false;
  const dw=document.getElementById('disc-wrap');
  dw.classList.remove('spinning');
}

async function fetchTracklist(id){
  document.getElementById('tracklist-panel').style.display='none';
  try{
    const r=await fetch(discogsUrl(`releases/${id}`));
    const d=await r.json();
    if(d.tracklist&&d.tracklist.length>0){
      current.tracklist=d.tracklist.map(t=>({title:t.title,duration:t.duration||''}));
      const panel=document.getElementById('tracklist-panel');
      panel.innerHTML='<div style="font-family:\'DM Mono\',monospace;font-size:9px;letter-spacing:0.15em;color:var(--text3);margin-bottom:8px">TRACKLIST</div>'+
        current.tracklist.slice(0,8).map((t,i)=>
          `<div class="track-item"><span class="track-num">${String(i+1).padStart(2,'0')}</span><span class="track-title">${t.title}</span><span class="track-dur">${t.duration}</span></div>`
        ).join('')+
        (current.tracklist.length>8?`<div class="track-item" style="color:var(--text4)">+ ${current.tracklist.length-8} more tracks</div>`:'');
      panel.style.display='block';
    }
  }catch(e){}
}

// ═══════════ DISC SPIN ═══════════
function toggleSpin(){
  if(suppressSpinToggle){
    suppressSpinToggle=false;
    return;
  }
  if(!current){toast('Scan an album first');return;}
  spinning=!spinning;
  const dw=document.getElementById('disc-wrap');
  if(spinning){
    dw.classList.add('spinning');
    toast('Spinning: '+current.album);
  } else {
    dw.classList.remove('spinning');
  }
}

function startDiscDrag(event){
  const wrap=document.getElementById('disc-wrap');
  if(!wrap) return;
  discDragState = {
    pointerId:event.pointerId,
    startX:event.clientX,
    startY:event.clientY,
    startRotateX:discRotation.x,
    startRotateY:discRotation.y,
    moved:false
  };
  wrap.classList.add('dragging');
  wrap.setPointerCapture(event.pointerId);
}

function moveDiscDrag(event){
  if(!discDragState || discDragState.pointerId!==event.pointerId) return;
  const dx=event.clientX-discDragState.startX;
  const dy=event.clientY-discDragState.startY;
  if(Math.abs(dx)>2 || Math.abs(dy)>2) discDragState.moved=true;
  discRotation.y = Math.max(-75, Math.min(75, discDragState.startRotateY + dx * 0.35));
  discRotation.x = Math.max(-50, Math.min(50, discDragState.startRotateX - dy * 0.35));
  applyDiscRotation();
}

function endDiscDrag(event){
  if(!discDragState || discDragState.pointerId!==event.pointerId) return;
  const wrap=document.getElementById('disc-wrap');
  if(wrap){
    wrap.classList.remove('dragging');
    try{wrap.releasePointerCapture(event.pointerId);}catch(e){}
  }
  if(discDragState.moved) suppressSpinToggle=true;
  discDragState = null;
}

function clearAlbum(){
  current=null;spinning=false;
  const dw=document.getElementById('disc-wrap');
  dw.classList.remove('spinning');
  dw.classList.remove('mode-cd');
  dw.classList.remove('has-art');
  document.getElementById('disc-label').innerHTML='<div class="label-placeholder">CRATE<br>MUSIC<br>LIBRARY</div>';
  document.getElementById('disc-cover-img').removeAttribute('src');
  setDiscMode(false);
  document.getElementById('big-title').textContent='NO ALBUM\nSELECTED';
  document.getElementById('big-title').classList.remove('loaded');
  document.getElementById('big-artist').textContent='—';
  document.getElementById('big-artist').classList.remove('loaded');
  document.getElementById('meta-row').innerHTML='';
  document.getElementById('tracklist-panel').style.display='none';
  document.getElementById('add-btn').disabled=true;
  document.getElementById('add-btn').textContent='+ ADD TO CRATE';
  document.getElementById('hero-color-bg').style.opacity='0';
  document.getElementById('hero-cover-bg').style.opacity='0';
  document.getElementById('hero-cover-bg').style.backgroundImage='none';
  resetThemeColor();
  resetDiscRotation(false);
  setStatus('cleared');
}

// ═══════════ COLLECTION ═══════════
function addToCollection(){
  if(!ensureEditable()) return;
  if(!current)return;
  if(collection.find(c=>c.id===current.id)){toast('Already in crate!');return;}
  const item=normalizeRecord({...current,addedAt:Date.now(),manualOrder:getMaxManualOrder()+1});
  collection.push(item);
  if(item.barcode){
    barcodeHistory[item.barcode]={
      recordId:item.id,
      album:item.album,
      artist:item.artist,
      scannedAt:Date.now()
    };
  }
  save(); renderCrate(); updatePills();
  document.getElementById('add-btn').textContent='✓ IN CRATE';
  document.getElementById('add-btn').disabled=true;
  toast('Added to crate!');
}

function removeItem(id, e){
  if(!ensureEditable()) return;
  e&&e.stopPropagation();
  Object.keys(barcodeHistory).forEach(code=>{
    if(barcodeHistory[code]?.recordId===id) delete barcodeHistory[code];
  });
  collection=collection.filter(c=>c.id!==id);
  save(); renderCrate(); updatePills();
  toast('Removed from crate');
}

function toggleLoan(id, e){
  if(!ensureEditable()) return;
  e&&e.stopPropagation();
  const item=collection.find(c=>c.id===id);
  if(!item)return;
  if(item.loaned){item.loaned=false;item.loanedTo='';save();renderCrate();toast('Marked as returned');}
  else{
    const name=prompt('Loaned to:');
    if(name){item.loaned=true;item.loanedTo=name;save();renderCrate();toast('Marked as loaned to '+name);}
  }
}

function editItem(id, e){
  e&&e.stopPropagation();
  const item=collection.find(c=>c.id===id);
  if(!item)return;
  showEditModal(item);
}

function showEditModal(item){
  const grade=item.conditionGrade || ratingToGrade(item.conditionRating || 0);
  const meta=getConditionMeta(grade);
  const m=document.getElementById('active-modal');
  m.innerHTML=`
    <div class="modal-title">EDIT RECORD</div>
    <div class="modal-field"><label class="modal-label">ALBUM</label><input class="modal-input" id="e-album" value="${item.album||''}" /></div>
    <div class="modal-field"><label class="modal-label">ARTIST</label><input class="modal-input" id="e-artist" value="${item.artist||''}" /></div>
    <div class="modal-field"><label class="modal-label">YEAR</label><input class="modal-input" id="e-year" value="${item.year||''}" /></div>
    <div class="modal-field"><label class="modal-label">FORMAT</label>
      <select class="modal-select" id="e-format">
        <option ${!/cd/i.test(item.format)?'selected':''}>Vinyl</option>
        <option ${/cd/i.test(item.format)?'selected':''}>CD</option>
      </select>
    </div>
    <div class="modal-field"><label class="modal-label">CONDITION</label>
      <select class="modal-select" id="e-condition-grade" onchange="updateConditionPreview(this.value)">
        ${CONDITION_SCALE.map(entry=>`<option value="${entry.value}" ${entry.value===grade?'selected':''}>${entry.label}</option>`).join('')}
      </select>
      <div class="condition-preview" id="condition-preview">
        <div class="condition-pill">${meta.label}</div>
        ${renderWearMeter(grade)}
        <div class="condition-copy">${meta.wear}</div>
      </div>
    </div>
    <div class="modal-field"><label class="modal-label">NOTES</label><textarea class="modal-textarea" id="e-notes">${item.notes||''}</textarea></div>
    <div class="modal-btns">
      <button class="btn btn-ghost" onclick="closeModal()">CANCEL</button>
      <button class="btn btn-gold" onclick="saveEdit(${item.id})">SAVE</button>
    </div>`;
  openModal();
}

function updateConditionPreview(grade){
  const meta=getConditionMeta(grade);
  const preview=document.getElementById('condition-preview');
  if(!preview) return;
  preview.innerHTML=`<div class="condition-pill">${meta.label}</div>${renderWearMeter(grade)}<div class="condition-copy">${meta.wear}</div>`;
}

function saveEdit(id){
  if(!ensureEditable()) return;
  const item=collection.find(c=>c.id===id);
  if(!item)return;
  item.album=document.getElementById('e-album').value||item.album;
  item.artist=document.getElementById('e-artist').value||item.artist;
  item.year=document.getElementById('e-year').value||item.year;
  item.format=document.getElementById('e-format').value;
  item.conditionGrade=document.getElementById('e-condition-grade').value;
  item.conditionRating=getConditionMeta(item.conditionGrade).score;
  item.notes=document.getElementById('e-notes').value;
  item.title=item.artist+' - '+item.album;
  if(item.manualOrder === undefined) item.manualOrder=getMaxManualOrder()+1;
  save(); renderCrate(); renderGrid();
  closeModal(); toast('Saved!');
}

function openEditModal(){
  if(!current){toast('Load an album first');return;}
  const fake={...current,conditionGrade:current.conditionGrade || '',conditionRating:getConditionMeta(current.conditionGrade || '').score};
  showEditModal({...fake, id:current.id});
}

// ═══════════ RENDER CRATE ═══════════
function renderCrate(){
  const list=document.getElementById('coll-list');
  document.getElementById('crate-count').textContent=collection.length+' record'+(collection.length!==1?'s':'');
  let items=filterAndSort(collection, crateFilter);
  if(!items.length){
    list.innerHTML='<div id="empty-crate"><div class="empty-disc"><svg width="28" height="28" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="12" stroke="#3a3530" stroke-width="1.5"/><circle cx="14" cy="14" r="4" stroke="#3a3530" stroke-width="1.5"/></svg></div>'+
    (crateFilter!=='all'?'No '+crateFilter+' records.':'Your crate is empty.<br>Search or scan to add records.')+'</div>';
    return;
  }
  list.innerHTML=items.map((item,i)=>{
    const isCD=/cd/i.test(item.format);
    const dragEnabled = sortMode==='manual' && crateFilter==='all';
    const thumbHTML=item.thumb
      ?`<img src="${item.thumb}" alt="" onerror="this.style.display='none'" />`
      :`<div class="vinyl-mini"></div>`;
    const conditionMeta=getConditionMeta(item.conditionGrade || ratingToGrade(item.conditionRating || 0));
    const loanBadge=item.loaned?`<span class="format-badge badge-l" title="${item.loanedTo}">LOANED</span>`
      :`<span class="format-badge ${isCD?'badge-c':'badge-v'}">${isCD?'CD':'VINYL'}</span>`;
    return `<div class="coll-item${item.loaned?' loaned':''}${dragEnabled?' draggable':''}" id="ci-${item.id}" onclick="loadItemById(${item.id})" style="animation-delay:${Math.min(i,12)*0.04}s" draggable="${dragEnabled}" ondragstart="handleCrateDragStart(event, ${item.id})" ondragover="handleCrateDragOver(event, ${item.id})" ondrop="handleCrateDrop(event, ${item.id})" ondragend="handleCrateDragEnd()">
      <div class="item-art">${thumbHTML}</div>
      <div class="item-data">
        <div class="item-album">${item.album}</div>
        <div class="item-artist">${item.artist}${item.year?' · '+item.year:''}</div>
        ${item.notes?`<div class="item-note">${item.notes.substring(0,40)}</div>`:''}
        ${conditionMeta.score?`<div class="condition-row"><span class="condition-pill">${conditionMeta.label}</span>${renderWearMeter(conditionMeta.value)}</div>`:''}
        <div class="item-actions">
          ${dragEnabled?'<button class="ia drag-handle" title="Drag to reorder" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">DRAG</button>':''}
          <button class="ia" onclick="editItem(${item.id},event)">EDIT</button>
          <button class="ia" onclick="toggleLoan(${item.id},event)">${item.loaned?'RETURN':'LOAN'}</button>
          <button class="ia del" onclick="removeItem(${item.id},event)">REMOVE</button>
        </div>
      </div>
      <div class="item-right">${loanBadge}</div>
    </div>`;
  }).join('');
}

function filterAndSort(arr, f){
  let res=[...arr];
  if(f==='vinyl') res=res.filter(c=>!/cd/i.test(c.format));
  else if(f==='cd') res=res.filter(c=>/cd/i.test(c.format));
  else if(f==='loaned') res=res.filter(c=>c.loaned);
  if(sortMode==='manual') res.sort((a,b)=>(a.manualOrder??0)-(b.manualOrder??0));
  else if(sortMode==='alpha') res.sort((a,b)=>a.album.localeCompare(b.album));
  else if(sortMode==='year') res.sort((a,b)=>(b.year||0)-(a.year||0));
  else if(sortMode==='condition') res.sort((a,b)=>getConditionScore(b)-getConditionScore(a));
  else res.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
  return res;
}

function filterCrate(btn){
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  crateFilter=btn.dataset.f;
  renderCrate();
}

function sortCrate(val){sortMode=val;renderCrate();}

function reindexManualOrder(ids){
  const indexMap=new Map(ids.map((id,index)=>[id,index+1]));
  collection = collection.map(item=>indexMap.has(item.id)?{...item,manualOrder:indexMap.get(item.id)}:item);
}

function handleCrateDragStart(event,id){
  if(sortMode!=='manual' || crateFilter!=='all') return;
  dragItemId=id;
  event.dataTransfer.effectAllowed='move';
  event.dataTransfer.setData('text/plain', String(id));
  event.currentTarget.classList.add('dragging');
}

function handleCrateDragOver(event,id){
  if(sortMode!=='manual' || crateFilter!=='all' || dragItemId===null || dragItemId===id) return;
  event.preventDefault();
  document.querySelectorAll('.coll-item.drag-target').forEach(el=>el.classList.remove('drag-target'));
  event.currentTarget.classList.add('drag-target');
}

function handleCrateDrop(event,targetId){
  if(!ensureEditable()) return;
  if(sortMode!=='manual' || crateFilter!=='all' || dragItemId===null || dragItemId===targetId) return;
  event.preventDefault();
  const ordered=filterAndSort(collection,'all').map(item=>item.id);
  const fromIndex=ordered.indexOf(dragItemId);
  const toIndex=ordered.indexOf(targetId);
  if(fromIndex===-1 || toIndex===-1) return;
  ordered.splice(toIndex,0,ordered.splice(fromIndex,1)[0]);
  reindexManualOrder(ordered);
  save();
  renderCrate();
  renderGrid();
}

function handleCrateDragEnd(){
  dragItemId=null;
  document.querySelectorAll('.coll-item.dragging,.coll-item.drag-target').forEach(el=>{
    el.classList.remove('dragging','drag-target');
  });
}

function loadItemById(id){
  const item=collection.find(c=>c.id===id);
  if(!item)return;
  document.querySelectorAll('.coll-item').forEach(e=>e.classList.remove('active'));
  document.getElementById('ci-'+id)?.classList.add('active');
  loadResult({
    id:item.id,title:item.title,
    cover_image:item.cover,thumb:item.thumb,
    year:item.year,format:item.format?[item.format]:['Vinyl'],
    country:item.country,genre:item.genre?[item.genre]:undefined,
    label:item.label?[item.label]:undefined,
    barcode:item.barcode || '',
    conditionGrade:item.conditionGrade || '',
    notes:item.notes || '',
    loaned:item.loaned,
    loanedTo:item.loanedTo,
    addedAt:item.addedAt,
    manualOrder:item.manualOrder,
    tracklist:item.tracklist || []
  });
  document.getElementById('add-btn').textContent='✓ IN CRATE';
  document.getElementById('add-btn').disabled=true;
}

// ═══════════ SHUFFLE ═══════════
function shufflePlay(){
  const avail=collection.filter(c=>!c.loaned);
  if(!avail.length){toast('Add some records first!');return;}
  // weighted: prefer less-played
  const pick=avail[Math.floor(Math.random()*avail.length)];
  loadItemById(pick.id);
  setTimeout(()=>{
    spinning=true;
    document.getElementById('disc-wrap').classList.add('spinning');
  },500);
  toast('Tonight: '+pick.album);
}

// ═══════════ GRID (COLLECTION PAGE) ═══════════
function renderGrid(){
  const q=(document.getElementById('grid-search').value||'').toLowerCase();
  const grid=document.getElementById('album-grid');
  const empty=document.getElementById('grid-empty');
  let items=filterAndSort(collection,gridFilterVal);
  if(q) items=items.filter(c=>c.album.toLowerCase().includes(q)||c.artist.toLowerCase().includes(q));
  if(!items.length){grid.innerHTML='';empty.style.display='block';return;}
  empty.style.display='none';
  grid.innerHTML=items.map((item,i)=>{
    const isCD=/cd/i.test(item.format);
    const cover=normalizeImageUrl(item.cover);
    const conditionMeta=getConditionMeta(item.conditionGrade || ratingToGrade(item.conditionRating || 0));
    return `<div class="grid-card" onclick="goToScanAndLoad(${item.id})" style="animation-delay:${Math.min(i,20)*0.03}s;--cover-delay:${Math.min(i,20)*0.03}s">
      ${cover
        ?`<img class="grid-card-art" src="${cover}" alt="${item.album}" onerror="this.outerHTML='<div class=grid-card-art-placeholder><div class=vinyl-thumb-svg></div></div>'" />`
        :`<div class="grid-card-art-placeholder"><div class="vinyl-thumb-svg"></div></div>`}
      <div class="grid-card-glow" ${cover?`style="background-image:url('${cover.replace(/'/g,"&#39;")}')"`:''}></div>
      ${item.loaned?'<div class="loan-overlay">LOANED</div>':''}
      <div class="grid-card-info">
        <div class="gc-album">${item.album}</div>
        <div class="gc-artist">${item.artist}</div>
        ${conditionMeta.score?`<div class="grid-condition"><span class="condition-pill">${conditionMeta.label}</span>${renderWearMeter(conditionMeta.value)}</div>`:''}
        <div class="gc-foot">
          <div class="gc-year">${item.year||''}</div>
          <span class="grid-badge ${isCD?'badge-c':'badge-v'} format-badge">${isCD?'CD':'VINYL'}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function gridFilter(btn){
  document.querySelectorAll('.grid-filter').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  gridFilterVal=btn.dataset.gf;
  renderGrid();
}

function goToScanAndLoad(id){
  showPage('scan');
  setTimeout(()=>loadItemById(id),100);
}

// ═══════════ STATS ═══════════
function renderStats(){
  const total=collection.length;
  const vinyls=collection.filter(c=>!/cd/i.test(c.format)).length;
  const cds=total-vinyls;
  const loaned=collection.filter(c=>c.loaned).length;
  const graded=collection.filter(c=>getConditionScore(c)>0).length;
  document.getElementById('stats-cards').innerHTML=[
    ['TOTAL RECORDS',total],['VINYL',vinyls],['CD',cds],['GRADED',graded],['WISHLIST',wishlist.length],['SCANNED BARCODES',Object.keys(barcodeHistory).length],['LOANED OUT',loaned]
  ].map(([l,v],i)=>`<div class="stat-card" style="animation-delay:${i*0.08}s"><div class="sc-num">${v}</div><div class="sc-label">${l}</div></div>`).join('');

  // genre chart
  const genres={};
  collection.forEach(c=>{if(c.genre)genres[c.genre]=(genres[c.genre]||0)+1;});
  const genreMax=Math.max(...Object.values(genres),1);
  const genreRows=Object.entries(genres).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([g,n])=>
    `<div class="bar-row"><div class="bar-label-txt">${g}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.round(n/genreMax*100)}%"></div></div><div class="bar-count">${n}</div></div>`
  ).join('');

  // decade chart
  const decades={};
  collection.forEach(c=>{if(c.year){const d=Math.floor(parseInt(c.year)/10)*10;decades[d+'s']=(decades[d+'s']||0)+1;}});
  const decMax=Math.max(...Object.values(decades),1);
  const decRows=Object.entries(decades).sort((a,b)=>a[0].localeCompare(b[0])).map(([d,n])=>
    `<div class="bar-row"><div class="bar-label-txt">${d}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.round(n/decMax*100)}%"></div></div><div class="bar-count">${n}</div></div>`
  ).join('');

  document.getElementById('stats-charts').innerHTML=`
    <div class="bar-chart"><div class="chart-title">BY GENRE</div>${genreRows||'<div style="color:var(--text3);font-size:12px">No genre data</div>'}</div>
    <div class="bar-chart"><div class="chart-title">BY DECADE</div>${decRows||'<div style="color:var(--text3);font-size:12px">No year data</div>'}</div>
  `;
}

// ═══════════ WISHLIST ═══════════
async function wishSearch(){
  const q=document.getElementById('wish-input').value.trim();
  if(!q)return;
  const r=document.getElementById('wish-results');
  r.innerHTML='<div style="padding:10px 14px;font-size:12px;color:var(--text3)">Searching...</div>';
  r.style.display='block';
  try{
    const res=await fetch(discogsUrl('database/search',{q,type:'release',per_page:6}));
    const d=await res.json();
    if(!d.results||!d.results.length){r.innerHTML='<div style="padding:10px 14px;font-size:12px;color:var(--text3)">No results</div>';return;}
    r.innerHTML=d.results.map((it,i)=>{
      const parts=(it.title||'').split(' - ');
      const artist=parts[0];const album=parts[1]||parts[0];
      const thumb=normalizeImageUrl(it.thumb);
      return `<div class="result-item" onclick="addToWishlist(${i})">
        ${thumb?`<img class="result-thumb" src="${thumb}" alt="" />`:`<div class="result-thumb"></div>`}
        <div class="result-info"><div class="result-title">${album}</div><div class="result-sub">${artist} · ${it.year||'?'}</div></div>
        <button class="btn btn-ghost" style="flex-shrink:0;padding:5px 10px;font-size:9px" onclick="addToWishlist(${i});event.stopPropagation()">+ WISH</button>
      </div>`;
    }).join('');
    window._wishResults=d.results;
  }catch(e){r.innerHTML='<div style="padding:10px 14px;font-size:12px;color:var(--red)">Search failed</div>';}
}

function addToWishlist(i){
  if(!ensureEditable()) return;
  const it=window._wishResults[i];
  const parts=(it.title||'').split(' - ');
  const artist=parts[0];const album=parts[1]||parts[0];
  if(wishlist.find(w=>w.id===it.id)){toast('Already on wishlist');return;}
  wishlist.push(normalizeWishlistItem({id:it.id,title:it.title,artist,album,year:it.year||'',thumb:normalizeImageUrl(it.thumb)||null,cover:normalizeImageUrl(it.cover_image)||null,addedAt:Date.now(),alertTarget:''}));
  save();renderWishlist();
  document.getElementById('wish-results').style.display='none';
  toast('Added to wishlist: '+album);
  refreshWishlistPrice(it.id);
}

function removeWish(id,e){
  if(!ensureEditable()) return;
  e&&e.stopPropagation();
  wishlist=wishlist.filter(w=>w.id!==id);
  save();renderWishlist();
}

function moveWishToCrate(id,e){
  if(!ensureEditable()) return;
  e&&e.stopPropagation();
  const item=wishlist.find(w=>w.id===id);
  if(!item)return;
  if(!collection.find(c=>c.id===id)){
    collection.push(normalizeRecord({...item,format:'Vinyl',condition:'',conditionGrade:'',notes:item.notes||'',loaned:false,loanedTo:'',plays:0,tracklist:[],manualOrder:getMaxManualOrder()+1}));
    wishlist=wishlist.filter(w=>w.id!==id);
    save();renderWishlist();renderCrate();updatePills();
    toast('Moved to crate: '+item.album);
  } else {toast('Already in crate!');}
}

function setWishAlertTarget(id, value){
  if(!ensureEditable()) return;
  const item=wishlist.find(w=>w.id===id);
  if(!item) return;
  const normalized=value.trim()==='' ? '' : Math.max(0, Number(value));
  item.alertTarget=normalized==='' || Number.isNaN(normalized) ? '' : normalized;
  save();
  renderWishlist();
}

async function refreshWishlistPrice(id){
  const item=wishlist.find(w=>w.id===id);
  if(!item) return;
  try{
    const res=await fetch(discogsUrl(`marketplace/stats/${id}`));
    const data=await res.json();
    item.lowestPrice=typeof data.lowest_price === 'number' ? data.lowest_price : null;
    item.numForSale=typeof data.num_for_sale === 'number' ? data.num_for_sale : 0;
    item.currency=data.currency || 'USD';
    item.lastPriceCheck=Date.now();
    save();
    renderWishlist();
  }catch(e){
    toast('Price check failed');
  }
}

async function checkWishlistPrices(){
  if(!wishlist.length){toast('Wishlist is empty');return;}
  const btn=document.getElementById('wish-price-check-btn');
  if(btn) btn.disabled=true;
  let checked=0;
  for(const item of wishlist){
    try{
      const res=await fetch(discogsUrl(`marketplace/stats/${item.id}`));
      const data=await res.json();
      item.lowestPrice=typeof data.lowest_price === 'number' ? data.lowest_price : null;
      item.numForSale=typeof data.num_for_sale === 'number' ? data.num_for_sale : 0;
      item.currency=data.currency || 'USD';
      item.lastPriceCheck=Date.now();
      checked++;
    }catch(e){}
  }
  save();
  renderWishlist();
  if(btn) btn.disabled=false;
  toast(checked ? `Checked ${checked} wishlist price${checked!==1?'s':''}` : 'Price checks failed');
}

function renderWishlist(){
  const el=document.getElementById('wish-list');
  if(!wishlist.length){
    el.innerHTML='<div id="wish-empty" class="wish-item" style="justify-content:center;background:transparent;border-color:transparent">Your wishlist is empty.</div>';
    return;
  }
  el.innerHTML=wishlist.map((item,i)=>{
    const belowTarget=typeof item.lowestPrice==='number' && typeof item.alertTarget==='number' && item.alertTarget>0 && item.lowestPrice<=item.alertTarget;
    return `
    <div class="wish-item" style="animation-delay:${i*0.05}s">
      <div class="wish-art">${item.thumb?`<img src="${item.thumb}" alt="" />`:'♪'}</div>
      <div class="wish-data">
        <div class="wish-title">${item.album}</div>
        <div class="wish-artist">${item.artist}${item.year?' · '+item.year:''}</div>
        <div class="wish-price-row">
          <div class="wish-price">${formatPrice(item.lowestPrice, item.currency)}</div>
          ${belowTarget?'<div class="wish-alert-hit">below target</div>':''}
          ${item.numForSale?`<div class="wish-price-meta">${item.numForSale} for sale</div>`:''}
        </div>
        <div class="wish-alert-row">
          <label class="wish-target-label">Target</label>
          <input class="wish-target-input" type="number" min="0" step="0.01" value="${item.alertTarget === '' ? '' : item.alertTarget}" placeholder="0.00" onchange="setWishAlertTarget(${item.id}, this.value)" />
          <button class="btn btn-ghost" style="font-size:9px;padding:5px 10px" onclick="refreshWishlistPrice(${item.id})">CHECK</button>
          ${item.lastPriceCheck?`<div class="wish-price-meta">checked ${new Date(item.lastPriceCheck).toLocaleDateString()}</div>`:''}
        </div>
      </div>
      <div class="wish-actions">
        <button class="btn btn-teal" style="font-size:9px;padding:5px 10px" onclick="moveWishToCrate(${item.id},event)">GOT IT</button>
        <button class="btn btn-danger" style="font-size:9px;padding:5px 10px" onclick="removeWish(${item.id},event)">REMOVE</button>
      </div>
    </div>
  `;
  }).join('');
}

// ═══════════ CAMERA ═══════════
async function openCam(){
  try{
    camStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    showModal(`
      <div class="modal-title">CAMERA SCAN</div>
      <video id="cam-video" autoplay playsinline muted></video>
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--text3);margin-bottom:1rem;letter-spacing:0.06em">Position barcode in frame, or enter it manually</div>
      <div class="modal-btns">
        <button class="btn btn-ghost" onclick="closeCam()">CANCEL</button>
        <button class="btn btn-gold" onclick="promptBarcode()">ENTER BARCODE</button>
      </div>
    `);
    document.getElementById('cam-video').srcObject=camStream;
  }catch(e){toast('Camera denied — use manual search');}
}

function closeCam(){
  if(camStream){camStream.getTracks().forEach(t=>t.stop());camStream=null;}
  closeModal();
}

function promptBarcode(){
  const code=prompt('Enter the barcode number:');
  closeCam();
  if(code&&code.trim())lookupBarcode(code.trim());
}

// ═══════════ WISHLIST SEARCH FROM SCAN ═══════════
function openWishSearch(){
  showPage('wishlist');
}

function updateInstallButton(){
  const btn=document.getElementById('install-app-btn');
  if(!btn) return;
  btn.hidden = !pendingInstallPrompt;
}

async function installApp(){
  if(!pendingInstallPrompt){
    toast('Use your browser menu to add CRATE to your home screen');
    return;
  }
  try{
    await pendingInstallPrompt.prompt();
    await pendingInstallPrompt.userChoice;
  }catch(e){}
  pendingInstallPrompt=null;
  updateInstallButton();
}

async function registerPWA(){
  if(!('serviceWorker' in navigator)) return;
  try{
    await navigator.serviceWorker.register('./sw.js');
  }catch(e){
    console.error('Service worker registration failed', e);
  }
}

window.addEventListener('beforeinstallprompt', event=>{
  event.preventDefault();
  pendingInstallPrompt=event;
  updateInstallButton();
});

window.addEventListener('appinstalled', ()=>{
  pendingInstallPrompt=null;
  updateInstallButton();
  toast('CRATE installed');
});

function showModal(html){
  document.getElementById('active-modal').innerHTML=html;
  document.getElementById('modal-overlay').classList.add('open');
}
function openModal(){document.getElementById('modal-overlay').classList.add('open');}
function closeModal(){document.getElementById('modal-overlay').classList.remove('open');}
document.getElementById('modal-overlay').addEventListener('click',e=>{if(e.target===document.getElementById('modal-overlay'))closeModal();});

// ═══════════ PILLS ═══════════
function updatePills(){
  const v=collection.filter(c=>!/cd/i.test(c.format)).length;
  const c=collection.filter(x=>/cd/i.test(x.format)).length;
  const pv=document.getElementById('pill-vinyl');
  const pc=document.getElementById('pill-cd');
  pv.textContent=v+' VINYL';pc.textContent=c+' CD';
  pv.className='stat-pill'+(v?' on':'');
  pc.className='stat-pill'+(c?' on':'');
}

// ═══════════ KEYBOARD ═══════════
document.getElementById('search-input').addEventListener('keydown',e=>{if(e.key==='Enter')doSearch();});
document.getElementById('wish-input').addEventListener('keydown',e=>{if(e.key==='Enter')wishSearch();});
document.getElementById('grid-search').addEventListener('keydown',e=>{if(e.key==='Enter')renderGrid();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});

// ═══════════ INIT ═══════════
async function initApp(){
  loadSharedViewFromHash();
  normalizeCollectionOrder();
  resetThemeColor();
  resetDiscRotation(false);
  refreshUI();
  updateInstallButton();
  registerPWA();
  setStatus('ready — enter barcode or album title, or click CAMERA');
  const wrap=document.getElementById('disc-wrap');
  if(wrap){
    wrap.addEventListener('pointerdown', startDiscDrag);
    wrap.addEventListener('pointermove', moveDiscDrag);
    wrap.addEventListener('pointerup', endDiscDrag);
    wrap.addEventListener('pointercancel', endDiscDrag);
  }
}

initApp();

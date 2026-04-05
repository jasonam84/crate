// ═══════════ STATE ═══════════
const STORAGE_KEYS = {
  collection:'crate_v3',
  wishlist:'crate_wish'
};

let collection = JSON.parse(localStorage.getItem(STORAGE_KEYS.collection)||'[]');
let wishlist   = JSON.parse(localStorage.getItem(STORAGE_KEYS.wishlist)||'[]');
let current = null;
let spinning = false;
let camStream = null;
let crateFilter = 'all';
let gridFilterVal = 'all';
let sortMode = 'added';
let toastTimer = null;

// ═══════════ PERSIST ═══════════
function save(){
  localStorage.setItem(STORAGE_KEYS.collection, JSON.stringify(collection));
  localStorage.setItem(STORAGE_KEYS.wishlist, JSON.stringify(wishlist));
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
  renderCrate();
  renderGrid();
  renderWishlist();
  updatePills();
  if(document.getElementById('page-stats').classList.contains('active')) renderStats();
}

// ═══════════ NAV ═══════════
document.querySelectorAll('.nav-tab').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.nav-tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const pg = btn.dataset.page;
    document.querySelectorAll('.page').forEach(p=>{p.classList.remove('active');p.style.display='none'});
    const el = document.getElementById('page-'+pg);
    if(pg==='scan') el.style.display='grid'; else el.style.display='block';
    el.classList.add('active');
    if(pg==='collection') renderGrid();
    if(pg==='stats') renderStats();
    if(pg==='wishlist') renderWishlist();
  });
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
  return url.toString();
}

// ═══════════ SEARCH ═══════════
async function doSearch(){
  const val = document.getElementById('search-input').value.trim();
  if(!val){setStatus('enter something to search','err');return;}
  if(/^\d{7,14}$/.test(val)) await lookupBarcode(val);
  else await searchTitle(val, true);
}

async function lookupBarcode(code){
  setStatus('looking up '+code+'...','active');
  try{
    const r = await fetch(discogsUrl('database/search',{barcode:code,per_page:8}));
    const d = await r.json();
    if(d.results&&d.results.length>0){
      if(d.results.length===1) loadResult(d.results[0]);
      else showResultsDrop(d.results);
    } else { setStatus('no results for '+code,'err'); toast('Not found'); }
  }catch(e){setStatus('lookup failed','err');}
}

async function searchTitle(q, showDrop=false){
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
    return `<div class="result-item" onclick="pickResult(${i})">
      ${r.thumb?`<img class="result-thumb" src="${r.thumb}" alt="" />`:`<div class="result-thumb" style="border-radius:50%;background:radial-gradient(circle,#1e1e1e,#080808)"></div>`}
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
  current = {
    id:item.id||Date.now(),
    title:item.title||'Unknown',
    artist, album,
    year:item.year||'',
    format:fmt,
    cover:item.cover_image||null,
    thumb:item.thumb||null,
    country:item.country||'',
    genre:item.genre?item.genre[0]:'',
    label:item.label?item.label[0]:'',
    condition:'',
    notes:'',
    loaned:false,
    loanedTo:'',
    plays:0,
    addedAt: Date.now(),
    tracklist:[],
  };

  // update disc
  const lbl = document.getElementById('disc-label');
  const img = document.createElement('img');
  img.src = current.thumb||'';
  img.onerror=()=>{lbl.innerHTML=`<div class="label-placeholder">${album.substring(0,12).toUpperCase()}</div>`};
  if(current.thumb){lbl.innerHTML='';lbl.appendChild(img);}
  else{lbl.innerHTML=`<div class="label-placeholder">${album.substring(0,12).toUpperCase()}</div>`;}

  const isCD = fmt.toLowerCase().includes('cd');
  const face = document.getElementById('face-vinyl');
  if(isCD){
    face.style.background='radial-gradient(circle at 35% 30%,#e0e0e0,#aaa 40%,#888 70%,#666)';
    face.querySelector('.grooves').style.opacity='0.1';
    lbl.style.background='#ccc';
    lbl.style.border='2px solid #bbb';
  } else {
    face.style.background='radial-gradient(circle at 32% 28%,#2e2e2e,#080808)';
    face.querySelector('.grooves').style.opacity='1';
    lbl.style.background='#0a0a0a';
    lbl.style.border='2px solid #111';
  }

  // extract color from image for bg tint
  if(current.cover){
    const tmpImg=new Image();tmpImg.crossOrigin='anonymous';
    tmpImg.onload=()=>{
      try{
        const c=document.createElement('canvas');c.width=c.height=4;
        const ctx=c.getContext('2d');ctx.drawImage(tmpImg,0,0,4,4);
        const px=ctx.getImageData(0,0,1,1).data;
        const col=`rgb(${px[0]},${px[1]},${px[2]})`;
        const bg=document.getElementById('hero-color-bg');
        bg.style.background=col;bg.style.opacity='0.12';
      }catch(e){}
    };
    tmpImg.src=current.cover;
  } else {
    document.getElementById('hero-color-bg').style.opacity='0';
  }

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
  dw.style.transform='rotateY(-22deg) rotateX(10deg)';
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

function clearAlbum(){
  current=null;spinning=false;
  const dw=document.getElementById('disc-wrap');
  dw.classList.remove('spinning');
  dw.style.transform='rotateY(-22deg) rotateX(10deg)';
  document.getElementById('disc-label').innerHTML='<div class="label-placeholder">CRATE<br>MUSIC<br>LIBRARY</div>';
  document.getElementById('face-vinyl').style.background='radial-gradient(circle at 32% 28%,#2e2e2e,#080808)';
  document.getElementById('face-vinyl').querySelector('.grooves').style.opacity='1';
  document.getElementById('big-title').textContent='NO ALBUM\nSELECTED';
  document.getElementById('big-title').classList.remove('loaded');
  document.getElementById('big-artist').textContent='—';
  document.getElementById('big-artist').classList.remove('loaded');
  document.getElementById('meta-row').innerHTML='';
  document.getElementById('tracklist-panel').style.display='none';
  document.getElementById('add-btn').disabled=true;
  document.getElementById('add-btn').textContent='+ ADD TO CRATE';
  document.getElementById('hero-color-bg').style.opacity='0';
  setStatus('cleared');
}

// ═══════════ COLLECTION ═══════════
function addToCollection(){
  if(!current)return;
  if(collection.find(c=>c.id===current.id)){toast('Already in crate!');return;}
  collection.push({...current,plays:0,addedAt:Date.now()});
  save(); renderCrate(); updatePills();
  document.getElementById('add-btn').textContent='✓ IN CRATE';
  document.getElementById('add-btn').disabled=true;
  toast('Added to crate!');
}

function removeItem(id, e){
  e&&e.stopPropagation();
  collection=collection.filter(c=>c.id!==id);
  save(); renderCrate(); updatePills();
  toast('Removed from crate');
}

function toggleLoan(id, e){
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
      <div class="stars" id="e-stars">${[1,2,3,4,5].map(n=>`<span class="star${(item.conditionRating||0)>=n?' on':''}" onclick="rateStar(${n})">${n<=5?'★':''}</span>`).join('')}</div>
    </div>
    <div class="modal-field"><label class="modal-label">NOTES</label><textarea class="modal-textarea" id="e-notes">${item.notes||''}</textarea></div>
    <div class="modal-btns">
      <button class="btn btn-ghost" onclick="closeModal()">CANCEL</button>
      <button class="btn btn-gold" onclick="saveEdit(${item.id})">SAVE</button>
    </div>`;
  window._editRating = item.conditionRating||0;
  openModal();
}

function rateStar(n){
  window._editRating=n;
  document.querySelectorAll('#e-stars .star').forEach((s,i)=>{s.classList.toggle('on',i<n);});
}

function saveEdit(id){
  const item=collection.find(c=>c.id===id);
  if(!item)return;
  item.album=document.getElementById('e-album').value||item.album;
  item.artist=document.getElementById('e-artist').value||item.artist;
  item.year=document.getElementById('e-year').value||item.year;
  item.format=document.getElementById('e-format').value;
  item.conditionRating=window._editRating||0;
  item.notes=document.getElementById('e-notes').value;
  item.title=item.artist+' - '+item.album;
  save(); renderCrate(); renderGrid();
  closeModal(); toast('Saved!');
}

function openEditModal(){
  if(!current){toast('Load an album first');return;}
  const fake={...current,conditionRating:0};
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
    const thumbHTML=item.thumb
      ?`<img src="${item.thumb}" alt="" onerror="this.style.display='none'" />`
      :`<div class="vinyl-mini"></div>`;
    const cond=item.conditionRating?'★'.repeat(item.conditionRating):'';
    const loanBadge=item.loaned?`<span class="format-badge badge-l" title="${item.loanedTo}">LOANED</span>`
      :`<span class="format-badge ${isCD?'badge-c':'badge-v'}">${isCD?'CD':'VINYL'}</span>`;
    return `<div class="coll-item${item.loaned?' loaned':''}" id="ci-${item.id}" onclick="loadItemById(${item.id})" style="animation-delay:${Math.min(i,12)*0.04}s">
      <div class="item-art">${thumbHTML}</div>
      <div class="item-data">
        <div class="item-album">${item.album}</div>
        <div class="item-artist">${item.artist}${item.year?' · '+item.year:''}</div>
        ${item.notes?`<div class="item-note">${item.notes.substring(0,40)}</div>`:''}
        ${cond?`<div style="color:var(--gold);font-size:10px;letter-spacing:0">${cond}</div>`:''}
        <div class="item-actions">
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
  if(sortMode==='alpha') res.sort((a,b)=>a.album.localeCompare(b.album));
  else if(sortMode==='year') res.sort((a,b)=>(b.year||0)-(a.year||0));
  else if(sortMode==='condition') res.sort((a,b)=>(b.conditionRating||0)-(a.conditionRating||0));
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
    label:item.label?[item.label]:undefined
  });
  document.getElementById('add-btn').textContent='✓ IN CRATE';
  document.getElementById('add-btn').disabled=true;
}

// ═══════════ SHUFFLE ═══════════
function shufflePlay(){
  const avail=collection.filter(c=>!c.loaned);
  if(!avail.length){toast('Add some records first!');return;}
  // weighted: prefer less-played
  const maxPlays=Math.max(...avail.map(c=>c.plays||0),1);
  const weights=avail.map(c=>maxPlays-(c.plays||0)+1);
  const total=weights.reduce((a,b)=>a+b,0);
  let rand=Math.random()*total;
  let pick=avail[0];
  for(let i=0;i<avail.length;i++){rand-=weights[i];if(rand<=0){pick=avail[i];break;}}
  const idx=collection.indexOf(pick);
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
    return `<div class="grid-card" onclick="goToScanAndLoad(${item.id})" style="animation-delay:${Math.min(i,20)*0.03}s">
      ${item.cover
        ?`<img class="grid-card-art" src="${item.cover}" alt="${item.album}" onerror="this.outerHTML='<div class=grid-card-art-placeholder><div class=vinyl-thumb-svg></div></div>'" />`
        :`<div class="grid-card-art-placeholder"><div class="vinyl-thumb-svg"></div></div>`}
      ${item.loaned?'<div class="loan-overlay">LOANED</div>':''}
      <div class="grid-card-info">
        <div class="gc-album">${item.album}</div>
        <div class="gc-artist">${item.artist}</div>
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
  document.querySelector('[data-page="scan"]').click();
  setTimeout(()=>loadItemById(id),100);
}

// ═══════════ STATS ═══════════
function renderStats(){
  const total=collection.length;
  const vinyls=collection.filter(c=>!/cd/i.test(c.format)).length;
  const cds=total-vinyls;
  const loaned=collection.filter(c=>c.loaned).length;
  document.getElementById('stats-cards').innerHTML=[
    ['TOTAL RECORDS',total],['VINYL',vinyls],['CD',cds],['LOANED OUT',loaned]
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
      return `<div class="result-item" onclick="addToWishlist(${i})">
        ${it.thumb?`<img class="result-thumb" src="${it.thumb}" alt="" />`:`<div class="result-thumb"></div>`}
        <div class="result-info"><div class="result-title">${album}</div><div class="result-sub">${artist} · ${it.year||'?'}</div></div>
        <button class="btn btn-ghost" style="flex-shrink:0;padding:5px 10px;font-size:9px" onclick="addToWishlist(${i});event.stopPropagation()">+ WISH</button>
      </div>`;
    }).join('');
    window._wishResults=d.results;
  }catch(e){r.innerHTML='<div style="padding:10px 14px;font-size:12px;color:var(--red)">Search failed</div>';}
}

function addToWishlist(i){
  const it=window._wishResults[i];
  const parts=(it.title||'').split(' - ');
  const artist=parts[0];const album=parts[1]||parts[0];
  if(wishlist.find(w=>w.id===it.id)){toast('Already on wishlist');return;}
  wishlist.push({id:it.id,title:it.title,artist,album,year:it.year||'',thumb:it.thumb||null,cover:it.cover_image||null,addedAt:Date.now()});
  save();renderWishlist();
  document.getElementById('wish-results').style.display='none';
  toast('Added to wishlist: '+album);
}

function removeWish(id,e){
  e&&e.stopPropagation();
  wishlist=wishlist.filter(w=>w.id!==id);
  save();renderWishlist();
}

function moveWishToCrate(id,e){
  e&&e.stopPropagation();
  const item=wishlist.find(w=>w.id===id);
  if(!item)return;
  if(!collection.find(c=>c.id===id)){
    collection.push({...item,format:'Vinyl',condition:'',notes:'',loaned:false,loanedTo:'',plays:0,tracklist:[]});
    wishlist=wishlist.filter(w=>w.id!==id);
    save();renderWishlist();renderCrate();updatePills();
    toast('Moved to crate: '+item.album);
  } else {toast('Already in crate!');}
}

function renderWishlist(){
  const el=document.getElementById('wish-list');
  if(!wishlist.length){
    el.innerHTML='<div id="wish-empty" class="wish-item" style="justify-content:center;background:transparent;border-color:transparent">Your wishlist is empty.</div>';
    return;
  }
  el.innerHTML=wishlist.map((item,i)=>`
    <div class="wish-item" style="animation-delay:${i*0.05}s">
      <div class="wish-art">${item.thumb?`<img src="${item.thumb}" alt="" />`:'♪'}</div>
      <div class="wish-data">
        <div class="wish-title">${item.album}</div>
        <div class="wish-artist">${item.artist}${item.year?' · '+item.year:''}</div>
      </div>
      <div class="wish-actions">
        <button class="btn btn-teal" style="font-size:9px;padding:5px 10px" onclick="moveWishToCrate(${item.id},event)">GOT IT</button>
        <button class="btn btn-danger" style="font-size:9px;padding:5px 10px" onclick="removeWish(${item.id},event)">REMOVE</button>
      </div>
    </div>
  `).join('');
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
  document.querySelector('[data-page="wishlist"]').click();
}

// ═══════════ EXPORT ═══════════
function exportCollection(){
  if(!collection.length){toast('Nothing to export');return;}
  const rows=[['Album','Artist','Year','Format','Plays','Loaned','Notes'],...collection.map(c=>[c.album,c.artist,c.year,c.format,c.plays||0,c.loaned?c.loanedTo:'',c.notes||''])];
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='crate-collection.csv';
  a.click();
  toast('Exported!');
}

// ═══════════ MODAL HELPERS ═══════════
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
  refreshUI();
  setStatus('ready — enter barcode or album title, or click CAMERA');
}

initApp();

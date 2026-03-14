// prompt-toggle-manager

const extensionName   = 'prompt-toggle-manager';
const GLOBAL_DUMMY_ID = 100001;
const TG_KEY          = extensionName;

let getRequestHeaders, openai_setting_names, openai_settings,
    extension_settings, saveSettingsDebounced, oai_settings,
    eventSource, event_types, setupChatCompletionPromptManager,
    callGenericPopup, POPUP_TYPE;

async function initImports() {
    const scriptPath   = import.meta.url;
    const isThirdParty = scriptPath.includes('/third-party/');
    const base  = isThirdParty ? '../../../../' : '../../../';
    const base2 = isThirdParty ? '../../../'    : '../../';

    const sm = await import(base + 'script.js');
    getRequestHeaders     = sm.getRequestHeaders;
    saveSettingsDebounced = sm.saveSettingsDebounced;
    eventSource           = sm.eventSource;
    event_types           = sm.event_types;

    const om = await import(base2 + 'openai.js');
    openai_setting_names             = om.openai_setting_names;
    openai_settings                  = om.openai_settings;
    oai_settings                     = om.oai_settings;
    setupChatCompletionPromptManager = om.setupChatCompletionPromptManager;

    const em = await import(base2 + 'extensions.js');
    extension_settings = em.extension_settings;

    const pm = await import(base2 + 'popup.js');
    callGenericPopup = pm.callGenericPopup;
    POPUP_TYPE       = pm.POPUP_TYPE;
}

// ══════════════════════════════════════════
// A. Toggle Group Data
// ══════════════════════════════════════════

// UI-only collapse state (session, not persisted)
const collapsedGroups = new Set();

function getTGStore() {
    if (!extension_settings[TG_KEY]) extension_settings[TG_KEY] = { presets: {} };
    return extension_settings[TG_KEY];
}
function getGroupsForPreset(pn) {
    const s = getTGStore();
    if (!s.presets[pn]) s.presets[pn] = [];
    return s.presets[pn];
}
function saveGroups(pn, groups) {
    getTGStore().presets[pn] = groups;
    saveSettingsDebounced();
}
function getCurrentPreset() {
    return oai_settings?.preset_settings_openai || '';
}

// ══════════════════════════════════════════
// B. Apply group
// ══════════════════════════════════════════

function applyGroup(pn, gi) {
    const groups = getGroupsForPreset(pn);
    const g      = groups[gi];
    if (!g) return;
    try {
        const pm = setupChatCompletionPromptManager(oai_settings);
        for (const t of g.toggles) {
            const entry = pm.getPromptOrderEntry(pm.activeCharacter, t.target);
            if (!entry) continue;
            // individual override takes priority over group state
            const ovr = t.override ?? null;
            entry.enabled = ovr !== null ? ovr : (t.behavior === 'invert') ? !g.isOn : g.isOn;
            if (pm.tokenHandler?.getCounts) {
                const counts = pm.tokenHandler.getCounts();
                counts[t.target] = null;
            }
        }
        pm.render();
        pm.saveServiceSettings();
    } catch (e) {
        console.warn('[PTM] applyGroup error', e);
    }
}

// ══════════════════════════════════════════
// C. Toggle Group UI
// ══════════════════════════════════════════

function renderTGGroups() {
    const area = document.getElementById('ptm-tg-area');
    if (!area) return;
    const pn = getCurrentPreset();
    if (!pn) { area.innerHTML = '<div class="ptm-ph">프리셋이 선택되지 않았습니다</div>'; return; }
    const groups = getGroupsForPreset(pn);
    if (!groups.length) { area.innerHTML = '<div class="ptm-ph">그룹이 없습니다</div>'; return; }
    area.innerHTML = groups.map((g, gi) => buildGroupCard(g, gi, pn)).join('');
    wireGroupCards(area);
}

function buildGroupCard(g, gi, pn) {
    const preset     = openai_settings[openai_setting_names[pn]];
    const allPrompts = preset?.prompts || [];

    const rows = g.toggles.map((t, ti) => {
        const name     = allPrompts.find(p => p.identifier === t.target)?.name || t.target;
        const isDirect = t.behavior === 'direct';
        const ovr      = t.override ?? null;
        const effectiveOn = ovr !== null ? ovr : (isDirect ? g.isOn : !g.isOn);

        // override button: cycles null → true → false → null
        let ovrLabel, ovrCls;
        if (ovr === null)      { ovrLabel = '그룹';   ovrCls = 'ptm-tovr-none'; }
        else if (ovr === true) { ovrLabel = 'On';  ovrCls = 'ptm-tovr-on';  }
        else                   { ovrLabel = 'Off'; ovrCls = 'ptm-tovr-off'; }

        return `
        <div class="ptm-trow">
            <span class="ptm-tstate ${effectiveOn?'ptm-ts-on':'ptm-ts-off'}">${effectiveOn?'On':'Off'}</span>
            <button class="ptm-ibtn ptm-tovr ${ovrCls}" data-gi="${gi}" data-ti="${ti}">${ovrLabel}</button>
            <span class="ptm-tname">${name}</span>
            <select class="ptm-bsel" data-gi="${gi}" data-ti="${ti}" style="width:45px;min-width:45px;max-width:45px">
                <option value="direct" ${isDirect?'selected':''}>동일</option>
                <option value="invert" ${!isDirect?'selected':''}>반전</option>
            </select>
            <button class="ptm-ibtn ptm-danger ptm-del-toggle" data-gi="${gi}" data-ti="${ti}">✕</button>
        </div>`;
    }).join('');

    const collapseKey = `${pn}__${gi}`;
    const isCollapsed = collapsedGroups.has(collapseKey);
    const toggleCount = g.toggles.length;

    return `
    <div class="ptm-card">
        <div class="ptm-card-head">
            <button class="ptm-onoff ${g.isOn?'ptm-onoff-on':'ptm-onoff-off'}" data-gi="${gi}">${g.isOn?'On':'Off'}</button>
            <span class="ptm-gname">${g.name} <span class="ptm-gcnt">(${toggleCount})</span></span>
            <div class="ptm-gbtns">
                <button class="ptm-ibtn ptm-ren-grp" data-gi="${gi}">이름 변경</button>
                <button class="ptm-ibtn ptm-danger ptm-del-grp" data-gi="${gi}">✕</button>
                <button class="ptm-ibtn ptm-collapse-grp" data-gi="${gi}" data-cpkey="${collapseKey}" title="${isCollapsed?'펼치기':'접기'}">${isCollapsed?'▸':'▾'}</button>
            </div>
        </div>
        <div class="ptm-tlist${isCollapsed?' ptm-hidden':''}">
            ${rows || '<div class="ptm-ph" style="padding:6px;font-size:11px">토글 없음</div>'}
        </div>
        <button class="ptm-sm ptm-sm-full ptm-add-toggle${isCollapsed?' ptm-hidden':''}" data-gi="${gi}">+ 토글 추가</button>
    </div>`;
}

function wireGroupCards(area) {
    area.querySelectorAll('.ptm-collapse-grp').forEach(btn => btn.addEventListener('click', () => {
        const cpkey = btn.dataset.cpkey;
        if (collapsedGroups.has(cpkey)) collapsedGroups.delete(cpkey);
        else collapsedGroups.add(cpkey);
        renderTGGroups();
    }));
    // group on/off — clears all individual overrides
    area.querySelectorAll('.ptm-onoff').forEach(btn => btn.addEventListener('click', () => {
        const gi = +btn.dataset.gi, pn = getCurrentPreset(), gs = getGroupsForPreset(pn);
        gs[gi].isOn = !gs[gi].isOn;
        gs[gi].toggles.forEach(t => { t.override = null; });
        applyGroup(pn, gi);
        saveGroups(pn, gs);
        renderTGGroups();
    }));
    // individual override: cycle null → true → false → null
    area.querySelectorAll('.ptm-tovr').forEach(btn => btn.addEventListener('click', () => {
        const gi = +btn.dataset.gi, ti = +btn.dataset.ti, pn = getCurrentPreset(), gs = getGroupsForPreset(pn);
        const cur = gs[gi].toggles[ti].override ?? null;
        gs[gi].toggles[ti].override = cur === null ? true : cur === true ? false : null;
        applyGroup(pn, gi);
        saveGroups(pn, gs);
        renderTGGroups();
    }));
    area.querySelectorAll('.ptm-ren-grp').forEach(btn => btn.addEventListener('click', async () => {
        const gi = +btn.dataset.gi, pn = getCurrentPreset(), gs = getGroupsForPreset(pn);
        const n = await callGenericPopup('그룹 이름 변경:', POPUP_TYPE.INPUT, gs[gi].name);
        if (!n?.trim()) return;
        gs[gi].name = n.trim(); saveGroups(pn, gs); renderTGGroups();
    }));
    area.querySelectorAll('.ptm-del-grp').forEach(btn => btn.addEventListener('click', async () => {
        const gi = +btn.dataset.gi, pn = getCurrentPreset(), gs = getGroupsForPreset(pn);
        const ok = await callGenericPopup(`"${gs[gi].name}" 그룹을 삭제할까요?`, POPUP_TYPE.CONFIRM);
        if (!ok) return;
        gs.splice(gi, 1); saveGroups(pn, gs); renderTGGroups();
    }));
    area.querySelectorAll('.ptm-bsel').forEach(sel => sel.addEventListener('change', () => {
        const gi = +sel.dataset.gi, ti = +sel.dataset.ti, pn = getCurrentPreset(), gs = getGroupsForPreset(pn);
        gs[gi].toggles[ti].behavior = sel.value; saveGroups(pn, gs); renderTGGroups();
    }));
    area.querySelectorAll('.ptm-del-toggle').forEach(btn => btn.addEventListener('click', () => {
        const gi = +btn.dataset.gi, ti = +btn.dataset.ti, pn = getCurrentPreset(), gs = getGroupsForPreset(pn);
        gs[gi].toggles.splice(ti, 1); saveGroups(pn, gs); renderTGGroups();
    }));
    area.querySelectorAll('.ptm-add-toggle').forEach(btn => btn.addEventListener('click', () => showAddToggleModal(+btn.dataset.gi)));
}

// ── Add toggle modal ──────────────────────────────────────────────
async function showAddToggleModal(gi) {
    const pn = getCurrentPreset(), preset = openai_settings[openai_setting_names[pn]];
    if (!preset) return;
    const gs = getGroupsForPreset(pn), exists = new Set(gs[gi].toggles.map(t => t.target));
    const prompts = preset.prompts || [];

    // index → identifier map (enables range selection)
    const selectedMap = new Map();

    const listHtml = prompts.map((p, idx) => {
        const ex = exists.has(p.identifier);
        return `<label style="display:flex;align-items:center;gap:8px;padding:7px 4px;cursor:${ex?'default':'pointer'};opacity:${ex?'0.45':'1'}">
            <input type="checkbox" class="ptm-add-cb" data-i="${idx}" data-id="${p.identifier}" ${ex?'disabled checked':''}
                style="width:16px;height:16px;accent-color:#7a6fff;flex-shrink:0;cursor:pointer">
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name||p.identifier}</span>
            ${ex?'<span style="font-size:10px;padding:1px 5px;border-radius:8px;background:rgba(120,100,255,.25);color:#a89fff;flex-shrink:0">추가됨</span>':''}
        </label>`;
    }).join('');

    const html = `
        <input type="text" id="ptm-msearch" placeholder="검색..."
            style="width:100%;margin-bottom:6px;padding:6px 8px;border-radius:5px;border:1px solid #555;background:#222;color:#eee;box-sizing:border-box">
        <div style="display:flex;gap:6px;margin-bottom:8px">
            <button id="ptm-mall"   class="ptm-sm" style="margin:0">전체</button>
            <button id="ptm-mnone"  class="ptm-sm" style="margin:0">해제</button>
            <button id="ptm-mrange" class="ptm-sm" style="margin:0">연속</button>
        </div>
        <div id="ptm-mlist" style="max-height:45vh;overflow-y:auto">${listHtml}</div>`;

    const observer = new MutationObserver(() => {
        const search = document.getElementById('ptm-msearch');
        if (search && !search._ptmWired) {
            search._ptmWired = true;
            search.addEventListener('input', e => {
                const q = e.target.value.toLowerCase();
                document.querySelectorAll('#ptm-mlist label').forEach(el => {
                    el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
                });
            });
        }
        document.querySelectorAll('.ptm-add-cb:not(:disabled)').forEach(cb => {
            if (cb._ptmWired) return;
            cb._ptmWired = true;
            cb.addEventListener('change', () => {
                if (cb.checked) selectedMap.set(+cb.dataset.i, cb.dataset.id);
                else selectedMap.delete(+cb.dataset.i);
            });
        });
        const mallBtn = document.getElementById('ptm-mall');
        if (mallBtn && !mallBtn._ptmWired) {
            mallBtn._ptmWired = true;
            mallBtn.addEventListener('click', () => {
                document.querySelectorAll('.ptm-add-cb:not(:disabled)').forEach(cb => {
                    cb.checked = true; selectedMap.set(+cb.dataset.i, cb.dataset.id);
                });
            });
        }
        const mnoneBtn = document.getElementById('ptm-mnone');
        if (mnoneBtn && !mnoneBtn._ptmWired) {
            mnoneBtn._ptmWired = true;
            mnoneBtn.addEventListener('click', () => {
                document.querySelectorAll('.ptm-add-cb:not(:disabled)').forEach(cb => {
                    cb.checked = false; selectedMap.delete(+cb.dataset.i);
                });
            });
        }
        const mrangeBtn = document.getElementById('ptm-mrange');
        if (mrangeBtn && !mrangeBtn._ptmWired) {
            mrangeBtn._ptmWired = true;
            mrangeBtn.addEventListener('click', () => {
                if (selectedMap.size < 2) { toastr.warning('시작과 끝 항목 2개를 선택하세요'); return; }
                const idxs = [...selectedMap.keys()].sort((a, b) => a - b);
                const mn = idxs[0], mx = idxs[idxs.length - 1];
                document.querySelectorAll('.ptm-add-cb:not(:disabled)').forEach(cb => {
                    const i = +cb.dataset.i;
                    if (i >= mn && i <= mx) { cb.checked = true; selectedMap.set(i, cb.dataset.id); }
                });
            });
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const ok = await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', { okButton: '추가', cancelButton: '취소' });
    observer.disconnect();

    if (!ok) return;
    if (!selectedMap.size) { toastr.warning('추가할 항목을 선택하세요'); return; }
    const gs2 = getGroupsForPreset(pn);
    selectedMap.forEach(id => gs2[gi].toggles.push({ target: id, behavior: 'direct', override: null }));
    saveGroups(pn, gs2); renderTGGroups();
    toastr.success(`${selectedMap.size}개 추가됨`);
}

// ══════════════════════════════════════════
// D. Mover helpers
// ══════════════════════════════════════════

let sourcePresetName='', targetPresetName='', sourceOrderedPrompts=[],
    targetOrderedPrompts=[], selectedSourceIndices=new Set(), insertPosition=-1;

function getPromptOrder(preset) {
    if (!preset?.prompt_order) return [];
    return preset.prompt_order.find(o => String(o.character_id)===String(GLOBAL_DUMMY_ID))?.order || [];
}
function getOrderedPrompts(preset) {
    return getPromptOrder(preset).map(e => {
        const def = (preset?.prompts||[]).find(p => p.identifier===e.identifier);
        return { identifier:e.identifier, enabled:e.enabled, prompt:def||{identifier:e.identifier,name:e.identifier} };
    });
}
// Always returns the freshest data for a preset:
// current active preset → oai_settings (live), others → openai_settings snapshot
function getLivePresetData(presetName) {
    if (!presetName) return null;
    if (presetName === getCurrentPreset()) return oai_settings;
    return openai_settings[openai_setting_names[presetName]];
}
async function savePreset(name, preset) {
    const r = await fetch('/api/presets/save', { method:'POST', headers:getRequestHeaders(), body:JSON.stringify({apiId:'openai',name,preset}) });
    if (!r.ok) throw new Error('프리셋 저장 실패');
    return r.json();
}
function getPresetOptions() {
    if (!openai_settings||!openai_setting_names) return '<option value="">-- 프리셋 없음 --</option>';
    return '<option value="">-- 선택 --</option>'
        + Object.keys(openai_setting_names).filter(n=>openai_settings[openai_setting_names[n]])
            .map(n=>`<option value="${n}">${n}</option>`).join('');
}

// ══════════════════════════════════════════
// E. Build drawers
// ══════════════════════════════════════════

function buildMoverDrawer() {
    const presets = getPresetOptions();
    const el = document.createElement('div');
    el.id = 'ptm-mover-drawer';
    el.innerHTML = `
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Prompt Multi-Mover</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <div class="ptm-block">
                <label class="ptm-label">① 출발 프리셋</label>
                <select id="ptm-src" class="ptm-sel">${presets}</select>
            </div>
            <div class="ptm-block">
                <div class="ptm-lrow">
                    <label class="ptm-label">② 이동할 항목</label>
                    <div>
                        <button class="ptm-sm" id="ptm-all">전체</button>
                        <button class="ptm-sm" id="ptm-none">해제</button>
                        <button class="ptm-sm" id="ptm-range">연속</button>
                    </div>
                </div>
                <div id="ptm-src-list" class="ptm-list"><div class="ptm-ph">출발 프리셋을 선택하세요</div></div>
            </div>
            <div class="ptm-block">
                <label class="ptm-label">③ 도착 프리셋</label>
                <select id="ptm-dst" class="ptm-sel">${presets}</select>
            </div>
            <div class="ptm-block">
                <label class="ptm-label">④ 삽입 위치 (+ 클릭)</label>
                <div id="ptm-dst-list" class="ptm-list"><div class="ptm-ph">도착 프리셋을 선택하세요</div></div>
            </div>
            <div class="ptm-block ptm-gblock">
                <label class="ptm-grow">
                    <input type="checkbox" id="ptm-make-group">
                    <span>복사/이동 후 토글 그룹으로 묶기</span>
                </label>
                <div id="ptm-gname-row" class="ptm-hidden">
                    <input type="text" id="ptm-gname" class="ptm-tinput" style="margin-top:6px" placeholder="그룹 이름 입력...">
                </div>
            </div>
            <div id="ptm-info" class="ptm-info">항목과 위치를 선택하면 버튼이 활성화됩니다</div>
            <div class="ptm-brow">
                <button id="ptm-copy" class="ptm-btn ptm-btn-copy" disabled>복사</button>
                <button id="ptm-move" class="ptm-btn ptm-btn-move" disabled>이동</button>
            </div>
        </div>
    </div>`;
    return el;
}

function buildTGDrawer() {
    const el = document.createElement('div');
    el.id = 'ptm-tg-drawer';
    el.innerHTML = `
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>토글 그룹 관리</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <div id="ptm-tg-area"><div class="ptm-ph">로딩 중...</div></div>
            <button class="ptm-sm ptm-sm-full" id="ptm-add-group">+ 그룹 추가</button>
        </div>
    </div>`;
    return el;
}

// ══════════════════════════════════════════
// F. Render mover
// ══════════════════════════════════════════

function renderSrcList() {
    // Always re-read live data so changes (toggles, applyGroup, etc.) are reflected immediately
    if (sourcePresetName) sourceOrderedPrompts = getOrderedPrompts(getLivePresetData(sourcePresetName));
    const el = document.getElementById('ptm-src-list'); if (!el) return;
    if (!sourceOrderedPrompts.length) { el.innerHTML='<div class="ptm-ph">프롬프트 없음</div>'; return; }
    el.innerHTML = sourceOrderedPrompts.map((e,i) => {
        const name=e.prompt.name||e.identifier||'Unnamed', chk=selectedSourceIndices.has(i);
        return `<label class="ptm-item${!e.enabled?' ptm-item-off':''}${chk?' ptm-chked':''}">
            <input type="checkbox" class="ptm-chk" data-i="${i}"${chk?' checked':''}><span class="ptm-num">#${i+1}</span>
            <span class="ptm-name">${e.prompt.marker?'[고정] ':''}${name}</span></label>`;
    }).join('');
    el.querySelectorAll('.ptm-chk').forEach(cb => cb.addEventListener('change', ev => {
        const i=+ev.target.dataset.i;
        if(ev.target.checked){selectedSourceIndices.add(i);ev.target.closest('.ptm-item').classList.add('ptm-chked');}
        else{selectedSourceIndices.delete(i);ev.target.closest('.ptm-item').classList.remove('ptm-chked');}
        updateButtons();
    }));
}

function renderDstList() {
    // Always re-read live data
    if (targetPresetName) targetOrderedPrompts = getOrderedPrompts(getLivePresetData(targetPresetName));
    const el = document.getElementById('ptm-dst-list'); if (!el) return;
    const slot = i=>`<div class="ptm-slot${insertPosition===i?' ptm-slot-on':''}" data-slot="${i}">+</div>`;
    if (!targetOrderedPrompts.length) { el.innerHTML=slot(0); el.querySelector('.ptm-slot').addEventListener('click',()=>selectSlot(0)); return; }
    el.innerHTML = slot(0)+targetOrderedPrompts.map((e,i)=>{
        const name=e.prompt.name||e.identifier||'Unnamed';
        return `<div class="ptm-ditem${!e.enabled?' ptm-item-off':''}"><span class="ptm-num">#${i+1}</span>
            <span class="ptm-name">${e.prompt.marker?'[고정] ':''}${name}</span></div>${slot(i+1)}`;
    }).join('');
    el.querySelectorAll('.ptm-slot').forEach(s=>s.addEventListener('click',()=>selectSlot(+s.dataset.slot)));
}

function selectSlot(s){insertPosition=s;renderDstList();updateButtons();}

function updateButtons() {
    const n=selectedSourceIndices.size, ok=sourcePresetName&&targetPresetName&&n>0&&insertPosition>=0;
    document.getElementById('ptm-copy').disabled=!ok;
    document.getElementById('ptm-move').disabled=!ok;
    const info=document.getElementById('ptm-info'); if(!info) return;
    if(!sourcePresetName) info.textContent='출발 프리셋을 선택하세요';
    else if(!n) info.textContent='이동할 항목을 체크하세요';
    else if(!targetPresetName) info.textContent=`${n}개 선택됨 · 도착 프리셋을 선택하세요`;
    else if(insertPosition<0) info.textContent=`${n}개 선택됨 · 삽입 위치(+)를 클릭하세요`;
    else if(sourcePresetName===targetPresetName) info.textContent=`${n}개 선택 · 같은 프리셋 내 순서 변경`;
    else info.textContent=`${n}개 선택 · 복사 또는 이동 클릭`;
}

// ══════════════════════════════════════════
// G. Perform copy/move
// ══════════════════════════════════════════

async function performOperation(isMove) {
    const n=selectedSourceIndices.size;
    if(!sourcePresetName||!targetPresetName||!n||insertPosition<0) return;
    const makeGroup=document.getElementById('ptm-make-group')?.checked;
    const groupName=document.getElementById('ptm-gname')?.value.trim();
    if(makeGroup&&!groupName){toastr.warning('그룹 이름을 입력해주세요');document.getElementById('ptm-gname')?.focus();return;}

    // Same-preset move = reorder only
    if(isMove && sourcePresetName===targetPresetName) { await performSamePresetMove(n,makeGroup,groupName); return; }

    const srcIdx=openai_setting_names[sourcePresetName], dstIdx=openai_setting_names[targetPresetName];
    const selected=[...selectedSourceIndices].sort((a,b)=>a-b).map(i=>sourceOrderedPrompts[i]).filter(Boolean);
    const tp=JSON.parse(JSON.stringify(openai_settings[dstIdx]));
    tp.prompts=tp.prompts||[]; tp.prompt_order=tp.prompt_order||[];
    const existingIds=new Set(tp.prompts.map(p=>p.identifier)), newIds=[];
    selected.forEach((entry,offset)=>{
        const pd=JSON.parse(JSON.stringify(entry.prompt));
        let id=pd.identifier;
        if(existingIds.has(id)){let c=1,base=id.replace(/_\d+$/,'');while(existingIds.has(`${base}_${c}`))c++;id=`${base}_${c}`;pd.identifier=id;pd.name=`${pd.name||entry.identifier} (${c})`;}
        existingIds.add(id);newIds.push(id);tp.prompts.push(pd);
        const go=tp.prompt_order.find(o=>String(o.character_id)===String(GLOBAL_DUMMY_ID));
        if(go?.order)go.order.splice(insertPosition+offset,0,{identifier:id,enabled:true});
        else tp.prompt_order.push({character_id:GLOBAL_DUMMY_ID,order:[{identifier:id,enabled:true}]});
        for(const oe of tp.prompt_order)if(String(oe.character_id)!==String(GLOBAL_DUMMY_ID)&&oe.order)oe.order.push({identifier:id,enabled:true});
    });
    try {
        await savePreset(targetPresetName,tp); openai_settings[dstIdx]=tp;
        if(isMove&&sourcePresetName!==targetPresetName){
            const sp=JSON.parse(JSON.stringify(openai_settings[srcIdx])),rem=new Set(selected.map(e=>e.identifier));
            sp.prompts=sp.prompts.filter(p=>!rem.has(p.identifier));
            if(sp.prompt_order)for(const o of sp.prompt_order)if(o.order)o.order=o.order.filter(e=>!rem.has(e.identifier));
            await savePreset(sourcePresetName,sp);openai_settings[srcIdx]=sp;
            // If source is currently active preset, sync oai_settings too
            if(sourcePresetName===getCurrentPreset()){ oai_settings.prompts=sp.prompts; oai_settings.prompt_order=sp.prompt_order; }
        }
        // If target is currently active preset, sync oai_settings so PM renders correctly
        if(targetPresetName===getCurrentPreset()){ oai_settings.prompts=tp.prompts; oai_settings.prompt_order=tp.prompt_order; }
        if(makeGroup&&groupName){
            const gs=getGroupsForPreset(targetPresetName);let fn=groupName,c=1;
            while(gs.some(g=>g.name===fn))fn=`${groupName} (${c++})`;
            gs.push({name:fn,isOn:false,toggles:newIds.map(id=>({target:id,behavior:'direct',override:null}))});
            saveGroups(targetPresetName,gs);
            renderTGGroups();
            toastr.success(`${n}개 ${isMove?'이동':'복사'} 완료 + 그룹 "${fn}" 생성!`);
        } else toastr.success(`${n}개 ${isMove?'이동':'복사'} 완료`);
        selectedSourceIndices.clear();insertPosition=-1;
        const cb=document.getElementById('ptm-make-group');if(cb)cb.checked=false;
        document.getElementById('ptm-gname-row')?.classList.add('ptm-hidden');
        const gi=document.getElementById('ptm-gname');if(gi)gi.value='';
        renderSrcList();renderDstList();updateButtons();
        // Refresh ST prompt manager UI using now-synced oai_settings
        try { setupChatCompletionPromptManager(oai_settings).render(); } catch(e){console.warn('[PTM] PM refresh failed',e);}
    } catch(err){console.error('[PTM]',err);toastr.error('실패: '+err.message);}
}

// Same-preset reorder (move within same preset)
async function performSamePresetMove(n, makeGroup, groupName) {
    const srcIdx = openai_setting_names[sourcePresetName];
    const selected = [...selectedSourceIndices].sort((a,b)=>a-b).map(i=>sourceOrderedPrompts[i]).filter(Boolean);
    const selectedSet = new Set(selected.map(e=>e.identifier));
    const sp = JSON.parse(JSON.stringify(openai_settings[srcIdx]));

    for (const oe of (sp.prompt_order||[])) {
        if (!oe.order) continue;
        const isGlobal = String(oe.character_id) === String(GLOBAL_DUMMY_ID);
        // Count selected items that appear before insertPosition in original order
        let removedBefore = 0;
        for (let i = 0; i < insertPosition && i < oe.order.length; i++) {
            if (selectedSet.has(oe.order[i].identifier)) removedBefore++;
        }
        const filtered = oe.order.filter(e => !selectedSet.has(e.identifier));
        const adjPos = Math.max(0, Math.min(insertPosition - removedBefore, filtered.length));
        const toInsert = isGlobal
            ? selected.map(e => ({ identifier:e.identifier, enabled:e.enabled }))
            : selected.map(e => ({ identifier:e.identifier, enabled:true }));
        filtered.splice(adjPos, 0, ...toInsert);
        oe.order = filtered;
    }

    try {
        await savePreset(sourcePresetName, sp);
        openai_settings[srcIdx] = sp;
        // Sync oai_settings if this is the currently active preset
        if (sourcePresetName === getCurrentPreset()) { oai_settings.prompts = sp.prompts; oai_settings.prompt_order = sp.prompt_order; }
        if (makeGroup && groupName) {
            const newIds = selected.map(e=>e.identifier);
            const gs = getGroupsForPreset(sourcePresetName); let fn=groupName, c=1;
            while(gs.some(g=>g.name===fn)) fn=`${groupName} (${c++})`;
            gs.push({name:fn,isOn:false,toggles:newIds.map(id=>({target:id,behavior:'direct',override:null}))});
            saveGroups(sourcePresetName, gs);
            renderTGGroups();
            toastr.success(`${n}개 순서 변경 완료 + 그룹 "${fn}" 생성!`);
        } else {
            toastr.success(`${n}개 순서 변경 완료`);
        }
        sourceOrderedPrompts = getOrderedPrompts(openai_settings[srcIdx]);
        targetOrderedPrompts = getOrderedPrompts(openai_settings[srcIdx]);
        selectedSourceIndices.clear(); insertPosition = -1;
        const cb = document.getElementById('ptm-make-group'); if(cb) cb.checked = false;
        document.getElementById('ptm-gname-row')?.classList.add('ptm-hidden');
        const gi = document.getElementById('ptm-gname'); if(gi) gi.value = '';
        renderSrcList(); renderDstList(); updateButtons();
        // Auto-refresh the ST prompt manager UI without page reload
        try { setupChatCompletionPromptManager(oai_settings).render(); } catch(e){console.warn('[PTM] PM refresh failed',e);}
    } catch(err) { console.error('[PTM]', err); toastr.error('실패: '+err.message); }
}

// ══════════════════════════════════════════
// H. Wire events
// ══════════════════════════════════════════

function wireMover() {
    document.getElementById('ptm-src')?.addEventListener('change',e=>{
        sourcePresetName=e.target.value;selectedSourceIndices.clear();
        sourceOrderedPrompts=[];
        renderSrcList();updateButtons();
    });
    document.getElementById('ptm-dst')?.addEventListener('change',e=>{
        targetPresetName=e.target.value;insertPosition=-1;
        targetOrderedPrompts=[];
        renderDstList();updateButtons();
    });
    document.getElementById('ptm-all')?.addEventListener('click',()=>{
        document.querySelectorAll('#ptm-src-list .ptm-chk').forEach(cb=>{cb.checked=true;selectedSourceIndices.add(+cb.dataset.i);cb.closest('.ptm-item').classList.add('ptm-chked');});updateButtons();
    });
    document.getElementById('ptm-none')?.addEventListener('click',()=>{
        document.querySelectorAll('#ptm-src-list .ptm-chk').forEach(cb=>{cb.checked=false;cb.closest('.ptm-item').classList.remove('ptm-chked');});selectedSourceIndices.clear();updateButtons();
    });
    document.getElementById('ptm-range')?.addEventListener('click',()=>{
        if(selectedSourceIndices.size<2){toastr.warning('시작과 끝 항목 2개를 선택하세요');return;}
        const s=[...selectedSourceIndices].sort((a,b)=>a-b),mn=s[0],mx=s[s.length-1];
        for(let i=mn;i<=mx;i++)selectedSourceIndices.add(i);
        document.querySelectorAll('#ptm-src-list .ptm-chk').forEach(cb=>{const i=+cb.dataset.i;if(i>=mn&&i<=mx){cb.checked=true;cb.closest('.ptm-item').classList.add('ptm-chked');}});updateButtons();
    });
    document.getElementById('ptm-make-group')?.addEventListener('change',e=>{
        document.getElementById('ptm-gname-row')?.classList[e.target.checked?'remove':'add']('ptm-hidden');
        if(e.target.checked)document.getElementById('ptm-gname')?.focus();
    });
    document.getElementById('ptm-copy')?.addEventListener('click',()=>performOperation(false));
    document.getElementById('ptm-move')?.addEventListener('click',()=>performOperation(true));
}

function wireTG() {
    document.getElementById('ptm-add-group')?.addEventListener('click', async () => {
        const pn=getCurrentPreset();if(!pn){toastr.warning('프리셋을 먼저 선택하세요');return;}
        const name=await callGenericPopup('새 그룹 이름:', POPUP_TYPE.INPUT, '');
        if(!name?.trim())return;
        const gs=getGroupsForPreset(pn);if(gs.some(g=>g.name===name.trim())){toastr.warning('같은 이름이 이미 있습니다');return;}
        gs.push({name:name.trim(),isOn:false,toggles:[]});saveGroups(pn,gs);renderTGGroups();
    });
}

// ══════════════════════════════════════════
// I. Mount & Init
// ══════════════════════════════════════════

function mount() {
    if(document.getElementById('ptm-mover-drawer')) return true;
    const target=document.querySelector('.range-block.m-b-1');
    if(!target) return false;
    const tg=buildTGDrawer(), mover=buildMoverDrawer();
    target.before(tg); tg.before(mover);
    wireMover(); wireTG(); renderTGGroups();
    return true;
}

jQuery(async ()=>{
    console.log(`[${extensionName}] Loading...`);
    try {
        await initImports();
        let c=0; const t=setInterval(()=>{if(mount()||++c>50)clearInterval(t);},200);
        eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER,()=>renderTGGroups());
        console.log(`[${extensionName}] Loaded`);
    } catch(err){console.error(`[${extensionName}] Failed:`,err);}
});

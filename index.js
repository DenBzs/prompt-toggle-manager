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
// Reorder mode state — two independent modes
let groupReorderMode = false;           // group-level ▲▼ arrows
let toggleReorderMode = null;           // gi of group whose toggles are being reordered (drag&drop)

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
            const ovr = t.override ?? null;
            // On/Off = fixed value, always enforced regardless of group state
            // 연동(null) = follows group direction
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

    // Call setupChatCompletionPromptManager ONCE — extract both validIds and allPrompts.
    // Previously buildGroupCard called it again for every card (N+1 calls per render).
    // Now it's always exactly 1 call.
    let validIds, allPrompts;
    try {
        const pm = setupChatCompletionPromptManager(oai_settings);
        const order = (pm.serviceSettings?.prompt_order || [])
            .find(o => String(o.character_id) === String(GLOBAL_DUMMY_ID));
        validIds   = new Set((order?.order || []).map(e => e.identifier));
        allPrompts = pm.serviceSettings?.prompts || [];
    } catch(e) {
        // fallback to cached data
        const livePreset = getLivePresetData(pn) || openai_settings[openai_setting_names[pn]];
        const order = (livePreset?.prompt_order || [])
            .find(o => String(o.character_id) === String(GLOBAL_DUMMY_ID));
        validIds   = new Set((order?.order || []).map(e => e.identifier));
        allPrompts = livePreset?.prompts || [];
    }
    const groups = getGroupsForPreset(pn);
    let changed = false;
    groups.forEach(g => {
        const before = g.toggles.length;
        g.toggles = g.toggles.filter(t => validIds.has(t.target));
        if (g.toggles.length !== before) changed = true;
    });
    if (changed) saveGroups(pn, groups);

    if (!groups.length) { area.innerHTML = '<div class="ptm-ph">그룹이 없습니다</div>'; return; }
    area.innerHTML = groups.map((g, gi) => buildGroupCard(g, gi, pn, allPrompts)).join('');
    wireGroupCards(area);
}

// allPrompts passed in from renderTGGroups — no extra manager call needed.
// Fallback handles any future direct callers.
function buildGroupCard(g, gi, pn, allPrompts) {
    if (!allPrompts) {
        try {
            allPrompts = setupChatCompletionPromptManager(oai_settings).serviceSettings?.prompts || [];
        } catch(e) {
            allPrompts = (getLivePresetData(pn) || openai_settings[openai_setting_names[pn]])?.prompts || [];
        }
    }
    const inToggleReorder = toggleReorderMode === gi;

    const rows = g.toggles.map((t, ti) => {
        const name     = allPrompts.find(p => p.identifier === t.target)?.name ?? '';
        const isDirect = t.behavior === 'direct';
        const ovr      = t.override ?? null;
        const effectiveOn = ovr !== null ? ovr : (isDirect ? g.isOn : !g.isOn);

        let ovrLabel, ovrCls;
        if (ovr === null)      { ovrLabel = '고정'; ovrCls = 'ptm-tovr-lock'; }
        else if (ovr === true) { ovrLabel = 'On';  ovrCls = 'ptm-tovr-on';  }
        else                   { ovrLabel = 'Off'; ovrCls = 'ptm-tovr-off'; }

        return `
        <div class="ptm-trow" ${inToggleReorder ? 'data-draggable="true"' : ''} data-gi="${gi}" data-ti="${ti}">
            ${inToggleReorder
                ? `<span class="ptm-drag-handle" title="드래그하여 이동">⠿</span>`
                : `<span class="ptm-tstate ${effectiveOn ? 'ptm-ts-on' : 'ptm-ts-off'}">${effectiveOn ? 'On' : 'Off'}</span>`}
            <button class="ptm-ibtn ptm-tovr ${ovrCls}" data-gi="${gi}" data-ti="${ti}">${ovrLabel}</button>
            <span class="ptm-tname">${name}</span>
            ${!inToggleReorder ? `<button class="ptm-ibtn ptm-bsel ${isDirect ? 'ptm-bsel-dir' : 'ptm-bsel-inv'}" data-gi="${gi}" data-ti="${ti}">${isDirect ? '동일' : '반전'}</button>` : ''}
            <button class="ptm-ibtn ptm-danger ptm-del-toggle" data-gi="${gi}" data-ti="${ti}">✕</button>
        </div>`;
    }).join('');

    const collapseKey = `${pn}__${gi}`;
    const isCollapsed = collapsedGroups.has(collapseKey);
    const toggleCount = g.toggles.length;
    const groups      = getGroupsForPreset(pn);
    const isFirst     = gi === 0;
    const isLast      = gi === groups.length - 1;

    return `
    <div class="ptm-card" data-gi="${gi}">
        <div class="ptm-card-head">
            ${groupReorderMode ? `
                <button class="ptm-ibtn ptm-grp-up${isFirst ? ' ptm-arr-disabled' : ''}" data-gi="${gi}" ${isFirst ? 'disabled' : ''}>▲</button>
                <button class="ptm-ibtn ptm-grp-dn${isLast  ? ' ptm-arr-disabled' : ''}" data-gi="${gi}" ${isLast  ? 'disabled' : ''}>▼</button>
            ` : `<button class="ptm-onoff ${g.isOn ? 'ptm-onoff-on' : 'ptm-onoff-off'}" data-gi="${gi}">${g.isOn ? 'On' : 'Off'}</button>`}
            <span class="ptm-gname">${g.name} <span class="ptm-gcnt">(${toggleCount})</span></span>
            <div class="ptm-gbtns">
                ${!groupReorderMode && !inToggleReorder && !isCollapsed ? `<button class="ptm-ibtn ptm-ren-grp" data-gi="${gi}">✏️</button>` : ''}
                ${!groupReorderMode && !inToggleReorder && !isCollapsed ? `<button class="ptm-ibtn ptm-reorder-grp-btn" data-gi="${gi}" title="토글 순서 변경">⠿</button>` : ''}
                ${!groupReorderMode && !inToggleReorder ? `<button class="ptm-ibtn ptm-danger ptm-del-grp" data-gi="${gi}">✕</button>` : ''}
                ${inToggleReorder ? `<button class="ptm-ibtn ptm-toggle-reorder-done" data-gi="${gi}" style="color:#6ddb9e">✓</button>` : ''}
                <button class="ptm-ibtn ptm-collapse-grp" data-gi="${gi}" data-cpkey="${collapseKey}" title="${isCollapsed ? '펼치기' : '접기'}">${isCollapsed ? '▸' : '▾'}</button>
            </div>
        </div>
        <div class="ptm-tlist${isCollapsed ? ' ptm-hidden' : ''}">
            ${rows || '<div class="ptm-ph" style="padding:6px;font-size:11px">토글 없음</div>'}
        </div>
        ${!groupReorderMode ? `<button class="ptm-sm ptm-add-toggle${isCollapsed ? ' ptm-hidden' : ''}" data-gi="${gi}" style="width:calc(100% - 12px);margin:2px 6px;box-sizing:border-box;">+ 토글 추가</button>` : ''}
    </div>`;
}

function wireGroupCards(area) {
    // group ▲▼ buttons (groupReorderMode)
    area.querySelectorAll('.ptm-grp-up').forEach(btn => btn.addEventListener('click', () => {
        const gi = +btn.dataset.gi, pn = getCurrentPreset(), gs = getGroupsForPreset(pn);
        if (gi === 0) return;
        [gs[gi-1], gs[gi]] = [gs[gi], gs[gi-1]];
        saveGroups(pn, gs); renderTGGroups();
    }));
    area.querySelectorAll('.ptm-grp-dn').forEach(btn => btn.addEventListener('click', () => {
        const gi = +btn.dataset.gi, pn = getCurrentPreset(), gs = getGroupsForPreset(pn);
        if (gi >= gs.length - 1) return;
        [gs[gi], gs[gi+1]] = [gs[gi+1], gs[gi]];
        saveGroups(pn, gs); renderTGGroups();
    }));
    // toggle reorder mode per-group
    area.querySelectorAll('.ptm-reorder-grp-btn').forEach(btn => btn.addEventListener('click', () => {
        toggleReorderMode = +btn.dataset.gi;
        renderTGGroups();
    }));
    area.querySelectorAll('.ptm-toggle-reorder-done').forEach(btn => btn.addEventListener('click', () => {
        toggleReorderMode = null;
        renderTGGroups();
    }));
    area.querySelectorAll('.ptm-collapse-grp').forEach(btn => btn.addEventListener('click', () => {
        const cpkey = btn.dataset.cpkey;
        if (collapsedGroups.has(cpkey)) collapsedGroups.delete(cpkey);
        else collapsedGroups.add(cpkey);
        renderTGGroups();
    }));
    area.querySelectorAll('.ptm-onoff').forEach(btn => btn.addEventListener('click', () => {
        const gi = +btn.dataset.gi, pn = getCurrentPreset(), gs = getGroupsForPreset(pn);
        gs[gi].isOn = !gs[gi].isOn;
        applyGroup(pn, gi);
        saveGroups(pn, gs);
        renderTGGroups();
    }));
    // individual override: cycle null(고정) → true(On) → false(Off) → null(고정)
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
    area.querySelectorAll('.ptm-bsel').forEach(btn => btn.addEventListener('click', () => {
        const gi = +btn.dataset.gi, ti = +btn.dataset.ti, pn = getCurrentPreset(), gs = getGroupsForPreset(pn);
        const cur = gs[gi].toggles[ti].behavior;
        gs[gi].toggles[ti].behavior = cur === 'direct' ? 'invert' : 'direct';
        saveGroups(pn, gs); renderTGGroups();
    }));
    area.querySelectorAll('.ptm-del-toggle').forEach(btn => btn.addEventListener('click', () => {
        const gi = +btn.dataset.gi, ti = +btn.dataset.ti, pn = getCurrentPreset(), gs = getGroupsForPreset(pn);
        gs[gi].toggles.splice(ti, 1); saveGroups(pn, gs); renderTGGroups();
    }));
    area.querySelectorAll('.ptm-add-toggle').forEach(btn => btn.addEventListener('click', () => showAddToggleModal(+btn.dataset.gi)));
}

// ── Add toggle modal ──────────────────────────────────────────────
async function showAddToggleModal(gi) {
    const pn = getCurrentPreset(), preset = getLivePresetData(pn);
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
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name??''}</span>
            ${ex?'<span style="font-size:10px;padding:1px 5px;border-radius:8px;background:rgba(120,100,255,.25);color:#a89fff;flex-shrink:0">추가됨</span>':''}
        </label>`;
    }).join('');

    const html = `
        <div style="display:flex;gap:6px;margin-bottom:8px">
            <button id="ptm-mall"   class="ptm-sm" style="margin:0">전체</button>
            <button id="ptm-mnone"  class="ptm-sm" style="margin:0">해제</button>
            <button id="ptm-mrange" class="ptm-sm" style="margin:0">연속</button>
        </div>
        <div id="ptm-mlist" style="max-height:45vh;overflow-y:auto">${listHtml}</div>`;

    // One-shot observer: disconnect as soon as the popup DOM is ready,
    // then wire all events once. Avoids continuous subtree observation overhead.
    const observer = new MutationObserver((mutations, obs) => {
        const mlist = document.getElementById('ptm-mlist');
        if (!mlist) return;
        obs.disconnect();

        mlist.querySelectorAll('.ptm-add-cb:not(:disabled)').forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.checked) selectedMap.set(+cb.dataset.i, cb.dataset.id);
                else selectedMap.delete(+cb.dataset.i);
            });
        });
        document.getElementById('ptm-mall')?.addEventListener('click', () => {
            mlist.querySelectorAll('.ptm-add-cb:not(:disabled)').forEach(cb => {
                cb.checked = true; selectedMap.set(+cb.dataset.i, cb.dataset.id);
            });
        });
        document.getElementById('ptm-mnone')?.addEventListener('click', () => {
            mlist.querySelectorAll('.ptm-add-cb:not(:disabled)').forEach(cb => {
                cb.checked = false; selectedMap.delete(+cb.dataset.i);
            });
        });
        document.getElementById('ptm-mrange')?.addEventListener('click', () => {
            if (selectedMap.size < 2) { toastr.warning('시작과 끝 항목 2개를 선택하세요'); return; }
            const idxs = [...selectedMap.keys()].sort((a, b) => a - b);
            const mn = idxs[0], mx = idxs[idxs.length - 1];
            mlist.querySelectorAll('.ptm-add-cb:not(:disabled)').forEach(cb => {
                const i = +cb.dataset.i;
                if (i >= mn && i <= mx) { cb.checked = true; selectedMap.set(i, cb.dataset.id); }
            });
        });
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
            <b>토글 복사/이동</b>
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
            <div style="display:flex;gap:6px;margin-top:0;align-items:center">
                <button class="ptm-sm ptm-sm-full" id="ptm-add-group" style="flex:1;margin:0">+ 그룹 추가</button>
                <button class="ptm-sm" id="ptm-reorder-btn" style="margin:0;padding:3px 10px;min-width:36px;text-align:center" title="그룹 순서 변경">⠿</button>
            </div>
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
        const name=e.prompt.name??'', chk=selectedSourceIndices.has(i);
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
        const name=e.prompt.name??'';
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
        // Auto-refresh the ST prompt manager UI without page reload
        try { setupChatCompletionPromptManager(oai_settings).render(); } catch(e){console.warn('[PTM] PM refresh failed',e);}
    } catch(err) { console.error('[PTM]', err); toastr.error('실패: '+err.message); }
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

function refreshPresetSelects() {
    const opts = getPresetOptions();
    const src = document.getElementById('ptm-src');
    const dst = document.getElementById('ptm-dst');
    if (!src || !dst) return;
    const prevSrc = src.value, prevDst = dst.value;
    src.innerHTML = opts;
    dst.innerHTML = opts;
    // restore previous selection if still valid
    if ([...src.options].some(o => o.value === prevSrc)) src.value = prevSrc;
    if ([...dst.options].some(o => o.value === prevDst)) dst.value = prevDst;
}

function wireMover() {
    // Refresh preset list + src/dst lists every time the mover drawer is opened
    document.querySelector('#ptm-mover-drawer .inline-drawer-toggle')?.addEventListener('click', () => {
        setTimeout(() => {
            refreshPresetSelects();
            renderSrcList();
            renderDstList();
            updateButtons();
        }, 0);
    });
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
    // Refresh groups every time the TG drawer is opened
    document.querySelector('#ptm-tg-drawer .inline-drawer-toggle')?.addEventListener('click', () => {
        setTimeout(renderTGGroups, 0);
    });
    document.getElementById('ptm-add-group')?.addEventListener('click', async () => {
        const pn=getCurrentPreset();if(!pn){toastr.warning('프리셋을 먼저 선택하세요');return;}
        const name=await callGenericPopup('새 그룹 이름:', POPUP_TYPE.INPUT, '');
        if(!name?.trim())return;
        const gs=getGroupsForPreset(pn);if(gs.some(g=>g.name===name.trim())){toastr.warning('같은 이름이 이미 있습니다');return;}
        gs.push({name:name.trim(),isOn:false,toggles:[]});saveGroups(pn,gs);renderTGGroups();
    });
    document.getElementById('ptm-reorder-btn')?.addEventListener('click', () => {
        groupReorderMode = !groupReorderMode;
        if (groupReorderMode) toggleReorderMode = null; // exit toggle reorder if active
        const btn = document.getElementById('ptm-reorder-btn');
        if (btn) { btn.textContent = groupReorderMode ? '✓' : '⠿'; btn.style.color = groupReorderMode ? '#6ddb9e' : ''; }
        renderTGGroups();
    });
    wireTGReorder();
}

function wireTGReorder() {
    const area = document.getElementById('ptm-tg-area');
    if (!area) return;

    // Smooth in-container drag using Pointer Events + CSS transform.
    // - No ghost element, no document-level listeners, no RAF needed.
    // - The dragged row slides up/down within its container via translateY.
    // - Sibling rows smoothly shift out of the way with CSS transition.
    // - setPointerCapture ensures move/up fire even if pointer leaves the area.

    let drag = null; // { el, gi, fromTi, currentTi, rows, rowH }

    function getRows(gi) {
        return [...area.querySelectorAll(`.ptm-trow[data-gi="${gi}"][data-draggable="true"]`)];
    }

    function applyPositions(fromTi, toTi, rows, dragEl, rowH) {
        rows.forEach((r, i) => {
            if (r === dragEl) return;
            let shift = 0;
            if (fromTi < toTi) {
                // Dragging down: rows between old↓new shift up by one slot
                if (i > fromTi && i <= toTi) shift = -rowH;
            } else {
                // Dragging up: rows between new↑old shift down by one slot
                if (i >= toTi && i < fromTi) shift = rowH;
            }
            r.style.transition = 'transform 0.12s ease';
            r.style.transform  = shift ? `translateY(${shift}px)` : '';
        });
    }

    function resetStyles(rows) {
        rows.forEach(r => {
            r.style.transform  = '';
            r.style.transition = '';
            r.style.position   = '';
            r.style.zIndex     = '';
            r.style.opacity    = '';
            r.style.boxShadow  = '';
        });
    }

    area.addEventListener('pointerdown', e => {
        if (toggleReorderMode === null) return;
        const handle = e.target.closest('.ptm-drag-handle');
        if (!handle) return;
        const row = handle.closest('.ptm-trow[data-draggable="true"]');
        if (!row || +row.dataset.gi !== toggleReorderMode) return;

        e.preventDefault();
        const gi   = +row.dataset.gi;
        const ti   = +row.dataset.ti;
        const rows = getRows(gi);
        const rowH = row.offsetHeight;

        // Style the dragged row: lift it above siblings
        row.style.position  = 'relative';
        row.style.zIndex    = '10';
        row.style.opacity   = '0.88';
        row.style.boxShadow = '0 4px 12px rgba(0,0,0,0.28)';
        row.style.transition = 'none';

        drag = { el: row, gi, fromTi: ti, currentTi: ti, rows, rowH, startY: e.clientY };

        // Capture pointer so pointermove/pointerup always fire on this element
        area.setPointerCapture(e.pointerId);
    });

    area.addEventListener('pointermove', e => {
        if (!drag) return;
        const { el, fromTi, currentTi, rows, rowH, startY } = drag;
        const dy = e.clientY - startY;

        // Clamp vertical movement to the group's list bounds
        const maxUp   = -(fromTi * rowH);
        const maxDown = (rows.length - 1 - fromTi) * rowH;
        const clamped = Math.max(maxUp, Math.min(maxDown, dy));
        el.style.transform = `translateY(${clamped}px)`;

        // Determine which slot we're hovering over
        const newTi = Math.max(0, Math.min(rows.length - 1,
            fromTi + Math.round(dy / rowH)));

        if (newTi !== currentTi) {
            drag.currentTi = newTi;
            applyPositions(fromTi, newTi, rows, el, rowH);
        }
    });

    function endDrag(e) {
        if (!drag) return;
        const { el, gi, fromTi, currentTi, rows } = drag;
        drag = null;

        // Remove pointer capture
        try { area.releasePointerCapture(e.pointerId); } catch(_) {}

        resetStyles(rows);

        if (currentTi !== fromTi) {
            const pn = getCurrentPreset(), gs = getGroupsForPreset(pn);
            const toggles = gs[gi].toggles;
            const [moved] = toggles.splice(fromTi, 1);
            toggles.splice(currentTi, 0, moved);
            saveGroups(pn, gs);
            renderTGGroups();
        }
    }

    area.addEventListener('pointerup',     endDrag);
    area.addEventListener('pointercancel', endDrag);
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

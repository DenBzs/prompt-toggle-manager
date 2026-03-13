// Prompt Multi-Mover + Toggle Group Manager
// Two separate inline-drawers injected into Chat Completion preset panel

const extensionName   = '프롬프트 토글 관리';
const GLOBAL_DUMMY_ID = 100001;
const TG_KEY          = extensionName;

let getRequestHeaders, openai_setting_names, openai_settings,
    extension_settings, saveSettingsDebounced, oai_settings, eventSource, event_types;

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
    openai_setting_names = om.openai_setting_names;
    openai_settings      = om.openai_settings;
    oai_settings         = om.oai_settings;

    const em = await import(base2 + 'extensions.js');
    extension_settings = em.extension_settings;
}

// ══════════════════════════════════════════
// A. Toggle Group Data
// ══════════════════════════════════════════

function getTGStore() {
    if (!extension_settings[TG_KEY]) extension_settings[TG_KEY] = { presets: {} };
    return extension_settings[TG_KEY];
}
function getGroupsForPreset(presetName) {
    const store = getTGStore();
    if (!store.presets[presetName]) store.presets[presetName] = [];
    return store.presets[presetName];
}
function saveGroups(presetName, groups) {
    getTGStore().presets[presetName] = groups;
    saveSettingsDebounced();
}
function getCurrentPreset() {
    return oai_settings?.preset_settings_openai || '';
}

// ══════════════════════════════════════════
// B. Toggle Group UI
// ══════════════════════════════════════════

function renderTGGroups() {
    const area = document.getElementById('pmm-tg-groups-area');
    if (!area) return;
    const presetName = getCurrentPreset();
    if (!presetName) {
        area.innerHTML = '<div class="pmm-ph">프리셋이 선택되지 않았습니다</div>';
        return;
    }
    const groups = getGroupsForPreset(presetName);
    if (!groups.length) {
        area.innerHTML = '<div class="pmm-ph">그룹이 없습니다. [+ 그룹 추가]를 클릭하세요.</div>';
        return;
    }
    area.innerHTML = groups.map((g, gi) => buildGroupCard(g, gi, presetName)).join('');
    wireTGGroupEvents(area, presetName);
}

function wireTGGroupEvents(area, presetName) {
    // ON/OFF toggle
    area.querySelectorAll('.tg-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const gi = parseInt(btn.dataset.gi);
            const pn = getCurrentPreset();
            const groups = getGroupsForPreset(pn);
            groups[gi].isOn = !groups[gi].isOn;
            applyGroup(pn, gi);
            saveGroups(pn, groups);
            renderTGGroups();
        });
    });
    // Rename
    area.querySelectorAll('.tg-rename-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const gi = parseInt(btn.dataset.gi);
            const pn = getCurrentPreset();
            const groups = getGroupsForPreset(pn);
            const newName = prompt('그룹 이름 변경:', groups[gi].name);
            if (!newName?.trim()) return;
            groups[gi].name = newName.trim();
            saveGroups(pn, groups);
            renderTGGroups();
        });
    });
    // Delete group
    area.querySelectorAll('.tg-delete-group-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const gi = parseInt(btn.dataset.gi);
            const pn = getCurrentPreset();
            const groups = getGroupsForPreset(pn);
            if (!confirm(`"${groups[gi].name}" 그룹을 삭제할까요?`)) return;
            groups.splice(gi, 1);
            saveGroups(pn, groups);
            renderTGGroups();
        });
    });
    // Copy group to another preset
    area.querySelectorAll('.tg-copy-group-btn').forEach(btn => {
        btn.addEventListener('click', () => copyGroupToPreset(parseInt(btn.dataset.gi), false));
    });
    // Move group to another preset
    area.querySelectorAll('.tg-move-group-btn').forEach(btn => {
        btn.addEventListener('click', () => copyGroupToPreset(parseInt(btn.dataset.gi), true));
    });
    // Behavior select
    area.querySelectorAll('.tg-behavior-sel').forEach(sel => {
        sel.addEventListener('change', () => {
            const gi = parseInt(sel.dataset.gi);
            const ti = parseInt(sel.dataset.ti);
            const pn = getCurrentPreset();
            const groups = getGroupsForPreset(pn);
            groups[gi].toggles[ti].behavior = sel.value;
            saveGroups(pn, groups);
        });
    });
    // Delete toggle
    area.querySelectorAll('.tg-delete-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const gi = parseInt(btn.dataset.gi);
            const ti = parseInt(btn.dataset.ti);
            const pn = getCurrentPreset();
            const groups = getGroupsForPreset(pn);
            groups[gi].toggles.splice(ti, 1);
            saveGroups(pn, groups);
            renderTGGroups();
        });
    });
    // Add toggles
    area.querySelectorAll('.tg-add-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => openAddToggleModal(parseInt(btn.dataset.gi)));
    });
}

function buildGroupCard(g, gi, presetName) {
    const preset     = openai_settings[openai_setting_names[presetName]];
    const allPrompts = preset?.prompts || [];
    const toggleRows = g.toggles.map((t, ti) => {
        const p    = allPrompts.find(p => p.identifier === t.target);
        const name = p?.name || t.target;
        return `
            <div class="tg-toggle-row">
                <span class="tg-toggle-name">${name}</span>
                <select class="tg-behavior-sel" data-gi="${gi}" data-ti="${ti}">
                    <option value="direct" ${t.behavior==='direct'?'selected':''}>동일</option>
                    <option value="invert" ${t.behavior==='invert'?'selected':''}>반전</option>
                </select>
                <button class="tg-delete-toggle-btn pmm-icon-btn" data-gi="${gi}" data-ti="${ti}">삭제</button>
            </div>`;
    }).join('');

    return `
        <div class="tg-group-card">
            <div class="tg-group-header">
                <button class="tg-toggle-btn ${g.isOn?'tg-on':'tg-off'}" data-gi="${gi}">
                    ${g.isOn ? '켜짐' : '꺼짐'}
                </button>
                <span class="tg-group-name">${g.name}</span>
                <div class="tg-group-actions">
                    <button class="tg-copy-group-btn pmm-icon-btn" data-gi="${gi}">복사</button>
                    <button class="tg-move-group-btn pmm-icon-btn" data-gi="${gi}">이동</button>
                    <button class="tg-rename-btn pmm-icon-btn" data-gi="${gi}">이름 변경</button>
                    <button class="tg-delete-group-btn pmm-icon-btn pmm-icon-danger" data-gi="${gi}">삭제</button>
                </div>
            </div>
            <div class="tg-toggle-list">
                ${toggleRows || '<div class="pmm-ph" style="font-size:11px;padding:6px">토글 없음</div>'}
            </div>
            <button class="tg-add-toggle-btn pmm-sm pmm-sm-full" data-gi="${gi}">+ 토글 추가</button>
        </div>`;
}

function copyGroupToPreset(gi, removeFromSource) {
    const srcPreset = getCurrentPreset();
    const groups    = getGroupsForPreset(srcPreset);
    const group     = groups[gi];

    // Build preset selector modal
    const allPresetNames = Object.keys(openai_setting_names)
        .filter(n => openai_settings[openai_setting_names[n]] && n !== srcPreset);

    if (!allPresetNames.length) { toastr.warning('복사할 수 있는 다른 프리셋이 없습니다'); return; }

    const overlay = document.createElement('div');
    overlay.className = 'tg-modal-overlay';
    overlay.innerHTML = `
        <div class="tg-modal" style="max-height:70vh;margin-top:10vh">
            <div class="tg-modal-header">
                <span>"${group.name}" 그룹 ${removeFromSource ? '이동' : '복사'} — 대상 프리셋 선택</span>
                <button class="pmm-icon-btn" id="tg-pcopy-close">닫기</button>
            </div>
            <div class="tg-modal-list">
                ${allPresetNames.map(n => `
                    <div class="tg-modal-item tg-preset-item" data-preset="${n}">
                        <span>${n}</span>
                    </div>`).join('')}
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#tg-pcopy-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelectorAll('.tg-preset-item').forEach(item => {
        item.addEventListener('click', () => {
            const dstPreset  = item.dataset.preset;
            const dstGroups  = getGroupsForPreset(dstPreset);

            // Avoid duplicate names
            let finalName = group.name, c = 1;
            while (dstGroups.some(g => g.name === finalName)) finalName = `${group.name} (${c++})`;

            dstGroups.push({ name: finalName, isOn: false, toggles: JSON.parse(JSON.stringify(group.toggles)) });
            saveGroups(dstPreset, dstGroups);

            if (removeFromSource) {
                groups.splice(gi, 1);
                saveGroups(srcPreset, groups);
                renderTGGroups();
                toastr.success(`"${finalName}" 그룹을 "${dstPreset}"으로 이동했습니다`);
            } else {
                toastr.success(`"${finalName}" 그룹을 "${dstPreset}"에 복사했습니다`);
            }
            close();
        });
    });
}

function openAddToggleModal(gi) {
    const presetName      = getCurrentPreset();
    const preset          = openai_settings[openai_setting_names[presetName]];
    if (!preset) return;
    const allPrompts      = preset.prompts || [];
    const groups          = getGroupsForPreset(presetName);
    const existingTargets = new Set(groups[gi].toggles.map(t => t.target));

    const overlay = document.createElement('div');
    overlay.className = 'tg-modal-overlay';
    overlay.innerHTML = `
        <div class="tg-modal">
            <div class="tg-modal-header">
                <span>토글 추가 — ${groups[gi].name}</span>
                <button class="pmm-icon-btn" id="tg-modal-close">닫기</button>
            </div>
            <div style="padding:8px 12px">
                <input type="text" id="tg-modal-search" class="pmm-text-input" placeholder="검색...">
            </div>
            <div class="tg-modal-list" id="tg-modal-list">
                ${allPrompts.map(p => {
                    const exists = existingTargets.has(p.identifier);
                    return `
                        <label class="tg-modal-item ${exists?'tg-modal-item-exists':''}">
                            <input type="checkbox" class="pmm-chk" data-id="${p.identifier}" ${exists?'disabled checked':''}>
                            <span>${p.name || p.identifier}</span>
                            ${exists?'<span class="tg-exists-badge">추가됨</span>':''}
                        </label>`;
                }).join('')}
            </div>
            <div class="tg-modal-footer">
                <button class="pmm-btn pmm-copy" id="tg-modal-confirm">선택 항목 추가</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#tg-modal-search').addEventListener('input', e => {
        const q = e.target.value.toLowerCase();
        overlay.querySelectorAll('.tg-modal-item').forEach(item => {
            item.style.display = item.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
    });
    const close = () => overlay.remove();
    overlay.querySelector('#tg-modal-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#tg-modal-confirm').addEventListener('click', () => {
        const selected = [...overlay.querySelectorAll('#tg-modal-list input:checked:not(:disabled)')]
            .map(cb => cb.dataset.id);
        if (!selected.length) { toastr.warning('추가할 항목을 선택하세요'); return; }
        const pn     = getCurrentPreset();
        const groups = getGroupsForPreset(pn);
        selected.forEach(id => groups[gi].toggles.push({ target: id, behavior: 'direct' }));
        saveGroups(pn, groups);
        renderTGGroups();
        close();
        toastr.success(`${selected.length}개 토글 추가됨`);
    });
}

function applyGroup(presetName, gi) {
    const groups = getGroupsForPreset(presetName);
    const g      = groups[gi];
    if (!g) return;
    const preset = openai_settings[openai_setting_names[presetName]];
    if (!preset) return;
    const orderEntry = preset.prompt_order?.find(o => String(o.character_id) === String(GLOBAL_DUMMY_ID));
    if (!orderEntry?.order) return;
    g.toggles.forEach(t => {
        const entry = orderEntry.order.find(e => e.identifier === t.target);
        if (entry) entry.enabled = t.behavior === 'invert' ? !g.isOn : g.isOn;
    });
}

// ══════════════════════════════════════════
// C. Mover Helpers
// ══════════════════════════════════════════

let sourcePresetName      = '';
let targetPresetName      = '';
let sourceOrderedPrompts  = [];
let targetOrderedPrompts  = [];
let selectedSourceIndices = new Set();
let insertPosition        = -1;

function getPromptOrder(preset) {
    if (!preset?.prompt_order) return [];
    const entry = preset.prompt_order.find(o => String(o.character_id) === String(GLOBAL_DUMMY_ID));
    return entry?.order || [];
}
function getOrderedPrompts(preset) {
    const order   = getPromptOrder(preset);
    const prompts = preset?.prompts || [];
    return order.map(entry => {
        const def = prompts.find(p => p.identifier === entry.identifier);
        return { identifier: entry.identifier, enabled: entry.enabled,
                 prompt: def || { identifier: entry.identifier, name: entry.identifier } };
    });
}
async function savePreset(name, preset) {
    const r = await fetch('/api/presets/save', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ apiId: 'openai', name, preset }),
    });
    if (!r.ok) throw new Error('프리셋 저장 실패');
    return await r.json();
}
function getPresetOptions() {
    if (!openai_settings || !openai_setting_names) return '<option value="">-- 프리셋 없음 --</option>';
    return '<option value="">-- 선택 --</option>'
        + Object.keys(openai_setting_names)
            .filter(n => openai_settings[openai_setting_names[n]])
            .map(n => `<option value="${n}">${n}</option>`)
            .join('');
}

// ══════════════════════════════════════════
// D. Build two separate drawers
// ══════════════════════════════════════════

function buildMoverDrawer() {
    const presets = getPresetOptions();
    const el = document.createElement('div');
    el.id = 'pmm-mover-drawer';
    el.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Prompt Multi-Mover</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="pmm-block">
                    <label class="pmm-label">① 출발 프리셋</label>
                    <select id="pmm-src" class="pmm-sel">${presets}</select>
                </div>
                <div class="pmm-block">
                    <div class="pmm-label-row">
                        <label class="pmm-label">② 이동할 항목</label>
                        <div>
                            <button class="pmm-sm" id="pmm-all">전체</button>
                            <button class="pmm-sm" id="pmm-none">해제</button>
                            <button class="pmm-sm" id="pmm-range">연속</button>
                        </div>
                    </div>
                    <div id="pmm-src-list" class="pmm-list">
                        <div class="pmm-ph">출발 프리셋을 선택하세요</div>
                    </div>
                </div>
                <div class="pmm-block">
                    <label class="pmm-label">③ 도착 프리셋</label>
                    <select id="pmm-dst" class="pmm-sel">${presets}</select>
                </div>
                <div class="pmm-block">
                    <label class="pmm-label">④ 삽입 위치 (+ 클릭)</label>
                    <div id="pmm-dst-list" class="pmm-list">
                        <div class="pmm-ph">도착 프리셋을 선택하세요</div>
                    </div>
                </div>
                <div class="pmm-block pmm-group-block">
                    <label class="pmm-group-toggle-row">
                        <input type="checkbox" id="pmm-make-group" style="width:16px;height:16px;accent-color:#7a6fff;flex-shrink:0;cursor:pointer">
                        <span>복사/이동 후 토글 그룹으로 묶기</span>
                    </label>
                    <div id="pmm-group-name-row" class="pmm-hidden" style="margin-top:8px">
                        <input type="text" id="pmm-group-name" class="pmm-text-input" placeholder="그룹 이름 입력...">
                    </div>
                </div>
                <div id="pmm-info" class="pmm-info">항목과 위치를 선택하면 버튼이 활성화됩니다</div>
                <div class="pmm-btn-row">
                    <button id="pmm-copy" class="pmm-btn pmm-copy" disabled>복사</button>
                    <button id="pmm-move" class="pmm-btn pmm-move" disabled>이동</button>
                </div>
            </div>
        </div>`;
    return el;
}

function buildTGDrawer() {
    const el = document.createElement('div');
    el.id = 'pmm-tg-drawer';
    el.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>토글 그룹 관리</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div id="pmm-tg-groups-area">
                    <div class="pmm-ph">로딩 중...</div>
                </div>
                <button class="pmm-sm pmm-sm-full" id="tg-add-group">+ 그룹 추가</button>
            </div>
        </div>`;
    return el;
}

// ══════════════════════════════════════════
// E. Render Mover
// ══════════════════════════════════════════

function renderSrcList() {
    const el = document.getElementById('pmm-src-list');
    if (!el) return;
    if (!sourceOrderedPrompts.length) { el.innerHTML = '<div class="pmm-ph">프롬프트 없음</div>'; return; }
    el.innerHTML = sourceOrderedPrompts.map((entry, i) => {
        const name      = entry.prompt.name || entry.identifier || 'Unnamed';
        const marker    = entry.prompt.marker ? '[고정] ' : '';
        const isChecked = selectedSourceIndices.has(i);
        return `
            <label class="pmm-item ${!entry.enabled?'pmm-off':''} ${isChecked?'pmm-checked':''}">
                <input type="checkbox" class="pmm-chk" data-i="${i}" ${isChecked?'checked':''}>
                <span class="pmm-num">#${i+1}</span>
                <span class="pmm-name">${marker}${name}</span>
            </label>`;
    }).join('');
    el.querySelectorAll('.pmm-chk').forEach(cb => {
        cb.addEventListener('change', e => {
            const i = parseInt(e.target.dataset.i);
            if (e.target.checked) { selectedSourceIndices.add(i); e.target.closest('.pmm-item').classList.add('pmm-checked'); }
            else { selectedSourceIndices.delete(i); e.target.closest('.pmm-item').classList.remove('pmm-checked'); }
            updateButtons();
        });
    });
}

function renderDstList() {
    const el = document.getElementById('pmm-dst-list');
    if (!el) return;
    if (!targetOrderedPrompts.length) {
        el.innerHTML = `<div class="pmm-slot ${insertPosition===0?'pmm-slot-on':''}" data-slot="0">+</div>`;
        el.querySelector('.pmm-slot').addEventListener('click', () => selectSlot(0));
        return;
    }
    let html = `<div class="pmm-slot ${insertPosition===0?'pmm-slot-on':''}" data-slot="0">+</div>`;
    targetOrderedPrompts.forEach((entry, i) => {
        const name   = entry.prompt.name || entry.identifier || 'Unnamed';
        const marker = entry.prompt.marker ? '[고정] ' : '';
        html += `
            <div class="pmm-dst-item ${!entry.enabled?'pmm-off':''}">
                <span class="pmm-num">#${i+1}</span>
                <span class="pmm-name">${marker}${name}</span>
            </div>
            <div class="pmm-slot ${insertPosition===i+1?'pmm-slot-on':''}" data-slot="${i+1}">+</div>`;
    });
    el.innerHTML = html;
    el.querySelectorAll('.pmm-slot').forEach(s => s.addEventListener('click', () => selectSlot(parseInt(s.dataset.slot))));
}

function selectSlot(slot) { insertPosition = slot; renderDstList(); updateButtons(); }

function updateButtons() {
    const n      = selectedSourceIndices.size;
    const canAct = sourcePresetName && targetPresetName && n > 0 && insertPosition >= 0;
    document.getElementById('pmm-copy').disabled = !canAct;
    document.getElementById('pmm-move').disabled = !(canAct && sourcePresetName !== targetPresetName);
    const info = document.getElementById('pmm-info');
    if (!info) return;
    if (!sourcePresetName)       info.textContent = '출발 프리셋을 선택하세요';
    else if (n === 0)            info.textContent = '이동할 항목을 체크하세요';
    else if (!targetPresetName)  info.textContent = `${n}개 선택됨 · 도착 프리셋을 선택하세요`;
    else if (insertPosition < 0) info.textContent = `${n}개 선택됨 · 삽입 위치(+)를 클릭하세요`;
    else                         info.textContent = `${n}개 선택 · 위치 확인 → 복사 또는 이동 클릭`;
}

// ══════════════════════════════════════════
// F. Perform copy/move (mover)
// ══════════════════════════════════════════

async function performOperation(removeFromSource) {
    const n = selectedSourceIndices.size;
    if (!sourcePresetName || !targetPresetName || n === 0 || insertPosition < 0) return;

    const makeGroup = document.getElementById('pmm-make-group')?.checked;
    const groupName = document.getElementById('pmm-group-name')?.value.trim();
    if (makeGroup && !groupName) {
        toastr.warning('그룹 이름을 입력해주세요');
        document.getElementById('pmm-group-name')?.focus();
        return;
    }

    const srcIdx = openai_setting_names[sourcePresetName];
    const dstIdx = openai_setting_names[targetPresetName];
    const selected = [...selectedSourceIndices].sort((a,b)=>a-b).map(i=>sourceOrderedPrompts[i]).filter(Boolean);

    const targetPreset = JSON.parse(JSON.stringify(openai_settings[dstIdx]));
    targetPreset.prompts      = targetPreset.prompts      || [];
    targetPreset.prompt_order = targetPreset.prompt_order || [];

    const existingIds    = new Set(targetPreset.prompts.map(p => p.identifier));
    const newIdentifiers = [];

    selected.forEach((entry, offset) => {
        const promptDef = JSON.parse(JSON.stringify(entry.prompt));
        let newId = promptDef.identifier;
        if (existingIds.has(newId)) {
            let c = 1;
            const base = newId.replace(/_\d+$/, '');
            while (existingIds.has(`${base}_${c}`)) c++;
            newId = `${base}_${c}`;
            promptDef.identifier = newId;
            promptDef.name = `${promptDef.name || entry.identifier} (${c})`;
        }
        existingIds.add(newId);
        newIdentifiers.push(newId);
        targetPreset.prompts.push(promptDef);

        const globalOrder = targetPreset.prompt_order.find(o => String(o.character_id) === String(GLOBAL_DUMMY_ID));
        if (globalOrder?.order) {
            globalOrder.order.splice(insertPosition + offset, 0, { identifier: newId, enabled: true });
        } else {
            targetPreset.prompt_order.push({ character_id: GLOBAL_DUMMY_ID, order: [{ identifier: newId, enabled: true }] });
        }
        for (const oe of targetPreset.prompt_order) {
            if (String(oe.character_id) !== String(GLOBAL_DUMMY_ID) && oe.order)
                oe.order.push({ identifier: newId, enabled: true });
        }
    });

    try {
        await savePreset(targetPresetName, targetPreset);
        openai_settings[dstIdx] = targetPreset;

        if (removeFromSource && sourcePresetName !== targetPresetName) {
            const sp      = JSON.parse(JSON.stringify(openai_settings[srcIdx]));
            const removed = new Set(selected.map(e => e.identifier));
            sp.prompts    = sp.prompts.filter(p => !removed.has(p.identifier));
            if (sp.prompt_order) for (const o of sp.prompt_order) if (o.order) o.order = o.order.filter(e => !removed.has(e.identifier));
            await savePreset(sourcePresetName, sp);
            openai_settings[srcIdx] = sp;
        }

        if (makeGroup && groupName) {
            const groups = getGroupsForPreset(targetPresetName);
            let finalName = groupName, c = 1;
            while (groups.some(g => g.name === finalName)) finalName = `${groupName} (${c++})`;
            groups.push({ name: finalName, isOn: false, toggles: newIdentifiers.map(id => ({ target: id, behavior: 'direct' })) });
            saveGroups(targetPresetName, groups);
            toastr.success(`${n}개 ${removeFromSource?'이동':'복사'} 완료 + 토글 그룹 "${finalName}" 생성!`);
        } else {
            toastr.success(`${n}개 ${removeFromSource?'이동':'복사'} 완료`);
        }

        sourceOrderedPrompts = getOrderedPrompts(openai_settings[srcIdx]);
        targetOrderedPrompts = getOrderedPrompts(openai_settings[dstIdx]);
        selectedSourceIndices.clear();
        insertPosition = -1;
        const cb = document.getElementById('pmm-make-group'); if (cb) cb.checked = false;
        document.getElementById('pmm-group-name-row')?.classList.add('pmm-hidden');
        const gni = document.getElementById('pmm-group-name'); if (gni) gni.value = '';
        renderSrcList(); renderDstList(); updateButtons();

    } catch (err) {
        console.error('[PMM]', err);
        toastr.error('실패: ' + err.message);
    }
}

// ══════════════════════════════════════════
// G. Wire Events
// ══════════════════════════════════════════

function wireMoverEvents() {
    document.getElementById('pmm-src')?.addEventListener('change', e => {
        sourcePresetName = e.target.value;
        selectedSourceIndices.clear();
        sourceOrderedPrompts = sourcePresetName ? getOrderedPrompts(openai_settings[openai_setting_names[sourcePresetName]]) : [];
        renderSrcList(); updateButtons();
    });
    document.getElementById('pmm-dst')?.addEventListener('change', e => {
        targetPresetName = e.target.value;
        insertPosition   = -1;
        targetOrderedPrompts = targetPresetName ? getOrderedPrompts(openai_settings[openai_setting_names[targetPresetName]]) : [];
        renderDstList(); updateButtons();
    });
    document.getElementById('pmm-all')?.addEventListener('click', () => {
        document.querySelectorAll('#pmm-src-list .pmm-chk').forEach(cb => {
            cb.checked = true; selectedSourceIndices.add(parseInt(cb.dataset.i));
            cb.closest('.pmm-item').classList.add('pmm-checked');
        });
        updateButtons();
    });
    document.getElementById('pmm-none')?.addEventListener('click', () => {
        document.querySelectorAll('#pmm-src-list .pmm-chk').forEach(cb => {
            cb.checked = false; cb.closest('.pmm-item').classList.remove('pmm-checked');
        });
        selectedSourceIndices.clear(); updateButtons();
    });
    document.getElementById('pmm-range')?.addEventListener('click', () => {
        if (selectedSourceIndices.size < 2) { toastr.warning('먼저 시작과 끝 항목 2개를 선택하세요'); return; }
        const sorted = [...selectedSourceIndices].sort((a,b)=>a-b);
        const min = sorted[0], max = sorted[sorted.length-1];
        for (let i = min; i <= max; i++) selectedSourceIndices.add(i);
        document.querySelectorAll('#pmm-src-list .pmm-chk').forEach(cb => {
            const i = parseInt(cb.dataset.i);
            if (i >= min && i <= max) { cb.checked = true; cb.closest('.pmm-item').classList.add('pmm-checked'); }
        });
        updateButtons();
    });
    document.getElementById('pmm-make-group')?.addEventListener('change', e => {
        const row = document.getElementById('pmm-group-name-row');
        e.target.checked ? row.classList.remove('pmm-hidden') : row.classList.add('pmm-hidden');
        if (e.target.checked) document.getElementById('pmm-group-name')?.focus();
    });
    document.getElementById('pmm-copy')?.addEventListener('click', () => performOperation(false));
    document.getElementById('pmm-move')?.addEventListener('click', () => performOperation(true));
}

function wireTGDrawerEvents() {
    document.getElementById('tg-add-group')?.addEventListener('click', () => {
        const pn = getCurrentPreset();
        if (!pn) { toastr.warning('프리셋을 먼저 선택하세요'); return; }
        const name = prompt('새 그룹 이름:');
        if (!name?.trim()) return;
        const groups = getGroupsForPreset(pn);
        if (groups.some(g => g.name === name.trim())) { toastr.warning('같은 이름의 그룹이 이미 있습니다'); return; }
        groups.push({ name: name.trim(), isOn: false, toggles: [] });
        saveGroups(pn, groups);
        renderTGGroups();
    });
}

// ══════════════════════════════════════════
// H. Mount & Init
// ══════════════════════════════════════════

function mount() {
    if (document.getElementById('pmm-mover-drawer')) return true;
    const target = document.querySelector('.range-block.m-b-1');
    if (!target) return false;

    // Insert mover ABOVE toggle groups (i.e. before the range-block)
    // Insert TG drawer just before the range-block (directly above prompt list)
    const tgDrawer    = buildTGDrawer();
    const moverDrawer = buildMoverDrawer();

    target.before(tgDrawer);    // TG drawer: directly above prompt list
    tgDrawer.before(moverDrawer); // Mover drawer: above TG drawer

    wireMoverEvents();
    wireTGDrawerEvents();
    renderTGGroups();
    return true;
}

jQuery(async () => {
    console.log(`[${extensionName}] Loading...`);
    try {
        await initImports();

        let count = 0;
        const t = setInterval(() => {
            if (mount() || ++count > 50) clearInterval(t);
        }, 200);

        eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => {
            renderTGGroups();
        });

        console.log(`[${extensionName}] Loaded`);
    } catch (err) {
        console.error(`[${extensionName}] Failed:`, err);
    }
});

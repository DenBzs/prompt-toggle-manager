// Prompt Multi-Mover
// Inline Extensions panel UI, mobile-friendly single column
// Based on prompt-mover by melody077

const extensionName = 'prompt-mover-multi';
const GLOBAL_DUMMY_ID = 100001;

let getRequestHeaders, openai_setting_names, openai_settings;

async function initImports() {
    const scriptPath = import.meta.url;
    const isThirdParty = scriptPath.includes('/third-party/');
    const base = isThirdParty ? '../../../../' : '../../../';
    const mod2 = isThirdParty ? '../../../' : '../../';

    const scriptModule = await import(base + 'script.js');
    getRequestHeaders = scriptModule.getRequestHeaders;

    const openaiModule = await import(mod2 + 'openai.js');
    openai_setting_names = openaiModule.openai_setting_names;
    openai_settings = openaiModule.openai_settings;
}

// ── State ─────────────────────────────────────────────────────────────────────
let sourcePresetName = '';
let targetPresetName = '';
let sourceOrderedPrompts = [];
let targetOrderedPrompts = [];
let selectedSourceIndices = new Set();
let insertPosition = -1;

// ── Data helpers ──────────────────────────────────────────────────────────────
function getPromptOrder(preset) {
    if (!preset?.prompt_order) return [];
    const entry = preset.prompt_order.find(o => String(o.character_id) === String(GLOBAL_DUMMY_ID));
    return entry?.order || [];
}

function getOrderedPrompts(preset) {
    const order = getPromptOrder(preset);
    const prompts = preset?.prompts || [];
    return order.map(entry => {
        const def = prompts.find(p => p.identifier === entry.identifier);
        return {
            identifier: entry.identifier,
            enabled: entry.enabled,
            prompt: def || { identifier: entry.identifier, name: entry.identifier },
        };
    });
}

async function savePreset(name, preset) {
    const response = await fetch('/api/presets/save', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ apiId: 'openai', name, preset }),
    });
    if (!response.ok) throw new Error('저장 실패');
    return await response.json();
}

// ── Build UI ──────────────────────────────────────────────────────────────────
function buildUI() {
    const presets = getPresetOptions();

    const el = document.createElement('div');
    el.id = 'pmm-panel';
    el.className = 'extension_container';
    el.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Prompt Multi-Mover</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" id="pmm-content">

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
                    <label class="pmm-label">④ 삽입 위치 (➕ 클릭)</label>
                    <div id="pmm-dst-list" class="pmm-list">
                        <div class="pmm-ph">도착 프리셋을 선택하세요</div>
                    </div>
                </div>

                <div id="pmm-info" class="pmm-info">항목과 위치를 선택하면 버튼이 활성화됩니다</div>

                <div class="pmm-btn-row">
                    <button id="pmm-copy" class="pmm-btn pmm-copy" disabled>📋 복사</button>
                    <button id="pmm-move" class="pmm-btn pmm-move" disabled>✂️ 이동</button>
                </div>

            </div>
        </div>
    `;
    return el;
}

function getPresetOptions() {
    if (!openai_settings || !openai_setting_names) return '<option value="">-- 프리셋 없음 --</option>';
    return '<option value="">-- 선택 --</option>'
        + Object.keys(openai_setting_names)
            .filter(name => openai_settings[openai_setting_names[name]])
            .map(name => `<option value="${name}">${name}</option>`)
            .join('');
}

// ── Render lists ──────────────────────────────────────────────────────────────
function renderSrcList() {
    const el = document.getElementById('pmm-src-list');
    if (!el) return;

    if (!sourceOrderedPrompts.length) {
        el.innerHTML = '<div class="pmm-ph">프롬프트 없음</div>';
        return;
    }

    el.innerHTML = sourceOrderedPrompts.map((entry, i) => {
        const name = entry.prompt.name || entry.identifier || 'Unnamed';
        const marker = entry.prompt.marker ? '📍' : '';
        const isChecked = selectedSourceIndices.has(i);
        return `
            <label class="pmm-item ${!entry.enabled ? 'pmm-off' : ''} ${isChecked ? 'pmm-checked' : ''}">
                <input type="checkbox" class="pmm-chk" data-i="${i}" ${isChecked ? 'checked' : ''}>
                <span class="pmm-num">#${i + 1}</span>
                <span class="pmm-name">${marker}${name}</span>
            </label>`;
    }).join('');

    el.querySelectorAll('.pmm-chk').forEach(cb => {
        cb.addEventListener('change', e => {
            const i = parseInt(e.target.dataset.i);
            if (e.target.checked) {
                selectedSourceIndices.add(i);
                e.target.closest('.pmm-item').classList.add('pmm-checked');
            } else {
                selectedSourceIndices.delete(i);
                e.target.closest('.pmm-item').classList.remove('pmm-checked');
            }
            updateButtons();
        });
    });
}

function renderDstList() {
    const el = document.getElementById('pmm-dst-list');
    if (!el) return;

    if (!targetOrderedPrompts.length) {
        el.innerHTML = `<div class="pmm-slot ${insertPosition === 0 ? 'pmm-slot-on' : ''}" data-slot="0">➕ 여기에 삽입</div>`;
        el.querySelector('.pmm-slot').addEventListener('click', () => selectSlot(0));
        return;
    }

    let html = `<div class="pmm-slot ${insertPosition === 0 ? 'pmm-slot-on' : ''}" data-slot="0">➕ 맨 위에 삽입</div>`;

    targetOrderedPrompts.forEach((entry, i) => {
        const name = entry.prompt.name || entry.identifier || 'Unnamed';
        const marker = entry.prompt.marker ? '📍' : '';
        html += `
            <div class="pmm-dst-item ${!entry.enabled ? 'pmm-off' : ''}">
                <span class="pmm-num">#${i + 1}</span>
                <span class="pmm-name">${marker}${name}</span>
            </div>
            <div class="pmm-slot ${insertPosition === i + 1 ? 'pmm-slot-on' : ''}" data-slot="${i + 1}">➕ 여기에 삽입</div>`;
    });

    el.innerHTML = html;
    el.querySelectorAll('.pmm-slot').forEach(slot => {
        slot.addEventListener('click', () => selectSlot(parseInt(slot.dataset.slot)));
    });
}

function selectSlot(slot) {
    insertPosition = slot;
    renderDstList();
    updateButtons();
}

// ── Buttons & info ────────────────────────────────────────────────────────────
function updateButtons() {
    const n = selectedSourceIndices.size;
    const canAct = sourcePresetName && targetPresetName && n > 0 && insertPosition >= 0;
    const canMove = canAct && sourcePresetName !== targetPresetName;

    const copyBtn = document.getElementById('pmm-copy');
    const moveBtn = document.getElementById('pmm-move');
    const info = document.getElementById('pmm-info');

    if (copyBtn) copyBtn.disabled = !canAct;
    if (moveBtn) moveBtn.disabled = !canMove;

    if (!info) return;
    if (!sourcePresetName) info.textContent = '출발 프리셋을 선택하세요';
    else if (n === 0) info.textContent = '이동할 항목을 체크하세요';
    else if (!targetPresetName) info.textContent = `${n}개 선택됨 · 도착 프리셋을 선택하세요`;
    else if (insertPosition < 0) info.textContent = `${n}개 선택됨 · 삽입 위치(➕)를 클릭하세요`;
    else info.textContent = `${n}개 선택 · 위치 확인 → 복사 또는 이동 버튼 클릭`;
}

// ── Execute ───────────────────────────────────────────────────────────────────
async function performOperation(removeFromSource) {
    const n = selectedSourceIndices.size;
    if (!sourcePresetName || !targetPresetName || n === 0 || insertPosition < 0) return;

    const srcIdx = openai_setting_names[sourcePresetName];
    const dstIdx = openai_setting_names[targetPresetName];

    const selected = [...selectedSourceIndices]
        .sort((a, b) => a - b)
        .map(i => sourceOrderedPrompts[i])
        .filter(Boolean);

    const targetPreset = JSON.parse(JSON.stringify(openai_settings[dstIdx]));
    targetPreset.prompts = targetPreset.prompts || [];
    targetPreset.prompt_order = targetPreset.prompt_order || [];

    const existingIds = new Set(targetPreset.prompts.map(p => p.identifier));

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

        targetPreset.prompts.push(promptDef);

        const globalOrder = targetPreset.prompt_order.find(
            o => String(o.character_id) === String(GLOBAL_DUMMY_ID)
        );
        if (globalOrder?.order) {
            globalOrder.order.splice(insertPosition + offset, 0, { identifier: newId, enabled: true });
        } else {
            targetPreset.prompt_order.push({
                character_id: GLOBAL_DUMMY_ID,
                order: [{ identifier: newId, enabled: true }],
            });
        }

        for (const orderEntry of targetPreset.prompt_order) {
            if (String(orderEntry.character_id) !== String(GLOBAL_DUMMY_ID) && orderEntry.order) {
                orderEntry.order.push({ identifier: newId, enabled: true });
            }
        }
    });

    try {
        await savePreset(targetPresetName, targetPreset);
        openai_settings[dstIdx] = targetPreset;

        if (removeFromSource && sourcePresetName !== targetPresetName) {
            const sourcePreset = JSON.parse(JSON.stringify(openai_settings[srcIdx]));
            const removedIds = new Set(selected.map(e => e.identifier));
            sourcePreset.prompts = sourcePreset.prompts.filter(p => !removedIds.has(p.identifier));
            if (sourcePreset.prompt_order) {
                for (const o of sourcePreset.prompt_order) {
                    if (o.order) o.order = o.order.filter(e => !removedIds.has(e.identifier));
                }
            }
            await savePreset(sourcePresetName, sourcePreset);
            openai_settings[srcIdx] = sourcePreset;
        }

        toastr.success(removeFromSource ? `${n}개 이동 완료` : `${n}개 복사 완료`);

        sourceOrderedPrompts = getOrderedPrompts(openai_settings[srcIdx]);
        targetOrderedPrompts = getOrderedPrompts(openai_settings[dstIdx]);
        selectedSourceIndices.clear();
        insertPosition = -1;

        renderSrcList();
        renderDstList();
        updateButtons();

    } catch (err) {
        console.error('[PMM]', err);
        toastr.error('실패: ' + err.message);
    }
}

// ── Wire events ───────────────────────────────────────────────────────────────
function wireEvents() {
    document.getElementById('pmm-src')?.addEventListener('change', e => {
        sourcePresetName = e.target.value;
        selectedSourceIndices.clear();
        sourceOrderedPrompts = sourcePresetName
            ? getOrderedPrompts(openai_settings[openai_setting_names[sourcePresetName]])
            : [];
        renderSrcList();
        updateButtons();
    });

    document.getElementById('pmm-dst')?.addEventListener('change', e => {
        targetPresetName = e.target.value;
        insertPosition = -1;
        targetOrderedPrompts = targetPresetName
            ? getOrderedPrompts(openai_settings[openai_setting_names[targetPresetName]])
            : [];
        renderDstList();
        updateButtons();
    });

    document.getElementById('pmm-all')?.addEventListener('click', () => {
        document.querySelectorAll('.pmm-chk').forEach(cb => {
            cb.checked = true;
            selectedSourceIndices.add(parseInt(cb.dataset.i));
            cb.closest('.pmm-item').classList.add('pmm-checked');
        });
        updateButtons();
    });

    document.getElementById('pmm-none')?.addEventListener('click', () => {
        document.querySelectorAll('.pmm-chk').forEach(cb => {
            cb.checked = false;
            cb.closest('.pmm-item').classList.remove('pmm-checked');
        });
        selectedSourceIndices.clear();
        updateButtons();
    });

    document.getElementById('pmm-copy')?.addEventListener('click', () => performOperation(false));
    document.getElementById('pmm-move')?.addEventListener('click', () => performOperation(true));
}

// ── Mount ─────────────────────────────────────────────────────────────────────
function mount() {
    const tryAdd = () => {
        if (document.getElementById('pmm-panel')) return true;
        const panel = document.getElementById('extensions_settings2');
        if (!panel) return false;
        panel.appendChild(buildUI());
        wireEvents();
        return true;
    };

    if (tryAdd()) return;
    let count = 0;
    const t = setInterval(() => { if (tryAdd() || ++count > 50) clearInterval(t); }, 200);
}

// ── Init ──────────────────────────────────────────────────────────────────────
jQuery(async () => {
    console.log(`[${extensionName}] Loading...`);
    try {
        await initImports();
        mount();
        console.log(`[${extensionName}] Loaded`);
    } catch (err) {
        console.error(`[${extensionName}] Failed:`, err);
    }
});

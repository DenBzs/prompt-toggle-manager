// Prompt Multi-Mover
// Based on prompt-mover by melody077
// Added: multi-select checkboxes, copy & move buttons

const extensionName = 'prompt-mover-multi';
const GLOBAL_DUMMY_ID = 100001;

let getRequestHeaders, callGenericPopup, POPUP_TYPE, openai_setting_names, openai_settings;

async function initImports() {
    const scriptPath = import.meta.url;
    const isThirdParty = scriptPath.includes('/third-party/');
    const base = isThirdParty ? '../../../../' : '../../../';
    const popBase = isThirdParty ? '../../../' : '../../';

    const scriptModule = await import(base + 'script.js');
    getRequestHeaders = scriptModule.getRequestHeaders;

    const popupModule = await import(popBase + 'popup.js');
    callGenericPopup = popupModule.callGenericPopup;
    POPUP_TYPE = popupModule.POPUP_TYPE;

    const openaiModule = await import(popBase + 'openai.js');
    openai_setting_names = openaiModule.openai_setting_names;
    openai_settings = openaiModule.openai_settings;
}

// State
let sourcePresetName = '';
let targetPresetName = '';
let sourceOrderedPrompts = [];
let targetOrderedPrompts = [];
let selectedSourceIndices = new Set(); // multi-select
let insertPosition = -1;

// ── Data helpers (same as original) ──────────────────────────────────────────
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
    if (!response.ok) throw new Error('Failed to save preset');
    return await response.json();
}

// ── Popup HTML ────────────────────────────────────────────────────────────────
function createPopupHtml(presets) {
    const opts = Object.keys(presets)
        .map(name => `<option value="${name}">${name}</option>`)
        .join('');

    return `
        <div id="pmm-popup">
            <div class="pmm-cols">

                <!-- LEFT: Source -->
                <div class="pmm-col">
                    <div class="pmm-col-title">📤 출발 프리셋</div>
                    <select id="pmm-source-preset" class="pmm-sel">
                        <option value="">-- 선택 --</option>
                        ${opts}
                    </select>
                    <div class="pmm-list-header">
                        <span>항목 선택 (다중 가능)</span>
                        <div class="pmm-list-actions">
                            <button class="pmm-sm-btn" id="pmm-sel-all">전체</button>
                            <button class="pmm-sm-btn" id="pmm-sel-none">해제</button>
                        </div>
                    </div>
                    <div class="pmm-prompt-list" id="pmm-source-prompts">
                        <div class="pmm-placeholder">프리셋을 선택하세요</div>
                    </div>
                </div>

                <!-- RIGHT: Target -->
                <div class="pmm-col">
                    <div class="pmm-col-title">📥 도착 프리셋 · 삽입 위치 선택</div>
                    <select id="pmm-target-preset" class="pmm-sel">
                        <option value="">-- 선택 --</option>
                        ${opts}
                    </select>
                    <div class="pmm-list-header">
                        <span>삽입할 위치를 클릭</span>
                    </div>
                    <div class="pmm-prompt-list" id="pmm-target-prompts">
                        <div class="pmm-placeholder">프리셋을 선택하세요</div>
                    </div>
                </div>

            </div>

            <!-- Actions -->
            <div class="pmm-actions">
                <div id="pmm-selection-info" class="pmm-info">항목을 선택하면 버튼이 활성화됩니다</div>
                <div class="pmm-btn-group">
                    <button id="pmm-btn-copy" class="pmm-action-btn pmm-copy-btn" disabled>📋 복사</button>
                    <button id="pmm-btn-move" class="pmm-action-btn pmm-move-btn" disabled>✂️ 이동</button>
                </div>
            </div>
        </div>
    `;
}

// ── Render source list (checkboxes) ──────────────────────────────────────────
function renderSourceList(container) {
    const listEl = container.querySelector('#pmm-source-prompts');
    if (!listEl) return;

    if (!sourceOrderedPrompts.length) {
        listEl.innerHTML = '<div class="pmm-placeholder">프롬프트 없음</div>';
        return;
    }

    listEl.innerHTML = sourceOrderedPrompts.map((entry, i) => {
        const name = entry.prompt.name || entry.identifier || 'Unnamed';
        const marker = entry.prompt.marker ? '📍 ' : '';
        const checked = selectedSourceIndices.has(i) ? 'checked' : '';
        const disabled = !entry.enabled ? 'pmm-disabled' : '';
        return `
            <label class="pmm-item ${disabled} ${checked ? 'pmm-item-checked' : ''}" data-index="${i}">
                <input type="checkbox" class="pmm-check" data-index="${i}" ${checked}>
                <span class="pmm-idx">#${i + 1}</span>
                <span class="pmm-name">${marker}${name}</span>
                <span class="pmm-id">[${entry.identifier}]</span>
            </label>
        `;
    }).join('');

    listEl.querySelectorAll('.pmm-check').forEach(cb => {
        cb.addEventListener('change', e => {
            const idx = parseInt(e.target.dataset.index);
            if (e.target.checked) {
                selectedSourceIndices.add(idx);
                e.target.closest('.pmm-item').classList.add('pmm-item-checked');
            } else {
                selectedSourceIndices.delete(idx);
                e.target.closest('.pmm-item').classList.remove('pmm-item-checked');
            }
            updateButtons(container);
            updateSelectionInfo(container);
        });
    });
}

// ── Render target list (slots between items) ──────────────────────────────────
function renderTargetList(container) {
    const listEl = container.querySelector('#pmm-target-prompts');
    if (!listEl) return;

    if (!targetOrderedPrompts.length) {
        listEl.innerHTML = `
            <div class="pmm-slot ${insertPosition === 0 ? 'selected' : ''}" data-slot="0">
                <span class="pmm-slot-icon">➕</span> 여기에 삽입
            </div>`;
        listEl.querySelector('.pmm-slot').addEventListener('click', () => onSelectSlot(container, 0));
        return;
    }

    let html = `<div class="pmm-slot ${insertPosition === 0 ? 'selected' : ''}" data-slot="0">
        <span class="pmm-slot-icon">➕</span> 맨 위에 삽입
    </div>`;

    targetOrderedPrompts.forEach((entry, i) => {
        const name = entry.prompt.name || entry.identifier || 'Unnamed';
        const marker = entry.prompt.marker ? '📍 ' : '';
        const disabled = !entry.enabled ? 'pmm-disabled' : '';
        const slotIdx = i + 1;
        html += `
            <div class="pmm-target-item ${disabled}">
                <span class="pmm-idx">#${i + 1}</span>
                <span class="pmm-name">${marker}${name}</span>
                <span class="pmm-id">[${entry.identifier}]</span>
            </div>
            <div class="pmm-slot ${insertPosition === slotIdx ? 'selected' : ''}" data-slot="${slotIdx}">
                <span class="pmm-slot-icon">➕</span> 여기에 삽입
            </div>`;
    });

    listEl.innerHTML = html;
    listEl.querySelectorAll('.pmm-slot').forEach(slot => {
        slot.addEventListener('click', () => onSelectSlot(container, parseInt(slot.dataset.slot)));
    });
}

function onSelectSlot(container, slot) {
    insertPosition = slot;
    renderTargetList(container);
    updateButtons(container);
    updateSelectionInfo(container);
}

// ── UI state ──────────────────────────────────────────────────────────────────
function updateButtons(container) {
    const canAct = sourcePresetName && targetPresetName
        && selectedSourceIndices.size > 0
        && insertPosition >= 0;
    const canMove = canAct && sourcePresetName !== targetPresetName;

    container.querySelector('#pmm-btn-copy').disabled = !canAct;
    container.querySelector('#pmm-btn-move').disabled = !canMove;
}

function updateSelectionInfo(container) {
    const info = container.querySelector('#pmm-selection-info');
    if (!info) return;
    const n = selectedSourceIndices.size;
    if (n === 0) {
        info.textContent = '항목을 선택하면 버튼이 활성화됩니다';
    } else if (insertPosition < 0) {
        info.textContent = `${n}개 선택됨 · 삽입 위치를 선택하세요`;
    } else {
        info.textContent = `${n}개 선택됨 · 위치 ${insertPosition} 선택됨 → 이제 복사/이동 가능`;
    }
}

// ── Perform copy/move ─────────────────────────────────────────────────────────
async function performOperation(container, removeFromSource) {
    if (selectedSourceIndices.size === 0 || insertPosition < 0) {
        toastr.error('항목과 삽입 위치를 선택해주세요');
        return;
    }

    const srcIdx = openai_setting_names[sourcePresetName];
    const dstIdx = openai_setting_names[targetPresetName];
    if (srcIdx === undefined || dstIdx === undefined) {
        toastr.error('프리셋을 찾을 수 없습니다');
        return;
    }

    // Get selected entries in their original order
    const selected = [...selectedSourceIndices]
        .sort((a, b) => a - b)
        .map(i => sourceOrderedPrompts[i])
        .filter(Boolean);

    if (!selected.length) {
        toastr.error('선택한 항목을 찾을 수 없습니다');
        return;
    }

    // Deep copy target preset
    const targetPreset = JSON.parse(JSON.stringify(openai_settings[dstIdx]));
    targetPreset.prompts = targetPreset.prompts || [];
    targetPreset.prompt_order = targetPreset.prompt_order || [];

    const existingIds = new Set(targetPreset.prompts.map(p => p.identifier));

    // Insert all selected items at insertPosition (offset increases for each)
    const insertedIdentifiers = [];

    selected.forEach((entry, offset) => {
        const promptDef = JSON.parse(JSON.stringify(entry.prompt));

        // Deduplicate identifier
        let newId = promptDef.identifier;
        if (existingIds.has(newId)) {
            let counter = 1;
            const base = newId.replace(/_\d+$/, '');
            while (existingIds.has(`${base}_${counter}`)) counter++;
            newId = `${base}_${counter}`;
            promptDef.identifier = newId;
            promptDef.name = `${promptDef.name || entry.identifier} (${counter})`;
        }
        existingIds.add(newId);
        insertedIdentifiers.push(newId);

        // Add prompt definition
        targetPreset.prompts.push(promptDef);

        // Insert into global prompt_order at (insertPosition + offset)
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

        // Also append to character-specific orders
        for (const orderEntry of targetPreset.prompt_order) {
            if (String(orderEntry.character_id) !== String(GLOBAL_DUMMY_ID) && orderEntry.order) {
                orderEntry.order.push({ identifier: newId, enabled: true });
            }
        }
    });

    try {
        await savePreset(targetPresetName, targetPreset);
        openai_settings[dstIdx] = targetPreset;

        // If moving (not copying): remove from source
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

        toastr.success(removeFromSource
            ? `${selected.length}개 이동 완료`
            : `${selected.length}개 복사 완료`
        );

        // Refresh state
        sourceOrderedPrompts = getOrderedPrompts(openai_settings[srcIdx]);
        targetOrderedPrompts = getOrderedPrompts(openai_settings[dstIdx]);
        selectedSourceIndices.clear();
        insertPosition = -1;

        renderSourceList(container);
        renderTargetList(container);
        updateButtons(container);
        updateSelectionInfo(container);

    } catch (err) {
        console.error('[PMM] Operation error:', err);
        toastr.error('작업 실패: ' + err.message);
    }
}

// ── Open popup ────────────────────────────────────────────────────────────────
async function openPopup() {
    try {
        const presets = {};
        if (!openai_settings || !openai_setting_names) {
            toastr.warning('Chat Completion API를 사용 중인지 확인하세요.');
            return;
        }
        for (const [name, index] of Object.entries(openai_setting_names)) {
            if (openai_settings[index]) presets[name] = openai_settings[index];
        }
        if (!Object.keys(presets).length) {
            toastr.warning('프리셋이 없습니다.');
            return;
        }

        // Reset state
        sourcePresetName = '';
        targetPresetName = '';
        sourceOrderedPrompts = [];
        targetOrderedPrompts = [];
        selectedSourceIndices.clear();
        insertPosition = -1;

        const wrapper = document.createElement('div');
        wrapper.innerHTML = createPopupHtml(presets);
        const container = wrapper.firstElementChild;

        // Select all / deselect all
        container.querySelector('#pmm-sel-all').addEventListener('click', () => {
            container.querySelectorAll('.pmm-check').forEach(cb => {
                cb.checked = true;
                selectedSourceIndices.add(parseInt(cb.dataset.index));
                cb.closest('.pmm-item').classList.add('pmm-item-checked');
            });
            updateButtons(container);
            updateSelectionInfo(container);
        });
        container.querySelector('#pmm-sel-none').addEventListener('click', () => {
            container.querySelectorAll('.pmm-check').forEach(cb => {
                cb.checked = false;
                cb.closest('.pmm-item').classList.remove('pmm-item-checked');
            });
            selectedSourceIndices.clear();
            updateButtons(container);
            updateSelectionInfo(container);
        });

        container.querySelector('#pmm-source-preset').addEventListener('change', e => {
            sourcePresetName = e.target.value;
            selectedSourceIndices.clear();
            sourceOrderedPrompts = sourcePresetName
                ? getOrderedPrompts(openai_settings[openai_setting_names[sourcePresetName]])
                : [];
            renderSourceList(container);
            updateButtons(container);
            updateSelectionInfo(container);
        });

        container.querySelector('#pmm-target-preset').addEventListener('change', e => {
            targetPresetName = e.target.value;
            insertPosition = -1;
            targetOrderedPrompts = targetPresetName
                ? getOrderedPrompts(openai_settings[openai_setting_names[targetPresetName]])
                : [];
            renderTargetList(container);
            updateButtons(container);
            updateSelectionInfo(container);
        });

        container.querySelector('#pmm-btn-copy').addEventListener('click', () => performOperation(container, false));
        container.querySelector('#pmm-btn-move').addEventListener('click', () => performOperation(container, true));

        await callGenericPopup(container, POPUP_TYPE.TEXT, '', {
            okButton: '닫기',
            cancelButton: false,
            wide: true,
        });

    } catch (err) {
        console.error('[PMM] Popup error:', err);
        toastr.error('Prompt Multi-Mover를 열 수 없습니다');
    }
}

// ── Extension panel + header button (same pattern as original) ────────────────
function addExtensionPanel() {
    const tryAdd = () => {
        if (document.getElementById('pmm-panel')) return true;
        const panel = document.getElementById('extensions_settings2');
        if (!panel) return false;

        const el = document.createElement('div');
        el.id = 'pmm-panel';
        el.className = 'extension_container';
        el.innerHTML = `
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Prompt Multi-Mover</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div id="pmm-open-btn" class="menu_button menu_button_icon">
                        <i class="fa-solid fa-arrows-left-right"></i>
                        <span>Prompt Multi-Mover 열기</span>
                    </div>
                </div>
            </div>`;
        el.querySelector('#pmm-open-btn').addEventListener('click', openPopup);
        panel.appendChild(el);
        return true;
    };

    if (tryAdd()) return;
    let count = 0;
    const t = setInterval(() => { if (tryAdd() || ++count > 50) clearInterval(t); }, 200);
}

function addHeaderButton() {
    const tryAdd = () => {
        if (document.getElementById('pmm-header-btn')) return;
        const header = document.querySelector('#completion_prompt_manager_header');
        if (!header) return;

        const btn = document.createElement('div');
        btn.id = 'pmm-header-btn';
        btn.className = 'menu_button menu_button_icon';
        btn.title = 'Prompt Multi-Mover';
        btn.innerHTML = '<i class="fa-solid fa-arrows-left-right"></i>';
        btn.style.marginLeft = '5px';
        btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openPopup(); });
        header.appendChild(btn);
    };

    tryAdd();
    const obs = new MutationObserver(tryAdd);
    obs.observe(document.body, { childList: true, subtree: true });
}

// ── Init ──────────────────────────────────────────────────────────────────────
jQuery(async () => {
    console.log(`[${extensionName}] Loading...`);
    try {
        await initImports();
        addExtensionPanel();
        addHeaderButton();
        console.log(`[${extensionName}] Loaded`);
    } catch (err) {
        console.error(`[${extensionName}] Failed:`, err);
    }
});

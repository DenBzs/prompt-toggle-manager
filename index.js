// Prompt Multi-Mover
// Copy/move prompt entries between presets, with insert position selection
'use strict';

const MODULE_NAME = 'prompt_multi_mover';

(function init() {
    const checkReady = setInterval(() => {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            clearInterval(checkReady);
            setup();
        }
    }, 300);
})();

function setup() {
    const { eventSource, event_types } = SillyTavern.getContext();
    injectUI();
    eventSource.on(event_types.APP_READY, () => refreshAll());
    setTimeout(refreshAll, 500);
}

// ── UI ────────────────────────────────────────────────────────────────────────
function injectUI() {
    if (document.getElementById('pmm-container')) return;

    const html = `
<div id="pmm-container" class="pmm-container">
    <div class="pmm-header" id="pmm-header">
        <span class="pmm-title">📋 Prompt Multi-Mover</span>
        <span id="pmm-chevron">▲</span>
    </div>
    <div id="pmm-body" class="pmm-body">

        <div class="pmm-step">
            <div class="pmm-step-label">① 원본 프리셋</div>
            <select id="pmm-src-preset" class="pmm-select"></select>
        </div>

        <div class="pmm-step">
            <div class="pmm-step-label">② 복사/이동할 항목</div>
            <div class="pmm-list-controls">
                <button class="pmm-btn pmm-btn-sm" id="pmm-sel-all">전체 선택</button>
                <button class="pmm-btn pmm-btn-sm" id="pmm-sel-none">전체 해제</button>
                <button class="pmm-btn pmm-btn-sm" id="pmm-refresh" title="새로고침">↻</button>
            </div>
            <div id="pmm-list" class="pmm-list">
                <div class="pmm-empty">원본 프리셋을 선택해주세요</div>
            </div>
        </div>

        <div class="pmm-step">
            <div class="pmm-step-label">③ 목적지 프리셋</div>
            <select id="pmm-dst-preset" class="pmm-select"></select>
        </div>

        <div class="pmm-step">
            <div class="pmm-step-label">④ 삽입 위치 <span class="pmm-hint-inline">(선택 항목이 이 항목 위에 들어가요)</span></div>
            <select id="pmm-insert-pos" class="pmm-select">
                <option value="__top__">⬆ 맨 위</option>
                <option value="__bottom__" selected>⬇ 맨 아래</option>
            </select>
            <button class="pmm-btn pmm-btn-sm pmm-load-dst-btn" id="pmm-load-dst">목적지 위치 목록 불러오기</button>
        </div>

        <div class="pmm-action-row">
            <button class="pmm-btn pmm-btn-copy" id="pmm-copy-btn">📋 복사</button>
            <button class="pmm-btn pmm-btn-move" id="pmm-move-btn">✂️ 이동</button>
        </div>

        <div id="pmm-status" class="pmm-status"></div>
    </div>
</div>`;

    const target = document.getElementById('extensions_settings')
        || document.querySelector('.extension_settings');
    if (target) {
        target.insertAdjacentHTML('afterbegin', html);
    } else {
        document.body.insertAdjacentHTML('beforeend', html);
        document.getElementById('pmm-container').classList.add('pmm-floating');
    }

    document.getElementById('pmm-header').addEventListener('click', toggleBody);
    document.getElementById('pmm-src-preset').addEventListener('change', onSrcChange);
    document.getElementById('pmm-dst-preset').addEventListener('change', () => {
        // Reset insert positions when destination changes
        document.getElementById('pmm-insert-pos').innerHTML =
            '<option value="__top__">⬆ 맨 위</option><option value="__bottom__" selected>⬇ 맨 아래</option>';
    });
    document.getElementById('pmm-sel-all').addEventListener('click', () =>
        document.querySelectorAll('#pmm-list .pmm-check').forEach(c => c.checked = true));
    document.getElementById('pmm-sel-none').addEventListener('click', () =>
        document.querySelectorAll('#pmm-list .pmm-check').forEach(c => c.checked = false));
    document.getElementById('pmm-refresh').addEventListener('click', refreshAll);
    document.getElementById('pmm-load-dst').addEventListener('click', loadDstPositions);
    document.getElementById('pmm-copy-btn').addEventListener('click', () => execute('copy'));
    document.getElementById('pmm-move-btn').addEventListener('click', () => execute('move'));
}

function toggleBody() {
    const body = document.getElementById('pmm-body');
    const chevron = document.getElementById('pmm-chevron');
    const hidden = body.style.display === 'none';
    body.style.display = hidden ? '' : 'none';
    chevron.textContent = hidden ? '▲' : '▼';
}

// ── ST helpers ────────────────────────────────────────────────────────────────
function findPresetSelect() {
    const candidates = [
        '#settings_preset_openai',
        '#settings_perset_novel',
        '#instruct_presets',
        'select[name="preset_settings_novel"]',
        'select[name="preset_settings"]',
    ];
    for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el && el.options.length > 1) return el;
    }
    return null;
}

function getPresetNames() {
    const el = findPresetSelect();
    if (!el) return [];
    return [...el.options]
        .filter(o => o.value && o.value !== '' && o.value !== 'None')
        .map(o => ({ value: o.value, label: o.text.trim() }));
}

function getActivePresetName() {
    const el = findPresetSelect();
    return el ? el.value : null;
}

function getCurrentPrompts() {
    try {
        const ctx = SillyTavern.getContext();
        if (ctx.oai_settings && Array.isArray(ctx.oai_settings.prompts)) {
            return ctx.oai_settings.prompts;
        }
    } catch (e) {}
    return [];
}

async function switchToPreset(presetName) {
    const el = findPresetSelect();
    if (!el) throw new Error('프리셋 드롭다운을 찾을 수 없습니다');
    el.value = presetName;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 700));
}

function saveSettings() {
    try {
        const ctx = SillyTavern.getContext();
        if (ctx.saveSettingsDebounced) ctx.saveSettingsDebounced();
    } catch (e) {}
}

// ── Render ────────────────────────────────────────────────────────────────────
function refreshAll() {
    const presets = getPresetNames();
    const active = getActivePresetName();

    const opts = '<option value="">-- 프리셋 선택 --</option>'
        + presets.map(p =>
            `<option value="${esc(p.value)}">${esc(p.label)}${p.value === active ? ' ✓' : ''}</option>`
        ).join('');

    document.getElementById('pmm-src-preset').innerHTML = opts;
    document.getElementById('pmm-dst-preset').innerHTML = opts;

    if (active) {
        document.getElementById('pmm-src-preset').value = active;
        onSrcChange();
    }
}

function onSrcChange() {
    const val = document.getElementById('pmm-src-preset').value;
    if (!val) {
        document.getElementById('pmm-list').innerHTML = '<div class="pmm-empty">원본 프리셋을 선택해주세요</div>';
        return;
    }

    const active = getActivePresetName();
    if (val !== active) {
        document.getElementById('pmm-list').innerHTML = `
            <div class="pmm-empty">
                ⚠️ 현재 활성화된 프리셋이 아닙니다.<br>
                이 프리셋의 항목을 보려면 잠깐 전환이 필요해요.<br>
                <button class="pmm-btn pmm-btn-sm pmm-mt" id="pmm-load-src">불러오기</button>
            </div>`;
        document.getElementById('pmm-load-src').addEventListener('click', async () => {
            document.getElementById('pmm-list').innerHTML = '<div class="pmm-empty">불러오는 중...</div>';
            await switchToPreset(val);
            renderSrcList();
        });
    } else {
        renderSrcList();
    }
}

function renderSrcList() {
    const prompts = getCurrentPrompts();
    const listEl = document.getElementById('pmm-list');

    if (!prompts.length) {
        listEl.innerHTML = '<div class="pmm-empty">이 프리셋에 항목이 없습니다</div>';
        return;
    }

    const sorted = [...prompts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    listEl.innerHTML = sorted.map((p, i) => `
        <label class="pmm-item">
            <input type="checkbox" class="pmm-check" data-id="${esc(p.identifier)}">
            <span class="pmm-item-num">${i + 1}</span>
            <span class="pmm-item-name" title="${esc(p.name)}">${esc(p.name)}</span>
            <span class="pmm-badge ${p.enabled === false ? 'pmm-off' : 'pmm-on'}">${p.enabled === false ? 'OFF' : 'ON'}</span>
        </label>
    `).join('');
}

async function loadDstPositions() {
    const dstVal = document.getElementById('pmm-dst-preset').value;
    if (!dstVal) return setStatus('⚠️ 목적지 프리셋을 먼저 선택해주세요', 'warn');

    const active = getActivePresetName();
    if (dstVal !== active) {
        setStatus('목적지 프리셋 전환 중...', '');
        await switchToPreset(dstVal);
    }

    const prompts = getCurrentPrompts();
    const sorted = [...prompts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const pos = document.getElementById('pmm-insert-pos');
    pos.innerHTML = `
        <option value="__top__">⬆ 맨 위</option>
        ${sorted.map(p => `<option value="${esc(p.identifier)}">${esc(p.name)} 위로</option>`).join('')}
        <option value="__bottom__" selected>⬇ 맨 아래</option>
    `;
    setStatus(`✅ 목적지 위치 ${sorted.length}개 로드 완료`, 'success');
}

// ── Execute ───────────────────────────────────────────────────────────────────
async function execute(mode) {
    const srcPreset = document.getElementById('pmm-src-preset').value;
    const dstPreset = document.getElementById('pmm-dst-preset').value;
    const insertPos = document.getElementById('pmm-insert-pos').value;

    if (!srcPreset) return setStatus('⚠️ 원본 프리셋을 선택해주세요', 'warn');
    if (!dstPreset) return setStatus('⚠️ 목적지 프리셋을 선택해주세요', 'warn');
    if (srcPreset === dstPreset && mode === 'move') return setStatus('⚠️ 원본과 목적지가 같으면 이동할 수 없습니다', 'warn');

    const checked = [...document.querySelectorAll('#pmm-list .pmm-check:checked')];
    if (!checked.length) return setStatus('⚠️ 이동할 항목을 선택해주세요', 'warn');

    const selectedIds = new Set(checked.map(c => c.dataset.id));
    setStatus('처리 중...', '');

    try {
        const ctx = SillyTavern.getContext();
        const active = getActivePresetName();

        // 1. Load source prompts
        if (srcPreset !== active) await switchToPreset(srcPreset);
        const srcPrompts = getCurrentPrompts();
        const selectedPrompts = srcPrompts.filter(p => selectedIds.has(p.identifier));
        if (!selectedPrompts.length) return setStatus('❌ 선택 항목을 찾을 수 없습니다', 'error');

        // Clone selected items
        const cloned = selectedPrompts.map(p => ({ ...p }));

        // 2. Move mode: remove from source first
        if (mode === 'move' && srcPreset !== dstPreset) {
            const remaining = srcPrompts
                .filter(p => !selectedIds.has(p.identifier))
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            remaining.forEach((p, i) => { p.order = i; });
            ctx.oai_settings.prompts.splice(0);
            remaining.forEach(p => ctx.oai_settings.prompts.push(p));
            saveSettings();
        }

        // 3. Switch to destination
        await switchToPreset(dstPreset);
        const dstPrompts = getCurrentPrompts();
        const dstSorted = [...dstPrompts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        // 4. Deduplicate identifiers
        const existingIds = new Set(dstPrompts.map(p => p.identifier));
        cloned.forEach(p => {
            if (existingIds.has(p.identifier)) {
                p.identifier = p.identifier + '_' + Date.now();
            }
        });

        // 5. Find insert index
        let insertIdx;
        if (insertPos === '__top__') {
            insertIdx = 0;
        } else if (insertPos === '__bottom__') {
            insertIdx = dstSorted.length;
        } else {
            insertIdx = dstSorted.findIndex(p => p.identifier === insertPos);
            if (insertIdx === -1) insertIdx = dstSorted.length;
        }

        // 6. Build new order and apply
        const newOrder = [
            ...dstSorted.slice(0, insertIdx),
            ...cloned,
            ...dstSorted.slice(insertIdx),
        ];
        newOrder.forEach((p, i) => { p.order = i; });

        ctx.oai_settings.prompts.splice(0);
        newOrder.forEach(p => ctx.oai_settings.prompts.push(p));
        saveSettings();

        // 7. Refresh ST UI
        try {
            const pm = ctx.getPresetManager ? ctx.getPresetManager('openai') : null;
            if (pm && pm.render) pm.render();
        } catch (e) {}

        const label = mode === 'copy' ? '복사' : '이동';
        setStatus(`✅ ${selectedPrompts.length}개 항목 ${label} 완료!`, 'success');

        setTimeout(refreshAll, 500);

    } catch (e) {
        console.error('[Prompt Multi-Mover]', e);
        setStatus('❌ 오류: ' + e.message, 'error');
    }
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function setStatus(msg, type) {
    const el = document.getElementById('pmm-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'pmm-status' + (type ? ` pmm-status-${type}` : '');
    if (type === 'success') setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000);
}

function esc(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

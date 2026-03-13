// Prompt Multi-Mover Extension
// Allows selecting multiple prompt entries and moving them above a target entry

const MODULE_NAME = 'prompt_multi_mover';

(function init() {
    // Wait for ST to be fully loaded
    const checkReady = setInterval(() => {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            clearInterval(checkReady);
            setup();
        }
    }, 300);
})();

function setup() {
    const { eventSource, event_types } = SillyTavern.getContext();

    // Inject settings panel HTML into Extensions sidebar
    injectUI();

    // Re-render when chat or settings change
    eventSource.on(event_types.APP_READY, () => renderPromptList());
    eventSource.on(event_types.CHAT_CHANGED, () => renderPromptList());

    // Also render on load
    renderPromptList();
}

function injectUI() {
    // Check if already injected
    if (document.getElementById('pmm-container')) return;

    const html = `
        <div id="pmm-container" class="pmm-container">
            <div class="pmm-header" id="pmm-toggle-header" title="클릭해서 접기/펼치기">
                <span class="pmm-title">📦 Prompt Multi-Mover</span>
                <span class="pmm-chevron" id="pmm-chevron">▲</span>
            </div>
            <div id="pmm-body" class="pmm-body">
                <div class="pmm-controls">
                    <button id="pmm-refresh" class="pmm-btn pmm-btn-secondary" title="목록 새로고침">↻ 새로고침</button>
                    <button id="pmm-select-all" class="pmm-btn pmm-btn-secondary">전체 선택</button>
                    <button id="pmm-deselect-all" class="pmm-btn pmm-btn-secondary">전체 해제</button>
                </div>

                <div class="pmm-section-label">① 이동할 항목 선택</div>
                <div id="pmm-list" class="pmm-list">
                    <div class="pmm-empty">프롬프트 항목을 불러오는 중...</div>
                </div>

                <div class="pmm-section-label">② 이동할 위치 선택</div>
                <div class="pmm-destination-row">
                    <select id="pmm-destination" class="pmm-select">
                        <option value="">-- 이 항목 위로 이동 --</option>
                    </select>
                </div>

                <div class="pmm-action-row">
                    <button id="pmm-move-btn" class="pmm-btn pmm-btn-primary">▲ 선택 항목 이동</button>
                </div>

                <div id="pmm-status" class="pmm-status"></div>
            </div>
        </div>
    `;

    // Find the extensions settings area to inject into
    const target = document.getElementById('extensions_settings')
        || document.querySelector('.extension_settings')
        || document.querySelector('#options_content');

    if (target) {
        target.insertAdjacentHTML('afterbegin', html);
    } else {
        // Fallback: append to body as floating panel
        document.body.insertAdjacentHTML('beforeend', html);
        document.getElementById('pmm-container').classList.add('pmm-floating');
    }

    // Wire up events
    document.getElementById('pmm-refresh').addEventListener('click', renderPromptList);
    document.getElementById('pmm-select-all').addEventListener('click', selectAll);
    document.getElementById('pmm-deselect-all').addEventListener('click', deselectAll);
    document.getElementById('pmm-move-btn').addEventListener('click', moveSelectedPrompts);
    document.getElementById('pmm-toggle-header').addEventListener('click', toggleBody);
}

// ── Collapse / Expand ──────────────────────────────────────────────────────────
function toggleBody() {
    const body = document.getElementById('pmm-body');
    const chevron = document.getElementById('pmm-chevron');
    const collapsed = body.style.display === 'none';
    body.style.display = collapsed ? '' : 'none';
    chevron.textContent = collapsed ? '▲' : '▼';
}

// ── Read prompts from ST ───────────────────────────────────────────────────────
function getPromptManager() {
    // ST exposes prompt_manager or PromptManager globally
    if (typeof window.PromptManagerModule !== 'undefined') return window.PromptManagerModule;
    if (typeof window.promptManager !== 'undefined') return window.promptManager;

    // Try via getContext
    const ctx = SillyTavern.getContext();
    if (ctx.promptManager) return ctx.promptManager;
    if (ctx.getPromptManager) return ctx.getPromptManager();
    return null;
}

function getPromptList() {
    // Approach 1: via promptManager
    const pm = getPromptManager();
    if (pm && pm.serviceSettings && pm.serviceSettings.prompts) {
        return pm.serviceSettings.prompts;
    }

    // Approach 2: directly from context
    const ctx = SillyTavern.getContext();
    if (ctx.oai_settings && ctx.oai_settings.prompts) {
        return ctx.oai_settings.prompts;
    }

    // Approach 3: read from the live DOM (fallback)
    return readPromptsFromDOM();
}

function readPromptsFromDOM() {
    // Parse the Prompt Manager DOM as a fallback
    const rows = document.querySelectorAll('#prompt_manager_list .prompt_manager_prompt');
    const result = [];
    rows.forEach((row, index) => {
        const nameEl = row.querySelector('.prompt_manager_prompt_name');
        const identifier = row.dataset.pmIdentifier || row.dataset.identifier || `dom_${index}`;
        const name = nameEl ? nameEl.textContent.trim() : `항목 ${index + 1}`;
        const enabled = !row.classList.contains('disabled');
        result.push({ identifier, name, enabled, order: index, _domEl: row });
    });
    return result;
}

// ── Render the prompt list ─────────────────────────────────────────────────────
function renderPromptList() {
    const listEl = document.getElementById('pmm-list');
    const destEl = document.getElementById('pmm-destination');
    if (!listEl || !destEl) return;

    const prompts = getPromptList();

    if (!prompts || prompts.length === 0) {
        listEl.innerHTML = '<div class="pmm-empty">프롬프트 항목이 없습니다.<br>Prompt Manager에서 프리셋을 선택해주세요.</div>';
        destEl.innerHTML = '<option value="">-- 항목 없음 --</option>';
        return;
    }

    // Sort by current order
    const sorted = [...prompts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // Build list
    listEl.innerHTML = sorted.map((p, idx) => `
        <label class="pmm-item ${p.enabled === false ? 'pmm-item-disabled' : ''}">
            <input type="checkbox" class="pmm-check" data-id="${p.identifier}" data-idx="${idx}">
            <span class="pmm-item-order">${idx + 1}</span>
            <span class="pmm-item-name" title="${p.name}">${p.name}</span>
            <span class="pmm-item-badge ${p.enabled === false ? 'pmm-off' : 'pmm-on'}">${p.enabled === false ? 'OFF' : 'ON'}</span>
        </label>
    `).join('');

    // Build destination dropdown
    destEl.innerHTML = '<option value="">-- 맨 아래로 이동 --</option>'
        + sorted.map((p, idx) => `
            <option value="${p.identifier}">[${idx + 1}] ${p.name} 위로</option>
        `).join('');

    setStatus('');
}

// ── Select / Deselect all ──────────────────────────────────────────────────────
function selectAll() {
    document.querySelectorAll('#pmm-list .pmm-check').forEach(cb => cb.checked = true);
}
function deselectAll() {
    document.querySelectorAll('#pmm-list .pmm-check').forEach(cb => cb.checked = false);
}

// ── Move logic ────────────────────────────────────────────────────────────────
function moveSelectedPrompts() {
    const checked = [...document.querySelectorAll('#pmm-list .pmm-check:checked')];
    if (checked.length === 0) {
        setStatus('⚠️ 이동할 항목을 선택해주세요.', 'warn');
        return;
    }

    const destId = document.getElementById('pmm-destination').value;
    const selectedIds = new Set(checked.map(cb => cb.dataset.id));

    const prompts = getPromptList();
    if (!prompts || prompts.length === 0) {
        setStatus('❌ 프롬프트 목록을 불러올 수 없습니다.', 'error');
        return;
    }

    const sorted = [...prompts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // Split into: selected group & remaining
    const selected = sorted.filter(p => selectedIds.has(p.identifier));
    const remaining = sorted.filter(p => !selectedIds.has(p.identifier));

    // Find insert position
    let insertIdx = remaining.length; // default: end
    if (destId) {
        const destPos = remaining.findIndex(p => p.identifier === destId);
        if (destPos !== -1) insertIdx = destPos;
    }

    // Build new order
    const newOrder = [
        ...remaining.slice(0, insertIdx),
        ...selected,
        ...remaining.slice(insertIdx),
    ];

    // Apply new order values
    newOrder.forEach((p, idx) => {
        p.order = idx;
    });

    // Try to persist via promptManager
    const persisted = tryPersistOrder(newOrder);

    if (persisted) {
        setStatus(`✅ ${selected.length}개 항목을 이동했습니다.`, 'success');
    } else {
        // DOM-only fallback
        applyOrderToDOM(newOrder);
        setStatus(`✅ ${selected.length}개 항목을 이동했습니다. (DOM 모드 — 페이지 새로고침 후 유지되지 않을 수 있습니다)`, 'success');
    }

    // Re-render our list to reflect new order
    setTimeout(renderPromptList, 200);
}

function tryPersistOrder(newOrder) {
    try {
        const pm = getPromptManager();
        if (pm && pm.serviceSettings && pm.serviceSettings.prompts) {
            // Update order in the actual prompts array
            const promptsMap = {};
            pm.serviceSettings.prompts.forEach(p => { promptsMap[p.identifier] = p; });
            newOrder.forEach((p, idx) => {
                if (promptsMap[p.identifier]) promptsMap[p.identifier].order = idx;
            });

            // Trigger ST to save & re-render
            if (typeof pm.render === 'function') pm.render();
            if (typeof pm.saveServiceSettings === 'function') pm.saveServiceSettings();

            const ctx = SillyTavern.getContext();
            if (ctx.saveSettingsDebounced) ctx.saveSettingsDebounced();

            return true;
        }

        // Try oai_settings path
        const ctx = SillyTavern.getContext();
        if (ctx.oai_settings && ctx.oai_settings.prompts) {
            const map = {};
            ctx.oai_settings.prompts.forEach(p => { map[p.identifier] = p; });
            newOrder.forEach((p, idx) => {
                if (map[p.identifier]) map[p.identifier].order = idx;
            });
            if (ctx.saveSettingsDebounced) ctx.saveSettingsDebounced();
            // Try to trigger prompt manager re-render via event
            document.dispatchEvent(new CustomEvent('prompt_manager_update'));
            return true;
        }
    } catch (e) {
        console.warn('[Prompt Multi-Mover] persist failed:', e);
    }
    return false;
}

function applyOrderToDOM(newOrder) {
    // Reorder DOM rows in Prompt Manager list
    const container = document.getElementById('prompt_manager_list')
        || document.querySelector('.prompt_manager_list');
    if (!container) return;

    newOrder.forEach(p => {
        const row = container.querySelector(`[data-pm-identifier="${p.identifier}"], [data-identifier="${p.identifier}"]`);
        if (row) container.appendChild(row); // move to end in new order
    });
}

// ── Status helper ─────────────────────────────────────────────────────────────
function setStatus(msg, type = '') {
    const el = document.getElementById('pmm-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'pmm-status' + (type ? ` pmm-status-${type}` : '');

    if (type === 'success') {
        setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000);
    }
}

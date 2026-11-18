export function createAssistantPanel({ getProfile, showMessage }) {
    const byId = id => document.getElementById(`assistant-${id}`);
    const ui = Object.fromEntries(['enable', 'disable', 'status', 'copy', 'instructions'].map(id => [id, byId(id)]));
    let busy = false, state = null;
    const label = provider => ({ gemini: 'Gemini / Nano Banana', openai: 'OpenAI-compatible', openrouter: 'OpenRouter', novelai: 'NovelAI' })[provider] || provider;
    function render() {
        ui.enable.disabled = busy; ui.disable.disabled = busy;
        ui.disable.classList.toggle('hidden', !state?.enabled); ui.copy.classList.toggle('hidden', !state?.enabled);
        ui.instructions.classList.toggle('hidden', !state?.enabled);
        ui.enable.textContent = state?.enabled ? 'Обновить доступ выбранным профилем' : 'Разрешить помощнику использовать этот профиль';
        if (state?.enabled) {
            const profile = state.profile;
            ui.status.textContent = `Разрешён: ${profile.name} · ${label(profile.provider)} · ${profile.model}. ${state.busy ? 'Идёт генерация. ' : ''}Запросов за час: ${state.usedLastHour} из ${state.limitPerHour}.`;
        } else ui.status.textContent = 'Доступ выключен. Ни один профиль не доступен помощнику.';
    }
    async function request(action, body = {}) {
        const response = await fetch(`/api/assistant/${action}`, { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Image-Studio-UI': '1' }, body: JSON.stringify(body) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Не удалось связаться с сервером студии. Перезапусти его после обновления.');
        state = data; render(); return data;
    }
    async function refresh() {
        if (busy) return;
        try { await request('status'); }
        catch { ui.status.textContent = 'Для подключения помощника нужен обновлённый сервер студии. Перезапусти его после обновления.'; }
    }
    ui.enable.addEventListener('click', async () => {
        if (busy) return;
        const profile = getProfile();
        if (!profile.model?.trim()) return showMessage('Сначала укажи модель в выбранном профиле');
        if (!confirm(`Разрешить локальному помощнику генерировать через профиль «${profile.name}» (${profile.model})?\n\nЗапросы могут расходовать баланс этого провайдера. Разрешается только этот профиль, не текст промпта и не референсы из редактора. Ключи будут в памяти сервера до отключения или перезапуска. Не более 20 запросов в час, по одной картинке.`)) return;
        busy = true; render();
        try { await request('enable', { consent: true, profile }); showMessage('Готово. Теперь можно попросить помощника сделать картинку через студию', 'success'); }
        catch (error) { showMessage(error.message); }
        finally { busy = false; render(); }
    });
    ui.disable.addEventListener('click', async () => {
        if (busy) return; busy = true; render();
        try { await request('disable'); showMessage('Доступ помощнику выключен. Удалённая генерация, если уже началась, всё ещё может быть оплачена.'); }
        catch (error) { showMessage(error.message); }
        finally { busy = false; render(); }
    });
    ui.copy.addEventListener('click', async () => {
        if (!state?.enabled) return;
        const command = `node ${JSON.stringify(state.cliPath)}`;
        const text = `Генерируй через запущенную на этом компьютере Local Image Studio, а не встроенный генератор. Сначала проверь доступ: ${command} status. Затем вызови ${command} generate --prompt "описание картинки" --output "путь к результату.png". Документация рядом со скриптом: ../ASSISTANT.md. Не читай и не выводи содержимое приватной папки .assistant-access; скрипт сам использует ключ доступа. Не включай доступ самостоятельно, не меняй профиль и не повторяй платные запросы автоматически.`;
        try { await navigator.clipboard.writeText(text); showMessage('Инструкция скопирована. Её можно отправить помощнику на этом компьютере', 'success'); }
        catch { showMessage('Не удалось скопировать. Инструкция есть в ASSISTANT.md в папке студии.'); }
    });
    window.addEventListener('focus', refresh);
    return { init: refresh };
}

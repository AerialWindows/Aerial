import {api, element, button, section, ask, notify, send, changed} from './shared.js';

function previewVideoLink() {
    const title = element('h2', {id: 'video-link-title'}, 'Add video link');
    const input = element('input', {id: 'video-link-url', type: 'url'});
    const preview = element('div', {className: 'video-link-preview'});
    const status = element('p', {role: 'status', hidden: true});
    const action = element('button', {type: 'submit', disabled: true, className: 'primary'}, 'Preview');
    let verifiedUrl;
    let player;
    let timeout;

    function showStatus(message = '') {
        status.textContent = message;
        status.hidden = !message;
    }

    function resetPreview() {
        clearTimeout(timeout);
        if (player) {
            const previous = player;
            player = null;
            previous.pause();
            previous.removeAttribute('src');
            previous.load();
            preview.replaceChildren();
        }
        verifiedUrl = undefined;
        action.textContent = 'Preview';
        action.disabled = !input.value.trim();
        showStatus();
    }

    function testLink() {
        resetPreview();
        let url;
        try {
            url = new URL(input.value.trim());
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
                throw new Error('Unsupported URL');
            }
        } catch {
            showStatus('Enter a valid HTTP or HTTPS video link.');
            return;
        }

        const video = element('video', {controls: true, muted: true, playsInline: true, 'aria-label': 'Video preview'});
        player = video;
        preview.append(video);
        showStatus('Loading video preview…');
        function failed(message) {
            if (player === video && dialog.open) {
                resetPreview();
                showStatus(message);
            }
        }
        video.addEventListener('error', () => failed('This link could not play as a video. Check the link and try again.'));
        video.requestVideoFrameCallback(() => {
            if (player === video && dialog.open && video.videoWidth > 0 && video.videoHeight > 0) {
                clearTimeout(timeout);
                verifiedUrl = url.href;
                action.textContent = 'Add link';
                showStatus();
            }
        });
        timeout = setTimeout(() => failed('The video preview timed out. Try again.'), 30000);
        video.src = url.href;
        video.play().catch(() => failed('This link could not play as a video. Check the link and try again.'));
    }

    input.addEventListener('input', resetPreview);
    const form = element('form', {noValidate: true, onSubmit: event => {
        event.preventDefault();
        if (verifiedUrl) {
            dialog.close('add');
        } else if (input.value.trim()) {
            testLink();
        }
    }}, title, element('label', {htmlFor: input.id}, 'Video URL'), input, preview, status,
        element('div', {className: 'actions'}, button('Cancel', () => dialog.close()), action));
    const dialog = element('dialog', {'aria-labelledby': title.id}, form);
    document.body.append(dialog);
    return new Promise(resolve => {
        dialog.addEventListener('close', () => {
            const url = dialog.returnValue === 'add' ? verifiedUrl : undefined;
            resetPreview();
            dialog.remove();
            resolve(url);
        }, {once: true});
        dialog.showModal();
        input.focus();
    });
}

export function initCustomVideos(root) {
    const list = element('div', {className: 'card'});
    root.append(element('div', {className: 'actions'},
        button('Add video', () => send('selectCustomVideos')),
        button('Add folder', () => send('selectCustomLocation')),
        button('Add link', async () => {
            const url = await previewVideoLink();
            if (url) {
                const {pathname, hostname} = new URL(url);
                const name = pathname.split('/').pop() || hostname;
                addVideos([{url, name}]);
            }
        })),
        element('br'), section('Your videos', list));

    function render() {
        const videos = api.store.get('customVideos') || [];
        const allowed = new Set(api.store.get('allowedVideos') || []);
        list.replaceChildren();
        if (!videos.length) {
            list.append(element('div', {className: 'empty-state'}, 'No custom videos yet.'));
        }
        for (const video of videos) {
            const check = element('input', {type: 'checkbox', checked: allowed.has(video.id), 'aria-label': `Include ${video.name}`});
            check.addEventListener('change', () => {
                const next = new Set(api.store.get('allowedVideos') || []);
                if (check.checked) {
                    next.add(video.id);
                } else {
                    next.delete(video.id);
                }
                api.store.set('allowedVideos', [...next]);
                changed(['allowedVideos']);
            });
            const name = element('input', {type: 'text', value: video.name, 'aria-label': 'Video name'});
            name.addEventListener('change', () => {
                const saved = api.store.get('customVideos') || [];
                const item = saved.find(item => item.id === video.id);
                if (item && name.value.trim()) {
                    item.name = name.value.trim();
                    api.store.set('customVideos', saved);
                } else {
                    name.value = video.name;
                }
            });
            const remove = button('Remove', async () => {
                const message = `Remove “${video.name}” from Aerial?` + (video.path ? ' The file on your computer will be kept.' : '');
                if (await ask('Remove custom video?', message, {confirm: 'Remove', danger: true})) {
                    api.store.set({customVideos: (api.store.get('customVideos') || []).filter(item => item.id !== video.id), allowedVideos: (api.store.get('allowedVideos') || []).filter(id => id !== video.id)});
                    changed(['customVideos', 'allowedVideos']);
                    render();
                }
            }, 'danger');
            list.append(element('div', {className: 'custom-video-row'}, check,
                element('div', {className: 'custom-name'}, name, element('span', {className: 'custom-path help'}, video.path || video.url)), remove));
        }
    }

    function addVideos(entries) {
        const videos = api.store.get('customVideos') || [];
        const allowed = new Set(api.store.get('allowedVideos') || []);
        for (const entry of entries) {
            let video = videos.find(video => entry.path
                ? video.path?.toLowerCase() === entry.path.toLowerCase() : video.url === entry.url);
            if (!video) {
                video = {...entry, id: `_${crypto.randomUUID()}`, accessibilityLabel: 'Custom Video'};
                videos.push(video);
            }
            allowed.add(video.id);
        }
        api.store.set({customVideos: videos, allowedVideos: [...allowed]});
        changed(['customVideos', 'allowedVideos']);
        render();
        notify(`Added ${entries.length} video${entries.length === 1 ? '' : 's'}.`);
    }

    api.ipcRenderer.on('newCustomVideos', (files, directory) => {
        addVideos(files.map(file => ({
            path: directory ? `${directory}\\${file}` : file,
            name: directory ? file : file.split(/[\\/]/).pop()
        })));
    });
    render();
    return {render};
}

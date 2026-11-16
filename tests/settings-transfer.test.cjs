const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {createPersistentSettings} = require('../src/settings-persistence');
const {exportSettings, importSettings} = require('../src/settings-transfer');

test('settings backup makes a disk round trip and preserves machine-local state', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aerial-settings-'));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    const backup = path.join(directory, 'aerial-settings.json');
    const window = {isDestroyed: () => false};
    const original = createPersistentSettings(path.join(directory, 'original.json'));
    const destinationPath = path.join(directory, 'destination.json');
    const destination = createPersistentSettings(destinationPath);
    const preferences = {
        startAfter: '12', allowH265: false, latitude: '39.7',
        allowedVideos: ['_custom'], customVideos: [{id: '_custom', url: 'movie.mp4'}],
        videoProfiles: [{name: 'Favorites', videos: ['_custom']}],
        videoPlaybackSpeeds: {_custom: 1.5}, overlayNames: {clock: 'Clock'},
        textStyle: {bold: true}
    };
    const local = {cachePath: directory, downloadedVideos: ['cached'], videoCacheSize: 10, version: '2.0.2'};
    original.set({...preferences, cachePath: 'old-cache', downloadedVideos: ['old'], version: '1.0.0'});
    destination.set({...local, startAfter: 20});
    const dialog = {
        async showSaveDialog(parent, options) {
            assert.equal(parent, window);
            assert.equal(options.defaultPath, 'aerial-settings.json');
            return {filePath: backup};
        },
        async showOpenDialog(parent) {
            assert.equal(parent, window);
            return {filePaths: [backup]};
        }
    };

    assert.equal(await exportSettings(dialog, window, original), true);
    assert.deepEqual(JSON.parse(await fs.readFile(backup, 'utf8')), preferences);
    assert.equal(await importSettings(dialog, window, destination), true);
    assert.equal(await destination.flush(), true);
    assert.deepEqual(createPersistentSettings(destinationPath).store, {...local, ...preferences});
    await original.flush();

    await fs.writeFile(backup, '{"startAfter":5,"allowedVideos":{}}');
    await assert.rejects(importSettings(dialog, window, destination), /Invalid value for allowedVideos/);
    await fs.writeFile(backup, '{broken');
    await assert.rejects(importSettings(dialog, window, destination), SyntaxError);
    const cancel = async () => ({canceled: true});
    assert.equal(await importSettings({showOpenDialog: cancel}, window, destination), false);
    assert.equal(await exportSettings({showSaveDialog: cancel}, window, original), false);
    assert.deepEqual(destination.store, {...local, ...preferences});
});

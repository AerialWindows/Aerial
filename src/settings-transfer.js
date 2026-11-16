const fs = require('node:fs/promises');
const definition = require('../web/config/settings.json');

const types = new Map(definition.flatMap(group => group.entries)
    .filter(entry => entry.key && !['display', 'directory'].includes(entry.type))
    .map(entry => [entry.key, entry.key === 'videoFilters' ? 'array'
        : ['number', 'slider'].includes(entry.type) ? 'numeric' : entry.valueType]));

for (const key of ['allowedVideos', 'alwaysDownloadVideos', 'neverDownloadVideos', 'videoProfiles']) {
    types.set(key, 'array');
}
for (const key of ['videoPlaybackSpeeds', 'displayText', 'overlayNames', 'textStyle']) {
    types.set(key, 'object');
}
for (const key of ['textFont', 'textSizeUnit', 'textColor']) {
    types.set(key, 'string');
}
for (const key of ['textSize', 'randomSpeed']) {
    types.set(key, 'numeric');
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const filters = [{name: 'JSON files', extensions: ['json']}];

function portableSettings(snapshot) {
    return Object.fromEntries(Object.entries(snapshot).filter(([key]) => types.has(key)));
}

function validValue(key, value) {
    if (key === 'displayText') {
        const positions = ['topleft', 'topright', 'bottomleft', 'bottomright', 'left', 'right',
            'middle', 'topmiddle', 'bottommiddle', 'random'];
        return isObject(value) && Array.isArray(value.positionList)
            && value.positionList.every(position => positions.includes(position))
            && positions.every(position => Array.isArray(value[position]) && value[position].every(isObject));
    }
    switch (types.get(key)) {
        case 'numeric':
            return Number.isFinite(value) || (typeof value === 'string' && Number.isFinite(Number(value)));
        case 'array':
            return Array.isArray(value) && value.every(
                ['customVideos', 'videoProfiles', 'videoFilters'].includes(key)
                    ? isObject : item => typeof item === 'string');
        case 'object':
            return isObject(value);
        default:
            return typeof value === types.get(key);
    }
}

async function exportSettings(dialog, window, store) {
    const {canceled, filePath} = await dialog.showSaveDialog(window, {
        title: 'Export Aerial settings',
        defaultPath: 'aerial-settings.json',
        filters
    });
    if (canceled) {
        return false;
    }
    await fs.writeFile(filePath, JSON.stringify(portableSettings(store.store), null, 2) + '\n', 'utf8');
    return true;
}

async function importSettings(dialog, window, store) {
    const {canceled, filePaths} = await dialog.showOpenDialog(window, {
        title: 'Import Aerial settings',
        properties: ['openFile'],
        filters
    });
    if (canceled || window.isDestroyed()) {
        return false;
    }
    const file = JSON.parse((await fs.readFile(filePaths[0], 'utf8')).replace(/^\uFEFF/, ''));
    if (!isObject(file)) {
        throw new Error('The file must contain a JSON settings object.');
    }
    const settings = portableSettings(file);
    if (!Object.keys(settings).length) {
        throw new Error('The file contains no recognized Aerial settings.');
    }
    for (const [key, value] of Object.entries(settings)) {
        if (!validValue(key, value)) {
            throw new Error(`Invalid value for ${key}.`);
        }
    }
    if (window.isDestroyed()) {
        return false;
    }
    store.set(settings);
    return true;
}

module.exports = {exportSettings, importSettings};

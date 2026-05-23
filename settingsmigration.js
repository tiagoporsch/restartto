import { getBootEntries } from './efi.js';
const DEBUG = false;

export async function migrateSettings(settings) {
    if (DEBUG) console.log('[RestartTo-SettingsMigration] Checking if settings migration is needed...');

    if (!settings.settings_schema.has_key('blacklist')) {
        console.warn('[RestartTo-SettingsMigration] WARNING: blacklist key missing from schema! Migration aborted.');
        return;
    }

    const blacklist = settings.get_strv('blacklist');
    if (blacklist.length === 0) {
        if (DEBUG) console.log('[RestartTo-SettingsMigration] Blacklist is empty. No migration needed.');
        return;
    }

    if (DEBUG) console.log(`[RestartTo-SettingsMigration] Found old blacklist: ${JSON.stringify(blacklist)}`);
    const hiddenEntries = settings.get_strv('hidden-entries');
    if (hiddenEntries.length !== 0) {
        if (DEBUG) console.log('[RestartTo-SettingsMigration] hidden-entries already populated. Skipping migration.');
        return;
    }

    if (DEBUG) console.log('[RestartTo-SettingsMigration] Translating old names to EFI IDs...');
    const bootEntries = await getBootEntries();

    // Build a name → array of IDs lookup table
    const nameToIds = new Map();
    for (const [id, name] of bootEntries.entries()) {
        const trimmed = name.trim();
        if (nameToIds.has(trimmed)) {
            nameToIds.get(trimmed).push(id);
        } else {
            nameToIds.set(trimmed, [id]);
        }
    }

    // Log any duplicate names found
    for (const [name, ids] of nameToIds.entries()) {
        if (ids.length > 1) {
            console.log(`[RestartTo-SettingsMigration] ⚠️  Duplicate name detected: "${name}" has ${ids.length} entries: ${JSON.stringify(ids)}`);
        }
    }

    const translatedEntries = [];
    for (const oldName of blacklist) {
        if (oldName === 'UEFI') {
            translatedEntries.push('UEFI');
            continue;
        }

        const trimmed = oldName.trim();
        const ids = nameToIds.get(trimmed);

        if (ids) {
            if (DEBUG) console.log(`[RestartTo-SettingsMigration] Mapped "${oldName}" -> ${JSON.stringify(ids)}`);
            translatedEntries.push(...ids);
        } else {
            if (DEBUG) console.log(`[RestartTo-SettingsMigration] Could not map "${oldName}" (Not found in EFI). Keeping as string.`);
            translatedEntries.push(trimmed);
        }
    }

    // Eventually Deduplicate
    const uniqueTranslated = [...new Set(translatedEntries)];
    settings.set_strv('hidden-entries', uniqueTranslated);
    if (DEBUG) console.log(`[RestartTo-SettingsMigration] Migration successful! New hidden-entries: ${JSON.stringify(uniqueTranslated)}`);

    // And clear old blacklist
    settings.set_strv('blacklist', []);
}

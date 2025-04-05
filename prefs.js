import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {getBootEntries} from './efi.js';

export default class RestartToPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
      // Create a preferences page, with a single group
      const page = new Adw.PreferencesPage({
          title: _('General'),
          icon_name: 'system-restart-symbolic',
      });
      window.add(page);

      const group = new Adw.PreferencesGroup({
          title: _('Blacklist'),
          description: _('Hide boot entries'),
      });
      page.add(group);

      // Settings binding
      const settings = this.getSettings();
      window._settings = settings;

      // Available and blacklisted entries
      const entries = Array.from((await getBootEntries()).values());
      const blacklist = settings.get_strv('blacklist');

      // Create one settings row for each entry
      for (const entry of entries) {
          const row = new Adw.SwitchRow({
              title: entry,
              active: blacklist.includes(entry),
          });
          row.connect('notify::active', () => {
              const updated = new Set(settings.get_strv('blacklist'));
              if (row.active) {
                updated.add(entry);
              } else {
                updated.delete(entry);
              }
              settings.set_strv('blacklist', Array.from(updated));
          });
          group.add(row);
      }
    }
}

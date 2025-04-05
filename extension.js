import * as GnomeSession from "resource:///org/gnome/shell/misc/gnomeSession.js";
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {Extension, gettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {getBootEntries} from './efi.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');
Gio._promisify(Gio.Subprocess.prototype, 'wait_async');

export default class RestartTo extends Extension {
    async restartTo(id) {
        const proc = Gio.Subprocess.new(
            ['/usr/bin/env', 'pkexec', 'efibootmgr', '--bootnext', id],
            Gio.SubprocessFlags.NONE
        );
        await proc.wait_async(null);
        if (!proc.get_successful()) {
            throw new Error('Failed to set BootNext');
        }

        try {
            await new GnomeSession.SessionManager().RebootAsync();
        } catch (e) {
            console.warn(e);
            const proc = Gio.Subprocess.new(
                ['/usr/bin/env', 'pkexec', 'efibootmgr', '--delete-bootnext'],
                Gio.SubprocessFlags.NONE
            );
            await proc.wait_async(null);
        }
    }

    updateMenuEntries() {
        if (this.menuItem == null)
            return;
        const blacklist = this.settings.get_strv('blacklist');
        this.menuItem.menu.removeAll();
        getBootEntries().then((bootEntries) => {
            for (const [id, name] of bootEntries.entries()) {
                if (!blacklist.includes(name)) {
                    this.menuItem.menu.addAction(name, () => {
                        this.restartTo(id);
                    });
                }
            }
        });
    }

    addMenuItem() {
        this.menuItem = new PopupMenu.PopupSubMenuMenuItem(gettext('Restart To...'), false);
        this.updateMenuEntries();
        Main.panel.statusArea.quickSettings._system?.quickSettingsItems[0].menu.addMenuItem(this.menuItem, 2);
    }

    enable() {
        if (!Main.panel.statusArea.quickSettings._system) {
            this.sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (!Main.panel.statusArea.quickSettings._system)
                    return GLib.SOURCE_CONTINUE;
                this.addMenuItem();
                return GLib.SOURCE_REMOVE;
            });
        } else {
            this.addMenuItem();
        }

        this.settings = this.getSettings('org.gnome.shell.extensions.restartto');
        this.settings.connect('changed::blacklist', (settings, key) => {
            this.updateMenuEntries()
        });
    }

    disable() {
        this.menuItem.destroy();
        this.menuItem = null;
        if (this.sourceId) {
            GLib.Source.remove(this.sourceId);
            this.sourceId = null;
        }
    }
}

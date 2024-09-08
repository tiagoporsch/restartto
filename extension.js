import * as GnomeSession from "resource:///org/gnome/shell/misc/gnomeSession.js";
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');
Gio._promisify(Gio.Subprocess.prototype, 'wait_async');

export default class RestartTo extends Extension {
    async getBootEntries() {
        const proc = Gio.Subprocess.new(
            ['efibootmgr'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        const [stdout, stderr] = await proc.communicate_utf8_async(null, null);
        if (!proc.get_successful()) {
            throw new Error("Failed to get boot entries");
        }
        return new Map([...stdout.matchAll(/Boot([0-9]{4})\* ([^\t]*)/g)].map(m => [m[1], m[2]])).entries();
    }

    async restartTo(id) {
        const proc = Gio.Subprocess.new(
            ['/usr/bin/pkexec', 'efibootmgr', '--bootnext', id],
            Gio.SubprocessFlags.NONE
        );
        await proc.wait_async(null);
        if (!proc.get_successful()) {
            throw new Error("Failed to set BootNext");
        }

        try {
            await new GnomeSession.SessionManager().RebootAsync();
        } catch (e) {
            console.warn(e);
            const proc = Gio.Subprocess.new(
                ['/usr/bin/pkexec', 'efibootmgr', '--delete-bootnext'],
                Gio.SubprocessFlags.NONE
            );
            await proc.wait_async(null);
        }
    }

    addMenuItem() {
        this.menuItem = new PopupMenu.PopupSubMenuMenuItem('Restart To...', false);
        this.getBootEntries().then((bootEntries) => {
            for (const [id, name] of bootEntries) {
                this.menuItem.menu.addAction(name, () => {
                    this.restartTo(id);
                });
            }
        });
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

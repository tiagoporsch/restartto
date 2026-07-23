import * as GnomeSession from "resource:///org/gnome/shell/misc/gnomeSession.js";
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {getBootEntries} from './efi.js';
import {migrateSettings} from './settingsmigration.js';

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
        const hiddenEntries = this.settings.get_strv('hidden-entries');
        const savedOrder = this.settings.get_strv('order');
        
        let customNames = {};
        try {
            customNames = JSON.parse(this.settings.get_string('custom-names') || '{}');
        } catch (e) {
            customNames = {};
        }

        this.menuItem.menu.removeAll();

        getBootEntries().then((bootEntries) => {
            // Compile unified structural array
            const items = [{ id: 'UEFI', defaultName: 'UEFI' }];
            for (const [id, name] of bootEntries.entries()) {
                items.push({ id: id, defaultName: name });
            }

            // Sort array matching preferences layout order configuration
            items.sort((a, b) => {
                let idxA = savedOrder.indexOf(a.id);
                let idxB = savedOrder.indexOf(b.id);
                if (idxA === -1) idxA = 999;
                if (idxB === -1) idxB = 999;
                return idxA - idxB;
            });

            // Build menu list matching custom arrangement specifications
            for (const item of items) {
                if (hiddenEntries.includes(item.id)) continue;

                const displayName = customNames[item.id] || item.defaultName;

                if (item.id === 'UEFI') {
                    this.menuItem.menu.addAction(displayName, async () => {
                        this.proxy.SetRebootToFirmwareSetupRemote(true);
                        try {
                            await new GnomeSession.SessionManager().RebootAsync();
                        } catch (e) {
                            console.warn(e);
                            this.proxy?.SetRebootToFirmwareSetupRemote(false);
                        }
                    });
                } else {
                    this.menuItem.menu.addAction(displayName, () => {
                        this.restartTo(item.id);
                    });
                }
            }
        });
    }

    addMenuItem() {
        this.menuItem = new PopupMenu.PopupSubMenuMenuItem(_('Restart To...'), false);
        this.updateMenuEntries();
        Main.panel.statusArea.quickSettings._system?.quickSettingsItems[0].menu.addMenuItem(this.menuItem, 2);
    }

    enable() {
        this.settings = this.getSettings();
        
        // Run settings Migration (background task)
        migrateSettings(this.settings).catch(console.error);

        this.proxy = Gio.DBusProxy.makeProxyWrapper(`<node>
          <interface name="org.freedesktop.login1.Manager">
            <method name="SetRebootToFirmwareSetup">
              <arg type="b" direction="in"/>
            </method>
          </interface>
        </node>`)(
            Gio.DBus.system,
            'org.freedesktop.login1',
            '/org/freedesktop/login1',
        );

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

        this._hiddenSignal = this.settings.connect('changed::hidden-entries', () => this.updateMenuEntries());
        this._customSignal = this.settings.connect('changed::custom-names', () => this.updateMenuEntries());
        this._orderSignal = this.settings.connect('changed::order', () => this.updateMenuEntries());
    }

    disable() {
        if (this.settings) {
            this.settings.disconnect(this._hiddenSignal);
            this.settings.disconnect(this._customSignal);
            this.settings.disconnect(this._orderSignal);
            this.settings = null;
        }
        this.proxy = null;
        this.menuItem.destroy();
        this.menuItem = null;
        if (this.sourceId) {
            GLib.Source.remove(this.sourceId);
            this.sourceId = null;
        }
    }
}

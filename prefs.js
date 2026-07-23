import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {getBootEntries} from './efi.js';
import {migrateSettings} from './settingsmigration.js'

export default class RestartToPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage({
          title: _('General'),
          icon_name: 'system-restart-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: _('Select Boot Entries to display'),
            description: _('Toggle to Show/Hide. Drag to reorder. Click names to rename.'),
        });

        const helpBtn = new Gtk.Button({
            icon_name: 'help-about',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Keyboard Shortcuts')
        });
        helpBtn.add_css_class('flat');

        group.set_header_suffix(helpBtn);

        helpBtn.connect('clicked', () => {
            const dialog = new Adw.MessageDialog({
                heading: _('Keyboard Shortcuts'),
                body: _(
                    '<b>J / K</b> : Move selected row down / up\n' +
                    '<b>Space / Enter</b> : Toggle visibility\n' +
                    '<b>R / E / F2</b> : Rename entry\n' +
                    '<b>Esc</b> : Cancel editing'
                ),
                body_use_markup: true,
            });
            
            // Add a simple close button to the dialog
            dialog.add_response('close', _('Understood'));
            dialog.set_default_response('close');
            dialog.set_close_response('close');
            
            // Present the dialog over the main preferences window
            dialog.present();
        });
        page.add(group);

        const settings = this.getSettings();
        window._settings = settings;

        // Run settings Migration
        await migrateSettings(settings);

        // Custom CSS
        const provider = new Gtk.CssProvider();
        provider.load_from_data(`
            .dim-row, .dim-row:hover, .dim-row:focus {opacity: 0.40;}
            .dim-row .suggested-action {opacity: 0.40;}
            .dim-row .flat {opacity: 0.40;}

            row:focus-visible {
                background-color: @accent_bg_color;
                color: @accent_fg_color;
            }
            row:focus-visible .dim-label {
                color: alpha(@accent_fg_color, 0.7);
            }
        `, -1);
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );

        this._draggedEntryId = null;

        const listBox = new Gtk.ListBox();
        listBox.add_css_class('boxed-list');
        listBox.set_selection_mode(Gtk.SelectionMode.NONE);
        listBox.set_activate_on_single_click(false);
        group.add(listBox);
        listBox.set_focusable(true);

        const bootEntries = await getBootEntries();
        const hiddenEntries = settings.get_strv('hidden-entries');
        const savedOrder = settings.get_strv('order');

        let customNames = {};
        try {
            customNames = JSON.parse(settings.get_string('custom-names') || '{}');
        } catch (e) {
            customNames = {};
        }

        const items = [{ id: 'UEFI', defaultName: 'UEFI' }];
        for (const [id, name] of bootEntries.entries()) {
            items.push({ id: id, defaultName: name });
        }

        // Sort items initially based on saved order
        items.sort((a, b) => {
            let idxA = savedOrder.indexOf(a.id);
            let idxB = savedOrder.indexOf(b.id);
            if (idxA === -1) idxA = 999;
            if (idxB === -1) idxB = 999;
            return idxA - idxB;
        });

        let currentOrder = items.map(item => item.id);

        listBox.set_sort_func((rowA, rowB) => {
            if (!rowA._entryId || !rowB._entryId) return 0;
            const idxA = currentOrder.indexOf(rowA._entryId);
            const idxB = currentOrder.indexOf(rowB._entryId);
            return idxA - idxB;
        });

        for (const item of items) {
            const entryId = item.id;
            const defaultName = item.defaultName;
            const hasCustomName = !!customNames[entryId];
            const displayName = hasCustomName ? customNames[entryId] : defaultName;
            const isHidden = hiddenEntries.includes(entryId);

            const row = new Adw.PreferencesRow();
            row._entryId = entryId;
            row._isEditing = false;
            row.set_selectable(false);
            row.set_activatable(false);
            row.set_focusable(true);
            row.set_focus_on_click(false);
            
            if (isHidden) {
                row.add_css_class('dim-row');
            }

            const mainBox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 12,
                margin_start: 16,
                margin_end: 16,
                margin_top: 4,
                margin_bottom: 4,
                valign: Gtk.Align.CENTER
            });
            mainBox.set_size_request(-1, 46);
            row.set_child(mainBox);

            // Drag Handle Icon
            const handleImg = new Gtk.Image({
                icon_name: 'list-drag-handle-symbolic',
                valign: Gtk.Align.CENTER
            });
            handleImg.set_focusable(false);
            handleImg.add_css_class('dim-label');
            mainBox.append(handleImg);

            // Title container
            const titleContainer = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 6,
                valign: Gtk.Align.CENTER,
                hexpand: true
            });
            mainBox.append(titleContainer);

            // Text Display Mode
            const titleBox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 6,
                valign: Gtk.Align.CENTER,
                tooltip_text: _("Click to rename")
            });
            
            const label = new Gtk.Label({
                label: displayName,
                xalign: 0,
                valign: Gtk.Align.CENTER
            });
            titleBox.append(label);
            label.set_focusable(false);

            const pencilImg = new Gtk.Image({
                icon_name: 'document-edit-symbolic',
                visible: hasCustomName,
                valign: Gtk.Align.CENTER
            });
            pencilImg.add_css_class('dim-label');
            titleBox.append(pencilImg);
            titleContainer.append(titleBox);
            pencilImg.set_focusable(false);

            // Text Input/Edit Mode
            const editEntry = new Gtk.Entry({
                text: displayName,
                visible: false,
                hexpand: true,
                valign: Gtk.Align.CENTER
            });

            const saveBtn = new Gtk.Button({
                icon_name: 'object-select-symbolic',
                visible: false,
                valign: Gtk.Align.CENTER,
                tooltip_text: _('Save')
            });
            saveBtn.add_css_class('suggested-action');

            const cancelBtn = new Gtk.Button({
                icon_name: 'window-close-symbolic',
                visible: false,
                valign: Gtk.Align.CENTER,
                tooltip_text: _('Cancel')
            });
            cancelBtn.add_css_class('destructive-action');

            titleContainer.append(editEntry);
            titleContainer.append(saveBtn);
            titleContainer.append(cancelBtn);

            // Suffix Controls
            const resetBtn = new Gtk.Button({
                icon_name: 'view-refresh-symbolic',
                visible: hasCustomName,
                valign: Gtk.Align.CENTER,
                tooltip_text: _("Revert to original name")
            });
            resetBtn.add_css_class('flat');
            resetBtn.set_focusable(false);

            const switchWidget = new Gtk.Switch({
                active: !isHidden,
                valign: Gtk.Align.CENTER
            });
            row._switchWidget = switchWidget;
            switchWidget.set_focusable(false);
            
            mainBox.append(resetBtn);
            mainBox.append(switchWidget);

            // DRAG CONTROLLER
            const dragSource = new Gtk.DragSource({ actions: Gdk.DragAction.MOVE });
            dragSource.connect('prepare', (source, x, y) => {
                return Gdk.ContentProvider.new_for_value(entryId);
            });
            
            dragSource.connect('drag-begin', (source, drag) => {
                this._draggedEntryId = entryId;

                // Snap full graphical picture layout to display under cursor
                const paintable = Gtk.WidgetPaintable.new(row);
                Gtk.DragIcon.set_from_paintable(drag, paintable, 0, 0);
            });

            dragSource.connect('drag-end', () => {
                this._draggedEntryId = null;
                settings.set_strv('order', currentOrder);
            });
            row.add_controller(dragSource);

            // DROP CONTROLLER
            const dropTarget = Gtk.DropTarget.new(GObject.TYPE_STRING, Gdk.DragAction.MOVE);
            dropTarget.connect('enter', (target, x, y) => {
                const draggedId = this._draggedEntryId;
                if (!draggedId || draggedId === entryId) return Gdk.DragAction.NONE;

                const draggedIdx = currentOrder.indexOf(draggedId);
                const targetIdx = currentOrder.indexOf(entryId);

                if (draggedIdx !== -1 && targetIdx !== -1) {
                    currentOrder.splice(draggedIdx, 1);
                    currentOrder.splice(targetIdx, 0, draggedId);
                    
                    listBox.invalidate_sort();
                }
                return Gdk.DragAction.MOVE;
            });

            dropTarget.connect('drop', () => {
                return true;
            });
            row.add_controller(dropTarget);

            // Rename actions
            const clickGesture = new Gtk.GestureClick();
            clickGesture.connect('released', () => {
                row._startRename();
            });
            titleBox.add_controller(clickGesture);

            row._startRename = () => {
                row._isEditing = true;
                titleBox.set_visible(false);
                editEntry.set_text(label.get_text());
                editEntry.set_visible(true);
                saveBtn.set_visible(true);
                cancelBtn.set_visible(true);
                editEntry.grab_focus();
            };

            const saveChanges = () => {
                const newName = editEntry.get_text().trim();
                let currentCustomNames = {};
                try {
                    currentCustomNames = JSON.parse(settings.get_string('custom-names') || '{}');
                } catch (e) {}

                if (newName && newName !== defaultName) {
                    currentCustomNames[entryId] = newName;
                    label.set_text(newName);
                    pencilImg.set_visible(true);
                    resetBtn.set_visible(true);
                } else {
                    delete currentCustomNames[entryId];
                    label.set_text(defaultName);
                    pencilImg.set_visible(false);
                    resetBtn.set_visible(false);
                }

                settings.set_string('custom-names', JSON.stringify(currentCustomNames));
                exitEditMode();
            };

            const cancelEdit = () => {
                editEntry.set_text(label.get_text());
                exitEditMode();
            };

            const exitEditMode = () => {
                row._isEditing = false;
                editEntry.set_visible(false);
                saveBtn.set_visible(false);
                cancelBtn.set_visible(false);
                titleBox.set_visible(true);
                row.grab_focus();
            };

            saveBtn.connect('clicked', saveChanges);
            cancelBtn.connect('clicked', cancelEdit);
            editEntry.connect('activate', saveChanges);

            // Escape key → cancel
            const keyController = new Gtk.EventControllerKey();
            keyController.connect('key-pressed', (ctrl, keyval) => {
                if (keyval === Gdk.KEY_Escape) {
                    cancelEdit();
                    return true;
                }
                return false;
            });
            editEntry.add_controller(keyController);

            // Click-away / focus lost cancels
            const focusController = new Gtk.EventControllerFocus();
            focusController.connect('leave', () => {
                if (editEntry.get_visible()) {
                    cancelEdit();
                }
            });
            editEntry.add_controller(focusController);

            // Action: Revert Name Reset Button
            resetBtn.connect('clicked', () => {
                let currentCustomNames = {};
                try {
                    currentCustomNames = JSON.parse(settings.get_string('custom-names') || '{}');
                } catch (e) {}

                delete currentCustomNames[entryId];
                settings.set_string('custom-names', JSON.stringify(currentCustomNames));

                label.set_text(defaultName);
                editEntry.set_text(defaultName);
                pencilImg.set_visible(false);
                resetBtn.set_visible(false);
            });

            // Toggle Visibility
            switchWidget.connect('notify::active', () => {
                const updated = new Set(settings.get_strv('hidden-entries'));
                if (switchWidget.active) {
                    updated.delete(entryId);
                    row.remove_css_class('dim-row');
                } else {
                    updated.add(entryId);
                    row.add_css_class('dim-row');
                }
                settings.set_strv('hidden-entries', Array.from(updated));
            });

            listBox.append(row);
        }
        
        const _moveRow = (focused, direction) => {
            const entryId = focused._entryId;
            const idx = currentOrder.indexOf(entryId);
            const newIdx = idx + direction;

            if (newIdx >= 0 && newIdx < currentOrder.length) {
                const temp = currentOrder[idx];
                currentOrder[idx] = currentOrder[newIdx];
                currentOrder[newIdx] = temp;
                
                listBox.invalidate_sort();
                
                settings.set_strv('order', currentOrder);

                focused.grab_focus();
            }
        };
        
        const keyController = new Gtk.EventControllerKey();
        keyController.connect('key-pressed', (ctrl, keyval) => {
            const focused = listBox.get_focus_child();

            if (!focused || !focused._entryId) return false;
            
            if (focused._isEditing) return false;

            if (keyval === Gdk.KEY_r || keyval === Gdk.KEY_e || keyval === Gdk.KEY_F2) {
                focused._startRename();
                return true;
            }

            if (keyval === Gdk.KEY_space || keyval === Gdk.KEY_Return) {
                focused._switchWidget.set_active(!focused._switchWidget.get_active());
                return true;
            }

            if (keyval === Gdk.KEY_j) {  // Down
                _moveRow(focused, 1);
                return true;
            }
            if (keyval === Gdk.KEY_k) {  // Up
                _moveRow(focused, -1);
                return true;
            }

            return false;
        });

        listBox.add_controller(keyController);
    }
}

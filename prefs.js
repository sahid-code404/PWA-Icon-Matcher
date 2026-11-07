/**
 * PWA Icon Matcher - Preferences Interface (GTK4 + Libadwaita)
 *
 * Symmetrical, polished, pixel-perfect Libadwaita preferences:
 * - Perfectly aligned boxed-list groups across all pages
 * - Uniform prefix icon sizing and alignment
 * - Grouped button bars for launcher management
 * - Pure event-driven, zero idle RAM/CPU footprint
 */

import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { logger } from './lib/logger.js';
import { IconResolver } from './lib/icon-resolver.js';
import { StateManager } from './lib/state-manager.js';
import { FileWriter } from './lib/file-writer.js';
import { PwaDetector } from './lib/pwa-detector.js';
import { IconMatcher } from './lib/icon-matcher.js';
import { parseDesktopEntry } from './lib/desktop-entry.js';

export default class PwaIconMatcherPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        const resolver = new IconResolver(iconTheme, settings);
        const stateManager = new StateManager();
        stateManager.load();

        const fileWriter = new FileWriter();
        const detector = new PwaDetector(settings);
        const matcher = new IconMatcher({
            settings,
            detector,
            resolver,
            stateManager,
            fileWriter
        });

        // Symmetrical window geometry
        window.set_default_size(660, 800);
        window.set_search_enabled(true);

        // Standardized prefix icon generator
        const makePrefixIcon = (iconName) => new Gtk.Image({
            icon_name: iconName,
            pixel_size: 20,
            valign: Gtk.Align.CENTER,
            css_classes: ['dim-label']
        });

        const updateDesktopDatabase = () => {
            try {
                const appsDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'applications']);
                Gio.Subprocess.new(['update-desktop-database', appsDir], Gio.SubprocessFlags.NONE);
            } catch (_) {}
        };

        const showInFiles = (filePath) => {
            try {
                Gio.Subprocess.new(['nautilus', '--select', filePath], Gio.SubprocessFlags.NONE);
            } catch (_) {
                try {
                    const dir = GLib.path_get_dirname(filePath);
                    Gio.Subprocess.new(['xdg-open', dir], Gio.SubprocessFlags.NONE);
                } catch (e) {
                    window.add_toast(new Adw.Toast({ title: _('Could not open file manager') }));
                }
            }
        };

        const findHeaderBar = (widget) => {
            if (widget instanceof Adw.HeaderBar) return widget;
            let child = widget.get_first_child();
            while (child) {
                const res = findHeaderBar(child);
                if (res) return res;
                child = child.get_next_sibling();
            }
            return null;
        };

        // ==========================================
        // HEADER BAR MENU
        // ==========================================
        const menuModel = new Gio.Menu();

        const configSection = new Gio.Menu();
        configSection.append(_('Export Profile…'), 'prefs.export-profile');
        configSection.append(_('Import Profile…'), 'prefs.import-profile');
        menuModel.append_section(null, configSection);

        const toolsSection = new Gio.Menu();
        toolsSection.append(_('Restore Original Icons…'), 'prefs.restore-all');
        toolsSection.append(_('Reset to Defaults…'), 'prefs.reset');
        toolsSection.append(_('Debug Logging'), 'prefs.debug-logging');
        menuModel.append_section(null, toolsSection);

        const linksSection = new Gio.Menu();
        linksSection.append(_('GitHub Page'), 'prefs.open-readme');
        linksSection.append(_('Report Issue'), 'prefs.open-bug-report');
        menuModel.append_section(null, linksSection);

        const menuButton = new Gtk.MenuButton({
            menu_model: menuModel,
            icon_name: 'open-menu-symbolic',
            tooltip_text: _('Main Menu'),
            valign: Gtk.Align.CENTER
        });

        const actionGroup = new Gio.SimpleActionGroup();
        actionGroup.add_action(settings.create_action('debug-logging'));

        // Export Profile Action
        const exportAction = new Gio.SimpleAction({ name: 'export-profile' });
        exportAction.connect('activate', () => {
            try {
                const fileDialog = new Gtk.FileDialog({
                    title: _('Export Configuration Profile'),
                    initial_name: 'pwa-icon-matcher-profile.json'
                });
                fileDialog.save(window, null, (dialog, res) => {
                    try {
                        const file = dialog.save_finish(res);
                        if (file) {
                            const rawAliases = settings.get_value('custom-aliases');
                            const aliases = rawAliases.deepUnpack ? rawAliases.deepUnpack() : {};
                            const exclusions = settings.get_strv('excluded-apps') || [];
                            const payload = JSON.stringify({
                                format: 'pwa-icon-matcher-profile',
                                version: 1,
                                exported_at: new Date().toISOString(),
                                aliases,
                                exclusions
                            }, null, 2);

                            const bytes = new GLib.Bytes(new TextEncoder().encode(payload));
                            file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, (obj, r) => {
                                try {
                                    obj.replace_contents_finish(r);
                                    window.add_toast(new Adw.Toast({ title: _('Configuration exported successfully') }));
                                } catch (e) {
                                    window.add_toast(new Adw.Toast({ title: _(`Export failed: ${e.message}`) }));
                                }
                            });
                        }
                    } catch (_) {}
                });
            } catch (err) {
                window.add_toast(new Adw.Toast({ title: _(`Export dialog failed: ${err.message}`) }));
            }
        });
        actionGroup.add_action(exportAction);

        // Import Profile Action
        const importAction = new Gio.SimpleAction({ name: 'import-profile' });
        importAction.connect('activate', () => {
            try {
                const fileDialog = new Gtk.FileDialog({
                    title: _('Import Configuration Profile')
                });
                fileDialog.open(window, null, (dialog, res) => {
                    try {
                        const file = dialog.open_finish(res);
                        if (file) {
                            const [ok, bytes] = file.load_contents(null);
                            if (ok && bytes) {
                                const text = new TextDecoder('utf-8').decode(bytes);
                                const parsed = JSON.parse(text);
                                if (parsed.aliases && typeof parsed.aliases === 'object') {
                                    settings.set_value('custom-aliases', new GLib.Variant('a{ss}', parsed.aliases));
                                }
                                if (parsed.exclusions && Array.isArray(parsed.exclusions)) {
                                    settings.set_strv('excluded-apps', parsed.exclusions);
                                }
                                window.add_toast(new Adw.Toast({ title: _('Configuration imported successfully') }));
                                refreshAppLists();
                                refreshAliases();
                                refreshExclusions();
                            }
                        }
                    } catch (e) {
                        window.add_toast(new Adw.Toast({ title: _(`Import failed: ${e.message}`) }));
                    }
                });
            } catch (err) {
                window.add_toast(new Adw.Toast({ title: _(`Import dialog failed: ${err.message}`) }));
            }
        });
        actionGroup.add_action(importAction);

        // Reset Action
        const resetAction = new Gio.SimpleAction({ name: 'reset' });
        resetAction.connect('activate', () => {
            const dialog = new Adw.AlertDialog({
                heading: _('Reset Preferences?'),
                body: _('Settings, aliases, and exclusions will return to defaults.')
            });
            dialog.add_response('cancel', _('Cancel'));
            dialog.add_response('reset', _('Reset'));
            dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.set_default_response('cancel');
            dialog.set_close_response('cancel');
            dialog.connect('response::reset', () => {
                settings.reset('enabled');
                settings.reset('auto-match-new');
                settings.reset('startup-scan');
                settings.reset('debug-logging');
                settings.reset('custom-aliases');
                settings.reset('excluded-apps');
                window.add_toast(new Adw.Toast({ title: _('Preferences reset to default') }));
                refreshAppLists();
                refreshAliases();
                refreshExclusions();
            });
            dialog.present(window);
        });
        actionGroup.add_action(resetAction);

        // Restore Original Icons Action (in menu)
        const restoreAction = new Gio.SimpleAction({ name: 'restore-all' });
        restoreAction.connect('activate', () => {
            const dialog = new Adw.AlertDialog({
                heading: _('Restore Original Icons?'),
                body: _('Revert all modified launchers to their original browser icons.')
            });
            dialog.add_response('cancel', _('Cancel'));
            dialog.add_response('restore', _('Restore'));
            dialog.set_response_appearance('restore', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.set_default_response('cancel');
            dialog.set_close_response('cancel');

            dialog.connect('response::restore', async () => {
                try {
                    const count = await matcher.restoreAllLaunchers();
                    updateDesktopDatabase();
                    window.add_toast(new Adw.Toast({ title: _(`Restored ${count} launcher(s)`) }));
                    refreshAppLists();
                } catch (err) {
                    window.add_toast(new Adw.Toast({ title: _(`Restoration failed: ${err.message}`) }));
                }
            });

            dialog.present(window);
        });
        actionGroup.add_action(restoreAction);

        // Links
        const readmeAction = new Gio.SimpleAction({ name: 'open-readme' });
        readmeAction.connect('activate', () => {
            new Gtk.UriLauncher({ uri: 'https://github.com/shaque/pwa-icon-matcher' }).launch(window, null, null);
        });
        actionGroup.add_action(readmeAction);

        const bugAction = new Gio.SimpleAction({ name: 'open-bug-report' });
        bugAction.connect('activate', () => {
            new Gtk.UriLauncher({ uri: 'https://github.com/shaque/pwa-icon-matcher/issues' }).launch(window, null, null);
        });
        actionGroup.add_action(bugAction);

        window.insert_action_group('prefs', actionGroup);

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            try {
                const headerbar = findHeaderBar(window);
                if (headerbar) headerbar.pack_end(menuButton);
            } catch (err) {
                logger.error('Failed to attach headerbar menu', err);
            }
            return GLib.SOURCE_REMOVE;
        });

        // ==========================================
        // PAGE 1: GENERAL (Merged with Launchers)
        // ==========================================
        const generalPage = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic'
        });
        window.add(generalPage);

        // Group 1: General Toggles
        const generalGroup = new Adw.PreferencesGroup({
            title: _('General')
        });
        generalPage.add(generalGroup);

        const enableRow = new Adw.SwitchRow({
            title: _('Enable Icon Matching')
        });
        enableRow.add_prefix(makePrefixIcon('preferences-desktop-theme-symbolic'));
        settings.bind('enabled', enableRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        generalGroup.add(enableRow);

        const autoMatchRow = new Adw.SwitchRow({
            title: _('Auto-Match New Installations')
        });
        autoMatchRow.add_prefix(makePrefixIcon('folder-download-symbolic'));
        settings.bind('auto-match-new', autoMatchRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        generalGroup.add(autoMatchRow);

        // Group 2: Operations
        const actionsGroup = new Adw.PreferencesGroup({
            title: _('Operations')
        });
        generalPage.add(actionsGroup);

        const scanRow = new Adw.ActionRow({
            title: _('Synchronize All Launchers')
        });
        scanRow.add_prefix(makePrefixIcon('system-search-symbolic'));
        const scanBtn = new Gtk.Button({
            label: _('Sync Now'),
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action']
        });
        scanBtn.connect('clicked', async () => {
            scanBtn.set_sensitive(false);
            try {
                const appsDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'applications']);
                const dirFile = Gio.File.new_for_path(appsDir);
                if (dirFile.query_exists(null)) {
                    const enumerator = await new Promise((res, rej) => {
                        dirFile.enumerate_children_async(
                            'standard::name',
                            Gio.FileQueryInfoFlags.NONE,
                            GLib.PRIORITY_DEFAULT,
                            null,
                            (obj, r) => {
                                try { res(obj.enumerate_children_finish(r)); }
                                catch (e) { rej(e); }
                            }
                        );
                    });

                    let count = 0;
                    while (true) {
                        const files = await new Promise((res, rej) => {
                            enumerator.next_files_async(10, GLib.PRIORITY_DEFAULT, null, (obj, r) => {
                                try { res(obj.next_files_finish(r)); }
                                catch (e) { rej(e); }
                            });
                        });
                        if (!files || files.length === 0) break;

                        for (const info of files) {
                            const name = info.get_name();
                            if (!name.endsWith('.desktop')) continue;
                            const fullPath = GLib.build_filenamev([appsDir, name]);
                            const result = await matcher.processDesktopFile(fullPath);
                            if (result && result.modified) count++;
                        }
                    }
                    enumerator.close(null);
                    updateDesktopDatabase();
                    window.add_toast(new Adw.Toast({ title: _(`Updated ${count} launcher(s)`) }));
                    refreshAppLists();
                }
            } catch (err) {
                window.add_toast(new Adw.Toast({ title: _(`Scan failed: ${err.message}`) }));
            } finally {
                scanBtn.set_sensitive(true);
            }
        });
        scanRow.add_suffix(scanBtn);
        actionsGroup.add(scanRow);

        // Group 3: Symmetrical Unified Launchers Card
        const launchersGroup = new Adw.PreferencesGroup({
            title: _('Launchers')
        });
        generalPage.add(launchersGroup);

        const searchEntryRow = new Adw.EntryRow({
            title: _('Filter Launchers')
        });
        searchEntryRow.add_prefix(makePrefixIcon('edit-find-symbolic'));
        launchersGroup.add(searchEntryRow);

        const matchedExpander = new Adw.ExpanderRow({
            title: _('Themed Applications'),
            subtitle: _('Loading…'),
            expanded: true
        });
        matchedExpander.add_prefix(makePrefixIcon('emblem-ok-symbolic'));
        launchersGroup.add(matchedExpander);

        const unmatchedExpander = new Adw.ExpanderRow({
            title: _('Unresolved Launchers'),
            subtitle: _('Loading…'),
            expanded: false
        });
        unmatchedExpander.add_prefix(makePrefixIcon('dialog-warning-symbolic'));
        launchersGroup.add(unmatchedExpander);

        let matchedChildRows = [];
        let unmatchedChildRows = [];

        // Real-time filtering function
        searchEntryRow.connect('changed', () => {
            const query = searchEntryRow.get_text().toLowerCase().trim();

            let matchedCount = 0;
            for (const row of matchedChildRows) {
                if (!query) {
                    row.set_visible(true);
                    matchedCount++;
                } else {
                    const title = (row.title || '').toLowerCase();
                    const subtitle = (row.subtitle || '').toLowerCase();
                    const matches = title.includes(query) || subtitle.includes(query);
                    row.set_visible(matches);
                    if (matches) matchedCount++;
                }
            }

            let unmatchedCount = 0;
            for (const row of unmatchedChildRows) {
                if (!query) {
                    row.set_visible(true);
                    unmatchedCount++;
                } else {
                    const title = (row.title || '').toLowerCase();
                    const subtitle = (row.subtitle || '').toLowerCase();
                    const matches = title.includes(query) || subtitle.includes(query);
                    row.set_visible(matches);
                    if (matches) unmatchedCount++;
                }
            }

            if (query) {
                matchedExpander.set_expanded(matchedCount > 0);
                unmatchedExpander.set_expanded(unmatchedCount > 0);
                matchedExpander.set_subtitle(_(`${matchedCount} matching "${query}"`));
                unmatchedExpander.set_subtitle(_(`${unmatchedCount} matching "${query}"`));
            } else {
                matchedExpander.set_expanded(true);
                matchedExpander.set_subtitle(_(`${matchedChildRows.length} themed`));
                unmatchedExpander.set_subtitle(_(`${unmatchedChildRows.length} unresolved`));
            }
        });

        // Dialog for manual icon customization
        const openManualIconDialog = (appName, currentIcon, desktopFile) => {
            const dialog = new Adw.AlertDialog({
                heading: _('Custom Theme Icon'),
                body: _(`Select or type a theme icon name for "${appName}"`)
            });

            const box = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 12,
                margin_top: 12,
                margin_bottom: 12
            });

            const iconEntry = new Adw.EntryRow({
                title: _('Target Icon Name'),
                text: currentIcon
            });
            box.append(iconEntry);

            dialog.set_extra_child(box);
            dialog.add_response('cancel', _('Cancel'));
            dialog.add_response('apply', _('Apply'));
            dialog.set_response_appearance('apply', Adw.ResponseAppearance.SUGGESTED);
            dialog.set_default_response('apply');

            dialog.connect('response::apply', async () => {
                const target = iconEntry.get_text().trim();
                if (!target) return;

                const current = settings.get_value('custom-aliases').deepUnpack() || {};
                current[appName] = target;
                settings.set_value('custom-aliases', new GLib.Variant('a{ss}', current));

                const appsDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'applications']);
                const fullPath = GLib.build_filenamev([appsDir, desktopFile]);
                await matcher.processDesktopFile(fullPath);
                updateDesktopDatabase();

                window.add_toast(new Adw.Toast({ title: _(`Applied icon "${target}" to ${appName}`) }));
                refreshAppLists();
                refreshAliases();
            });

            dialog.present(window);
        };

        const refreshAppLists = async () => {
            stateManager.load();
            const entries = stateManager.getAllEntries();

            for (const row of matchedChildRows) matchedExpander.remove(row);
            matchedChildRows = [];

            matchedExpander.set_subtitle(_(`${entries.length} themed`));

            const appsDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'applications']);

            for (const item of entries) {
                const row = new Adw.ActionRow({
                    title: item.appName || item.desktopFile,
                    subtitle: item.matchedIcon
                });

                const appImg = new Gtk.Image({
                    icon_name: item.matchedIcon,
                    pixel_size: 24,
                    valign: Gtk.Align.CENTER
                });
                row.add_prefix(appImg);

                const fullPath = GLib.build_filenamev([appsDir, item.desktopFile]);

                // Symmetrical button bar
                const btnBox = new Gtk.Box({
                    orientation: Gtk.Orientation.HORIZONTAL,
                    spacing: 2,
                    valign: Gtk.Align.CENTER
                });

                const editIconBtn = new Gtk.Button({
                    icon_name: 'document-edit-symbolic',
                    tooltip_text: _('Change Icon Manually'),
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat']
                });
                editIconBtn.connect('clicked', () => {
                    openManualIconDialog(item.appName, item.matchedIcon, item.desktopFile);
                });
                btnBox.append(editIconBtn);

                const rematchBtn = new Gtk.Button({
                    icon_name: 'view-refresh-symbolic',
                    tooltip_text: _('Re-match Launcher'),
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat']
                });
                rematchBtn.connect('clicked', async () => {
                    rematchBtn.set_sensitive(false);
                    try {
                        await matcher.processDesktopFile(fullPath);
                        updateDesktopDatabase();
                        window.add_toast(new Adw.Toast({ title: _(`Re-matched ${item.appName}`) }));
                        refreshAppLists();
                    } finally {
                        rematchBtn.set_sensitive(true);
                    }
                });
                btnBox.append(rematchBtn);

                const revealBtn = new Gtk.Button({
                    icon_name: 'folder-symbolic',
                    tooltip_text: _('Reveal in Files'),
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat']
                });
                revealBtn.connect('clicked', () => showInFiles(fullPath));
                btnBox.append(revealBtn);

                const revertOneBtn = new Gtk.Button({
                    icon_name: 'edit-undo-symbolic',
                    tooltip_text: _('Revert to Original Icon'),
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat']
                });
                revertOneBtn.connect('clicked', async () => {
                    await matcher.restoreLauncher(item.desktopFile);
                    updateDesktopDatabase();
                    window.add_toast(new Adw.Toast({ title: _(`Reverted ${item.appName}`) }));
                    refreshAppLists();
                });
                btnBox.append(revertOneBtn);

                row.add_suffix(btnBox);
                matchedExpander.add_row(row);
                matchedChildRows.push(row);
            }

            if (entries.length === 0) {
                const emptyRow = new Adw.ActionRow({
                    title: _('No themed launchers recorded')
                });
                emptyRow.add_prefix(makePrefixIcon('info-symbolic'));
                matchedExpander.add_row(emptyRow);
                matchedChildRows.push(emptyRow);
            }

            // Unmatched Scan
            for (const row of unmatchedChildRows) unmatchedExpander.remove(row);
            unmatchedChildRows = [];

            const dirFile = Gio.File.new_for_path(appsDir);
            const unmatched = [];

            if (dirFile.query_exists(null)) {
                try {
                    const enumerator = dirFile.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                    let info;
                    while ((info = enumerator.next_file(null)) !== null) {
                        const name = info.get_name();
                        if (!name.endsWith('.desktop')) continue;

                        const fullPath = GLib.build_filenamev([appsDir, name]);
                        const f = Gio.File.new_for_path(fullPath);
                        const [ok, bytes] = f.load_contents(null);
                        if (!ok || !bytes) continue;

                        const decoder = new TextDecoder('utf-8');
                        const content = decoder.decode(bytes);
                        const parsed = parseDesktopEntry(content);
                        if (!parsed.isValid) continue;

                        const pwaInfo = detector.detect(parsed, name);
                        if (pwaInfo.isPwa) {
                            const resolved = await resolver.resolveIcon(parsed.name, pwaInfo.appId);
                            if (!resolved) {
                                unmatched.push({
                                    filename: name,
                                    name: parsed.name,
                                    icon: parsed.icon
                                });
                            }
                        }
                    }
                    enumerator.close(null);
                } catch (e) {
                    logger.error('Error scanning for unmatched launchers', e);
                }
            }

            unmatchedExpander.set_subtitle(_(`${unmatched.length} unresolved`));

            for (const item of unmatched) {
                const row = new Adw.ActionRow({
                    title: item.name,
                    subtitle: item.filename
                });
                row.add_prefix(makePrefixIcon('dialog-warning-symbolic'));

                const fullPath = GLib.build_filenamev([appsDir, item.filename]);

                const btnBox = new Gtk.Box({
                    orientation: Gtk.Orientation.HORIZONTAL,
                    spacing: 4,
                    valign: Gtk.Align.CENTER
                });

                const revealBtn = new Gtk.Button({
                    icon_name: 'folder-symbolic',
                    tooltip_text: _('Reveal in Files'),
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat']
                });
                revealBtn.connect('clicked', () => showInFiles(fullPath));
                btnBox.append(revealBtn);

                const addAliasBtn = new Gtk.Button({
                    label: _('Set Icon'),
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat']
                });
                addAliasBtn.connect('clicked', () => openManualIconDialog(item.name, '', item.filename));
                btnBox.append(addAliasBtn);

                row.add_suffix(btnBox);
                unmatchedExpander.add_row(row);
                unmatchedChildRows.push(row);
            }

            if (unmatched.length === 0) {
                const emptyRow = new Adw.ActionRow({
                    title: _('All PWAs have matching icons')
                });
                emptyRow.add_prefix(makePrefixIcon('info-symbolic'));
                unmatchedExpander.add_row(emptyRow);
                unmatchedChildRows.push(emptyRow);
            }
        };

        refreshAppLists();

        // ==========================================
        // PAGE 2: CUSTOMIZATION
        // ==========================================
        const customPage = new Adw.PreferencesPage({
            title: _('Customization'),
            icon_name: 'emblem-favorite-symbolic'
        });
        window.add(customPage);

        // Group 1: Live Tester
        const previewGroup = new Adw.PreferencesGroup({
            title: _('Icon Tester')
        });
        customPage.add(previewGroup);

        const testEntryRow = new Adw.EntryRow({
            title: _('App Name')
        });
        testEntryRow.add_prefix(makePrefixIcon('edit-find-symbolic'));
        previewGroup.add(testEntryRow);

        const previewResultRow = new Adw.ActionRow({
            title: _('Result')
        });
        const previewImage = new Gtk.Image({
            icon_name: 'image-missing-symbolic',
            pixel_size: 24,
            valign: Gtk.Align.CENTER
        });
        previewResultRow.add_prefix(previewImage);

        const saveAsAliasBtn = new Gtk.Button({
            label: _('Save Alias'),
            valign: Gtk.Align.CENTER,
            sensitive: false,
            css_classes: ['suggested-action', 'flat']
        });
        previewResultRow.add_suffix(saveAsAliasBtn);
        previewGroup.add(previewResultRow);

        let lastResolvedIcon = '';
        let lastQueryName = '';

        testEntryRow.connect('changed', () => {
            const query = testEntryRow.get_text().trim();
            lastQueryName = query;
            if (!query) {
                previewResultRow.set_subtitle('');
                previewImage.set_from_icon_name('image-missing-symbolic');
                saveAsAliasBtn.set_sensitive(false);
                lastResolvedIcon = '';
                return;
            }

            resolver.resolveIcon(query, '').then(res => {
                if (res) {
                    lastResolvedIcon = res;
                    previewResultRow.set_subtitle(res);
                    previewImage.set_from_icon_name(res);
                    saveAsAliasBtn.set_sensitive(true);
                } else {
                    lastResolvedIcon = '';
                    previewResultRow.set_subtitle(_('Not found'));
                    previewImage.set_from_icon_name('image-missing-symbolic');
                    saveAsAliasBtn.set_sensitive(false);
                }
            });
        });

        saveAsAliasBtn.connect('clicked', () => {
            if (!lastQueryName || !lastResolvedIcon) return;
            const current = settings.get_value('custom-aliases').deepUnpack() || {};
            current[lastQueryName] = lastResolvedIcon;
            settings.set_value('custom-aliases', new GLib.Variant('a{ss}', current));
            refreshAliases();
            window.add_toast(new Adw.Toast({ title: _(`Saved alias for ${lastQueryName}`) }));
            saveAsAliasBtn.set_sensitive(false);
        });

        // Group 2: Custom Aliases (Native Boxed List)
        const aliasesGroup = new Adw.PreferencesGroup({
            title: _('Custom Aliases')
        });
        customPage.add(aliasesGroup);

        const addAliasActionRow = new Adw.ActionRow({
            title: _('Add New Alias')
        });
        addAliasActionRow.add_prefix(makePrefixIcon('list-add-symbolic'));
        const addAliasBtn = new Gtk.Button({
            label: _('Add'),
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action']
        });
        addAliasActionRow.add_suffix(addAliasBtn);
        aliasesGroup.add(addAliasActionRow);

        let aliasChildRows = [];

        const refreshAliases = () => {
            for (const r of aliasChildRows) aliasesGroup.remove(r);
            aliasChildRows = [];

            const rawVal = settings.get_value('custom-aliases');
            const aliases = rawVal.deepUnpack ? rawVal.deepUnpack() : {};
            const keys = Object.keys(aliases);

            if (keys.length === 0) {
                const emptyRow = new Adw.ActionRow({
                    title: _('No custom aliases defined')
                });
                emptyRow.add_prefix(makePrefixIcon('info-symbolic'));
                aliasesGroup.add(emptyRow);
                aliasChildRows.push(emptyRow);
                return;
            }

            for (const key of keys) {
                const targetIcon = aliases[key];
                const row = new Adw.ActionRow({
                    title: key,
                    subtitle: targetIcon
                });

                const img = new Gtk.Image({
                    icon_name: targetIcon,
                    pixel_size: 24,
                    valign: Gtk.Align.CENTER
                });
                row.add_prefix(img);

                const delBtn = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat', 'destructive-action']
                });
                delBtn.connect('clicked', () => {
                    delete aliases[key];
                    settings.set_value('custom-aliases', new GLib.Variant('a{ss}', aliases));
                    refreshAliases();
                });
                row.add_suffix(delBtn);

                aliasesGroup.add(row);
                aliasChildRows.push(row);
            }
        };

        const openAddAliasDialog = (defaultAppName = '') => {
            const dialog = new Adw.AlertDialog({
                heading: _('Add Custom Alias')
            });

            const box = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 12,
                margin_top: 12,
                margin_bottom: 12
            });

            const appEntry = new Adw.EntryRow({
                title: _('App Name'),
                text: defaultAppName
            });
            box.append(appEntry);

            const iconEntry = new Adw.EntryRow({
                title: _('Icon Name')
            });
            box.append(iconEntry);

            dialog.set_extra_child(box);
            dialog.add_response('cancel', _('Cancel'));
            dialog.add_response('save', _('Save'));
            dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);
            dialog.set_default_response('save');

            dialog.connect('response::save', () => {
                const app = appEntry.get_text().trim();
                const icon = iconEntry.get_text().trim();
                if (!app || !icon) return;

                const current = settings.get_value('custom-aliases').deepUnpack() || {};
                current[app] = icon;
                settings.set_value('custom-aliases', new GLib.Variant('a{ss}', current));
                refreshAliases();
                window.add_toast(new Adw.Toast({ title: _(`Added alias for ${app}`) }));
            });

            dialog.present(window);
        };

        addAliasBtn.connect('clicked', () => openAddAliasDialog());
        refreshAliases();

        // Group 3: Exclusions (Native Boxed List)
        const exclusionsGroup = new Adw.PreferencesGroup({
            title: _('Exclusions')
        });
        customPage.add(exclusionsGroup);

        const addExclusionActionRow = new Adw.ActionRow({
            title: _('Add Exclusion')
        });
        addExclusionActionRow.add_prefix(makePrefixIcon('list-add-symbolic'));
        const addExclusionBtn = new Gtk.Button({
            label: _('Add'),
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action']
        });
        addExclusionActionRow.add_suffix(addExclusionBtn);
        exclusionsGroup.add(addExclusionActionRow);

        let exclusionChildRows = [];

        const refreshExclusions = () => {
            for (const r of exclusionChildRows) exclusionsGroup.remove(r);
            exclusionChildRows = [];

            const exclusions = settings.get_strv('excluded-apps') || [];
            if (exclusions.length === 0) {
                const emptyRow = new Adw.ActionRow({
                    title: _('No applications excluded')
                });
                emptyRow.add_prefix(makePrefixIcon('info-symbolic'));
                exclusionsGroup.add(emptyRow);
                exclusionChildRows.push(emptyRow);
                return;
            }

            for (const item of exclusions) {
                const row = new Adw.ActionRow({
                    title: item
                });
                row.add_prefix(makePrefixIcon('dialog-error-symbolic'));

                const delBtn = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat', 'destructive-action']
                });
                delBtn.connect('clicked', () => {
                    const current = settings.get_strv('excluded-apps') || [];
                    const updated = current.filter(x => x !== item);
                    settings.set_strv('excluded-apps', updated);
                    refreshExclusions();
                    window.add_toast(new Adw.Toast({ title: _(`Removed exclusion ${item}`) }));
                });
                row.add_suffix(delBtn);

                exclusionsGroup.add(row);
                exclusionChildRows.push(row);
            }
        };

        addExclusionBtn.connect('clicked', () => {
            const dialog = new Adw.AlertDialog({
                heading: _('Add Exclusion')
            });

            const box = new Gtk.Box({ margin_top: 12, margin_bottom: 12 });
            const entry = new Adw.EntryRow({ title: _('App Name or .desktop filename') });
            box.append(entry);
            dialog.set_extra_child(box);

            dialog.add_response('cancel', _('Cancel'));
            dialog.add_response('add', _('Add'));
            dialog.set_response_appearance('add', Adw.ResponseAppearance.SUGGESTED);

            dialog.connect('response::add', () => {
                const val = entry.get_text().trim();
                if (!val) return;
                const current = settings.get_strv('excluded-apps') || [];
                if (!current.includes(val)) {
                    current.push(val);
                    settings.set_strv('excluded-apps', current);
                    refreshExclusions();
                    window.add_toast(new Adw.Toast({ title: _(`Excluded ${val}`) }));
                }
            });

            dialog.present(window);
        });

        refreshExclusions();
    }
}

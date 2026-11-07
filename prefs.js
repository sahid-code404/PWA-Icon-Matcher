/**
 * PWA Icon Matcher - Preferences Interface (GTK4 + Libadwaita)
 *
 * Implements a complete preferences window covering:
 * - Section A: General Settings
 * - Section B: Browser Support Toggles
 * - Section C: Icon Matching, Custom Aliases, Exclusions, and Live Preview
 * - Section D: Maintenance, Manual Scan, Icon Restoration, State Management
 * - Section E: Diagnostics and Lightweight Log Inspection
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

        window.set_default_size(720, 680);
        window.set_search_enabled(true);

        // ==========================================
        // PAGE 1: GENERAL & BROWSERS
        // ==========================================
        const generalPage = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic'
        });
        window.add(generalPage);

        // Section A: General Settings Group
        const generalGroup = new Adw.PreferencesGroup({
            title: _('General Configuration'),
            description: _('Control automatic matching and startup behavior')
        });
        generalPage.add(generalGroup);

        const enableRow = new Adw.SwitchRow({
            title: _('Enable PWA Icon Matcher'),
            subtitle: _('Master switch for the extension')
        });
        settings.bind('enabled', enableRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        generalGroup.add(enableRow);

        const autoMatchRow = new Adw.SwitchRow({
            title: _('Automatically Match Newly Installed PWAs'),
            subtitle: _('Monitors ~/.local/share/applications/ and patches new PWA launchers')
        });
        settings.bind('auto-match-new', autoMatchRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        generalGroup.add(autoMatchRow);

        const startupScanRow = new Adw.SwitchRow({
            title: _('Scan Existing Launchers at Startup'),
            subtitle: _('Performs a single asynchronous pass when the extension starts')
        });
        settings.bind('startup-scan', startupScanRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        generalGroup.add(startupScanRow);

        const browserIndepRow = new Adw.SwitchRow({
            title: _('Browser-Independent Detection'),
            subtitle: _('Detect PWAs across all supported browser engines')
        });
        settings.bind('browser-independent', browserIndepRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        generalGroup.add(browserIndepRow);

        // Section B: Browser Support Group
        const browserGroup = new Adw.PreferencesGroup({
            title: _('Supported Browser Adapters'),
            description: _('Enable or disable detection adapters for individual browsers')
        });
        generalPage.add(browserGroup);

        const browsers = [
            { key: 'browser-brave', title: _('Brave'), subtitle: _('Brave Browser PWA desktop entries') },
            { key: 'browser-chrome', title: _('Google Chrome'), subtitle: _('Google Chrome PWA desktop entries') },
            { key: 'browser-chromium', title: _('Chromium'), subtitle: _('Chromium and Ungoogled Chromium launchers') },
            { key: 'browser-edge', title: _('Microsoft Edge'), subtitle: _('Microsoft Edge PWA desktop entries') },
            { key: 'browser-vivaldi', title: _('Vivaldi'), subtitle: _('Vivaldi Web App desktop entries') },
            { key: 'browser-opera', title: _('Opera'), subtitle: _('Opera Web App desktop entries') },
            { key: 'browser-firefox-pwa', title: _('Firefox PWA tools'), subtitle: _('PWAsForFirefox (firefoxpwa) launchers') },
            { key: 'browser-epiphany', title: _('GNOME Web (Epiphany)'), subtitle: _('GNOME Web application mode launchers') },
            { key: 'browser-generic', title: _('Generic PWA Detection'), subtitle: _('Launchers with unambiguous PWA command-line arguments') }
        ];

        for (const b of browsers) {
            const row = new Adw.SwitchRow({
                title: b.title,
                subtitle: b.subtitle
            });
            settings.bind(b.key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            browserGroup.add(row);
        }

        // ==========================================
        // PAGE 2: ICON MATCHING & ALIASES
        // ==========================================
        const matchingPage = new Adw.PreferencesPage({
            title: _('Icon Matching'),
            icon_name: 'emblem-favorite-symbolic'
        });
        window.add(matchingPage);

        // Section C1: Matching Rules
        const rulesGroup = new Adw.PreferencesGroup({
            title: _('Matching Rules'),
            description: _('Configure icon matching strictness')
        });
        matchingPage.add(rulesGroup);

        const exactMatchRow = new Adw.SwitchRow({
            title: _('Exact Matching Only'),
            subtitle: _('Avoid heuristic guessing and require exact normalized theme matches')
        });
        settings.bind('exact-matching', exactMatchRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        rulesGroup.add(exactMatchRow);

        // Section C2: Live Icon Tester & Preview
        const previewGroup = new Adw.PreferencesGroup({
            title: _('Icon Preview & Testing'),
            description: _('Test how an application name resolves against your active icon theme')
        });
        matchingPage.add(previewGroup);

        const testEntryRow = new Adw.EntryRow({
            title: _('Test Application Name (e.g. Claude, YouTube, Gmail)')
        });
        previewGroup.add(testEntryRow);

        const previewResultRow = new Adw.ActionRow({
            title: _('Resolved Theme Icon'),
            subtitle: _('Type a name above to test resolution')
        });
        const previewImage = new Gtk.Image({
            icon_name: 'image-missing-symbolic',
            pixel_size: 32,
            valign: Gtk.Align.CENTER
        });
        previewResultRow.add_suffix(previewImage);
        previewGroup.add(previewResultRow);

        let lastResolvedIcon = '';
        let lastQueryName = '';

        const saveAsAliasBtn = new Gtk.Button({
            label: _('Save as Alias'),
            valign: Gtk.Align.CENTER,
            sensitive: false,
            css_classes: ['suggested-action', 'flat']
        });
        previewResultRow.add_suffix(saveAsAliasBtn);

        testEntryRow.connect('changed', () => {
            const query = testEntryRow.get_text().trim();
            lastQueryName = query;
            if (!query) {
                previewResultRow.set_subtitle(_('Type a name above to test resolution'));
                previewImage.set_from_icon_name('image-missing-symbolic');
                saveAsAliasBtn.set_sensitive(false);
                lastResolvedIcon = '';
                return;
            }

            resolver.resolveIcon(query).then(resolved => {
                if (testEntryRow.get_text().trim() !== query) return;
                if (resolved) {
                    lastResolvedIcon = resolved;
                    previewResultRow.set_subtitle(_(`Found in active theme: "${resolved}"`));
                    previewImage.set_from_icon_name(resolved);
                    saveAsAliasBtn.set_sensitive(true);
                } else {
                    lastResolvedIcon = '';
                    previewResultRow.set_subtitle(_('No matching icon found in active theme'));
                    previewImage.set_from_icon_name('dialog-warning-symbolic');
                    saveAsAliasBtn.set_sensitive(false);
                }
            });
        });

        // Section C3: Custom Icon Aliases Group
        const aliasesGroup = new Adw.PreferencesGroup({
            title: _('Custom Icon Aliases'),
            description: _('Explicit aliases take top priority over automatic normalization')
        });
        matchingPage.add(aliasesGroup);

        const addAliasActionRow = new Adw.ActionRow({
            title: _('Add New Alias'),
            subtitle: _('Map an application name to a specific icon name')
        });
        const addAliasBtn = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER
        });
        addAliasActionRow.add_suffix(addAliasBtn);
        aliasesGroup.add(addAliasActionRow);

        const aliasRowsBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4
        });
        aliasesGroup.add(aliasRowsBox);

        const refreshAliases = () => {
            // Remove existing alias child rows
            let child = aliasRowsBox.get_first_child();
            while (child) {
                const next = child.get_next_sibling();
                aliasRowsBox.remove(child);
                child = next;
            }

            const varVal = settings.get_value('custom-aliases');
            const aliases = varVal.deepUnpack ? varVal.deepUnpack() : {};
            const keys = Object.keys(aliases).sort();

            if (keys.length === 0) {
                const emptyRow = new Adw.ActionRow({
                    title: _('No custom aliases configured'),
                    subtitle: _('Default normalized matching is used')
                });
                aliasRowsBox.append(emptyRow);
                return;
            }

            for (const app of keys) {
                const iconName = aliases[app];
                const row = new Adw.ActionRow({
                    title: app,
                    subtitle: iconName
                });

                // Icon preview thumbnail
                const img = new Gtk.Image({
                    icon_name: iconName,
                    pixel_size: 24,
                    valign: Gtk.Align.CENTER
                });
                row.add_prefix(img);

                // Delete button
                const delBtn = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat', 'destructive-action']
                });
                delBtn.connect('clicked', () => {
                    const currentVar = settings.get_value('custom-aliases');
                    const curr = currentVar.deepUnpack ? currentVar.deepUnpack() : {};
                    delete curr[app];
                    settings.set_value('custom-aliases', new GLib.Variant('a{ss}', curr));
                    refreshAliases();
                });
                row.add_suffix(delBtn);

                aliasRowsBox.append(row);
            }
        };

        refreshAliases();

        const openAddAliasDialog = (initialApp = '', initialIcon = '') => {
            const dialog = new Adw.AlertDialog({
                heading: _('Add Custom Icon Alias'),
                body: _('Specify the exact application name and the desired theme icon name:')
            });

            const box = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 8,
                margin_top: 12
            });

            const appEntry = new Adw.EntryRow({ title: _('Application Name (e.g. Claude)') });
            const iconEntry = new Adw.EntryRow({ title: _('Theme Icon Name (e.g. claude)') });
            if (initialApp) appEntry.set_text(initialApp);
            if (initialIcon) iconEntry.set_text(initialIcon);

            box.append(appEntry);
            box.append(iconEntry);

            dialog.set_extra_child(box);
            dialog.add_response('cancel', _('Cancel'));
            dialog.add_response('save', _('Save'));
            dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);

            dialog.connect('response', (dlg, response) => {
                if (response === 'save') {
                    const app = appEntry.get_text().trim();
                    const icon = iconEntry.get_text().trim();
                    if (app && icon) {
                        const currentVar = settings.get_value('custom-aliases');
                        const curr = currentVar.deepUnpack ? currentVar.deepUnpack() : {};
                        curr[app] = icon;
                        settings.set_value('custom-aliases', new GLib.Variant('a{ss}', curr));
                        refreshAliases();
                    }
                }
            });

            dialog.present(window);
        };

        addAliasBtn.connect('clicked', () => {
            openAddAliasDialog();
        });

        saveAsAliasBtn.connect('clicked', () => {
            if (lastQueryName && lastResolvedIcon) {
                openAddAliasDialog(lastQueryName, lastResolvedIcon);
            }
        });

        // Section C4: User Exclusions Group
        const exclusionsGroup = new Adw.PreferencesGroup({
            title: _('User Exclusions'),
            description: _('Prevent specific applications or desktop files from being modified')
        });
        matchingPage.add(exclusionsGroup);

        const addExclusionRow = new Adw.ActionRow({
            title: _('Add Exclusion'),
            subtitle: _('Exclude by application name or desktop filename')
        });
        const addExclusionBtn = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER
        });
        addExclusionRow.add_suffix(addExclusionBtn);
        exclusionsGroup.add(addExclusionRow);

        const exclusionRowsBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4
        });
        exclusionsGroup.add(exclusionRowsBox);

        const refreshExclusions = () => {
            let child = exclusionRowsBox.get_first_child();
            while (child) {
                const next = child.get_next_sibling();
                exclusionRowsBox.remove(child);
                child = next;
            }

            const exclusions = settings.get_strv('excluded-apps') || [];
            if (exclusions.length === 0) {
                const emptyRow = new Adw.ActionRow({
                    title: _('No exclusions defined'),
                    subtitle: _('All detected PWAs are eligible for icon matching')
                });
                exclusionRowsBox.append(emptyRow);
                return;
            }

            for (const item of exclusions) {
                const row = new Adw.ActionRow({ title: item });
                const delBtn = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat', 'destructive-action']
                });
                delBtn.connect('clicked', () => {
                    const curr = settings.get_strv('excluded-apps') || [];
                    const filtered = curr.filter(x => x !== item);
                    settings.set_strv('excluded-apps', filtered);
                    refreshExclusions();
                });
                row.add_suffix(delBtn);
                exclusionRowsBox.append(row);
            }
        };

        refreshExclusions();

        addExclusionBtn.connect('clicked', () => {
            const dialog = new Adw.AlertDialog({
                heading: _('Add Exclusion'),
                body: _('Enter an application name or desktop filename to exclude:')
            });

            const box = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 8,
                margin_top: 12
            });
            const entry = new Adw.EntryRow({ title: _('Application or File Name') });
            box.append(entry);

            dialog.set_extra_child(box);
            dialog.add_response('cancel', _('Cancel'));
            dialog.add_response('add', _('Add'));
            dialog.set_response_appearance('add', Adw.ResponseAppearance.SUGGESTED);

            dialog.connect('response', (dlg, response) => {
                if (response === 'add') {
                    const val = entry.get_text().trim();
                    if (val) {
                        const curr = settings.get_strv('excluded-apps') || [];
                        if (!curr.includes(val)) {
                            curr.push(val);
                            settings.set_strv('excluded-apps', curr);
                            refreshExclusions();
                        }
                    }
                }
            });

            dialog.present(window);
        });

        // ==========================================
        // PAGE 3: MAINTENANCE & LAUNCHERS
        // ==========================================
        const maintenancePage = new Adw.PreferencesPage({
            title: _('Maintenance'),
            icon_name: 'system-run-symbolic'
        });
        window.add(maintenancePage);

        // Section D1: Operations Group
        const opsGroup = new Adw.PreferencesGroup({
            title: _('Operations'),
            description: _('Manually scan launchers or restore original browser icons')
        });
        maintenancePage.add(opsGroup);

        // Scan now action
        const scanRow = new Adw.ActionRow({
            title: _('Scan Existing PWA Launchers Now'),
            subtitle: _('Check all launchers in ~/.local/share/applications/ and apply matching icons')
        });
        const scanBtn = new Gtk.Button({
            label: _('Scan Now'),
            valign: Gtk.Align.CENTER
        });
        scanRow.add_suffix(scanBtn);
        opsGroup.add(scanRow);

        // Restore all action
        const restoreRow = new Adw.ActionRow({
            title: _('Restore All Modified Icons'),
            subtitle: _('Revert all PWA desktop entries back to their recorded original icons')
        });
        const restoreBtn = new Gtk.Button({
            label: _('Restore All'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action']
        });
        restoreRow.add_suffix(restoreBtn);
        opsGroup.add(restoreRow);

        // Section D2: Matched Launchers List
        const matchedGroup = new Adw.PreferencesGroup({
            title: _('Matched PWA Launchers'),
            description: _('PWA launchers whose icons have been updated by this extension')
        });
        maintenancePage.add(matchedGroup);

        const matchedExpander = new Adw.ExpanderRow({
            title: _('View Matched Launchers'),
            subtitle: _('Loading...')
        });
        matchedGroup.add(matchedExpander);

        // Section D3: Unmatched Launchers List
        const unmatchedGroup = new Adw.PreferencesGroup({
            title: _('Unmatched PWA Launchers'),
            description: _('Detected PWAs that do not have a corresponding theme icon')
        });
        maintenancePage.add(unmatchedGroup);

        const unmatchedExpander = new Adw.ExpanderRow({
            title: _('View Unmatched Launchers'),
            subtitle: _('Loading...')
        });
        unmatchedGroup.add(unmatchedExpander);

        let matchedChildRows = [];
        let unmatchedChildRows = [];

        const refreshLauncherLists = async () => {
            stateManager.load();
            const entries = stateManager.getAllEntries();

            // Clear previously added matched expander child rows
            for (const row of matchedChildRows) {
                matchedExpander.remove(row);
            }
            matchedChildRows = [];

            matchedExpander.set_subtitle(_(`${entries.length} launcher(s) modified`));

            for (const entry of entries) {
                const row = new Adw.ActionRow({
                    title: entry.appName || entry.desktopFile,
                    subtitle: `${entry.browser || 'PWA'} • Matched: ${entry.matchedIcon} (Original: ${entry.originalIcon})`
                });

                const img = new Gtk.Image({
                    icon_name: entry.matchedIcon,
                    pixel_size: 24,
                    valign: Gtk.Align.CENTER
                });
                row.add_prefix(img);

                const restoreOneBtn = new Gtk.Button({
                    label: _('Restore'),
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat', 'destructive-action']
                });
                restoreOneBtn.connect('clicked', async () => {
                    restoreOneBtn.set_sensitive(false);
                    await matcher.restoreLauncher(entry.desktopFile);
                    refreshLauncherLists();
                });
                row.add_suffix(restoreOneBtn);

                matchedExpander.add_row(row);
                matchedChildRows.push(row);
            }

            if (entries.length === 0) {
                const emptyRow = new Adw.ActionRow({
                    title: _('No modified launchers recorded'),
                    subtitle: _('Launchers will appear here once their icons are matched')
                });
                matchedExpander.add_row(emptyRow);
                matchedChildRows.push(emptyRow);
            }

            // Clear previously added unmatched expander child rows
            for (const row of unmatchedChildRows) {
                unmatchedExpander.remove(row);
            }
            unmatchedChildRows = [];

            const appsDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'applications']);
            const dirFile = Gio.File.new_for_path(appsDir);

            const unmatched = [];
            if (dirFile.query_exists(null)) {
                try {
                    const enumerator = dirFile.enumerate_children(
                        'standard::name',
                        Gio.FileQueryInfoFlags.NONE,
                        null
                    );
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
                                    browser: pwaInfo.browserName,
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

            unmatchedExpander.set_subtitle(_(`${unmatched.length} launcher(s) without theme icons`));

            for (const item of unmatched) {
                const row = new Adw.ActionRow({
                    title: item.name,
                    subtitle: `${item.browser || 'PWA'} • Desktop icon: ${item.icon}`
                });

                const warnImg = new Gtk.Image({
                    icon_name: 'dialog-warning-symbolic',
                    pixel_size: 24,
                    valign: Gtk.Align.CENTER
                });
                row.add_prefix(warnImg);

                const addAliasBtn = new Gtk.Button({
                    label: _('Add Alias'),
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat']
                });
                addAliasBtn.connect('clicked', () => {
                    openAddAliasDialog(item.name);
                });
                row.add_suffix(addAliasBtn);

                unmatchedExpander.add_row(row);
                unmatchedChildRows.push(row);
            }

            if (unmatched.length === 0) {
                const emptyRow = new Adw.ActionRow({
                    title: _('No unmatched PWA launchers found'),
                    subtitle: _('All detected PWAs have theme icons or no PWAs are installed')
                });
                unmatchedExpander.add_row(emptyRow);
                unmatchedChildRows.push(emptyRow);
            }
        };

        refreshLauncherLists();

        scanBtn.connect('clicked', async () => {
            scanBtn.set_sensitive(false);
            scanRow.set_subtitle(_('Scanning applications directory...'));

            const appsDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'applications']);
            const dirFile = Gio.File.new_for_path(appsDir);
            let updated = 0;

            if (dirFile.query_exists(null)) {
                try {
                    const enumerator = dirFile.enumerate_children(
                        'standard::name',
                        Gio.FileQueryInfoFlags.NONE,
                        null
                    );
                    let info;
                    while ((info = enumerator.next_file(null)) !== null) {
                        const name = info.get_name();
                        if (!name.endsWith('.desktop')) continue;
                        const fullPath = GLib.build_filenamev([appsDir, name]);
                        const res = await matcher.processDesktopFile(fullPath);
                        if (res && res.modified) updated++;
                    }
                    enumerator.close(null);
                } catch (e) {
                    logger.error('Manual scan error', e);
                }
            }

            scanRow.set_subtitle(_(`Scan complete: ${updated} launcher(s) updated`));
            scanBtn.set_sensitive(true);
            refreshLauncherLists();
        });

        restoreBtn.connect('clicked', () => {
            const dialog = new Adw.AlertDialog({
                heading: _('Restore All Original Icons?'),
                body: _('This will safely restore all modified PWA desktop launchers to their original browser-installed icon paths.')
            });
            dialog.add_response('cancel', _('Cancel'));
            dialog.add_response('restore', _('Restore All'));
            dialog.set_response_appearance('restore', Adw.ResponseAppearance.DESTRUCTIVE);

            dialog.connect('response', async (dlg, response) => {
                if (response === 'restore') {
                    restoreBtn.set_sensitive(false);
                    const { restoredCount } = await matcher.restoreAll();
                    restoreRow.set_subtitle(_(`Restored ${restoredCount} launcher(s)`));
                    restoreBtn.set_sensitive(true);
                    refreshLauncherLists();
                }
            });

            dialog.present(window);
        });

        // Section D4: State and Backup Group
        const stateGroup = new Adw.PreferencesGroup({
            title: _('State & Portability'),
            description: _('Manage persisted modification state or export/import custom aliases')
        });
        maintenancePage.add(stateGroup);

        // Export custom aliases
        const exportRow = new Adw.ActionRow({
            title: _('Export Custom Aliases'),
            subtitle: _('Save your custom icon aliases to a JSON file')
        });
        const exportBtn = new Gtk.Button({
            label: _('Export'),
            valign: Gtk.Align.CENTER
        });
        exportRow.add_suffix(exportBtn);
        stateGroup.add(exportRow);

        exportBtn.connect('clicked', async () => {
            try {
                const varVal = settings.get_value('custom-aliases');
                const aliases = varVal.deepUnpack ? varVal.deepUnpack() : {};
                const jsonStr = JSON.stringify(aliases, null, 2);

                if (Gtk.FileDialog) {
                    const dialog = new Gtk.FileDialog({
                        title: _('Export Custom Aliases'),
                        initial_name: 'pwa-icon-aliases.json'
                    });
                    dialog.save(window, null, (dlg, res) => {
                        try {
                            const file = dlg.save_finish(res);
                            if (file) {
                                file.replace_contents(
                                    new TextEncoder().encode(jsonStr),
                                    null,
                                    false,
                                    Gio.FileCreateFlags.REPLACE_DESTINATION,
                                    null
                                );
                                exportRow.set_subtitle(_(`Exported successfully to ${file.get_basename()}`));
                            }
                        } catch (e) {
                            // Cancelled by user
                        }
                    });
                }
            } catch (err) {
                logger.error('Failed to export custom aliases', err);
            }
        });

        // Import custom aliases
        const importRow = new Adw.ActionRow({
            title: _('Import Custom Aliases'),
            subtitle: _('Load custom icon aliases from a JSON file')
        });
        const importBtn = new Gtk.Button({
            label: _('Import'),
            valign: Gtk.Align.CENTER
        });
        importRow.add_suffix(importBtn);
        stateGroup.add(importRow);

        importBtn.connect('clicked', () => {
            try {
                if (Gtk.FileDialog) {
                    const dialog = new Gtk.FileDialog({
                        title: _('Import Custom Aliases')
                    });
                    dialog.open(window, null, (dlg, res) => {
                        try {
                            const file = dlg.open_finish(res);
                            if (file) {
                                const [ok, bytes] = file.load_contents(null);
                                if (ok && bytes) {
                                    const json = JSON.parse(new TextDecoder('utf-8').decode(bytes));
                                    if (json && typeof json === 'object' && !Array.isArray(json)) {
                                        const currentVar = settings.get_value('custom-aliases');
                                        const curr = currentVar.deepUnpack ? currentVar.deepUnpack() : {};
                                        let count = 0;
                                        for (const [k, v] of Object.entries(json)) {
                                            if (typeof k === 'string' && typeof v === 'string') {
                                                curr[k] = v;
                                                count++;
                                            }
                                        }
                                        settings.set_value('custom-aliases', new GLib.Variant('a{ss}', curr));
                                        refreshAliases();
                                        importRow.set_subtitle(_(`Successfully imported ${count} alias(es)`));
                                    }
                                }
                            }
                        } catch (e) {
                            // Cancelled by user
                        }
                    });
                }
            } catch (err) {
                logger.error('Failed to import custom aliases', err);
            }
        });

        const clearStateRow = new Adw.ActionRow({
            title: _('Clear Extension State'),
            subtitle: _('Deletes recorded original icon metadata without altering desktop files')
        });
        const clearStateBtn = new Gtk.Button({
            label: _('Clear State'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action', 'flat']
        });
        clearStateRow.add_suffix(clearStateBtn);
        stateGroup.add(clearStateRow);

        clearStateBtn.connect('clicked', () => {
            const dialog = new Adw.AlertDialog({
                heading: _('Clear Extension State?'),
                body: _('This clears the restoration database. Launchers will not be reverted and their original icon paths will no longer be stored.')
            });
            dialog.add_response('cancel', _('Cancel'));
            dialog.add_response('clear', _('Clear'));
            dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);

            dialog.connect('response', (dlg, response) => {
                if (response === 'clear') {
                    stateManager.clearState();
                    clearStateRow.set_subtitle(_('Extension state cleared'));
                    refreshLauncherLists();
                }
            });

            dialog.present(window);
        });

        // ==========================================
        // PAGE 4: DIAGNOSTICS
        // ==========================================
        const diagPage = new Adw.PreferencesPage({
            title: _('Diagnostics'),
            icon_name: 'utilities-terminal-symbolic'
        });
        window.add(diagPage);

        const diagGroup = new Adw.PreferencesGroup({
            title: _('Diagnostic Logging'),
            description: _('View lightweight diagnostic events to verify matching and troubleshooting')
        });
        diagPage.add(diagGroup);

        const debugSwitch = new Adw.SwitchRow({
            title: _('Debug Logging'),
            subtitle: _('Enable detailed matching logs in journal and below')
        });
        settings.bind('debug-logging', debugSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        diagGroup.add(debugSwitch);

        const logActionsRow = new Adw.ActionRow({
            title: _('Recent Activity Log'),
            subtitle: _('View recent matching and detection events')
        });
        const refreshLogsBtn = new Gtk.Button({
            label: _('Refresh'),
            valign: Gtk.Align.CENTER
        });
        const clearLogsBtn = new Gtk.Button({
            label: _('Clear'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat']
        });
        logActionsRow.add_suffix(refreshLogsBtn);
        logActionsRow.add_suffix(clearLogsBtn);
        diagGroup.add(logActionsRow);

        const logTextView = new Gtk.TextView({
            editable: false,
            monospace: true,
            wrap_mode: Gtk.WrapMode.WORD_CHAR,
            top_margin: 8,
            bottom_margin: 8,
            left_margin: 8,
            right_margin: 8
        });

        const logScrolled = new Gtk.ScrolledWindow({
            min_content_height: 240,
            child: logTextView
        });
        diagGroup.add(logScrolled);

        const updateLogDisplay = () => {
            const logs = logger.getRecentLogs();
            const buffer = logTextView.get_buffer();
            if (logs.length === 0) {
                buffer.set_text(_('No log entries recorded yet.'), -1);
            } else {
                buffer.set_text(logs.join('\n'), -1);
            }
        };

        refreshLogsBtn.connect('clicked', updateLogDisplay);
        clearLogsBtn.connect('clicked', () => {
            logger.clearLogs();
            updateLogDisplay();
        });

        updateLogDisplay();
    }
}

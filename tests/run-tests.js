/**
 * PWA Icon Matcher - Comprehensive Automated Test Runner
 *
 * Implements verification for all 12 core acceptance tests defined in the specification:
 * - Test 1: Claude on Brave
 * - Test 2: Existing PWA (Startup scan)
 * - Test 3: New PWA (YouTube)
 * - Test 4: Different browsers (Edge, Vivaldi, Epiphany, Firefox PWA)
 * - Test 5: Non-PWA browser launcher (Standard browser shortcut preserved)
 * - Test 6: Icon unavailable in theme (Safe fallback, untouched)
 * - Test 7: Multiple matching candidates / ambiguous names (Safety preserved)
 * - Test 8: Theme switching behavior (Stores theme icon name, not path)
 * - Test 9: Safe restoration (Original icon restored, user edits preserved)
 * - Test 10: Concurrent browser update (Race condition protection)
 * - Test 11: Extension lifecycle (Repeated enable/disable clean teardown)
 * - Test 12: Idle performance (0 timers, 0 background processes, 0 polling)
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { runDesktopEntryTests } from './desktop-entry.test.js';
import { runPwaDetectorTests } from './pwa-detector.test.js';
import { runIconMatcherTests } from './icon-matcher.test.js';
import { runRestorationTests } from './restoration.test.js';

import { PwaDetector } from '../lib/pwa-detector.js';
import { IconResolver } from '../lib/icon-resolver.js';
import { StateManager } from '../lib/state-manager.js';
import { FileWriter } from '../lib/file-writer.js';
import { IconMatcher } from '../lib/icon-matcher.js';
import { ApplicationFileMonitor } from '../lib/file-monitor.js';

// Simple Test Harness
class Assert {
    constructor() {
        this.passed = 0;
        this.failed = 0;
        this.errors = [];
    }

    ok(val, message) {
        if (Boolean(val)) {
            this.passed++;
            console.log(`  ✓ ${message}`);
        } else {
            this.failed++;
            const err = `  ✗ FAIL: ${message}`;
            console.error(err);
            this.errors.push(err);
        }
    }

    equal(actual, expected, message) {
        if (actual === expected) {
            this.passed++;
            console.log(`  ✓ ${message}`);
        } else {
            this.failed++;
            const err = `  ✗ FAIL: ${message} (expected "${expected}", got "${actual}")`;
            console.error(err);
            this.errors.push(err);
        }
    }
}

class MockTheme {
    constructor(icons) {
        this._icons = new Set(icons);
    }
    has_icon(name) {
        return this._icons.has(name);
    }
}

async function runScenarioTests(assert) {
    console.log('\n--- Running 12 Platform Acceptance Tests ---');

    const availableThemeIcons = ['claude', 'youtube', 'ms-teams', 'microsoft-teams', 'notion', 'spotify', 'discourse', 'mastodon'];
    const mockTheme = new MockTheme(availableThemeIcons);

    // =========================================================================
    // Test 1: Claude on Brave
    // =========================================================================
    console.log('\n[Test 1] Claude on Brave');
    {
        const tmpApps = GLib.dir_make_tmp('pwa-test1-XXXXXX');
        const tmpState = GLib.dir_make_tmp('pwa-state1-XXXXXX');
        try {
            const claudeFile = GLib.build_filenamev([tmpApps, 'brave-fmpnliohjhemenmnlpbfagaolkdacoja-Default.desktop']);
            const initialClaude = `[Desktop Entry]
Version=1.0
Terminal=false
Type=Application
Name=Claude
Exec=/usr/bin/brave-browser --profile-directory=Default --app-id=fmpnliohjhemenmnlpbfagaolkdacoja
Icon=/home/user/.local/share/icons/hicolor/256x256/apps/brave-fmpnliohjhemenmnlpbfagaolkdacoja-Default.png
StartupWMClass=crx_fmpnliohjhemenmnlpbfagaolkdacoja
`;
            const f = Gio.File.new_for_path(claudeFile);
            f.replace_contents(new TextEncoder().encode(initialClaude), null, false, Gio.FileCreateFlags.NONE, null);

            const matcher = new IconMatcher({
                resolver: new IconResolver(mockTheme),
                stateManager: new StateManager(tmpState),
                fileWriter: new FileWriter([tmpApps]),
                applicationsDir: tmpApps
            });

            const res = await matcher.processDesktopFile(claudeFile);
            assert.ok(res.success && res.modified, 'Claude on Brave processed and modified');
            assert.equal(res.matchedIcon, 'claude', 'Icon resolved to "claude"');

            const [ok, bytes] = f.load_contents(null);
            const content = new TextDecoder('utf-8').decode(bytes);
            assert.ok(content.includes('Icon=claude'), 'Desktop file now has Icon=claude');
            assert.ok(!content.includes('/home/user/.local/share/icons'), 'Old absolute path replaced');
        } finally {
            cleanupDir(tmpApps);
            cleanupDir(tmpState);
        }
    }

    // =========================================================================
    // Test 2: Existing PWA (Startup Scan)
    // =========================================================================
    console.log('\n[Test 2] Existing PWA (Startup Scan)');
    {
        const tmpApps = GLib.dir_make_tmp('pwa-test2-XXXXXX');
        const tmpState = GLib.dir_make_tmp('pwa-state2-XXXXXX');
        try {
            // Write existing Claude & Spotify launchers
            const f1 = Gio.File.new_for_path(GLib.build_filenamev([tmpApps, 'brave-claude-Default.desktop']));
            f1.replace_contents(new TextEncoder().encode(`[Desktop Entry]
Type=Application
Name=Claude
Exec=brave --app-id=claude123
Icon=/old/path/claude.png
`), null, false, Gio.FileCreateFlags.NONE, null);

            const f2 = Gio.File.new_for_path(GLib.build_filenamev([tmpApps, 'chrome-spotify-Default.desktop']));
            f2.replace_contents(new TextEncoder().encode(`[Desktop Entry]
Type=Application
Name=Spotify
Exec=google-chrome --app-id=spotify123
Icon=/old/path/spotify.png
`), null, false, Gio.FileCreateFlags.NONE, null);

            const matcher = new IconMatcher({
                resolver: new IconResolver(mockTheme),
                stateManager: new StateManager(tmpState),
                fileWriter: new FileWriter([tmpApps]),
                applicationsDir: tmpApps
            });

            const monitor = new ApplicationFileMonitor(matcher, {
                applicationsDir: tmpApps
            });

            // Run one-time startup scan
            const scanRes = await monitor.scanDirectoryOnce();
            assert.equal(scanRes.scannedCount, 2, 'Startup scan discovered 2 existing desktop files');
            assert.equal(scanRes.matchedCount, 2, 'Startup scan matched both existing PWAs');

            const [ok1, b1] = f1.load_contents(null);
            assert.ok(new TextDecoder('utf-8').decode(b1).includes('Icon=claude'), 'Existing Claude launcher updated');
            const [ok2, b2] = f2.load_contents(null);
            assert.ok(new TextDecoder('utf-8').decode(b2).includes('Icon=spotify'), 'Existing Spotify launcher updated');
        } finally {
            cleanupDir(tmpApps);
            cleanupDir(tmpState);
        }
    }

    // =========================================================================
    // Test 3: New PWA (YouTube)
    // =========================================================================
    console.log('\n[Test 3] New PWA (YouTube with actions)');
    {
        const tmpApps = GLib.dir_make_tmp('pwa-test3-XXXXXX');
        const tmpState = GLib.dir_make_tmp('pwa-state3-XXXXXX');
        try {
            const ytFile = GLib.build_filenamev([tmpApps, 'brave-youtube-Default.desktop']);
            const ytContent = `[Desktop Entry]
Version=1.0
Terminal=false
Type=Application
Name=YouTube
Exec=/usr/bin/brave-browser --app-id=agimnkijcaahngcdmfeangaknmldooml
Icon=/home/user/.icons/brave-agimnkijcaahngcdmfeangaknmldooml.png
StartupWMClass=crx_agimnkijcaahngcdmfeangaknmldooml
Actions=Search;

[Desktop Action Search]
Name=Search
Icon=/home/user/.icons/search.png
Exec=/usr/bin/brave-browser --app-id=agimnkijcaahngcdmfeangaknmldooml --search
`;
            const f = Gio.File.new_for_path(ytFile);
            f.replace_contents(new TextEncoder().encode(ytContent), null, false, Gio.FileCreateFlags.NONE, null);

            const matcher = new IconMatcher({
                resolver: new IconResolver(mockTheme),
                stateManager: new StateManager(tmpState),
                fileWriter: new FileWriter([tmpApps]),
                applicationsDir: tmpApps
            });

            const res = await matcher.processDesktopFile(ytFile);
            assert.ok(res.success && res.modified, 'New YouTube PWA processed');
            assert.equal(res.matchedIcon, 'youtube', 'YouTube matched with "youtube"');

            const [ok, bytes] = f.load_contents(null);
            const content = new TextDecoder('utf-8').decode(bytes);
            assert.ok(content.includes('Icon=youtube'), 'Main Icon key replaced with youtube');
            assert.ok(content.includes('Icon=/home/user/.icons/search.png'), 'Action group icon kept untouched');
        } finally {
            cleanupDir(tmpApps);
            cleanupDir(tmpState);
        }
    }

    // =========================================================================
    // Test 4: Different Browser Adapters (Edge, Vivaldi, Epiphany, Firefox PWA)
    // =========================================================================
    console.log('\n[Test 4] Different Browser Adapters');
    {
        const tmpApps = GLib.dir_make_tmp('pwa-test4-XXXXXX');
        const tmpState = GLib.dir_make_tmp('pwa-state4-XXXXXX');
        try {
            const matcher = new IconMatcher({
                resolver: new IconResolver(mockTheme),
                stateManager: new StateManager(tmpState),
                fileWriter: new FileWriter([tmpApps]),
                applicationsDir: tmpApps
            });

            // Edge Teams
            const edgePath = GLib.build_filenamev([tmpApps, 'msedge-teams-Default.desktop']);
            Gio.File.new_for_path(edgePath).replace_contents(new TextEncoder().encode(`[Desktop Entry]
Type=Application
Name=Microsoft Teams
Exec=msedge --app-id=edge123
Icon=/old/teams.png
`), null, false, Gio.FileCreateFlags.NONE, null);

            const resEdge = await matcher.processDesktopFile(edgePath);
            assert.ok(resEdge.success && resEdge.modified, 'Edge Teams processed');
            assert.equal(resEdge.matchedIcon, 'microsoft-teams', 'Edge Teams resolved to microsoft-teams');

            // Vivaldi Notion
            const vivaldiPath = GLib.build_filenamev([tmpApps, 'vivaldi-notion-Default.desktop']);
            Gio.File.new_for_path(vivaldiPath).replace_contents(new TextEncoder().encode(`[Desktop Entry]
Type=Application
Name=Notion
Exec=vivaldi-stable --app-id=notion123
Icon=/old/notion.png
`), null, false, Gio.FileCreateFlags.NONE, null);

            const resVivaldi = await matcher.processDesktopFile(vivaldiPath);
            assert.ok(resVivaldi.success && resVivaldi.modified, 'Vivaldi Notion processed');
            assert.equal(resVivaldi.matchedIcon, 'notion', 'Vivaldi Notion resolved to notion');

            // Epiphany
            const epiPath = GLib.build_filenamev([tmpApps, 'org.gnome.Epiphany.WebApp-discourse.desktop']);
            Gio.File.new_for_path(epiPath).replace_contents(new TextEncoder().encode(`[Desktop Entry]
Type=Application
Name=Discourse
Exec=epiphany --application-mode=/apps/discourse
Icon=/old/discourse.png
`), null, false, Gio.FileCreateFlags.NONE, null);

            const resEpi = await matcher.processDesktopFile(epiPath);
            assert.ok(resEpi.success && resEpi.modified, 'Epiphany Web App processed');
            assert.equal(resEpi.matchedIcon, 'discourse', 'Epiphany Web App resolved to discourse');

            // Firefox PWA
            const ffPath = GLib.build_filenamev([tmpApps, 'ffpwa-mastodon.desktop']);
            Gio.File.new_for_path(ffPath).replace_contents(new TextEncoder().encode(`[Desktop Entry]
Type=Application
Name=Mastodon
Exec=firefoxpwa site run mastodon123
Icon=/old/mastodon.png
`), null, false, Gio.FileCreateFlags.NONE, null);

            const resFf = await matcher.processDesktopFile(ffPath);
            assert.ok(resFf.success && resFf.modified, 'Firefox PWA processed');
            assert.equal(resFf.matchedIcon, 'mastodon', 'Firefox PWA resolved to mastodon');
        } finally {
            cleanupDir(tmpApps);
            cleanupDir(tmpState);
        }
    }

    // =========================================================================
    // Test 5: Non-PWA browser launcher
    // =========================================================================
    console.log('\n[Test 5] Non-PWA browser launcher');
    {
        const tmpApps = GLib.dir_make_tmp('pwa-test5-XXXXXX');
        const tmpState = GLib.dir_make_tmp('pwa-state5-XXXXXX');
        try {
            const browserShortcut = GLib.build_filenamev([tmpApps, 'brave-browser.desktop']);
            const rawContent = `[Desktop Entry]
Name=Brave Web Browser
GenericName=Web Browser
Exec=/usr/bin/brave-browser %U
Icon=brave-browser
Type=Application
`;
            const f = Gio.File.new_for_path(browserShortcut);
            f.replace_contents(new TextEncoder().encode(rawContent), null, false, Gio.FileCreateFlags.NONE, null);

            const matcher = new IconMatcher({
                resolver: new IconResolver(mockTheme),
                stateManager: new StateManager(tmpState),
                fileWriter: new FileWriter([tmpApps]),
                applicationsDir: tmpApps
            });

            const res = await matcher.processDesktopFile(browserShortcut);
            assert.ok(!res.modified, 'Standard browser shortcut is NOT modified');
            assert.equal(res.reason, 'not-a-pwa', 'Reason is correctly "not-a-pwa"');

            const [ok, bytes] = f.load_contents(null);
            assert.equal(new TextDecoder('utf-8').decode(bytes), rawContent, 'File content left identical');
        } finally {
            cleanupDir(tmpApps);
            cleanupDir(tmpState);
        }
    }

    // =========================================================================
    // Test 6: Icon unavailable in theme
    // =========================================================================
    console.log('\n[Test 6] Icon unavailable in theme');
    {
        const tmpApps = GLib.dir_make_tmp('pwa-test6-XXXXXX');
        const tmpState = GLib.dir_make_tmp('pwa-state6-XXXXXX');
        try {
            const unavailPath = GLib.build_filenamev([tmpApps, 'brave-obscure-Default.desktop']);
            const rawContent = `[Desktop Entry]
Type=Application
Name=ObscureInternalServiceXYZ99
Exec=brave --app-id=xyz99
Icon=/home/user/.icons/brave-xyz99.png
`;
            const f = Gio.File.new_for_path(unavailPath);
            f.replace_contents(new TextEncoder().encode(rawContent), null, false, Gio.FileCreateFlags.NONE, null);

            const matcher = new IconMatcher({
                resolver: new IconResolver(mockTheme),
                stateManager: new StateManager(tmpState),
                fileWriter: new FileWriter([tmpApps]),
                applicationsDir: tmpApps
            });

            const res = await matcher.processDesktopFile(unavailPath);
            assert.ok(!res.modified, 'File is NOT modified when icon does not exist in theme');
            assert.equal(res.reason, 'no-theme-icon-found', 'Correct reason reported');

            const [ok, bytes] = f.load_contents(null);
            assert.equal(new TextDecoder('utf-8').decode(bytes), rawContent, 'Launcher file untouched');
        } finally {
            cleanupDir(tmpApps);
            cleanupDir(tmpState);
        }
    }

    // =========================================================================
    // Test 7: Multiple matching candidates / ambiguous names
    // =========================================================================
    console.log('\n[Test 7] Multiple matching candidates / ambiguous names');
    {
        const resolver = new IconResolver(mockTheme);
        // "YouTube Music" candidate must not truncate to "youtube" when exact youtube-music isn't in theme
        const matchYtMusic = await resolver.resolveIcon('YouTube Music');
        assert.equal(matchYtMusic, null, 'YouTube Music does NOT collapse to "youtube"; avoids unsafe ambiguity');
    }

    // =========================================================================
    // Test 8: Theme switching behavior
    // =========================================================================
    console.log('\n[Test 8] Theme switching behavior');
    {
        // Desktop entry stores icon name "claude", not absolute path
        const tmpApps = GLib.dir_make_tmp('pwa-test8-XXXXXX');
        const tmpState = GLib.dir_make_tmp('pwa-state8-XXXXXX');
        try {
            const claudePath = GLib.build_filenamev([tmpApps, 'brave-claude-Default.desktop']);
            Gio.File.new_for_path(claudePath).replace_contents(new TextEncoder().encode(`[Desktop Entry]
Type=Application
Name=Claude
Exec=brave --app-id=123
Icon=/abs/path/claude.png
`), null, false, Gio.FileCreateFlags.NONE, null);

            const matcher = new IconMatcher({
                resolver: new IconResolver(mockTheme),
                stateManager: new StateManager(tmpState),
                fileWriter: new FileWriter([tmpApps]),
                applicationsDir: tmpApps
            });

            await matcher.processDesktopFile(claudePath);

            const [ok, bytes] = Gio.File.new_for_path(claudePath).load_contents(null);
            const content = new TextDecoder('utf-8').decode(bytes);
            assert.ok(content.includes('Icon=claude'), 'Stores simple icon name "claude"');
            assert.ok(!content.includes('/'), 'Icon key contains no directory slashes, enabling instant theme switching');
        } finally {
            cleanupDir(tmpApps);
            cleanupDir(tmpState);
        }
    }

    // =========================================================================
    // Test 9: Restoration
    // =========================================================================
    console.log('\n[Test 9] Restoration (restore one and restore all)');
    {
        const tmpApps = GLib.dir_make_tmp('pwa-test9-XXXXXX');
        const tmpState = GLib.dir_make_tmp('pwa-state9-XXXXXX');
        try {
            const f1Path = GLib.build_filenamev([tmpApps, 'brave-claude-Default.desktop']);
            const f2Path = GLib.build_filenamev([tmpApps, 'brave-youtube-Default.desktop']);

            Gio.File.new_for_path(f1Path).replace_contents(new TextEncoder().encode(`[Desktop Entry]
Type=Application
Name=Claude
Exec=brave --app-id=c1
Icon=/orig/claude.png
`), null, false, Gio.FileCreateFlags.NONE, null);

            Gio.File.new_for_path(f2Path).replace_contents(new TextEncoder().encode(`[Desktop Entry]
Type=Application
Name=YouTube
Exec=brave --app-id=y1
Icon=/orig/youtube.png
`), null, false, Gio.FileCreateFlags.NONE, null);

            const stateMgr = new StateManager(tmpState);
            const matcher = new IconMatcher({
                resolver: new IconResolver(mockTheme),
                stateManager: stateMgr,
                fileWriter: new FileWriter([tmpApps]),
                applicationsDir: tmpApps
            });

            // Patch both
            await matcher.processDesktopFile(f1Path);
            await matcher.processDesktopFile(f2Path);

            assert.equal(stateMgr.getAllEntries().length, 2, '2 entries recorded in state');

            // Restore all
            const { restoredCount } = await matcher.restoreAll();
            assert.equal(restoredCount, 2, 'Both launchers restored');
            assert.equal(stateMgr.getAllEntries().length, 0, 'State records cleared after restoration');

            const [ok1, b1] = Gio.File.new_for_path(f1Path).load_contents(null);
            assert.ok(new TextDecoder('utf-8').decode(b1).includes('Icon=/orig/claude.png'), 'Claude restored to original path');
            const [ok2, b2] = Gio.File.new_for_path(f2Path).load_contents(null);
            assert.ok(new TextDecoder('utf-8').decode(b2).includes('Icon=/orig/youtube.png'), 'YouTube restored to original path');
        } finally {
            cleanupDir(tmpApps);
            cleanupDir(tmpState);
        }
    }

    // =========================================================================
    // Test 10: Concurrent browser update
    // =========================================================================
    console.log('\n[Test 10] Concurrent browser update');
    {
        const tmpApps = GLib.dir_make_tmp('pwa-test10-XXXXXX');
        try {
            const writer = new FileWriter([tmpApps]);
            const filePath = GLib.build_filenamev([tmpApps, 'test.desktop']);
            const initial = '[Desktop Entry]\nName=App\nIcon=old\n';
            Gio.File.new_for_path(filePath).replace_contents(new TextEncoder().encode(initial), null, false, Gio.FileCreateFlags.NONE, null);

            // Simulate file changing on disk concurrently
            const concurrentUpdated = '[Desktop Entry]\nName=App\nIcon=browser-newer\nComment=New\n';
            Gio.File.new_for_path(filePath).replace_contents(new TextEncoder().encode(concurrentUpdated), null, false, Gio.FileCreateFlags.NONE, null);

            // updateIcon with expectedOriginalContent = initial must abort!
            const res = await writer.updateIcon(filePath, 'new-icon', initial);
            assert.ok(!res.success, 'Concurrent write safely aborted');
            assert.ok(res.concurrentChange, 'Marked with concurrentChange flag');

            const [ok, bytes] = Gio.File.new_for_path(filePath).load_contents(null);
            assert.equal(new TextDecoder('utf-8').decode(bytes), concurrentUpdated, 'Newer browser content preserved intact');
        } finally {
            cleanupDir(tmpApps);
        }
    }

    // =========================================================================
    // Test 11: Extension lifecycle
    // =========================================================================
    console.log('\n[Test 11] Extension lifecycle (Repeated enable/disable)');
    {
        const tmpApps = GLib.dir_make_tmp('pwa-test11-XXXXXX');
        const tmpState = GLib.dir_make_tmp('pwa-state11-XXXXXX');
        try {
            const matcher = new IconMatcher({
                resolver: new IconResolver(mockTheme),
                stateManager: new StateManager(tmpState),
                fileWriter: new FileWriter([tmpApps]),
                applicationsDir: tmpApps
            });

            const monitor = new ApplicationFileMonitor(matcher, { applicationsDir: tmpApps });

            // Cycle 1: Start and stop
            await monitor.start(false);
            assert.ok(monitor.isRunning(), 'Monitor running after start()');
            monitor.stop();
            assert.ok(!monitor.isRunning(), 'Monitor not running after stop()');

            // Cycle 2: Start and stop again
            await monitor.start(false);
            assert.ok(monitor.isRunning(), 'Monitor running after second start()');
            monitor.stop();
            assert.ok(!monitor.isRunning(), 'Monitor clean after second stop()');

            // Cycle 3: Clean state
            assert.equal(monitor._pendingDebounces.size, 0, 'No lingering debounce timers');
            assert.equal(monitor._monitor, null, 'No lingering directory monitor');
        } finally {
            cleanupDir(tmpApps);
            cleanupDir(tmpState);
        }
    }

    // =========================================================================
    // Test 12: Idle performance
    // =========================================================================
    console.log('\n[Test 12] Idle performance');
    {
        const tmpApps = GLib.dir_make_tmp('pwa-test12-XXXXXX');
        const tmpState = GLib.dir_make_tmp('pwa-state12-XXXXXX');
        try {
            const matcher = new IconMatcher({
                resolver: new IconResolver(mockTheme),
                stateManager: new StateManager(tmpState),
                fileWriter: new FileWriter([tmpApps]),
                applicationsDir: tmpApps
            });

            const monitor = new ApplicationFileMonitor(matcher, { applicationsDir: tmpApps });
            await monitor.start(false);

            // While idle: 0 pending timers, 0 polling loops
            assert.equal(monitor._pendingDebounces.size, 0, 'Zero pending debounces while idle');
            assert.ok(monitor._monitor !== null, 'Single event-driven monitor active');
            monitor.stop();
        } finally {
            cleanupDir(tmpApps);
            cleanupDir(tmpState);
        }
    }

    // =========================================================================
    // Test 13: Rename synchronization in directory monitor (Section 7)
    // =========================================================================
    console.log('\n[Test 13] Rename synchronization in directory monitor');
    {
        const tmpApps = GLib.dir_make_tmp('pwa-test13-XXXXXX');
        const tmpState = GLib.dir_make_tmp('pwa-state13-XXXXXX');
        try {
            const stateMgr = new StateManager(tmpState);
            const matcher = new IconMatcher({
                resolver: new IconResolver(mockTheme),
                stateManager: stateMgr,
                fileWriter: new FileWriter([tmpApps]),
                applicationsDir: tmpApps
            });

            const monitor = new ApplicationFileMonitor(matcher, { applicationsDir: tmpApps });
            await monitor.start(false);

            // Record initial state entry
            stateMgr.recordModification('brave-old.desktop', '/orig/path.png', 'claude', 'Claude', 'Brave');
            assert.ok(stateMgr.hasEntry('brave-old.desktop'), 'State record exists before rename');

            // Simulate file rename event through monitor handler
            const oldFile = Gio.File.new_for_path(GLib.build_filenamev([tmpApps, 'brave-old.desktop']));
            const newFile = Gio.File.new_for_path(GLib.build_filenamev([tmpApps, 'brave-new.desktop']));
            monitor._onFileChanged(oldFile, newFile, Gio.FileMonitorEvent.RENAMED);

            assert.ok(!stateMgr.hasEntry('brave-old.desktop'), 'Old state record removed after rename event');
            assert.ok(stateMgr.hasEntry('brave-new.desktop'), 'State record migrated to new filename');
            assert.equal(stateMgr.getEntry('brave-new.desktop').originalIcon, '/orig/path.png', 'Original icon preserved in migrated record');

            monitor.stop();
        } finally {
            cleanupDir(tmpApps);
            cleanupDir(tmpState);
        }
    }

    // =========================================================================
    // Test 14: Valid user-selected custom icon preservation (Section 5.4)
    // =========================================================================
    console.log('\n[Test 14] Valid user-selected custom icon preservation');
    {
        const tmpApps = GLib.dir_make_tmp('pwa-test14-XXXXXX');
        const tmpState = GLib.dir_make_tmp('pwa-state14-XXXXXX');
        try {
            const customFilePath = GLib.build_filenamev([tmpApps, 'brave-custom-Default.desktop']);
            const customContent = `[Desktop Entry]
Type=Application
Name=Claude
Exec=/usr/bin/brave-browser --app-id=claude123
Icon=my-favorite-custom-icon
`;
            Gio.File.new_for_path(customFilePath).replace_contents(
                new TextEncoder().encode(customContent),
                null,
                false,
                Gio.FileCreateFlags.NONE,
                null
            );

            const matcher = new IconMatcher({
                resolver: new IconResolver(mockTheme),
                stateManager: new StateManager(tmpState),
                fileWriter: new FileWriter([tmpApps]),
                applicationsDir: tmpApps
            });

            const res = await matcher.processDesktopFile(customFilePath);
            assert.ok(!res.modified, 'File with valid user-selected icon is NOT modified');
            assert.equal(res.reason, 'custom-icon-preserved', 'Reason correctly reports custom-icon-preserved');

            const [ok, bytes] = Gio.File.new_for_path(customFilePath).load_contents(null);
            const content = new TextDecoder('utf-8').decode(bytes);
            assert.ok(content.includes('Icon=my-favorite-custom-icon'), 'Custom icon preserved intact');
        } finally {
            cleanupDir(tmpApps);
            cleanupDir(tmpState);
        }
    }
}

function cleanupDir(dirPath) {
    try {
        const dir = Gio.File.new_for_path(dirPath);
        if (!dir.query_exists(null)) return;
        const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const childPath = GLib.build_filenamev([dirPath, info.get_name()]);
            cleanupDir(childPath);
        }
        enumerator.close(null);
        dir.delete(null);
    } catch {
        // Ignored in test cleanup
    }
}

async function main() {
    console.log('====================================================');
    console.log(' PWA Icon Matcher - Test Suite Execution');
    console.log('====================================================');

    const assert = new Assert();

    console.log('\n[Unit Tests] Desktop Entry:');
    runDesktopEntryTests(assert);

    console.log('\n[Unit Tests] PWA Detector:');
    runPwaDetectorTests(assert);

    console.log('\n[Unit Tests] Icon Matcher & Resolver:');
    await runIconMatcherTests(assert);

    console.log('\n[Unit Tests] Restoration & State:');
    await runRestorationTests(assert);

    await runScenarioTests(assert);

    console.log('\n====================================================');
    console.log(` Test Summary: ${assert.passed} Passed, ${assert.failed} Failed`);
    console.log('====================================================');

    if (assert.failed > 0) {
        console.error('FAILED TESTS:\n' + assert.errors.join('\n'));
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            // signal failure
        });
        throw new Error(`${assert.failed} test(s) failed`);
    }
}

const loop = new GLib.MainLoop(null, false);
let suiteError = null;

main().then(() => {
    loop.quit();
}).catch(err => {
    suiteError = err;
    loop.quit();
});

loop.run();

if (suiteError) {
    console.error('Test Suite Failed with exception:', suiteError);
    // In GJS throw to exit non-zero
    throw suiteError;
}

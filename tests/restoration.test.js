/**
 * PWA Icon Matcher - Restoration & State Preservation Tests
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { StateManager } from '../lib/state-manager.js';
import { FileWriter } from '../lib/file-writer.js';

export async function runRestorationTests(assert) {
    const tmpDir = GLib.dir_make_tmp('pwa-test-state-XXXXXX');
    try {
        const stateMgr = new StateManager(tmpDir);

        // 1. Initial record
        stateMgr.recordModification(
            'brave-test-Default.desktop',
            '/home/user/.icons/hicolor/original.png',
            'claude',
            'Claude',
            'Brave'
        );

        let entry = stateMgr.getEntry('brave-test-Default.desktop');
        assert.ok(entry, 'Entry recorded in state');
        assert.equal(entry.originalIcon, '/home/user/.icons/hicolor/original.png', 'Original icon saved');
        assert.equal(entry.matchedIcon, 'claude', 'Matched icon saved');

        // 2. Critical idempotency test: Reprocessing must NOT overwrite original icon
        stateMgr.recordModification(
            'brave-test-Default.desktop',
            'claude', // simulates reading the already patched icon
            'claude-updated',
            'Claude',
            'Brave'
        );

        entry = stateMgr.getEntry('brave-test-Default.desktop');
        assert.equal(
            entry.originalIcon,
            '/home/user/.icons/hicolor/original.png',
            'Original icon is PRESERVED when reprocessing an already patched file'
        );
        assert.equal(entry.matchedIcon, 'claude-updated', 'Matched icon updated');

        // 3. State file persistence across instances
        const stateMgrReloaded = new StateManager(tmpDir);
        stateMgrReloaded.load();
        const reloadedEntry = stateMgrReloaded.getEntry('brave-test-Default.desktop');
        assert.ok(reloadedEntry, 'Entry persists across StateManager instances');
        assert.equal(reloadedEntry.originalIcon, '/home/user/.icons/hicolor/original.png', 'Persisted original icon intact');

        // 4. Safe restoration with FileWriter
        const appsTmpDir = GLib.dir_make_tmp('pwa-test-apps-XXXXXX');
        try {
            const fileWriter = new FileWriter([appsTmpDir]);
            const testFilePath = GLib.build_filenamev([appsTmpDir, 'brave-test-Default.desktop']);
            const testFile = Gio.File.new_for_path(testFilePath);

            // Create patched file
            const initialContent = '[Desktop Entry]\nName=Claude\nIcon=claude\nExec=brave --app-id=123\n';
            testFile.replace_contents(
                new TextEncoder().encode(initialContent),
                null,
                false,
                Gio.FileCreateFlags.NONE,
                null
            );

            // Restore icon when it matches expected current icon
            const restoreRes = await fileWriter.restoreIcon(
                testFilePath,
                '/home/user/.icons/hicolor/original.png',
                'claude'
            );
            assert.ok(restoreRes.success, 'restoreIcon succeeds when current icon matches');

            const [readOk, readBytes] = testFile.load_contents(null);
            assert.ok(readOk, 'File read ok');
            const restoredContent = new TextDecoder('utf-8').decode(readBytes);
            assert.ok(restoredContent.includes('Icon=/home/user/.icons/hicolor/original.png'), 'Original icon restored to desktop file');

            // 5. User external modification preservation:
            // If user manually changed icon to "my-special-icon", restoreIcon must NOT overwrite it!
            const userModifiedContent = '[Desktop Entry]\nName=Claude\nIcon=user-custom-icon\nExec=brave --app-id=123\n';
            testFile.replace_contents(
                new TextEncoder().encode(userModifiedContent),
                null,
                false,
                Gio.FileCreateFlags.NONE,
                null
            );

            const safeCheckRes = await fileWriter.restoreIcon(
                testFilePath,
                '/home/user/.icons/hicolor/original.png',
                'claude' // expected current icon was claude, but file now has user-custom-icon
            );
            assert.ok(!safeCheckRes.success, 'restoreIcon aborts when file was externally modified');
            assert.ok(safeCheckRes.externallyModified, 'Marks externallyModified flag');

            const [checkOk, checkBytes] = testFile.load_contents(null);
            const checkContent = new TextDecoder('utf-8').decode(checkBytes);
            assert.ok(checkContent.includes('Icon=user-custom-icon'), 'User-modified icon left completely untouched');

            // 6. StateManager renameEntry synchronization test (Section 7)
            stateMgr.recordModification('old-launcher.desktop', '/orig/old.png', 'old-icon', 'App');
            assert.ok(stateMgr.hasEntry('old-launcher.desktop'), 'Old launcher entry exists');
            const renameOk = stateMgr.renameEntry('old-launcher.desktop', 'renamed-launcher.desktop');
            assert.ok(renameOk, 'renameEntry succeeds');
            assert.ok(!stateMgr.hasEntry('old-launcher.desktop'), 'Old entry removed');
            const renamedEntry = stateMgr.getEntry('renamed-launcher.desktop');
            assert.ok(renamedEntry, 'Renamed entry exists');
            assert.equal(renamedEntry.originalIcon, '/orig/old.png', 'Original icon preserved across rename');

            // 7. Security: Reject symlink pointing outside allowed directories
            const symlinkPath = GLib.build_filenamev([appsTmpDir, 'symlink-attack.desktop']);
            try {
                GLib.file_set_contents('/tmp/pwa-symlink-target.desktop', '[Desktop Entry]\nName=Target\n');
                const symFile = Gio.File.new_for_path(symlinkPath);
                symFile.make_symbolic_link('/tmp/pwa-symlink-target.desktop', null);
                assert.ok(!fileWriter.isPathAllowed(symlinkPath), 'Symlink targeting outside directory is rejected');
            } finally {
                const symFile = Gio.File.new_for_path(symlinkPath);
                if (symFile.query_exists(null)) symFile.delete(null);
                const targetFile = Gio.File.new_for_path('/tmp/pwa-symlink-target.desktop');
                if (targetFile.query_exists(null)) targetFile.delete(null);
            }
        } finally {
            // Cleanup appsTmpDir
            const dir = Gio.File.new_for_path(appsTmpDir);
            const child = dir.get_child('brave-test-Default.desktop');
            if (child.query_exists(null)) child.delete(null);
            dir.delete(null);
        }
    } finally {
        // Cleanup state tmpDir
        const dir = Gio.File.new_for_path(tmpDir);
        const stateFile = Gio.File.new_for_path(GLib.build_filenamev([tmpDir, 'pwa-icon-matcher', 'state.json']));
        if (stateFile.query_exists(null)) stateFile.delete(null);
        const subDir = Gio.File.new_for_path(GLib.build_filenamev([tmpDir, 'pwa-icon-matcher']));
        if (subDir.query_exists(null)) subDir.delete(null);
        dir.delete(null);
    }
}

/**
 * PWA Icon Matcher - Desktop Entry Tests
 */

import {
    parseExecArgs,
    parseDesktopEntry,
    patchDesktopEntryIcon,
    validateDesktopEntry
} from '../lib/desktop-entry.js';

export function runDesktopEntryTests(assert) {
    // 1. Argument parsing with quotes and field codes
    const args1 = parseExecArgs('/usr/bin/brave-browser --profile-directory=Default --app-id=xyz123 %U');
    assert.equal(args1.length, 3, 'parseExecArgs strips %U field code');
    assert.equal(args1[0], '/usr/bin/brave-browser', 'Executable path parsed');
    assert.equal(args1[2], '--app-id=xyz123', 'App ID argument parsed');

    const args2 = parseExecArgs('"quoted binary with spaces" "--app-launch-url=https://example.com/a b" %f');
    assert.equal(args2.length, 2, 'Handles quoted arguments and spaces');
    assert.equal(args2[0], 'quoted binary with spaces', 'Quoted binary preserved');
    assert.equal(args2[1], '--app-launch-url=https://example.com/a b', 'Quoted flag preserved');

    // 2. Desktop entry parsing
    const sample = `[Desktop Entry]
Version=1.0
Name=Test Application
Exec=/usr/bin/test --app-id=123
Icon=/path/to/icon.png
StartupWMClass=crx_123
Type=Application
Actions=NewWindow;

[Desktop Action NewWindow]
Name=New Window
Icon=/path/to/other.png
Exec=/usr/bin/test --new-window
`;

    const parsed = parseDesktopEntry(sample);
    assert.ok(parsed.isValid, 'parseDesktopEntry reports valid');
    assert.equal(parsed.name, 'Test Application', 'Extracts Name');
    assert.equal(parsed.icon, '/path/to/icon.png', 'Extracts Icon');
    assert.equal(parsed.startupWmClass, 'crx_123', 'Extracts StartupWMClass');
    assert.equal(parsed.type, 'Application', 'Extracts Type');
    assert.equal(parsed.actions.length, 1, 'Extracts Actions');
    assert.equal(parsed.actions[0], 'NewWindow', 'Action name correct');

    // 3. Patching Icon preserves other groups and keys
    const patched = patchDesktopEntryIcon(sample, 'test-app');
    assert.ok(patched.includes('Icon=test-app'), 'Icon patched in [Desktop Entry]');
    assert.ok(patched.includes('Icon=/path/to/other.png'), 'Action icon preserved intact');
    assert.ok(patched.includes('StartupWMClass=crx_123'), 'Other keys preserved');
    assert.ok(patched.includes('[Desktop Action NewWindow]'), 'Action group preserved');
    assert.ok(validateDesktopEntry(patched), 'Patched content validates with KeyFile');

    // 4. Preserves CRLF line endings
    const crlfSample = '[Desktop Entry]\r\nName=App\r\nIcon=old\r\n';
    const patchedCrlf = patchDesktopEntryIcon(crlfSample, 'new-icon');
    assert.ok(patchedCrlf.includes('\r\n'), 'Preserves CRLF line endings');
    assert.ok(patchedCrlf.includes('Icon=new-icon\r\n'), 'Patched line has CRLF');

    // 5. Appends Icon if not previously present
    const noIconSample = '[Desktop Entry]\nName=App\nExec=cmd\n';
    const patchedNoIcon = patchDesktopEntryIcon(noIconSample, 'added-icon');
    assert.ok(patchedNoIcon.includes('Icon=added-icon'), 'Icon appended when missing');
}

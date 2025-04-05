import Gio from 'gi://Gio';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

export async function getBootEntries() {
    const proc = Gio.Subprocess.new(
        ['efibootmgr'],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
    );
    const [stdout, stderr] = await proc.communicate_utf8_async(null, null);
    if (!proc.get_successful()) {
        throw new Error('Failed to get boot entries');
    }
    return new Map([...stdout.matchAll(/Boot([0-9]{4})\* ([^\t\r\n]*)/g)].map(m => [m[1], m[2]]));
}

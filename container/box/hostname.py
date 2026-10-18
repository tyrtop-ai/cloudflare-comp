# The box's host name (capability boxes, v8 live 5).
#
#   python3 -I /opt/box/hostname.py box-<16 hex> -- command [args...]
#
# Runs the command with the box's own name as its host name. The platform
# names a box's VM after its Durable Object, with a label longer than the 63
# characters a host name label may have, and Python's socket.getfqdn (which
# http.server's HTTPServer calls when it binds) fails on it with "encoding
# with 'idna' codec failed (UnicodeError: label too long)": no Python stdlib
# server could start in a box. Every command of an agent's session runs
# through this (src/box-session.js BOX_HOSTNAME), and so does the S0 probe's
# hostname item.
#
# The command gets UTS and mount namespaces of its own, whose host name is
# the box's name, with an /etc/hosts that resolves that name (127.0.1.1, as
# Debian does) without asking any DNS server. A session's commands run as the
# box's root, which may make those namespaces itself and keeps its
# capabilities in them; its mounts are made private first, so the /etc/hosts
# mount stays in the command's namespace. Any other user makes them inside a
# new user namespace that maps it to itself (unshare --user). Then it execs
# the command.
#
# When the namespaces cannot be made, the command still runs, under the
# platform's host name. BOX_HOSTNAME_STATUS, in the command's environment,
# says which: 'set', or why not; the S0 probe reports it, and nothing else
# reads it.
import ctypes, errno, os, re, socket, sys

CLONE_NEWNS = 0x00020000
CLONE_NEWUTS = 0x04000000
CLONE_NEWUSER = 0x10000000
MS_RDONLY, MS_REMOUNT, MS_BIND, MS_REC, MS_PRIVATE = 0x1, 0x20, 0x1000, 0x4000, 0x40000
NAME = re.compile(r'box-[0-9a-f]{16}\Z')


def write(path, text):
    with open(path, 'w') as f:
        f.write(text)


def code(n):
    return errno.errorcode.get(n, str(n))


def hosts_text(name):
    try:
        with open('/etc/hosts') as f:
            lines = [l for l in f.read().splitlines() if name not in l.split()]
    except OSError:
        lines = []
    if not any('localhost' in l.split()[1:] for l in lines if l.strip() and not l.lstrip().startswith('#')):
        lines.insert(0, '127.0.0.1\tlocalhost')
    return '\n'.join(lines + [f'127.0.1.1\t{name}', ''])


def bind_hosts(libc, text):
    # The file is unlinked once mounted (the mount keeps it) and the mount is
    # read-only: no check can change what the name resolves to.
    path = f'/tmp/.box-hosts-{os.getpid()}'
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
    try:
        os.write(fd, text.encode())
    finally:
        os.close(fd)
    try:
        if libc.mount(path.encode(), b'/etc/hosts', None, ctypes.c_ulong(MS_BIND), None) != 0:
            return 'hosts: ' + code(ctypes.get_errno())
        if libc.mount(None, b'/etc/hosts', None, ctypes.c_ulong(MS_BIND | MS_REMOUNT | MS_RDONLY), None) != 0:
            return 'hosts read-write: ' + code(ctypes.get_errno())
        return ''
    finally:
        os.unlink(path)


def enter(name):
    libc = ctypes.CDLL(None, use_errno=True)
    uid, gid, hosts = os.geteuid(), os.getegid(), hosts_text(name)
    root = uid == 0
    if libc.unshare(CLONE_NEWUTS | CLONE_NEWNS | (0 if root else CLONE_NEWUSER)) != 0:
        return 'unshare: ' + code(ctypes.get_errno())
    private = True
    try:
        if root:
            private = libc.mount(b'none', b'/', None, ctypes.c_ulong(MS_REC | MS_PRIVATE), None) == 0
        else:
            write('/proc/self/setgroups', 'deny')
            write('/proc/self/uid_map', f'{uid} {uid} 1\n')
            write('/proc/self/gid_map', f'{gid} {gid} 1\n')
        socket.sethostname(name)
    except OSError as e:
        return f'sethostname: {code(e.errno)}'
    if not private:
        note = 'hosts: private mounts: ' + code(ctypes.get_errno())
    else:
        try:
            note = bind_hosts(libc, hosts)
        except OSError as e:
            note = f'hosts: {code(e.errno)}'
    return 'set' + (f' ({note})' if note else '')


def main(argv):
    if len(argv) < 3 or not NAME.match(argv[0]) or argv[1] != '--':
        sys.stderr.write('usage: hostname.py box-<16 hex> -- command [args...]\n')
        return 2
    name, command = argv[0], argv[2:]
    os.environ['BOX_HOSTNAME_STATUS'] = enter(name) if socket.gethostname() != name else 'set'
    os.execvp(command[0], command)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
